# Preview deployment and public AI

## Build and hosting

Use Node.js 24:

```bash
npm ci
npm --prefix frontend ci
npm --prefix frontend run build:netlify
```

Netlify publishes `frontend/dist` and bundles `netlify/functions`. The non-forced SPA fallback handles application routes; `/api/ai` belongs to the Function. This branch has no external FastAPI proxy.

For a manually built preview, use Netlify CLI with `--no-build`, `--dir frontend/dist`, `--functions netlify/functions`, and a dedicated preview alias. CLI `--context` requires an actual Netlify build. Keep the tested commit and deploy ID in the release record. The current review URL is https://groq-preview--padhai-ishan.netlify.app.

## Runtime secrets

Configure these only for the Netlify Function runtime:

| Setting                    | Purpose                                                             |
| -------------------------- | ------------------------------------------------------------------- |
| `GROQ_API_KEY`             | Provider credential                                                 |
| `PADHAI_AI_ENABLED=true`   | Explicit generation enable switch                                   |
| `PADHAI_AI_SESSION_SECRET` | Independent random base64url signing secret, at least 43 characters |

Never put secrets in frontend code, `VITE_` variables, public build artifacts, screenshots, or logs. `.env.example` lists names only. A preview can receive deployment-only overrides without changing production settings. Do not print CLI secret arguments or environment dumps. Missing settings disable generation while local search remains available. `PADHAI_AI_ACCESS_HASH` and old invitations are no longer used; remove obsolete overrides from future deployments.

## Anonymous access and quotas

Visitors need no invitation or account. AI pages automatically check for an anonymous session and, if needed, solve a short proof of work in a browser worker. This sends no study content. Explicit excerpt-sharing consent in Settings is still required before generation.

The Function uses **Netlify's trusted `context.ip`**, not client forwarding headers. IPv4 addresses and IPv6 /64 networks map to keyed daily hashes; raw IP addresses are not stored by application code. Cookies are signed, HttpOnly, Secure, SameSite=Strict, and bound to that network/day. They last up to eight hours. Browser checks are signed, origin-bound, expire after three minutes, require a 16-bit SHA256 proof, and can be consumed only once. A missing trusted address fails closed.

Durable limits apply across Function instances and previews:

- Shared: **20 requests and 180,000 reserved tokens per UTC day**, with a one-minute cooldown and an in-flight lease.
- Per visitor network: **5 requests and 45,000 reserved tokens per UTC day**. Clearing cookies or forging browser headers does not reset these counters.
- Session setup: **12 attempts per network and 120 globally per ten-minute window**, including challenge and session requests. Challenge-replay records are bounded and pruned on use.

Large requests may exhaust a token budget first. Failed provider requests consume reservations; there are no automatic generation retries. Existing daily counters are preserved when upgrading from private access. Do not reset Blobs counters to bypass quotas. Local search, saved results, and quiz retakes remain available when AI quota is exhausted.

Proof of work is a speed bump, not a CAPTCHA or proof of humanity. Bots can solve it, rotate networks, or exhaust the shared allowance or setup limit. People behind a shared network may share quotas; VPN/network changes can require another browser check. Heavy public traffic can exhaust Netlify Free invocation/storage/bandwidth limits even without successful Groq requests. The application caps provider usage; it cannot guarantee availability under attack. No paid upgrades or unrestricted provider proxy are enabled. See [architecture and privacy](audit/architecture.md).

## Production review

Production is unchanged; the current release is a preview for manual review. Before promotion, review the [verification record](verification.md), obtain owner approval, retain the previous deploy, and check the promoted application. Preview and production origins have separate IndexedDB libraries. Do not merge, promote, enable paid services, or delete preserved branches as part of documentation maintenance.
