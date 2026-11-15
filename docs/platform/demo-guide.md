# A three-minute PadhAI demo

Use only the repository's public sample notes when recording screenshots or a portfolio video. Start a fresh workspace before the demo, verify the backend connection, and build the index once if avoiding first-model-load delay matters. Explain that warm-up honestly.

1. **Show the landing page and dashboard (20 seconds).** “PadhAI brings notes, semantic search, sources, and practice into one React workspace.” Counts are real and start empty.
2. **Add the two samples (30 seconds).** Use My Notes → Upload notes, choose `dbms_notes.pdf` and `cloud_computing.txt`, and process them. Show the library filter and PDF preview.
3. **Ask a real question (60 seconds).** Build the index and ask “How does database normalization reduce redundancy?” Open the PDF source and its page reference. Ask “What is IaaS in cloud computing?” to show a result from the other document. Explain that search uses local embeddings and needs no paid provider key.
4. **Show optional practice (30 seconds).** If a backend key and consent are enabled, generate five questions, submit, read a source-backed explanation, and retake. Otherwise show the honest availability state and explain the server-only integration; do not present a fixture as a live AI response.
5. **Show control and engineering (40 seconds).** Change appearance, show fixed expiry and storage rules, and delete notes. Point to the preserved core validators, FastAPI ownership/CSRF tests, real browser integration tests, and the deployment cutover gate.

## Defensible portfolio description

“Built an integrated React/FastAPI study platform with local semantic retrieval, page-level source previews, optional citation-validated generation, and server-scored quizzes. Added isolated temporary workspaces, bounded background jobs, deletion/expiry controls, and automated API/UI/browser tests. Prepared Netlify reverse-proxy and Render container deployment.”

Only add “deployed” after the new hosted preview and production workflow have passed. Avoid claims of production scale, end-to-end encryption, permanent account storage, or perfect AI accuracy. The earlier retrieval report is a small fixed learning dataset, not a benchmark guarantee.

## Recovery during a demo

- **First index is slow:** show the queued/running state and explain model warm-up. A restart requires rebuilding in-memory indexes.
- **No relevant passages:** rephrase against material actually in the notes; the app does not invent evidence.
- **AI unavailable or quota used:** continue with search and sources. Do not expose a key in the browser or a recording.
- **Workspace expired:** start a new workspace and re-upload the public samples. The expiry is intentional and shown in Settings.
- **Backend offline:** use the reconnect state and fix the backend; do not claim the previous Streamlit app is the new architecture.
