# Verification and remaining issues

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

Current preview deploy: `6b011ed1e8fcde8d2d90e666`, UI commit `8471258` (20-question option disabled). The preceding corrective deploy `6b011d902e88485aca134e2e` restored the provider schema; neither update made additional live generation requests.

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
