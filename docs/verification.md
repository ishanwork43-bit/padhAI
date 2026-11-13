# Final verification

The portfolio MVP was checked in the supplied Linux environment with Python
3.12.14, Streamlit 1.67.0, PyMuPDF 1.28.2, sentence-transformers 5.7.0,
PyTorch 2.15.0+cpu, Chroma 1.5.9, OpenAI SDK 2.54.0, and pytest 9.2.0.

## Automated checks

- `python -m pytest -q`: **523 passed**.
- `python -m pip check`: no broken requirements.
- Ordinary tests require neither a paid API call nor an embedding-model download.
  They use fixed test vectors/tiny fake models, real in-memory Chroma, SDK HTTP
  fixtures, and Streamlit AppTest.
- Coverage includes extraction/encoding/PDF failures, byte/page/character limits,
  metadata/chunk offsets, model/vector validation, workspace isolation, atomic
  index replacement, deletion, query limits, and stale-result invalidation.
- Answer and quiz tests cover strict schemas, duplicate JSON keys, source/quote
  mapping, fabricated references, unsafe Unicode, refusal/truncation, bounded
  context, API failures, and explicitly triggered retries.
- Quiz checks cover 5/10/20 questions, all difficulties, four distinct options,
  strict answer indexes, unanswered scoring, frozen submissions, retakes, and
  resets after settings or note changes.
- Evaluation tests verify metric denominators, partial multi-document recall,
  document deduplication, invalid labels, dataset fingerprints, and the explicit
  distinction between injected test embeddings and actual-model reports.

## Release preparation

Version 0.1.0 was prepared locally. The focused code review found no release-blocking
issue in the reviewed validation/state/retrieval paths. This is not a guarantee
that all defects have been found.

The full suite includes 57 release-builder tests for allowlisting, secret/cache
exclusion, version validation, traversal/symlink handling, reproducible ZIP bytes,
checksums, missing files, and failed output writes. The original v0.1.0 source manifest lists 61
reviewed project files; the current main-branch manifest adds the hosting files. The archive checksum, ZIP contents, extracted application
startup/navigation, and an identical second build were checked locally.

The original release preparation was local. Subsequently, the source and
`v0.1.0` tag were pushed to the public GitHub repository at the owner's request.
GitHub Actions passed for both Python 3.11 and 3.12 on commit `d42b40b` and the
Community Cloud entry-point commit `d8bb2b0`. See [deployment](deployment.md). Archive bytes are reproducible
for identical source bytes with the same Python/zlib versions; the checksum is
an integrity check rather than a signed publisher identity.

## Real local-model evaluation

The pinned all-MiniLM-L6-v2 model produced 384-dimensional embeddings. The fixed
8-document, 20-question evaluation completed using cached weights with
`HF_HUB_OFFLINE=1` and CPU inference. Of those questions, 18 are answerable and
2 have no relevant corpus document.

| K (unique documents) | Hit@K | Macro Recall@K |
| --- | --- | --- |
| 1 | 100.0% | 94.4% |
| 3 | 100.0% | 100.0% |
| 5 | 100.0% | 100.0% |

Unanswerable false positives: **0/2** at threshold **0.25**. The corpus/labels were
frozen before this run and were not tuned afterward. This small, hand-authored
learning dataset is not a held-out benchmark or a general accuracy estimate.
See [the measured report](retrieval-results.md) and
[full results JSON](../evaluation/results.json) for methodology, model revision,
dataset hash, package versions, and every query ranking.

The three-question real-model smoke check also passed, including a DBMS PDF page
match, a cloud-services text match, and one unrelated query with no returned hit.

## Browser checks

Playwright with system Chromium exercised the actual application for:

- Mixed valid/empty/corrupt uploads, duplicates, PDF page previews, and removal.
- Real local indexing/search, source/page metadata, unrelated and empty queries,
  separate sessions, and deletion followed by rebuilding from remaining notes.
- Keyless answer/quiz states and the current chat exchange.

Separate browser-only harnesses retained real application logic and validation
while simulating provider replies. They checked answer/citation rendering and
failure fallbacks; quiz answers hidden until submission; partial 2/5 scoring with
one unanswered choice; frozen controls; an all-unanswered 0/5 retake; parameter
selection; and malformed-quiz rejection without exposing partial questions.
Harnesses are not part of the delivered app. A prior 390-pixel viewport check found
no horizontal document overflow; this is not complete mobile accessibility testing.

## What remains unverified

No real OpenAI API key was configured, so **live answer and quiz generation were
not tested**. Offline SDK fixtures verify request serialization and error handling,
not live model/service quality. Exact quote/source checks cannot establish logical
support, uniquely correct quiz choices, appropriate difficulty, or prompt-injection
immunity.

macOS setup instructions were written but not executed on a Mac. GitHub Actions
passed on Python 3.11/3.12 for the commits recorded above. The application
has no production-security claim, authenticated accounts, durable notes storage,
or hard resource sandbox for native PDF parsing.


## Hosting preparation checks

The Community Cloud entry point rendered successfully with Streamlit AppTest.
Its CPU requirements resolved against the existing tested environment; a fresh
Community Cloud installation still needs to be checked after deployment.
The landing page passed 17 Node tests for URL validation, pending/linked states,
allowlisted output, and preservation of a prior build after invalid input.
Playwright checked desktop and 390/320-pixel widths, internal navigation, FAQ
expansion, sample downloads, and absence of a broken app launch link. Hosted
Python behavior is not established by these static-page checks.


The Netlify production deployment reached `ready` at
https://padhai-ishan.netlify.app. Live checks confirmed HTTP 200 and matching
build bytes for the page, stylesheet, and sample downloads; an unknown path
returned the custom 404. Its deployed response includes the configured headers.
Live browser checks passed at 1440, 390, and 320 pixels, including FAQ expansion
and the explicit pending app-launch state. CI also passed all three jobs on
commit `3d468a5` (Python 3.11/3.12 and the 17-test Node landing build).
At that initial deployment, the Streamlit app remained unverified and unlinked.

## Connected production app — 2026-11-14

The Netlify frontend now opens `https://padhaistudy.streamlit.app/` from both
**Open PadhAI** buttons. The public destination is persisted in `netlify.toml`.
The 17 existing Node checks and Netlify's local production build passed. Deployment
`6af795ace4749b2373c80036` was checked against the intended seven-file publish set;
every deployed file matched its local build bytes, and the configured response
headers remained active. Requests for `.env`, Streamlit secrets, local Netlify
state, and the build configuration did not serve those files.

Live browser checks covered both launch buttons, the new-tab destination and
absent `window.opener`, the FAQ, sample downloads, desktop and 390/320-pixel
landing layouts, and the hosted app at mobile width. No page exceptions or
horizontal document overflow were found in these checks.

The actual Streamlit application was tested through its hosted app frame:

- PDF/TXT upload, extracted-text preview, and duplicate-file handling.
- Real embedding-model indexing and semantic retrieval of the bundled samples.
- DBMS query matched the PDF on page 1; the IaaS query matched the cloud text.
- An unrelated question returned the no-evidence state; an empty question was rejected.
- Quiz navigation and disabled generation controls with no configured OpenAI key.
- Clearing the test notes invalidated search; a fresh launch contained no prior notes.

Tests used only the public sample documents and cleared their own session.
The app reports no OpenAI key, so live AI answers and quiz generation remain
unverified and disabled. No paid calls were made, and no credentials were added
to the frontend or repository. These checks validate the exercised integration
and workflows; they do not constitute a general security or accessibility audit.
