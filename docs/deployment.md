# Preview deployment and private AI

Build with Node 24 using `npm ci`, `npm --prefix frontend ci`, and `npm --prefix frontend run build:netlify`. Publish `frontend/dist` and bundle `netlify/functions`. All provider secrets belong only in the Function runtime, never in a frontend environment file or a public build.

Runtime settings:
- `GROQ_API_KEY`: existing Groq secret, available to deployed Functions.
- `PADHAI_AI_ENABLED=true`: explicit enable switch.
- `PADHAI_AI_ACCESS_HASH`: SHA256 of a cryptographically random private invitation. Share the invitation privately; never commit it.
- `PADHAI_AI_SESSION_SECRET`: an independent cryptographically random base64url secret of at least 43 characters.

Missing settings disable generation. The browser continues to offer local search. Private access expires after eight hours and can be revoked by signing out or rotating the signing secret. Site-wide Blobs maintain atomic quotas; do not replace this with process-memory limits or reset counters to bypass limits.

For a manually built preview, use Netlify CLI with `--no-build`, `--dir frontend/dist`, `--functions netlify/functions`, and a dedicated `--alias groq-preview`. Deployment-only secret overrides can provision the private invitation hash and signing secret without changing production settings. The existing provider key is inherited by the deployed Function; verify its actual runtime behavior without reading its value. CLI `--context` requires a build and should be used only with an actual Netlify build. Never print secret arguments or diagnostic environment dumps.

This task authorizes previews only. Do not use `--prod`, merge into main, delete branches, enable paid services, or rewrite history. Before any later production change, verify actual AI answers/summaries/quizzes, quotas, citations, storage, mobile layouts, and build scanning; record the tested commit and immutable deploy. Obtain explicit production authorization, retain the previous deploy, and verify after promotion. Preview and production have separate local libraries.
