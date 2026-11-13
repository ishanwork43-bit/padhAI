# Streamlit Community Cloud + Netlify

PadhAI's Python app runs on **Streamlit Community Cloud**. **Netlify** hosts the
static landing page and links to that app. Netlify cannot host a persistent
Streamlit server or its local embedding model. This setup keeps the full Python
implementation; it does not pretend the landing page performs retrieval.

## 1. Deploy the study app

Sign in to [Streamlit Community Cloud](https://share.streamlit.io/) with GitHub,
choose **Create app**, and use:

| Setting | Value |
| --- | --- |
| Repository | `ishanwork43-bit/padhAI` |
| Branch | `main` |
| Main file path | `deployment/streamlit/app.py` |
| Python version (Advanced settings) | `3.12` |

The entry point runs the original root `app.py`. Its adjacent requirements select
the tested Linux CPU PyTorch wheel and the project dependencies. No CUDA GPU is
needed. Start without an OpenAI key: upload, extraction, and local-model search
work without one. The first index build downloads the pinned public embedding
model, so it takes longer than later builds. Cloud resource limits still apply;
start with the small bundled sample documents. Sleeping/restarted instances can
lose session data and need to reload the model.

To enable optional generation later, add a **root-level** `OPENAI_API_KEY` in the
app's Advanced settings / Secrets, using Streamlit's TOML format. Never commit it
or put it in Netlify. Provider usage can incur charges. A publicly accessible app
with a shared key has no per-user spending controls in this MVP.

After deployment, open the actual `https://<chosen-name>.streamlit.app` URL.
Check Home, My Notes, Ask PadhAI, and Quiz Mode. Upload the sample PDF/TXT, build
an index, and verify a question returns the correct source/page before sharing
the URL. A successful landing-page deployment alone does not verify the app.

## 2. Deploy the landing page on Netlify

Import the same GitHub repository into Netlify. The root `netlify.toml` configures
base directory `web`, build command `npm run build`, and publish directory
`web/dist` (the `dist` setting is relative to the base directory).

The root `netlify.toml` now sets **`APP_URL`** under `[build.environment]` to
`https://padhaistudy.streamlit.app/`. Both launch buttons use this public address.
Update that setting if the app's URL changes. Use its HTTPS origin without
credentials, query parameters, or a fragment. No secret belongs in this file or
value: the URL becomes a public link. Builds fail when the URL is invalid.
When building without any `APP_URL`, the landing page
clearly shows **Study app launching soon** and contains no app launch link.
Deploying that pending page does not deploy the Python app.

The page uses local assets and plain HTML/CSS/JavaScript. Only `web/dist` is
published, including the intentionally public sample notes. Python source,
private uploaded notes, local files, and `.env` are never copied by the builder.
The Netlify page has no upload or AI API endpoint. Opening the study app navigates
directly to Streamlit; no WebSocket proxy or iframe is required.

For a local preview without an app URL:

```bash
cd web
npm test
npm run build
python3 -m http.server 8080 --directory dist
```

Open `http://localhost:8080`. The launch button is unavailable until an `APP_URL`
is supplied. To preview the actual link, use
`APP_URL=https://padhaistudy.streamlit.app/ npm run build`.

For an authenticated Netlify CLI deploy, run from `web` after choosing the
intended Netlify account/site:

```bash
APP_URL=https://padhaistudy.streamlit.app/ npm run build
netlify deploy --prod --dir dist --no-build
```

Alternatively, run `netlify build --context production` from the repository root
to use the URL in `netlify.toml`. This build was verified locally with
`netlify build --context production --offline`. The current connection did not
permit Netlify dashboard environment-variable writes, so the public URL is
persisted in the repository's build configuration instead. No new credential is
needed for this integration. Git-based Netlify builds also read this file.
A manual CLI deployment does not by itself connect future GitHub pushes to Netlify.

## Data and access

Hosted uploads reach the Streamlit server and remain in session memory; they do
not stay solely in the user's browser. Embeddings and search run on that server.
Explicit AI-generation actions send selected excerpts to OpenAI when configured.
Source-code visibility on GitHub is separate from the websites' visitor access.
Use the hosting providers' access controls if you need a restricted demo.

## Deployment status

- GitHub: [public source](https://github.com/ishanwork43-bit/padhAI) and
  [v0.1.0 release](https://github.com/ishanwork43-bit/padhAI/releases/tag/v0.1.0).
- Netlify: **[padhai-ishan.netlify.app](https://padhai-ishan.netlify.app)**.
  Deployment `6af795ace4749b2373c80036` connects both launch buttons to Streamlit.
  On 2026-11-14, all seven published files matched the generated build and both
  launch buttons were verified in desktop/mobile browsers.
- Streamlit: **[padhaistudy.streamlit.app](https://padhaistudy.streamlit.app/)**.
  Verified PDF/TXT uploads, duplicate handling, real-model indexing, DBMS/cloud
  searches and source/page citations, unrelated/empty questions, and clearing
  the test session. A fresh launch had an empty notes session.
- Optional AI: the app reports no configured OpenAI key. Answer and quiz buttons
  were verified to stay disabled; no paid generation calls were made.

The static publish folder contains only the landing assets and public samples.
Environment files, Streamlit secrets, local Netlify state, and build configuration
are not served by the Netlify site. Only the public app URL was added for this
connection; no API key or authentication token was put in the frontend or source.

The Netlify deployment was a manual CLI upload. Automatic GitHub-to-Netlify
builds are not connected; import/link this repository in Netlify to enable them.
The existing `netlify.toml` and `APP_URL` setting support that workflow.
GitHub Actions currently tests the Python app and landing-page build.

The v0.1.0 GitHub release offers GitHub's automatically generated source archives.
The separately built ZIP/checksum could not be attached because the release-upload
host rejected the connected credential. The checksum for that separate ZIP must
not be used to validate GitHub's generated archives. Hosting additions are on
`main`, after the v0.1.0 tag.
