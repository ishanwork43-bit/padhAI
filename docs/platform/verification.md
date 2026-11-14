# Integrated platform verification

Executed locally on Linux on **2026-11-14**, using Python 3.12, Node 24, and headless system Chromium. The production deployments were not changed by these checks.

## Automated coverage

Latest local totals: **564 Python tests**, **12 React/client tests**, **10 hosting tests**, **17 legacy landing tests**, and **2 real browser scenarios**, all passing. TypeScript and the production frontend build also passed.


- The original **523 Python tests** and **17 legacy landing-build tests** are preserved.
- API tests exercise real SQLite and Chroma with fixed test embeddings for deterministic contracts: token hashing, cookie attributes, exact CORS, CSRF, owner isolation for documents/jobs/quizzes, upload validation, real body limits, quotas (including a zero daily AI allowance), expiry, deletion, duplicate uploads, index invalidation, restart behavior, stale in-flight jobs, source pagination, answer retrieval provenance, frozen quiz scoring, and private draft solutions.
- The parser integration test runs actual TXT and two-page PDF extraction in the resource-bounded subprocess.
- React tests exercise actual quiz selection/submission, private pre-submit answers, unanswered confirmation, failure recovery, honest AI availability, and API client session/bootstrap/error/upload behavior.
- Hosting tests verify an exact HTTPS backend origin and proxy ordering, and reject credentials, insecure schemes, injected rules, paths, and missing configuration.
- TypeScript checks and the Vite production build run independently of hosting credentials. Netlify build configuration fails closed when the backend origin is absent.

## Real browser workflow

The Playwright suite uses the actual FastAPI server, document parser, pinned MiniLM model, and Chroma. **No search or embedding API is mocked.** It verifies:

1. Landing → dashboard → upload of the public DBMS PDF and cloud TXT samples.
2. A background index build and real completion state.
3. Normalization search returning the PDF/page-1 evidence, with original source preview and page-2 navigation.
4. IaaS search returning the cloud text note.
5. A separate browser context seeing an empty, isolated library.
6. Honest unavailable-AI state with generation disabled.
7. Saved workspace preferences, light/dark appearance, and clearing all notes/results.
8. Mobile navigation, actual sample insertion/source viewing, and no horizontal overflow at the checked 320/390/768 px notes layouts.

The checked desktop viewport is 1440×1000, with a 390×844 mobile flow. Screenshots under `docs/platform/screenshots/` contain only public sample material and actual app state. They are illustrative captures, not fake AI results.

## Container build

The standalone CPU backend image built successfully with the pinned MiniLM model cached inside it and `pip check` passing. In this managed workspace, the build used a temporary Dockerfile adaptation that mounted the environment CA as a BuildKit secret; TLS verification remained enabled and the CA was not stored in the image. The committed Dockerfile uses normal host trust for Render/CI.

A container smoke check is included in GitHub Actions: real PDF upload, offline cached-model index, retrieval, source preview, deletion, and verification that the process runs as UID 10001. The local VFS Docker builder leaves too little disk to clone the image into a running container, so the runtime check is delegated to CI rather than claimed from the build alone.

## Scope of evidence

Live paid OpenAI generation was **not** executed: no real provider key was configured. API generation/quiz behavior is tested using injected fixtures; the preserved core suite tests SDK transport, JSON/schema handling, exact citations, invalid output, and scoring. These fixtures are test-only and are not an application mode.

The hosted Netlify proxy, real backend volume permissions, platform restart/expiry behavior, and final production cutover still need verification after the new backend is provisioned. Local browser success does not establish hosted availability. Follow the gate in [deployment.md](deployment.md) before promoting a build.
