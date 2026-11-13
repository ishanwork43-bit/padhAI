# PadhAI

**Padhai ka smarter way.** Upload your notes, find relevant passages, and test what you know.

**Release candidate: 0.1.0.** A Python study companion built with Streamlit,
PyMuPDF, Sentence Transformers, and Chroma. Search runs locally after the first
embedding-model download. OpenAI answers and quizzes are optional and run only
when you explicitly request them.

## What you can do

- Upload PDF, UTF-8 TXT, and Markdown notes; inspect extracted text and PDF pages.
- Search semantically and see original passages, filenames, and page numbers.
- Request an AI answer with source IDs and exact evidence quotes checked in code.
- Generate 5, 10, or 20 MCQs at easy, medium, or hard difficulty; submit, score,
  review explanations, and retake without another generation request.
- Run deterministic tests and reproduce a small real-model retrieval evaluation.

Notes and vector indexes are isolated by session and held in memory. Refreshing
or disconnecting can lose access to them. Local retrieval returns passages; it
is **not full local AI answer generation**. Quizzes require an OpenAI API key.

## Run locally on your Mac

Install Python 3.11 or 3.12 if needed; Python 3.12 is recommended. Open Terminal
in the extracted project folder:

```bash
python3 --version
python3 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -r requirements-dev.txt
```

For a fresh setup, copy the example settings. Keep an existing `.env` when updating:

```bash
test -e .env || cp .env.example .env
python -m pytest -q
python -m streamlit run app.py
```

Open Streamlit's printed Local URL, usually `http://localhost:8501`. Stop with
Control-C. Activate `.venv` again in each new terminal. Run commands from the
project root so Streamlit loads its theme. If `python3` is older than 3.11, use
`python3.12` to create the virtual environment. The Mac instructions have not been
executed on a Mac; verification was performed on Linux.

For **Linux CPU-only** setup, install CPU PyTorch before the project requirements:

```bash
python -m pip install "torch>=2.6,<3" --index-url https://download.pytorch.org/whl/cpu
python -m pip install -r requirements-dev.txt
```

## Try the keyless demo

1. In **My Notes**, upload `sample_data/dbms_notes.pdf` and
   `sample_data/cloud_computing.txt`, then click **Process selected files**.
2. In **Ask PadhAI**, click **Build search index**. First use downloads the pinned
   `sentence-transformers/all-MiniLM-L6-v2` model from Hugging Face.
3. Ask **“What reduces redundancy in relational tables?”** and inspect the PDF
   passage and page number. Then try **“Who manages the operating system in IaaS?”**
4. Add or remove a document and rebuild to search the updated notes.

For a short presentation, follow the [demo guide](docs/demo-guide.md).

## Optional AI answers and quizzes

Set `OPENAI_API_KEY` in your local `.env` using a text editor and restart the app.
Keep `OPENAI_MODEL=gpt-4o-mini` initially. Search remains local. Clicking
**Generate AI answer** sends the submitted question and selected excerpts to
OpenAI; **Generate quiz** sends selected excerpts and quiz settings. These actions
may incur API charges. Excerpts may include personal information or the full text
of a short document. The app does not attach original files or send conversation
history. `store=False` is requested; provider data policies still apply.

Quiz Mode uses extracted notes directly, so it needs no search index. Correct
answers and evidence appear after submission. Unanswered items count as incorrect.
Retaking uses the same questions with no new API request. Changing notes or quiz
settings resets the quiz. Submit before leaving the page; unsubmitted choices
may be lost.

Missing keys, insufficient material, request errors, and invalid generated output
have explicit UI states. The app never substitutes an invented local quiz.

## Verification and retrieval results

See [verification](docs/verification.md) for executed checks and their limits.
**523 automated tests passed locally.** Tests cover extraction, chunking, source mapping, session isolation, index failure
handling, strict answer/quiz validation, scoring, UI state, and evaluation math.
OpenAI SDK calls were tested with simulated HTTP responses; **live OpenAI answer
and quiz generation have not been tested**.

The fixed evaluation has **8 documents, 18 answerable questions, and 2 unanswerable
questions**. It was frozen before the real-model run:

