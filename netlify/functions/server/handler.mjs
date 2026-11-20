import { AIError, MODEL, configured, requireConfiguration, requireOrigin, requireCSRF, parseSession, createSession, cookie, digest, equal, keys, readJSON, SecurityStore } from './core.mjs';
import { validateInput, providerPayload, callGroq } from './generation.mjs';
const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' };
const response = (value, status = 200, extra = {}) => new Response(JSON.stringify(value), { status, headers: { ...headers, ...extra } });
export function createHandler({ env = process.env, store, now = Date.now, fetcher = fetch }) {
  return async function handler(request) {
    let security;
    try {
      const action = new URL(request.url).searchParams.get('action') ?? 'status';
      if (!['GET','POST','DELETE'].includes(request.method)) throw new AIError(405, 'method', 'This method is not supported.');
      if (request.method !== 'GET') requireOrigin(request);
      if (action === 'status' && request.method === 'GET' && !configured(env)) return response({ enabled: false, authenticated: false, model: MODEL });
      requireConfiguration(env);
      security = new SecurityStore(typeof store === 'function' ? store() : store, now);
      if (action === 'session' && request.method === 'POST') {
        const body = await readJSON(request, 1000); keys(body, ['access_code']);
        await security.loginAttempt();
        if (typeof body.access_code !== 'string' || body.access_code.length > 128 || !equal(digest(body.access_code), env.PADHAI_AI_ACCESS_HASH)) throw new AIError(401, 'access_code', 'That private access code is not valid.');
        const { session, token } = createSession(env, now());
        await security.register(session);
        return response({ enabled: true, authenticated: true, csrf: session.csrf, expires_at: new Date(session.expires).toISOString(), model: MODEL, quota: await security.status(session.owner) }, 200, { 'Set-Cookie': cookie(token) });
      }
      const session = parseSession(request, env, now());
      await security.authorize(session);
      if (request.method !== 'GET') requireCSRF(request, session);
      if (action === 'status' && request.method === 'GET') return response({ enabled: true, authenticated: true, csrf: session.csrf, expires_at: new Date(session.expires).toISOString(), model: MODEL, quota: await security.status(session.owner) });
      if (action === 'session' && request.method === 'DELETE') {
        await security.revoke(session);
        return response({ authenticated: false }, 200, { 'Set-Cookie': cookie('', 0) });
      }
      if (action !== 'generate' || request.method !== 'POST') throw new AIError(404, 'action', 'This AI action is not supported.');
      const input = validateInput(await readJSON(request));
      const payload = providerPayload(input);
      // UTF-8 byte length is a conservative upper bound on input BPE tokens.
      const tokens = Buffer.byteLength(JSON.stringify(payload.messages)) + Buffer.byteLength(JSON.stringify(payload.response_format)) + payload.max_completion_tokens + 100;
      await security.reserve(session.owner, input.request_id, tokens);
      let result, failure;
      try { result = await callGroq(input, env, fetcher); }
      catch (error) { failure = error; }
      await security.finish(input.request_id, failure?.retryAfter ?? 0);
      if (failure) throw failure;
      return response({ result, quota: await security.status(session.owner), model: MODEL });
    } catch (error) {
      const safe = error instanceof AIError ? error : new AIError(503, 'ai_unavailable', 'AI is temporarily unavailable. Your local notes and search are unaffected.');
      return response({ error: { code: safe.code, message: safe.message, ...(safe.retryAfter ? { retry_after: safe.retryAfter } : {}) } }, safe.status, safe.retryAfter ? { 'Retry-After': String(safe.retryAfter) } : {});
    }
  };
}
