# Browser edition verification

Local verification on 2026-11-15, Node 24, Python 3.12, and Chromium on Linux. These results concern the browser-only branch; they do not imply testing on every physical phone or browser engine.

| Check | Result |
| --- | --- |
| Preserved Python/API suite | 564 passed |
| Frontend unit tests, including existing HTTP/quiz tests | 18 passed |
| Static/server hosting configuration tests | 12 passed |
| TypeScript + production browser build | Passed |
| TypeScript + server-mode frontend build | Passed |
| Browser-only Playwright suite with actual model and files | 5 passed locally; 5 passed on Netlify HTTPS |
| Retained server-mode Playwright workflow against real FastAPI/MiniLM | 2 passed |

## What the browser tests exercise

The tests use the real two-page `sample_data/dbms_notes.pdf`, real cloud-computing TXT, and a Markdown fixture. PDF.js extracts selectable text in a worker; Transformers.js loads the actual pinned Q8 MiniLM ONNX model and builds 384-dimensional vectors. No embeddings or search answers are mocked.

- Paraphrases rank the expected source first: avoiding duplicate table information → DBMS PDF page 1; transitive dependencies → page 2; renting virtual machines → cloud TXT; converting sunlight into chemical energy → biology Markdown.
- Source previews preserve exact original text and PDF page numbers; previous/next page controls work. HTML in an uploaded note stays literal text and does not execute.
- Refresh retains all three documents, preferences, and the completed vector index. A loaded model searches with the network disabled. This is not a claim that a fresh offline page load works.
- A separate browser context sees an empty library. Two tabs in one context share notes; deleting in one removes the document and invalidates displayed results in the other. Clear-all remains empty after refresh.
- Navigation and library layout have no horizontal overflow at 320, 390, and 768 CSS pixels. Desktop and mobile screenshots are captured from real test data.
- Duplicate, malformed, empty, password-protected, textless, and over-10-MiB files are rejected or deduplicated with existing notes preserved.
- A forced HTTP 503 on the model download produces an actionable error. Restoring the connection and retrying successfully rebuilds the real index without losing notes. The client restarts the failed ONNX runtime worker on explicit retry.
- Stopping an in-progress model download leaves source previews usable; restarting indexing succeeds and persists after refresh.
- Browser-mode Quiz Mode has an unavailability explanation and no generation action. The workflow sends no `/api` request, third-party request, or document/question payload over the network.

Unit tests additionally cover UTF-8/UTF-16 decoding, binary/unsupported content, source offsets, vector scoring/overlap handling, IndexedDB rollback, serialized cross-connection writes, and revision checks that reject stale commits after deletion/reset.

## Reproduce

```bash
npm --prefix frontend ci
npm --prefix frontend test
npm --prefix frontend run test:hosting
npm --prefix frontend run build:netlify
npm --prefix frontend run preview -- --port 4174 --strictPort
# In another terminal; install Playwright Chromium first if needed:
E2E_URL=http://localhost:4174 npm --prefix frontend run test:e2e
python -m pytest -q
```

Use `CHROMIUM_PATH=/usr/bin/chromium` only when selecting a system Chromium. To exercise the retained FastAPI workflow, start its API and a `VITE_PADHAI_MODE=server` Vite instance, then use `E2E_MODE=server E2E_URL=http://localhost:5173 npm --prefix frontend run test:e2e`.

## Preservation and limits

The full-stack branch remains at `f5084c497c1c765bad81982145c8d608f8b489c3`. `api/`, `src/`, and their Python tests are unchanged in this branch. `frontend/src/lib/http-api.ts` is byte-for-byte the original HTTP client. Existing quiz/answer generation code remains behind server mode. Generated assets and test artifacts are excluded from source releases; the model is fetched from its pinned revision during build.

Chromium desktop/mobile viewport emulation is verified. Physical low-memory phones and native Safari/Firefox have not yet been tested. The English-focused model is a retrieval model, not an answer generator. Scanned PDF OCR and encrypted-PDF decryption are not implemented. Browser storage can be cleared or evicted; retain original files. Netlify Free usage limits still apply.

## Screenshots

[Desktop workspace](screenshots/dashboard.png) · [Mobile library](screenshots/mobile.png) · [Landing page](screenshots/landing.png)

## Hosted preview and production preparation

- Preview: https://browser-preview--padhai-ishan.netlify.app
- Immutable tested deployment: https://6af96d1ab0605621c3593074--padhai-ishan.netlify.app
- Netlify deploy ID: `6af96d1ab0605621c3593074`
- Application source commit: `adf3cf92a573d3996208efe5bf8d68be609045bd` (subsequent documentation/test synchronization changes do not alter the deployed application).
- GitHub PR and CI checks: https://github.com/ishanwork43-bit/padhAI/pull/2

All five integration scenarios passed against the actual HTTPS preview, using its real model, workers, and security headers (1 minute 36 seconds). `/`, `/ask`, and `/settings` return the app directly with HTTP 200. Model configuration returns JSON and the runtime returns `application/wasm`. The delivered CSP permits only same-origin connections, workers, and WebAssembly compilation; `nosniff`, frame denial, no-referrer, and disabled camera/microphone/geolocation headers are present. No browser request to an API or third-party origin occurred in the complete import/search workflow.

The CI persistence test waits for the saved workspace name before refreshing; clicking Save alone does not mean its asynchronous IndexedDB transaction has committed. The fresh CI workflow also installs from the lockfile, verifies/downloads pinned model files, and runs the real-model browser suite.

Netlify's account plan was read back as **Free**. Production remains at deploy `6af795ace4749b2373c80036`; neither it nor the Streamlit app was replaced. The tested build and a file-hash manifest are retained for production promotion. Follow [the cutover guide](deployment.md) after the preview is approved. Preview and production storage remain separate origins.
