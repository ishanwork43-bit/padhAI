# Verification in progress

Observed on 2026-11-20:

- 14 Function/security tests passed using explicit test-only provider fixtures. Coverage includes unauthorized access, cookies/CSRF, revocation, expiry, input size, absent credentials, wrong provider credentials, 429s, network/malformed output, durable concurrent quotas, evidence validation, and duplicate MCQs.
- 21 frontend/unit tests passed, including bounded local AI context, exact local evidence matching, scoring, original text/IndexedDB checks, and retained quiz interaction tests.
- All 5 real-model browser regression scenarios passed locally: PDF/TXT/Markdown, actual MiniLM embeddings, page citations, persistence, isolation, deletion, mobile viewports, invalid files, model recovery, and cancellation.
- Production TypeScript/Vite build passed.
- An actual private request through the deployed Netlify Function returned HTTP 200 with a Groq-generated, source-checked answer from `openai/gpt-oss-120b`. No provider key was read or printed. Private login and the real Netlify Blobs store also succeeded.

Actual live UI checks also passed for five-question generation, local scoring, score persistence, summary generation, source references, and summary persistence. Screenshots use public study fixtures only.

10/20-question generation, broader language/style coverage, final hosted regressions, final screenshots, cleanup review, public-bundle scanning, and CI at the final commit are still pending. Do not interpret fixture tests as proof of successful real provider generation for those cases.

Development preview: https://groq-preview--padhai-ishan.netlify.app
Initial Function preview deploy: `6b006549c6e1cfdb094049a9`.
Production baseline: `6af795ace4749b2373c80036`, Netlify Free. No production deployment is authorized.
