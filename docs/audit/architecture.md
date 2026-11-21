# Architecture and repository audit

## Runtime boundaries

| Area                                    | Responsibility                                                                           | Storage                                  |
| --------------------------------------- | ---------------------------------------------------------------------------------------- | ---------------------------------------- |
| `frontend/src/browser/`                 | Worker-based PDF parsing, chunking, MiniLM embeddings, retrieval, and local quiz scoring | IndexedDB in the current browser profile |
| `frontend/src/pages/` and `components/` | Notes, search, sources, summaries, quizzes, and settings                                 | Local state and the browser worker       |
| `netlify/functions/`                    | Private access, request validation, Groq calls, and output checks                        | Security metadata in Netlify Blobs       |
| `frontend/scripts/`                     | Integrity-check public model assets and prepare static hosting rules                     | Ignored build output                     |

The embedding model is pinned to a revision and SHA256-checked before use. Each vector has 384 dimensions. PDF citations retain page numbers and character offsets. IndexedDB transactions and revision checks prevent old jobs from overwriting newer document state; deletion invalidates derived results across tabs.

Only reviewed excerpts and the generation request reach Groq. The Function fixes the provider and model, checks structured output against supplied source IDs and exact quotes, and reconstructs citation metadata. Quiz checks also reject repeated questions, duplicate options, and correct answers absent from the evidence. These are structural and textual checks, not a proof of factual correctness or complete prompt-injection protection.

## Privacy and security

Local notes, vectors, summaries, and quizzes belong to one browser profile and origin. Another person using that profile can access them. Clearing site data, browser eviction, or switching origins can remove access; there is no backup or cloud sync. Deleting a note clears associated generated results locally, but cannot recall excerpts already sent to Groq. Provider and hosting policies still apply. Locally stored quiz answers are inspectable, so this is a practice tool rather than an exam system.

Groq credentials exist only in the Function runtime. A high-entropy invitation creates an eight-hour HttpOnly/Secure/SameSite session. Mutations require exact-origin and session-bound CSRF checks; generation also requires consent. Requests have size, context, token, and time limits. Application code neither logs nor persists study content on the server.

Strongly consistent Netlify Blobs and conditional ETag writes enforce shared quotas across Function instances. Daily request/token budgets, an in-flight lease, and request IDs prevent concurrent overspending and duplicate generation. Missing configuration or storage fails closed. Authentication protects provider access, but cannot prevent all public Function invocation abuse or hosting-quota exhaustion.

Reference: [Netlify Blobs consistency and conditional writes](https://docs.netlify.com/build/data-and-storage/netlify-blobs/).

## Preserved editions

The Groq branch was created from browser commit `1edc13f9a17d0548e36d8693f65d99b64fcd13c2`; the original audit began on 2026-11-15.

- `feat/browser-only-padhai`: local-search edition at `1edc13f9a17d0548e36d8693f65d99b64fcd13c2`.
- `feat/integrated-platform`: React/FastAPI/Chroma edition and Python tests at `f5084c497c1c765bad81982145c8d608f8b489c3`.

Use the appropriate branch for those architectures; setting a frontend environment variable does not switch this application to FastAPI. History, authorship, license files, and attribution are retained.

## Cleanup review — 2026-11-21

The tracked-file inventory, imports, package scripts, configuration, documentation, screenshots, and generated-file exclusions were reviewed. Earlier removal of inactive Python, Streamlit, Render, and landing-page files is recorded in the [historical ledger](removed-files.json). Its entries describe removed historical versions; `docs/deployment.md` and `docs/verification.md` were subsequently replaced with current documentation.

This pass removed the redundant `summary-mobile.png` screenshot, the inactive external-FastAPI proxy implementation and its obsolete tests, the unused server-mode asset-preparation switch, and two unused React imports. It corrected the quiz-storage comment and the changelog heading. The README uses the genuine summary screenshot; the genuine quiz screenshot remains linked from verification evidence.

All declared packages have active application, tooling, or type-checking uses. No dependency upgrades or removals were needed. Active components, Function/security code, worker logic, relevant tests, sample notes, licenses, and configuration remain. Generated assets, dependencies, browser reports, and local credentials are excluded from Git; caches were retained to avoid unnecessary downloads. Legacy UI mode conditionals were left in place to avoid a broad rendering refactor.

The working-tree scan found no known credential patterns, unexpected sensitive filenames, personal contact information, or absolute local paths. A credential-shaped URL in the removed proxy tests was test data. Pattern scans cannot prove the absence of every secret format. No provider requests, deployments, or history changes were part of this cleanup.
