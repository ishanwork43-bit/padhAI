import { visitorId, createChallenge, verifyChallenge } from './visitor.mjs';
import { AIError, MODEL, configured, requireConfiguration, requireOrigin, requireCSRF, parseSession, createSession, cookie, keys, readJSON, SecurityStore } from './core.mjs';
import { validateInput, providerPayload, callGroq } from './generation.mjs';
const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' };
const response = (value, status = 200, extra = {}) => new Response(JSON.stringify(value), { status, headers: { ...headers, ...extra } });
export function createHandler({ env = process.env, store, now = Date.now, fetcher = fetch }) {
  return async function handler(request, context) {
    let security;
    try {
      const action = new URL(request.url).searchParams.get('action') ?? 'status';
      if (!['GET','POST'].includes(request.method)) throw new AIError(405, 'method', 'This method is not supported.');
      if (request.method !== 'GET') requireOrigin(request);
      if (action === 'status' && request.method === 'GET' && !configured(env)) return response({ enabled: false, authenticated: false, model: MODEL });
      requireConfiguration(env);
      security = new SecurityStore(typeof store === 'function' ? store() : store, now);
      const owner = visitorId(context, env, now());
      if (action === 'challenge' && request.method === 'POST') {
        await security.admission(owner);
        if (request.body) keys(await readJSON(request, 100), []);
        return response(createChallenge(owner, new URL(request.url).origin, env, now()));
      }
      if (action === 'session' && request.method === 'POST') {
        await security.admission(owner);
        const proof = verifyChallenge(await readJSON(request, 2000), owner, new URL(request.url).origin, env, now());
        await security.consumeChallenge(proof.id, proof.expires);
        const { session, token } = createSession(env, now(), owner);
        return response({ enabled: true, authenticated: true, csrf: session.csrf, expires_at: new Date(session.expires).toISOString(), model: MODEL, quota: await security.status(owner) }, 200, { 'Set-Cookie': cookie(token) });
      }
      const session = parseSession(request, env, now(), owner);
      if (request.method !== 'GET') requireCSRF(request, session);
      if (action === 'status' && request.method === 'GET') return response({ enabled: true, authenticated: true, csrf: session.csrf, expires_at: new Date(session.expires).toISOString(), model: MODEL, quota: await security.status(owner) });
      if (action !== 'generate' || request.method !== 'POST') throw new AIError(404, 'action', 'This AI action is not supported.');
      const input = validateInput(await readJSON(request));
      if (input.task === 'quiz' && input.count === 20) throw new AIError(400, 'quiz_unavailable', 'Twenty-question quizzes are coming soon. Choose 5 or 10 questions.');
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
