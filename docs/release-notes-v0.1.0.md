# PadhAI v0.1.0 — study notes, semantic search, and quizzes

PadhAI helps students inspect and search their own PDF, TXT, and Markdown notes.
It runs semantic retrieval locally and can optionally use OpenAI for answers
and quizzes supported by checked source IDs and exact evidence quotes.

## Included

- Upload validation, page metadata, and overlapping text chunks.
- Local embeddings and isolated in-memory Chroma collections.
- Retrieval-only passages when no key is configured or answer generation fails.
- Quizzes with 5/10/20 MCQs, difficulty settings, post-submission explanations,
  unanswered-question handling, frozen scores, and retakes.
- Automated tests, CI configuration, reproducible retrieval evaluation, and
  beginner-oriented architecture and learning documentation.

## Measured retrieval

On the fixed 8-document dataset: Hit@1/3/5 = 100%; macro Recall@1 = 94.4%,
Recall@3/5 = 100%; false positives on unanswerable queries = 0/2. There are
18 answerable and two unanswerable questions. This small hand-authored dataset
is not a general retrieval benchmark; per-query evidence is in `evaluation/results.json`.

## Validation and limits

The local suite passed **523 tests**, and dependency checks passed.
See `docs/verification.md` for the executed automated and browser checks.
The real embedding model was exercised; OpenAI replies were simulated. Live
OpenAI answer/quiz generation, Mac installation, and GitHub-hosted CI remain
unverified. Quote/source checks do not guarantee semantic correctness.

Notes/indexes are session-scoped and not persistent. The project has no production
security claim. OCR, authenticated workspaces, stronger multilingual evaluation,
and calibrated relevance thresholds remain future work.

## Install and demo

Use the README setup instructions and `docs/demo-guide.md`. No API key is required
for local retrieval; the first index build downloads the embedding model. Optional
AI requests send selected excerpts to OpenAI and may incur API charges.

Release files: `padhai-0.1.0.zip` and `padhai-0.1.0.zip.sha256`.
This is prepared release text; publication is a separate manual step described
in `docs/release-guide.md`.
