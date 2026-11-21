import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const MODEL = 'openai/gpt-oss-120b';
export const LIMITS = Object.freeze({ body: 24000, sources: 8, sourceBytes: 4400, dayRequests: 20, dayTokens: 180000, visitorRequests: 5, visitorTokens: 45000, cooldown: 60000, lease: 45000, session: 8 * 3600000 });
export class AIError extends Error {
  constructor(status, code, message, retryAfter) { super(message); Object.assign(this, { status, code, retryAfter }); }
}
export const fail = (code, message = 'This request is not supported.') => { throw new AIError(400, code, message); };
export const digest = (value) => createHash('sha256').update(value).digest('hex');
export const equal = (a, b) => typeof a === 'string' && typeof b === 'string' && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));
export const object = (value) => value && typeof value === 'object' && !Array.isArray(value);
export function keys(value, required, optional = []) {
  if (!object(value) || required.some(k => !Object.hasOwn(value, k)) || Object.keys(value).some(k => ![...required, ...optional].includes(k))) fail('invalid_fields');
}
export function text(value, max, min = 1) {
  if (typeof value !== 'string' || value.trim().length < min || value.length > max || /[\u0000-\u0008\u000b-\u001f\u007f]/u.test(value)) fail('invalid_text', 'Use readable text within the displayed limits.');
  return value.trim();
}
export async function readJSON(request, max = LIMITS.body) {
  if (!/^application\/json(?:;|$)/i.test(request.headers.get('content-type') ?? '')) throw new AIError(415, 'content_type', 'Send a JSON request.');
  const reader = request.body?.getReader();
  if (!reader) fail('empty_request');
  const chunks = []; let size = 0, timer;
  const deadline = new Promise((_, reject) => { timer = setTimeout(() => { void reader.cancel().catch(() => {}); reject(new AIError(408, 'request_timeout', 'The request took too long to arrive.')); }, 5000); });
  try {
    while (true) {
      const { value, done } = await Promise.race([reader.read(), deadline]); if (done) break;
      size += value.byteLength;
      if (size > max) { await reader.cancel(); throw new AIError(413, 'request_size', 'Send fewer source passages.'); }
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch (error) { if (error instanceof AIError) throw error; fail('invalid_json', 'The request could not be read.'); } finally { clearTimeout(timer); }
}
export function configured(env) {
  return env.PADHAI_AI_ENABLED === 'true' && !!env.GROQ_API_KEY && /^[A-Za-z0-9_-]{43,100}$/.test(env.PADHAI_AI_SESSION_SECRET ?? '');
}
export function requireConfiguration(env) {
  if (!configured(env)) throw new AIError(503, 'ai_disabled', 'AI is not configured. Local search is still available.');
}
export function requireOrigin(request) {
  const url = new URL(request.url), origin = request.headers.get('origin');
  if (url.protocol !== 'https:' || origin !== url.origin || request.headers.get('sec-fetch-site') === 'cross-site') throw new AIError(403, 'origin', 'Open PadhAI directly and try again.');
}
const cookieName = '__Host-padhai_ai';
export const cookie = (token, age = LIMITS.session / 1000) => `${cookieName}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${age}`;
export function createSession(env, now, owner) {
  const session = { nonce: randomBytes(24).toString('base64url'), csrf: randomBytes(24).toString('base64url'), owner, expires: now + LIMITS.session };
  const encoded = Buffer.from(JSON.stringify(session)).toString('base64url');
  return { session, token: `${encoded}.${createHmac('sha256', env.PADHAI_AI_SESSION_SECRET).update(encoded).digest('base64url')}` };
}
export function parseSession(request, env, now, owner) {
  const token = (request.headers.get('cookie') ?? '').split(';').map(s => s.trim()).find(s => s.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1);
  if (!token || token.length > 1500) throw new AIError(401, 'locked', 'Verify this browser connection to continue.');
  const [value, signature, extra] = token.split('.');
  const expected = createHmac('sha256', env.PADHAI_AI_SESSION_SECRET).update(value).digest('base64url');
  if (extra || !equal(signature, expected)) throw new AIError(401, 'locked', 'Your AI session is invalid. Retry the AI connection.');
  let session; try { session = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')); } catch { throw new AIError(401, 'locked', 'Retry the AI connection.'); }
  if (!object(session) || !equal(session.owner, owner) || !Number.isFinite(session.expires) || session.expires <= now || session.expires > now + LIMITS.session || typeof session.nonce !== 'string' || typeof session.csrf !== 'string') throw new AIError(401, 'locked', 'Your AI session expired or your network changed. Retry the AI connection.');
  return session;
}
export function requireCSRF(request, session) {
  if (!equal(request.headers.get('x-padhai-csrf'), session.csrf)) throw new AIError(403, 'csrf', 'Refresh your AI session and try again.');
}
/** All security state is strongly consistent and modified using atomic ETag CAS. */
export class SecurityStore {
  constructor(store, now = Date.now) { this.store = store; this.now = now; }
  async read(key) {
    try { return await this.store.getWithMetadata(key, { type: 'json', consistency: 'strong' }); }
    catch { throw new AIError(503, 'quota_storage', 'AI protection is temporarily unavailable. No new AI request was started.'); }
  }
  async change(key, update) {
    for (let attempt = 0; attempt < 8; attempt++) {
      const current = await this.read(key);
      const { data, result } = update(current?.data);
      let written;
      try { written = await this.store.setJSON(key, data, current ? { onlyIfMatch: current.etag } : { onlyIfNew: true }); }
      catch { throw new AIError(503, 'quota_storage', 'AI protection is temporarily unavailable. Please try later.'); }
      if (written.modified) return result;
    }
    throw new AIError(503, 'quota_contention', 'AI protection is busy. Please try again shortly.');
  }
  async admission(owner) {
    const window = Math.floor(this.now() / 600000);
    return this.change('public-admission', old => {
      const data = old?.window === window ? old : { window, count: 0, owners: {} };
      if (data.count >= 120 || (data.owners[owner] ?? 0) >= 12) throw new AIError(429, 'connection_limit', 'Too many AI connection attempts. Try again later.', 600);
      data.count++; data.owners[owner] = (data.owners[owner] ?? 0) + 1;
      return { data };
    });
  }
  async consumeChallenge(id, expires) {
    return this.change('public-challenges', old => {
      const data = Object.fromEntries(Object.entries(old ?? {}).filter(([, until]) => until > this.now()));
      if (data[id]) throw new AIError(409, 'challenge_used', 'This browser check was already used. Retry the AI connection.');
      if (Object.keys(data).length >= 120) throw new AIError(429, 'connection_limit', 'AI connection checks are busy. Try again later.', 180);
      data[id] = expires; return { data };
    });
  }
  current(old) {
    const day = new Date(this.now()).toISOString().slice(0, 10);
    return old?.day === day ? { ...old, visitorTokens: old.visitorTokens ?? {} } : { day, requests: 0, tokens: 0, owners: {}, visitorTokens: {}, ids: [], next: old?.next ?? 0, lease: old?.lease ?? null };
  }
  quota(data, owner) {
    return { remaining: Math.max(0, Math.min(LIMITS.dayRequests - data.requests, LIMITS.visitorRequests - (data.owners[owner] ?? 0))), token_budget_remaining: Math.max(0, Math.min(LIMITS.dayTokens - data.tokens, LIMITS.visitorTokens - (data.visitorTokens[owner] ?? 0))), next_request_at: Math.max(data.next, data.lease?.until ?? 0), resets_at: `${new Date(this.now() + 86400000).toISOString().slice(0, 10)}T00:00:00.000Z` };
  }
  async status(owner) { return this.quota(this.current((await this.read('quota'))?.data), owner); }
  async reserve(owner, id, tokens) {
    return this.change('quota', old => {
      const data = this.current(old), now = this.now();
      if (data.ids.includes(id)) throw new AIError(409, 'already_requested', 'This generation was already started. Check its result before retrying.');
      const until = Math.max(data.next, data.lease?.until ?? 0);
      if (until > now) throw new AIError(429, 'cooldown', 'The shared free AI allowance is cooling down. Please wait before generating again.', Math.ceil((until - now) / 1000));
      if (data.requests >= LIMITS.dayRequests || (data.owners[owner] ?? 0) >= LIMITS.visitorRequests || data.tokens + tokens > LIMITS.dayTokens || (data.visitorTokens[owner] ?? 0) + tokens > LIMITS.visitorTokens) throw new AIError(429, 'daily_quota', 'The daily AI allowance is used. Local search and existing quizzes still work.', Math.ceil((Date.parse(this.quota(data, owner).resets_at) - now) / 1000));
      data.requests++; data.tokens += tokens; data.owners[owner] = (data.owners[owner] ?? 0) + 1; data.visitorTokens[owner] = (data.visitorTokens[owner] ?? 0) + tokens; data.ids.push(id);
      data.next = now + LIMITS.cooldown; data.lease = { id, until: now + LIMITS.lease };
      return { data, result: this.quota(data, owner) };
    });
  }
  async finish(id, retryAfter = 0) {
    return this.change('quota', old => {
      const data = this.current(old);
      if (data.lease?.id === id) data.lease = null;
      if (retryAfter) data.next = Math.max(data.next, this.now() + Math.min(retryAfter, 3600) * 1000);
      return { data };
    });
  }
}
