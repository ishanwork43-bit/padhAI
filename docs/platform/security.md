# Security and operations

## Trust and ownership

A cryptographically random 32-byte session token is sent only in an HttpOnly cookie. SQLite stores its SHA-256 hash, not the token. Production uses `__Host-`/Secure/Path=/ with SameSite=Lax and fixed expiry. Mutations require an approved Origin, `X-Requested-With: padhai`, and a constant-time checked CSRF token returned during session bootstrap. That CSRF value stays in frontend memory. No notes, session secrets, or answers enter localStorage; only appearance is persisted there.

Every document, job, quiz, submission, and preview query uses the authenticated workspace owner. Client-supplied workspace IDs are not accepted. Guessing a content hash or quiz ID does not grant access. This is a bearer-session design: losing a browser cookie loses access, sharing a browser shares access, and there are no accounts or recovery links.

The React UI escapes text, filenames, and quotes. It does not render uploaded Markdown as HTML. Files are never executed or served back as original binaries. There is no arbitrary URL importer or client-controlled model/provider endpoint.

## Bounded work

Uploads use raw bytes with an encoded filename, not an unbounded multipart parser. The ASGI layer caps actual streamed bytes even without Content-Length, validates supplied lengths, limits headers, gives the upload 30 seconds, and accepts at most 16 concurrent requests. Workspaces get request/write/search limits; bootstrap is also limited. Responses include Retry-After where appropriate.

The existing loader validates extension/content, UTF-8, PDFs, page/text counts and chunk bounds. API filenames reject path separators. A subprocess gets only a minimal environment, no provider secrets, 20 CPU seconds, a 25-second parent deadline, 768 MiB address space, 64 descriptors, zero writable file output allowance, and an 8 MiB stdout cap. Native parsing is resource-contained, not fully sandboxed: it still shares the container's OS/filesystem identity. For hostile public scale, add stronger process/container isolation and an authenticated user system.

Indexing and generation use a bounded queue (eight slots, two worker threads). Index builds are serialized. A workspace can have one active job; revisions stop stale results being published after notes change. Pending jobs are marked interrupted on restart. The API does not hold an HTTP request open for an entire build/generation; the UI polls job state. Provider calls retain the existing timeouts and zero automatic retries.

Limits are conservative for a portfolio service. Reverse proxies can aggregate peer rate buckets; arbitrary forwarding headers are intentionally not trusted. These controls are not a distributed DDoS system. The global workspace and character caps can reject requests with safe, retryable errors when full.

## Stored data and deletion

The private SQLite file has mode 0600, foreign keys, secure-delete, WAL, and bounded records. Mount it on a persistent disk owned by the app user. Upload bytes are discarded after parsing. Extracted pages, filenames/metadata, preferences, job output, quiz questions, submitted choices, scores, and bounded activity are durable until deletion/expiry. No access logs or provider exception payloads are emitted by the supplied server command. Host/platform logs and backups need operator review.

Deleting one document invalidates the entire search index and generated study results, removes its filename activity, and deletes its page text. Other notes remain. Adding notes preserves already-created quizzes while invalidating the search index and pending jobs. Clearing notes deletes all documents and derived material/activity; workspace reset cascades all owner records. In-flight work can temporarily retain inputs in process memory or at the provider; its results cannot be committed after the owner/revision is invalidated.

Expiry is fixed at creation (24 hours default, configurable 5 minutes–7 days). Cleanup runs on startup, every 30 seconds while running, and when an expired workspace is accessed. A stopped server cannot run the cleanup loop; its persistent disk retains data until it restarts or the operator removes it. SQLite deletion/WAL truncation are not guarantees about physical sectors, memory, backups, or external provider retention.

AI usage counters contain dates and counts, not notes, and are kept seven days. Provider requests already sent cannot be recalled. The frontend explains these boundaries in Settings.

## AI and citations

Keyless search uses the pinned local MiniLM model and private Chroma collections. Optional OpenAI generation needs an operator switch, server-only key, and user consent. Quotas are reserved transactionally before calls; failures count. Quiz solutions and explanations are omitted from all draft responses. Submission uses validated server questions and the existing scoring function; the result is frozen for that attempt. Retakes generate no new provider call.

The original schema and exact-quote validators remain unchanged. A quote match proves that the quote occurs in an allowed passage; it is not a proof that every interpretation is correct. The UI asks users to inspect evidence. Missing evidence does not trigger a fabricated fallback quiz or answer.

## Operating boundaries

Keep exactly one API process/instance. Monitor disk use, health, failed jobs, memory, workspace capacity, and provider spending without recording note text. Back up only if the retention/privacy policy explicitly covers backups. Do not expose development OpenAPI docs on the production service (the production configuration disables them). Use HTTPS, exact origins, and the supplied no-store/security headers.
