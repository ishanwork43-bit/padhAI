# Deploy the integrated PadhAI platform

The old Netlify/Streamlit sites are the rollback path. These instructions deploy a **new backend** and verify a frontend preview before changing production. Building this branch alone does not remove or change either live site.

## 1. Provision the Python backend

Recommended: Render Docker web service, one instance, Standard plan (at least 2 GB RAM), 1 GB persistent disk. A sleeping free service is unsuitable for a dependable model-backed demo and persistent temporary workspaces. Confirm current host prices before provisioning.

Use `render.yaml` as a Blueprint from `feat/integrated-platform`, or create a service manually:

| Setting | Value |
| --- | --- |
| Repository | `https://github.com/ishanwork43-bit/padhAI` |
| Branch | `feat/integrated-platform` during verification; approved release branch after cutover |
| Runtime | Docker |
| Dockerfile | `deployment/platform/Dockerfile` |
| Docker context | repository root |
| Instance count | **1** |
| Health endpoint | `/api/health` |
| Disk mount | `/data` |
| Auto deploy | Off until verification is complete |

The image runs as UID 10001. Confirm the attached volume is writable by that user; do not make the database world-readable. A fresh Docker named volume inherits `/data` permissions from the image. A host-mounted volume must have suitable ownership. Failed storage permissions cause startup to fail instead of falling back to transient storage.

Set these backend environment variables in the host dashboard:

```dotenv
API_ENV=production
API_ALLOWED_ORIGINS=https://YOUR-STABLE-PREVIEW.netlify.app,https://padhai-ishan.netlify.app
API_DATABASE_PATH=/data/padhai.sqlite3
WORKSPACE_TTL_SECONDS=86400
MAX_WORKSPACES=100
ENABLE_PAID_AI=false
AI_REQUESTS_PER_WORKSPACE=5
AI_REQUESTS_PER_DAY=50
```

Replace the preview placeholder with the actual origin, or initially allow only the production origin and add the exact preview origin once allocated. Do not use wildcard preview domains. There are no required paid provider credentials for search. Build-time model caching requires outbound HTTPS to PyPI, the CPU PyTorch index, and Hugging Face. Runtime model loading is offline.

Wait for a successful deploy and verify `https://YOUR-BACKEND.onrender.com/api/health` returns `{"status":"ok","version":"0.2.0"}`. Record the HTTPS origin. This is a readiness check for the API/database; it does not claim that a model has already been loaded into RAM.

## 2. Build and stage Netlify

The root `netlify.toml` selects `frontend/`, `npm run build:netlify`, and `dist/`. Set **PADHAI_API_ORIGIN** in Netlify to the actual backend origin, for example `https://YOUR-BACKEND.onrender.com`. It is public routing metadata. Do not add OpenAI keys or any `VITE_*` secret to Netlify.

The generated `dist/_redirects` is:

```text
/api/*  https://YOUR-BACKEND.onrender.com/api/:splat  200!
/*  /index.html  200
```

The 200 rewrite proxies the request without navigating the browser away. Cookies, Origin, CSRF, JSON requests, and raw upload bodies travel through the proxy. `Path=/` host-only cookies are issued through the Netlify response. The SPA fallback comes last so API errors remain API errors. No cross-origin browser calls or third-party cookies are required.

For a manual local build and **draft** deploy to the existing site:

```bash
npm --prefix frontend ci
PADHAI_API_ORIGIN=https://YOUR-BACKEND.onrender.com npm --prefix frontend run build:netlify
netlify deploy --site padhai-ishan --dir frontend/dist --alias platform-preview
```

**Do not add `--prod` yet.** Use the actual returned draft origin in `API_ALLOWED_ORIGINS`, redeploy/restart the API configuration, and run the verification below. A stable branch/alias preview is easier to allowlist than a new random deployment URL each time. Preview workspaces use their own origin cookies and will not automatically migrate to production.

Netlify's security headers permit local scripts/fonts and same-origin API connections. Inline styles are allowed because dialog positioning and appearance use style attributes; inline scripts remain blocked. Frontend files must contain no provider keys. Delete any old `APP_URL` environment setting after cutover; the new build does not read it.

## 3. Verify before promotion

At the real preview origin:

1. Open Landing, Dashboard, My Notes, Ask PadhAI, Quiz Mode, and Settings. Refresh `/ask` directly to check SPA routing.
2. Open a workspace; inspect a Secure, HttpOnly, SameSite=Lax, host-only `__Host-padhai_workspace` cookie. API responses must be `Cache-Control: no-store`.
3. Upload the two public samples, build the index, search normalization and IaaS, and read PDF pages/source text in place. No navigation to Streamlit should occur.
4. Open an incognito context: it must have an empty workspace. A copied document or quiz ID must not grant access.
5. Delete a note, confirm its index/results disappear, and rebuild the remaining notes. Clear/reset the workspace.
6. Verify mobile navigation and a 320 px layout. Test offline/unavailable-backend recovery.
7. With paid AI off, generation must explain its availability. If enabling it later, use a small quota and verify a real answer/quiz after consent before claiming live generation works.
8. Restart the backend: notes should survive on disk, interrupted jobs should become failed, and the index should require a rebuild. Confirm expiry and disk ownership in the deployed environment.

The automated browser suite can target the preview:

```bash
cd frontend
E2E_URL=https://ACTUAL-PREVIEW.netlify.app npm run test:e2e
```

It assumes paid AI is off and consumes several temporary workspace slots. Clear test workspaces afterward or let them expire. Peer limits are conservative and may aggregate behind a shared reverse proxy. Never blindly trust arbitrary `X-Forwarded-For`; use a separately authenticated proxy identity strategy if higher public traffic requires per-user-IP controls.

## 4. Promote and retain rollback

After all hosted checks pass, publish the **same verified build** to the existing Netlify production site, or merge the reviewed branch and deploy its commit. For manual publication:

```bash
netlify deploy --site padhai-ishan --dir frontend/dist --prod
```

Re-run the production upload/search smoke check. Keep Streamlit running and retain the previous Netlify deploy. If the replacement fails, restore the previous Netlify deploy through the dashboard; no backend data migration is needed for the legacy interface. Only retire legacy hosting after the replacement has been observed working and the owner chooses to do so.

This implementation is one FastAPI process. **Do not add Uvicorn workers or service replicas**: indexes, job coordination, and rate limits are process-local. Horizontal scaling requires a shared database, job queue, rate limiter, and vector persistence strategy first.

## Local container verification

```bash
docker build -f deployment/platform/Dockerfile -t padhai-api:0.2.0 .
docker volume create padhai-workspaces
docker run --rm --name padhai-api -p 8000:8000 \
  -v padhai-workspaces:/data \
  -e API_ALLOWED_ORIGINS=http://localhost:5173,http://127.0.0.1:5173 \
  padhai-api:0.2.0
```

Run Vite separately. Local HTTP uses the development cookie; set `API_ENV=production` only behind HTTPS with exact HTTPS frontend origins. The health check uses the configured `PORT` (default 8000).

## Optional paid AI

Set `ENABLE_PAID_AI=true`, backend `OPENAI_API_KEY`, and optionally `OPENAI_MODEL=gpt-4o-mini` in the backend's private settings. Restart and opt in from Settings. The frontend receives availability and remaining allowance, never the key. Set provider-side billing limits as well; application quotas reset on workspace expiry/database loss and cannot replace provider billing controls. Default quotas count failed attempts to prevent uncontrolled retries.
