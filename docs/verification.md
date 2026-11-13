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
checksums, missing files, and failed output writes. The source manifest lists 61
reviewed project files. The archive checksum, ZIP contents, extracted application
startup/navigation, and an identical second build were checked locally.

No GitHub repository, commit, tag, push, or published release was created. Follow
[the release guide](release-guide.md) when ready. Archive bytes are reproducible
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
is configured for Python 3.11/3.12 but has not run on GitHub here. The application
has no production-security claim, authenticated accounts, durable notes storage,
or hard resource sandbox for native PDF parsing.
