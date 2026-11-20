# Groq platform audit and preservation

Audit started 2026-11-15 before application changes. The working branch `feat/groq-ai-platform` was created from browser commit `1edc13f9a17d0548e36d8693f65d99b64fcd13c2`.

## Preserved branches

- `feat/integrated-platform`: complete React/FastAPI/Python RAG at `f5084c497c1c765bad81982145c8d608f8b489c3`.
- `feat/browser-only-padhai`: verified local-search-only application at `1edc13f9a17d0548e36d8693f65d99b64fcd13c2`.
- Production deploy observed previously: `6af795ace4749b2373c80036`. Confirm again before and after preview deployment. No production change, branch deletion, merge, or history rewrite is authorized.

## Existing application

React 19 / Vite / Tailwind, worker-based PDF.js text extraction, SHA-pinned Transformers.js Q8 MiniLM, 384-dimensional local vectors, IndexedDB transactions, revision-guarded indexing, exact page/offset source previews, cross-tab invalidation, and accessible responsive navigation are active and will be retained.

The browser branch retains the original FastAPI HTTP adapter and quiz UI, but deliberately disables generation. Python, Streamlit, Docker/Render, the legacy `web/` redirect page, duplicate README, and server deployment instructions are inactive in Netlify browser mode. They are candidates for removal only from this new branch; their complete implementation and original tests remain on the preserved branches.

## Security design decision

Public local search remains usable without an account. Groq generation requires a private, high-entropy access code exchanged for an expiring HttpOnly/Secure/SameSite cookie. Provider credentials exist only in the Function runtime. Each generation requires explicit passage-sharing consent and a session-bound CSRF token. Exact-source quote validation and strict structured output reject invalid citations and malformed quizzes.

Quotas use strongly consistent Netlify Blobs with conditional writes, shared across Function instances, not process memory or Origin alone. Daily global/per-access budgets, an in-flight lease, request deduplication, and output/context caps apply before any provider call. Missing authorization configuration or durable storage fails closed. Public Function invocation abuse cannot be eliminated by application authentication; the Free plan may pause under abuse or quota exhaustion. No paid protection or automatic upgrade is enabled.

Netlify documents strong consistency and atomic `onlyIfMatch`/`onlyIfNew` writes: https://docs.netlify.com/build/data-and-storage/netlify-blobs/

A final removal/retention ledger and verification evidence accompany the completed implementation. No historical commits will be modified.
