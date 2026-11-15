# Browser edition deployment and cutover

This branch deploys the React study interface as a static Netlify site. There is no Python process or provider API in the deployed browser version. The preserved server project remains on `feat/integrated-platform`.

## Build

Use the committed lockfile and Node 24. Run `npm --prefix frontend ci`, then `npm --prefix frontend run build:netlify`. The prebuild verifies SHA256-pinned MiniLM model files, prepares local WASM/PDF resources, and Vite compiles the workers. Generated assets are ignored by Git. Do not upload `.env` files, original private notes, Python data directories, or credentials.

`VITE_PADHAI_MODE` defaults to browser and is explicitly browser in `netlify.toml`. `PADHAI_API_ORIGIN` is unnecessary. No OpenAI or other API key belongs in Netlify settings. The build output is `frontend/dist`. The CSP permits same-origin assets, workers, and WebAssembly compilation; arbitrary inline JavaScript/eval and third-party connections remain blocked.

## Preview

Run `netlify deploy --site padhai-ishan --dir frontend/dist --alias browser-preview --no-build` and use its returned URL. Keep the original production deploy published.

At the actual HTTPS preview:

- Upload the public two-page DBMS PDF, cloud TXT, and a Markdown note. Build a real index and search with a paraphrase. PDF sources must show the correct page and exact original text.
- Refresh and search again without rebuilding. Confirm notes, settings, and 384-dimensional vectors persisted in IndexedDB.
- Open another tab: it shares this browser's local library. Delete a note and confirm both tabs discard it and the old index. Another browser profile/incognito context must have a separate empty library.
- Check mobile navigation and horizontal overflow at 320, 390, and 768 pixels. Open/close a source dialog and change pages.
- Check duplicate, empty, malformed, scanned, encrypted, oversized, and unsupported files. A failure must leave existing notes usable.
- Check that Quiz Mode and generated-answer explanations are honest and cannot call a provider. DevTools should show no `/api` requests or document/question contents in network requests.
- Verify the actual Netlify CSP and worker/model URLs, refreshing deep links such as `/ask` and `/settings`.

Run the automated integration suite with `E2E_URL=https://ACTUAL-PREVIEW.netlify.app npm --prefix frontend run test:e2e`. Use `CHROMIUM_PATH` only if using an already installed Chromium; otherwise install Playwright Chromium first. These tests create only local browser sample data and do not upload it.

## Verified candidate

The verified preview is [browser-preview--padhai-ishan.netlify.app](https://browser-preview--padhai-ishan.netlify.app), deploy `6af96d1ab0605621c3593074`. Its application source is `adf3cf92a573d3996208efe5bf8d68be609045bd`. All five hosted integration scenarios passed; see [verification](verification.md). The previous production deploy `6af795ace4749b2373c80036` remains published.

## Prepare production

After all checks pass, review the preview, record the commit/deploy ID, and keep the exact verified `frontend/dist`. Only after production is approved, run `netlify deploy --site padhai-ishan --dir frontend/dist --prod --no-build`. Recheck sources, refresh, and deletion on the production domain. Retain the previous Netlify deploy and existing Streamlit app as rollback options.

IndexedDB is origin-specific. A preview library does not become a production library; reimport original notes. A rollback does not transfer browser notes to the old Streamlit application. Do not delete either architecture branch.

## Zero-cost boundary

Use the existing Netlify **Free** plan. No Render, Northflank, Railway, paid inference, database, function, or paid Netlify add-on is needed. The roughly 45 MB model/runtime first-load transfer counts against static hosting usage; caches reduce repeat downloads. Free quota exhaustion may pause hosting. Do not upgrade or enable paid usage automatically.
