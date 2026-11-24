# Verification and remaining issues

## Automatic indexing and quiz wording — 2026-11-24

PDF, TXT, and Markdown imports now start local indexing automatically. Matching vectors are reused, per-passage checkpoints survive refreshes, and one Web Lock prevents duplicate indexing across tabs. Failed or stopped jobs offer a retry; Settings provides a forced rebuild. The Quiz Generator uses “Practice What You've Learned” and the requested plain-language description. Twenty questions remains disabled.

Focused local checks passed: 18 unit tests across indexing, storage, study-job tracking, and Quiz controls; seven real-MiniLM browser workflows covering uploads, semantic retrieval/citations, persistence, deletion, mobile widths, malformed files, download failures/retries, stopping, refreshes, cross-tab locking, and Settings rebuilds; and one public-AI browser workflow with a mocked summary provider. The latter checks that automatic preparation preserves anonymous access and explicit consent. TypeScript/Vite build and the source/public-asset credential-pattern scan passed.

No real Groq requests were made. Functions, quota/security code, AI citation validation, and quiz scoring are unchanged. The two preserved architecture branches remain intact. Browser verification ran locally in Chromium; other browser engines were not retested. Completed embedding checkpoints resume; the last unfinished embedding may be recomputed. CI reruns are skipped to avoid duplicating these focused checks.

## Quiz citation fix — 2026-11-22

The reported public-preview failure was reproduced locally: the old quiz contract asked the model to copy a quote, while `verifyCitations()` required an exact substring. PDF item spacing/line breaks, repeated or non-breaking spaces, and straight versus typographic punctuation can produce a semantically similar quote that fails this check. The failing live source/quote pair was not collected, so the specific transformation in that request is unknown.

Quizzes now receive server-numbered evidence excerpts and return only `evidence_ids`. Each ID resolves to the original unmodified text, filename, page, and character offsets; there is no fuzzy matching or replacement of unsupported quotations. Unknown IDs, invalid options, unsupported correct answers, and repeated questions still fail closed. Empty or explicitly insufficient evidence produces an explanation and no saved quiz. Answers and summaries keep their existing citation contract. Twenty-question generation remains disabled.

The duplicated error came from reporting a failed generation to both the toast and the AI-status panel. A failed job now produces one toast; connection errors keep their separate status handling.

Local checks: 34 Function/security tests passed, including complete mocked 5/10-question responses, real PDF.js fixture extraction, exact offsets, long/repeated excerpts, forged IDs, compatibility, and existing quota protections. Fourteen focused frontend tests cover local scoring/citation validation, disabled 20-question controls, and single error notifications. The build and public-bundle credential scan also passed. Exactly one corrected preview was deployed. No real Groq request was made. This verifies the implementation with fixtures, not live model behavior under the new quiz schema.

## Public AI preview — 2026-11-21

Invitations and unlock controls have been replaced by automatic anonymous sessions. The API now enforces per-network limits alongside the existing shared daily counters. Twenty-question generation remains disabled in the UI and is also rejected by the public API.

Local verification: 23 mocked Function/security tests cover anonymous access, network binding, spoofed forwarding headers, cookie resets, challenge signature/work/expiry/origin/replay, durable concurrent quotas, migration of existing shared counters, visitor token budgets, CSRF, consent, and provider failures. Six focused frontend tests passed. The TypeScript/Vite build passed.

One focused local Chromium workflow passed using the real browser proof worker and Function handler with in-memory test storage and a mocked provider: automatic access, no invitation field, consent initially off, saving consent, TXT import, summary generation, persistence after refresh without a second session, and the disabled twenty-question option. External network requests were blocked in this test. No real Groq request or hosted application test was made for this change; provider availability remains subject to the existing runtime secret and free quota.

See [public-access limits and residual risks](deployment.md). Earlier private-access results below are historical evidence, not a description of the current access flow.

## Documentation and cleanup checks — 2026-11-21

The static-hosting regression test passed after removal of the inactive external proxy path (one current routing test replaces twelve tests covering both editions). TypeScript passed with unused-local and unused-parameter checks enabled. Asset preparation passed with network access blocked, using cached files and their pinned hashes. Script syntax, targeted formatting, local Markdown links, and whitespace checks passed.

The current source and existing public bundle passed the credential-pattern scan. A separate filename/path/contact-data review found no suspected exposure. Security Functions, browser processing, dependency locks, licenses, and attribution are unchanged. No full build, browser suite, real Groq request, or deployment was run for this cleanup; previous results below remain historical evidence.

## Manual-review UI update — 2026-11-21

The 20-question option is now disabled and labeled “Coming soon”. Five- and ten-question options remain selectable. Only the quiz UI, its existing focused test, and explanatory documentation changed; generation and security code remain unchanged. All four local quiz tests passed, including disabled-option selection checks. The TypeScript/Vite build also passed. No Groq API calls were made for this update. Production remains unchanged.

