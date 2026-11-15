# Architecture audit — 2026-11-14

Baseline: `5a7626c` on `main`. The production Netlify landing page and Streamlit
application remain available during development on `feat/integrated-platform`.

| Area | Current state | Replacement decision |
| --- | --- | --- |
| User experience | Static landing page opens Streamlit in another tab | React/Vite/Tailwind application with one navigation, upload/search/quiz screens |
| Document processing | Framework-independent, validated PDF/TXT/MD extraction and page-aware chunks | Reuse; execute untrusted parsing in a bounded subprocess |
| Search | Pinned local MiniLM model and workspace-specific Chroma collections | Reuse behind FastAPI; asynchronous indexing and automatic stale-index invalidation |
| Generation | Optional server API with strict structured-output/evidence validation | Reuse behind consent and server-side quotas; no provider keys in the client |
| State | Streamlit session memory, lost on disconnect/restart | Scoped SQLite records with expiry; HttpOnly opaque workspace cookie; in-memory indexes rebuilt after restart |
| Isolation | Per-Streamlit-session collections | Enforce workspace ownership on every API read/write; CSRF and exact CORS origins |
| Long operations | Streamlit blocking reruns | Bounded jobs with real queued/running/completed/failed states and polling |
| Quiz scoring | Validated questions and frozen server-side score logic | Keep correct answers server-side until submission; real scoring, explanations, retakes |
| Existing checks | 523 Python tests and 17 static-build checks | Preserve; add API, React, and browser integration coverage |
| Deployment | Manual Netlify publish; Streamlit from main | Netlify React frontend proxies `/api` to a Python host; Docker/Render configuration, health checks and cutover guide |

## Scope and retention

This version offers an anonymous private workspace, not fabricated accounts or
billing features. A high-entropy HttpOnly cookie grants access to one workspace.
Extracted text, metadata, settings, jobs, and quiz attempts live in a scoped SQLite
database. Original upload bytes are processed and discarded. Workspace expiry,
explicit document deletion, and workspace reset remove server-side records and
invalidate related indexes and generated state. In-flight operations discard
results when the workspace/revision has changed. Deployment documentation will
state disk/snapshot and in-flight-memory limits accurately.

A single Python process is intentional: index caches, bounded worker queues and
request limits are local to that instance. Multi-instance operation would need
shared jobs/limits and a shared database/index strategy; this release will not
claim that capability. Native PDF resource isolation is not a complete security
sandbox. No paid generation is enabled by default.

## Verification and cutover gate

The React app must pass actual upload → parse → index → semantic-search browser
checks, including source viewing and deletion. API tests will verify isolation,
CSRF, quotas, expiry, stale jobs, and non-disclosure of quiz answers. Production
will stay on the current implementation until a replacement backend and a
Netlify preview pass the same flow. No API credentials are included in bundles.
