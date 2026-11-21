# Preview deployment and private AI

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
| `PADHAI_AI_ACCESS_HASH`    | SHA256 of a cryptographically random private invitation             |
| `PADHAI_AI_SESSION_SECRET` | Independent random base64url signing secret, at least 43 characters |

Share invitations privately. Never put secrets in frontend code, `VITE_` variables, public build artifacts, screenshots, or logs. `.env.example` lists names only. Deployment-only secret overrides can configure a preview without changing production settings; do not print CLI secret arguments or environment dumps. Missing settings disable generation while local search remains available.

## Private access and quotas

In Settings, enter the owner's private invitation and select **Unlock private AI**. Review excerpt-sharing consent and save preferences before generating. An invitation is not a Groq API key. Sessions expire after eight hours; locking revokes the current session, and rotating the signing secret invalidates existing sessions.

Defaults are 20 shared requests per UTC day, a conservative 180,000-token reservation budget, and a one-minute cooldown. Large requests may exhaust the token budget first. Failed provider requests consume reservations; there are no automatic provider retries. Do not reset the durable Blobs counters to bypass quotas.

Groq and Netlify Free limits also apply. Public traffic can exhaust hosting allowance even with private generation. No paid upgrade or unlimited-usage guarantee is included. See [architecture and privacy](audit/architecture.md) for data retention and security boundaries.

## Production review

Production is unchanged; the current release is a preview for manual review. Before promotion, review the [verification record](verification.md), obtain owner approval, retain the previous deploy, and check the promoted application. Preview and production origins have separate IndexedDB libraries. Do not merge, promote, enable paid services, or delete preserved branches as part of documentation maintenance.
