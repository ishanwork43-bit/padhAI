# Changelog

## 0.2.0 — integrated platform (deployment pending)

- React/Vite/Tailwind frontend with six connected pages, responsive navigation and light/dark appearance.
- FastAPI wraps the existing document, Chroma, RAG/citation and quiz pipeline.
- Temporary isolated workspaces, secure cookies/CSRF, bounded jobs/uploads, durable metadata, expiry and deletion controls.
- API, React, hosting and real browser workflow tests; Netlify proxy and Render/Docker deployment configurations.
- The 0.1.0 implementation and public deployments remain available until the replacement passes hosted verification.

## Frontend connection — 2026-11-14

- Connected both Netlify launch buttons to https://padhaistudy.streamlit.app/.
- Persisted the public app URL in Netlify's build configuration and redeployed.
- Verified live uploads, indexing, search/citations, input handling, session cleanup,
  and desktop/mobile launch flows. No credentials were added to the frontend.
- Optional AI generation remains disabled because the app reports no OpenAI key.

## Unreleased hosting additions — 2026-11-13

- Published the source and v0.1.0 tag to GitHub at the owner's requested public visibility.
- Added a Community Cloud entry point with CPU PyTorch deployment requirements.
- Added a Netlify landing page, public samples, deployment guide, and 17 build tests.
- Published the landing page at https://padhai-ishan.netlify.app.
- The landing page shows an explicit pending state until a real Streamlit app URL is set.
- GitHub Actions passed on Python 3.11 and 3.12 for the original release and cloud entry point.

## 0.1.0 — prepared 2026-11-13

Initial portfolio MVP, prepared locally for a first GitHub release.

- PDF, TXT, and Markdown extraction with page-aware overlapping chunks and input limits.
- Local Sentence Transformers embeddings and session-isolated Chroma search.
- Optional OpenAI answers with validated source IDs and exact evidence quotes.
- MCQ quizzes with 5/10/20 questions, difficulty, explanations, scoring, and retakes.
- Failure handling for malformed documents, model/API errors, invalid generated
  output, stale indexes, and changed quiz settings.
- Automated tests, a fixed retrieval dataset, measured results, and GitHub Actions.
- Mac setup instructions, module learning notes, a demo guide, and release tooling.

Live OpenAI generation and macOS installation remain unverified. Retrieval
measurements come from a small hand-authored dataset. No GitHub release has been
published as part of this preparation.