| K (unique documents) | Hit@K | Macro Recall@K |
| --- | --- | --- |
| 1 | 100.0% | 94.4% |
| 3 | 100.0% | 100.0% |
| 5 | 100.0% | 100.0% |

Neither negative query returned a passage at threshold 0.25 (**0/2 false positives**).
This is a small hand-authored learning dataset, not a held-out benchmark or a
claim of general accuracy. See [the report](docs/retrieval-results.md) and
[per-query results](evaluation/results.json).

```bash
python -m evaluation.run_retrieval --output evaluation/results.json
```

After caching the model, prefix that command with `HF_HUB_OFFLINE=1` to verify
offline operation. The runner records dataset hash, model revision, runtime
versions, and retrieval settings. See [evaluation instructions](evaluation/README.md).

## How it works

```text
Upload → validate/extract → page-aware chunks → local embeddings → Chroma search
                                                        ↓
                          retrieved passages → optional AI answer → checked quotes

Extracted chunks → optional AI quiz → structure/evidence validation → scoring
```

| File or directory | Purpose |
| --- | --- |
| `app.py` | Streamlit navigation and session state |
| `src/document_loader.py`, `src/chunker.py` | Validated text and traceable chunks |
| `src/embeddings.py`, `src/vector_store.py`, `src/retriever.py` | Local retrieval |
| `src/answer_generator.py`, `src/quiz_generator.py` | Optional generation, validation, scoring |
| `src/config.py` | Environment settings |
| `tests/`, `evaluation/` | Automated behavior checks and retrieval measurements |
| `sample_data/` | Public example notes |

Read the [architecture](docs/architecture.md) for limits and design choices, and
the [learning guide](docs/learning-guide.md) for each module's Python concepts,
connections, tests, and exercises.

## Settings and limitations

| Setting | Default | Meaning |
| --- | --- | --- |
| `OPENAI_API_KEY` | empty | Optional API key; keep it out of Git |
| `OPENAI_MODEL` | `gpt-4o-mini` | Must support strict JSON-schema Chat Completions |
| `MAX_UPLOAD_MB` | `10` | Accepted per-file limit in MiB, integer 1–50 |

Environment variables override `.env`, including blank values. Accepted notes are
limited to 20 documents / 50 MiB / 2 million extracted characters per session.
Each PDF is limited to 300 pages; each document to 1 million extracted characters.
The architecture documentation lists all other processing and generation limits.

- Scanned PDFs need OCR elsewhere; encrypted or damaged PDFs are rejected.
- PDF reading order and tables may extract imperfectly. The embedding model works
  best with English; Hindi/Hinglish retrieval is not generally validated.
- Similarity measures relatedness, not answer support. Source/quote checks verify
  existence, not logical entailment, correct quiz answers, or unambiguous distractors.
- The app has no authenticated accounts or persistent notes. Disconnected Chroma
  collections may remain in server memory until shutdown; native PDF parsing has
  no hard resource sandbox. This is a learning MVP, not a production-secure service.
- Dependencies use version ranges; the embedding revision is pinned and tested
  dependency versions are recorded in the verification/evaluation artifacts.

If a port is occupied, use `--server.port 8502`. For a failed model download, check
connectivity/disk space and retry indexing. An AI error leaves local passages
available; a rejected quiz is never partially displayed. See the demo guide for
a presentation fallback and the architecture for future improvements.

## Release and contribution workflow

Version: [VERSION](VERSION). Changes: [CHANGELOG](CHANGELOG.md).
Follow the [release guide](docs/release-guide.md) to prepare your own repository,
review files, run checks, tag `v0.1.0`, and publish when ready. This preparation
has not created a GitHub repository or published a release.

```bash
python scripts/build_release.py --output-dir dist
```

The builder uses [release-files.txt](release-files.txt) as an explicit source
allowlist and creates a ZIP plus SHA-256 checksum. Update the list deliberately
when adding public project files. Unlisted local files are not packaged. Before
contributing, run `python -m pytest -q` and `python -m pip check`.

## License

Project code is MIT; see [LICENSE](LICENSE). Dependencies retain their own
licenses; PyMuPDF is offered under AGPL/commercial terms. Review those terms for
your distribution or deployment. Replace the copyright holder if publishing
under your own name. No EvidenceDesk source was available; PadhAI was built
as a separate project.