## Focused quiz check — 2026-11-21

The original 20-question failures reached output validation but returned a question count other than 20. A strict-schema candidate added exact array bounds while retaining an empty insufficient-evidence response. It passed local fixtures but **did not pass the one permitted real Groq check**.

- 19 focused Function/security tests passed before deploying the candidate, including five new quiz regression tests. These use explicit mocked provider responses, not real generation.
- The source/public-bundle credential-pattern scan and whitespace checks passed.
- Exactly **one** live 20-question request was made for this verification, against preview deploy `6b011d3ae082b93a67b04d36`, candidate commit `b226609`.
- Authentication succeeded. Generation returned HTTP **503**, error **`provider_model`**: “The configured model or response format is unavailable for this account. The owner needs to check Groq access.”
- The Function maps Groq HTTP 400/404/422 to that safe error. Raw provider details were not captured. Schema incompatibility is suspected after the change, but the precise upstream reason is **not confirmed**.
- No real retry or additional generation test was performed. Quotas were not reset or bypassed.
- The candidate schema was rolled back to the previously verified format to protect 5/10-question quizzes. One corrective preview deployment was necessary. All five focused quiz regression tests passed again after rollback; no frontend rebuild or full browser rerun was needed.
- Useful retained changes: positive 20-question validation fixtures, incomplete/oversized response rejection, duplicate/evidence checks, no-retry coverage, and safe errors reporting actual versus requested question counts.

**Remaining blocker:** reliable real 20-question generation is unresolved. The preview rejects incomplete or unsupported quizzes rather than saving them. Local mock success is not evidence that Groq successfully generated 20 questions. Future work should first establish a provider-compatible count constraint locally; another real request requires a separate verification allowance.

## Previously completed checks — 2026-11-20

- 14 Function/security tests passed before the five new quiz tests. Coverage includes private access, HttpOnly cookies/CSRF, revocation, expiry, input limits, missing credentials, simulated wrong provider credentials/429s/network failures, durable concurrent quotas, evidence validation, and duplicate MCQs.
- 18 frontend unit tests and 12 hosting tests passed.
- All five real MiniLM browser regression scenarios passed both locally and on the HTTPS preview: PDF/TXT/Markdown imports, semantic retrieval, page citations, persistence, isolation, deletion, mobile viewports, invalid files, model recovery, and cancellation.
- TypeScript/Vite production build and public-bundle scan passed. Mobile Summary/Quiz/Settings checks passed at widths 320, 390, and 768 pixels.
- Actual Netlify/Groq calls succeeded for an English short answer, a short summary, key takeaways, five-question generation, and ten-question medium-difficulty generation.
- Actual UI checks passed for private unlock, consent, note import, five MCQs, local scoring, score persistence, summary generation, source references, and summary persistence. Screenshots contain public study fixtures only.
- CI passed for `b129756`: [run 44769193708](https://github.com/ishanwork43-bit/padhAI/actions/runs/44769193708). This is baseline evidence, not a claim about later commits.

Broader successful Hinglish/detailed generation, actual UI retakes, and reliable 20-question generation remain unverified. Fault injection and quota-exhaustion checks use mocks to avoid spending live allowance or modifying the real provider key. Source checks reduce fabricated evidence; they do not prove logical entailment or eliminate prompt injection.

## Deployment scope

Preview: https://groq-preview--padhai-ishan.netlify.app

Current corrected preview deploy: `6b0295ba4aea97b38159f87f` (2026-11-22, deterministic quiz evidence). The preceding public-access preview was `6b012381ce02f27ae00cc288`. The earlier UI deploy `6b011ed1e8fcde8d2d90e666`, commit `8471258`, disabled the 20-question option. The preceding corrective deploy `6b011d902e88485aca134e2e` restored the provider schema; neither update made additional live generation requests.

Production remains `6af795ace4749b2373c80036`, confirmed after the candidate deployment on 2026-11-21. No production deployment, main merge, branch deletion, paid upgrade, or history rewrite was performed. Both earlier architecture branches remain preserved.

## Reproduce local checks

```bash
npm test                                      # mocked Function/security tests
npm --prefix frontend test                    # frontend unit tests
npm --prefix frontend run test:hosting         # static routing rules
npm --prefix frontend run build:netlify
npm run test:security                         # source and built-asset pattern scan
```

For browser workflow changes, install Playwright Chromium, start `npm --prefix frontend run preview -- --port 4176 --strictPort`, then run `E2E_URL=http://localhost:4176 npm --prefix frontend run test:e2e` in another terminal. These tests use the real local embedding model. They do not call Groq. Provider failures and quotas use explicit mocks in the Function tests.

The [quiz screenshot](screenshots/quiz.png) records an actual five-question scoring check with public study notes. The README summary screenshot is also from the running application.
