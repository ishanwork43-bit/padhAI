# PadhAI: a 5–7 minute portfolio demo

Use the included public sample notes and the keyless workflow. The recorded
verification includes real local retrieval, while answer and quiz API paths were
tested with simulated provider responses. No live OpenAI success is claimed.

## Prepare before presenting

From the project root, activate the virtual environment and run:

```bash
source .venv/bin/activate
python -m pytest -q
python -m pip check
python -m evaluation.smoke_retrieval
```

The smoke check downloads the pinned public embedding model on first use and
checks the same sample queries used below. Do this before the timed demo. After
the weights are cached, start a deliberately keyless, offline-model session:

```bash
OPENAI_API_KEY='' HF_HUB_OFFLINE=1 python -m streamlit run app.py
```

The empty process variable overrides any key in `.env`. Open the printed Local
URL, usually http://localhost:8501. Keep `.env`, account settings, and credentials
out of the screen share. No screenshots or secret-bearing setup screens are
needed; demonstrate the running app using only the included sample files.

If this is your first installation, follow [the README](../README.md) first.
Commands and test results were verified on Linux; the macOS instructions have
not been run on a Mac in this delivery.

## Presentation script

| Time | Action | Explain |
| --- | --- | --- |
| 0:00–0:30 | Show Home. | “PadhAI helps students inspect and search their notes, with optional evidence-backed AI answers and quizzes. This demo uses local retrieval without an API key.” |
| 0:30–1:30 | Open **My Notes**. Upload `sample_data/dbms_notes.pdf` and `sample_data/cloud_computing.txt`; click **Process selected files**. Choose the PDF and page 1; expand **Inspect chunks**. | “The loader checks actual content and limits, preserves PDF page numbers, and creates overlapping chunks. TXT has no invented page number. These notes remain in this session's memory.” |
| 1:30–2:30 | Open **Ask PadhAI** and click **Build search index**. Search `What reduces redundancy in relational tables?` with **Find passages**. | “The expected leading source is `dbms_notes.pdf`, page 1. This is an original passage with its source, not a generated answer. Local embeddings and Chroma rank related chunks.” |
| 2:30–3:15 | Search `Who manages the operating system in IaaS?`. | “The expected leading source is `cloud_computing.txt`, with no page number. Source metadata follows the passage through the pipeline.” |
| 3:15–3:45 | Search `What are the symptoms of influenza?`. | “The sample notes are unrelated; the verified smoke run returned no passages above the 0.25 similarity threshold. That threshold is a heuristic, so this example does not prove reliable abstention on every question.” |
| 3:45–4:30 | Return to **My Notes**, select `dbms_notes.pdf`, and click **Remove this document**. Open **Ask PadhAI** again. | “Changing notes clears stale passages, answers, quizzes, and the index. I must rebuild before searching the remaining notes. Deletion cannot leave an old source answer on screen.” |
| 4:30–5:30 | Give the architecture explanation below. | Connect one input file to one retrieved passage and explain the limits of source validation. |
| 5:30–6:30 | Show [verification](verification.md) and [retrieval results](retrieval-results.md). Open **Quiz Mode** briefly to show the honest disabled state. | “Tests cover boundaries and failures. The real-model fixture is small; API generation is optional, and there is no pretend local quiz generator.” |

The expected rankings refer to the included samples and pinned model. If your
runtime produces a different result, show it honestly and inspect the passages;
do not present an expected outcome as an observed result.

## Explain the architecture in 60 seconds

> Streamlit collects the upload and passes its bytes to a loader that validates
> the type, size, encoding, and PDF readability. It returns pages with document
> identity and page metadata. A chunker makes overlapping text windows with exact
> offsets. A pinned Sentence Transformers model creates local CPU embeddings;
> long inputs are split before encoding to avoid silently losing their tails.
> Chroma stores those vectors in an opaque collection for this session. A question
> uses the same embedder, and search returns known chunks with their original
> metadata. Local retrieval gives passages, not generated language. Optional OpenAI
> answers use selected excerpts only after a separate button click; each accepted
> claim needs a known source and an exact source quote. Those checks establish
> evidence existence, not logical correctness. Quizzes use extracted chunks
> directly and need no index. Scores are computed locally after submission.

## Demonstrate testing and measurement accurately

