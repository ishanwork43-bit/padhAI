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

Set the Netlify build environment variable **`APP_URL`** to the real Streamlit URL
from step 1. Use its HTTPS origin without credentials, query parameters, or a
fragment. No secret belongs in this value: it becomes a public link. Netlify
builds fail when this URL is invalid. Until it is provided, the landing page
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
`APP_URL=https://YOUR-APP.streamlit.app npm run build` with your real URL.

For an authenticated Netlify CLI deploy, run from `web` after choosing the
intended Netlify account/site:

```bash
APP_URL=https://YOUR-APP.streamlit.app npm run build
netlify deploy --prod --dir dist --no-build
```

Set `APP_URL` in Netlify too when enabling automatic Git-based builds. A manual
CLI deployment does not by itself connect future GitHub pushes to Netlify.

## Data and access

Hosted uploads reach the Streamlit server and remain in session memory; they do
not stay solely in the user's browser. Embeddings and search run on that server.
Explicit AI-generation actions send selected excerpts to OpenAI when configured.
Source-code visibility on GitHub is separate from the websites' visitor access.
Use the hosting providers' access controls if you need a restricted demo.

## Deployment status

The source and v0.1.0 tag have been pushed to the public GitHub repository at the
owner's request. Hosting URLs must be recorded only after their deployments have
completed and have been checked. No live Streamlit or Netlify URL is claimed by
this guide.