The verification record reports **523 passing tests** for the completed MVP.
Use the current terminal result if later changes alter that count. Ordinary tests
use deterministic embedding substitutes, real Chroma, and simulated API replies;
they require neither a paid API call nor a model download.

To reproduce the real-model evaluation outside the timed demo:

```bash
HF_HUB_OFFLINE=1 python -m evaluation.run_retrieval --output evaluation/results.json
```

The stored measurement uses **8 documents / 8 chunks**, **18 answerable questions**,
and **2 unanswerable questions**. K counts distinct documents:

| Metric | K=1 | K=3 | K=5 |
| --- | ---: | ---: | ---: |
| Hit@K, 18 answerable questions | 100% | 100% | 100% |
| Macro Recall@K, 18 answerable questions | 94.4% | 100% | 100% |

Unanswerable-query false positives: **0 of 2** at threshold 0.25. The corpus/labels
were fixed before measurement. This is a tiny hand-authored learning fixture,
not a held-out or representative benchmark. Two negative questions do not
calibrate abstention, and two Hinglish questions do not prove multilingual quality.
The JSON records the dataset hash, model revision, package versions, and each
query ranking. Retrieval metrics do not measure answer or quiz correctness.

## Optional live API extension

Only use this extension if you have privately configured your own OpenAI key and
accept the API charges. The delivered verification had no real key; it does not
establish live answer/quiz quality or availability. Stop the deliberately keyless
server and restart without the empty-key override after configuring `.env` off-screen.

- **Answer:** retrieve relevant passages, then click **Generate AI answer**.
  Explain that the current question and selected excerpts are sent to OpenAI.
  Review each displayed quote against the claim. Do not call quote membership
  a proof that the answer is true.
- **Quiz:** upload notes and open **Quiz Mode**; a search index and embedding-model
  download are unnecessary. Choose five easy questions and click **Generate quiz**.
  A short source may correctly yield insufficient material. Submit before showing
  the explanations, citations, and score. An unanswered item scores zero;
  **Retake this quiz** uses the same questions without another request.

Excerpts can contain personal information from the notes, even though separate
filename/page metadata is omitted from the request. `store=False` does not imply
zero provider retention. If generation is unavailable or a response fails
validation, show the fallback/error honestly; there is no accepted partial quiz.

## Fallback plan

- **No internet:** pre-cache the model and verify the smoke command with
  `HF_HUB_OFFLINE=1` before the presentation. Cached offline inference is the
  preferred fallback; the offline flag cannot download missing weights.
- **Missing cache/model failure:** continue with upload validation, page/chunk
  inspection, keyless states, code, and recorded evaluation artifacts. Explain
  that local retrieval is currently blocked; do not simulate live search results.
- **No API key or API failure:** complete the keyless script. Use the source code
  and test cases to explain answers/quizzes rather than claiming a live request.
- **Session reset:** upload the two samples again and rebuild. Notes and indexes
  are temporary; the app is not a persistent account-based service.

## Interview prompts

- Why use RAG rather than ask a model from memory? Where can retrieval still fail?
- Why preserve page numbers and offsets before embedding?
- Why are characters different from tokens, and what does weighted window
  averaging lose compared with indexing each window separately?
- How do opaque Chroma namespaces prevent accidental cross-session retrieval?
  What authentication and cleanup guarantees are still absent?
- Why distinguish Hit@K from Recall@K on multi-document questions? Why measure
  negatives separately instead of mixing their denominator into Recall@K?
- What do exact quote checks prove, and what do they leave unverified?
- Why does changing notes invalidate the index, answer, and quiz state?
- Why do API tests use fixtures, and what remains to test with a real provider?

## Two truthful résumé bullets

- Built PadhAI, a Python/Streamlit study companion with PDF/TXT/Markdown ingestion,
  page-aware chunks, local Sentence Transformers embeddings, session-isolated
  Chroma retrieval, and optional source-validated OpenAI answers and scored MCQs;
  verified boundaries and failures with 523 automated tests.
- Created a reproducible retrieval evaluation with dataset/model provenance;
  achieved Hit@1 of 100% and macro Recall@1 of 94.4% on 18 answerable questions
  across eight sample documents, with 0/2 negative-query false positives on a
  small hand-authored fixture; documented its limited generalizability.

Keep “optional” and the dataset qualification when adapting these bullets.
Do not add production adoption, live API success, or general accuracy claims that
this project has not measured.
