# Understand the complete PadhAI MVP

Run commands below from the project root with `.venv` activated. Start with the
README installation instructions if the environment is not ready.

## app.py

1. **What it does:** renders four navigation pages; My Notes processes uploads,
   shows text/chunks, and removes documents. Ask PadhAI searches passages and
   optionally generates an answer after an explicit button click. Quiz Mode
   generates questions, accepts a submission, reveals explanations, and supports retakes.
2. **Why it exists:** connects the backend functions to actions a student can use.
3. **Python concepts:** dictionaries, loops, functions, exception handling,
   hashing, conditionals, and Streamlit session state/reruns.
4. **Connections:** reads settings, calls `load_document`, then `chunk_document`,
   and stores their results per session. The Process button controls ingestion;
   switching pages does not parse documents again. `SearchEngine` provides retrieval;
   note changes invalidate existing search results, answers, the index, and quizzes.
   The answer button passes current results to `answer_generator.py`; quiz generation
   passes extracted chunks directly to `quiz_generator.py`, bypassing search.
5. **How to test:** `python -m pytest tests/test_app.py -q`, then upload the sample
   files manually. Try an empty text file beside a valid one, duplicate content,
   same-name different content, navigation, removal, and clearing.
6. **Before continuing:** explain why ordinary variables reset on reruns while
   session state persists, why private documents are not globally cached, and
   why a filename is displayed as plain text instead of rendered as Markdown.
   Explain why API generation is a separate button and why the interface sends
   only the current question rather than a conversation history.

## src/config.py

1. **What it does:** reads `.env` and environment variables, applies defaults,
   and validates settings.
2. **Why it exists:** keeps configuration decisions in one testable place.
3. **Python concepts:** dataclasses, properties, type hints, dictionaries,
   pathlib, and custom exceptions.
4. **Connections:** `app.py` uses `max_upload_mb` to calculate the allowed bytes.
   Process variables override `.env`, including blank values. `env={}` isolates
   tests from the machine. Dotenv variable interpolation is disabled.
5. **How to test:** `python -m pytest tests/test_config.py -q`. Try a zero or
   fractional upload limit in `.env` and observe the safe error.
6. **Before continuing:** explain defaults and range checks. API key presence is
   not authentication; hiding a key from `repr` is not encryption. `MAX_UPLOAD_MB`
   uses MiB units despite its short configuration name.

## src/document_loader.py

1. **What it does:** validates filenames/bytes, extracts TXT/Markdown or PDF text,
   and returns `Document` and `Page` records with warnings.
2. **Why it exists:** later retrieval needs clean, traceable text. Errors must be
   caught before unusable material enters the pipeline.
3. **Python concepts:** frozen dataclasses, tuples, byte strings versus Unicode,
   decoding, SHA-256, `with` context managers, enumerating, and exception boundaries.
4. **Connections:** the UI supplies bytes and limits; the chunker consumes the
   resulting document. PyMuPDF opens PDFs in memory and closes them on exit.
   A custom `DocumentError` provides a useful message without parser internals.
5. **How to test:** `python -m pytest tests/test_document_loader.py -q`. Tests
   generate their own small PDFs. Manually upload all three sample formats.
6. **Before continuing:** explain why UTF-8 bytes and characters have different
   counts, why hashing bytes identifies duplicate content, why page numbers must
   survive blank pages, and why a scan needs OCR. A character limit after
   extraction is not a hard memory limit on the native PDF parser.

## src/chunker.py

1. **What it does:** splits each page into overlapping character windows with
   exact text offsets and deterministic IDs.
2. **Why it exists:** later embedding/search needs manageable passages without
   losing their source. Overlap preserves some nearby context across boundaries.
3. **Python concepts:** `range`, slicing, exclusive end indexes, integer bounds,
   dataclasses, deterministic hashing, and tuples.
4. **Connections:** accepts a `Document` from the loader and returns `Chunk`
   records used by the UI and semantic retrieval. Chunks never cross
   page boundaries. Offsets refer to normalized extracted page text.
5. **How to test:** `python -m pytest tests/test_chunker.py -q`. Inspect chunks in
   the UI and check that `page.text[start_char:end_char]` equals their text.
6. **Before continuing:** trace chunk size 10, overlap 3 through a 20-character
   string. Explain why the step is 7, why overlap cannot equal the chunk size,
   and why the final window must not repeat only overlap. Character lengths do
   not equal model token counts; word/token-aware chunking can be a later change.

## src/embeddings.py

1. **What it does:** loads a pinned Sentence Transformers model on CPU and converts
   text into normalized vectors. Text exceeding its token limit is split before
   encoding and combined with a token-weighted average.
2. **Why it exists:** semantic search compares meanings through vectors rather
   than requiring exactly matching words. Explicit token handling avoids silent
   truncation of the end of a passage.
3. **Python concepts:** lazy imports, caching, recursion, lists, NumPy arrays,
   locks, normalization, and exception handling.
4. **Connections:** `SearchEngine` calls the same embedder for chunks and questions.
   Only model weights are shared. The model ID includes its revision and the
   windowing algorithm version so incompatible indexes can be rejected.
5. **How to test:** run `python -m pytest -q -k embedding` for deterministic model
   substitutes. Build an index in the app for a real model check; its first use
   requires the model download. Check `verification.md` for actual outcomes.
6. **Before continuing:** distinguish characters from tokens, explain a unit-length
   vector and a weighted average, and explain why preserving all text does not
   guarantee that an embedding captures every fact. English-focused model quality
   does not establish reliable Hindi or Hinglish retrieval.

## src/vector_store.py

1. **What it does:** stores supplied vectors and source metadata in an in-memory
   Chroma collection, then finds nearby vectors and maps them to known chunks.
2. **Why it exists:** vector search needs isolated collections and trustworthy
   source mapping as well as numerical similarity.
3. **Python concepts:** classes, dictionaries, UUIDs, numeric validation, locks,
   staged replacement, sorting, and cleanup after exceptions.
4. **Connections:** the retriever supplies vectors with the model identity. The
   store validates dimensions and IDs; search results use canonical `Chunk`
   records rather than trusting arbitrary returned text. Chroma performs no
   automatic embedding. Each session's store has its own opaque namespace.
5. **How to test:** run `python -m pytest -q -k store`. Tests with known vectors
   exercise actual Chroma without downloading a model. Inspect tests for source
   mismatch, isolation, invalid vectors, deletion, and failed replacement cases.
6. **Before continuing:** explain cosine similarity, why model versions and vector
   dimensions must match, and why staging protects the old collection during
   replacement. A random workspace ID is not user authentication. Ephemeral
   storage still occupies server memory and needs lifecycle cleanup.

## src/retriever.py

1. **What it does:** coordinates full index builds and validated questions, then
   returns source passages above a similarity threshold.
2. **Why it exists:** keeps the embedding/store workflow outside Streamlit so it
   can be tested independently and supplies evidence to optional answer generation.
3. **Python concepts:** object composition, dependency injection, tuples, input
   validation, and translating lower-level errors into safe application errors.
4. **Connections:** `app.py` calls `SearchEngine`; the engine calls `LocalEmbedder`
   and `WorkspaceStore`. Tests can inject a deterministic embedder without changing
   the application code. This retrieval module itself makes no OpenAI request.
5. **How to test:** run `python -m pytest -q -k retriev`, then upload sample notes,
   build the index, search a relevant question, and remove the source document.
   Check that old passages disappear and rebuilding is required.
6. **Before continuing:** explain why a high similarity is relatedness rather than
   correctness, why the uncalibrated 0.25 threshold may hide useful results, and
   why a retrieval-only result differs from a generated answer with citations.

## src/answer_generator.py

1. **What it does:** selects a bounded set of source passages, optionally asks
   OpenAI for structured claims, checks cited sources and exact quotes, and
   returns either an answer, an insufficient-information message, or fallback.
2. **Why it exists:** generated answers must remain connected to known evidence.
   A single validation boundary prevents unverified model output being presented
   as an accepted answer and leaves local retrieval useful when the API fails.
3. **Python concepts:** dataclasses, JSON serialization/parsing, schemas, keyword
   arguments, exact substring membership, regular expressions, mappings, loops,
   context managers, dependency injection, and exception handling.
4. **Connections:** `app.py` supplies the submitted question, search hits, and
   settings after a button click. Context sources get temporary S1…S6 labels.
   Citation objects retain original `Chunk` metadata. The model supplies claim
   text and quotes, not trusted document names or page numbers. No previous chat
   history is sent. The SDK connects to the explicit OpenAI endpoint.
5. **How to test:** run `python -m pytest tests/test_answer_generator.py tests/test_openai_transport.py -q`. Mocked responses and SDK
   transports can cover valid claims, false quotes, unknown IDs, malformed JSON,
   refusal, truncation, and network failures without using a paid API. Read
   `verification.md` for actual checks; mocked calls are not live API tests.
6. **Before continuing:** explain why exact quote existence does not prove a
   paraphrase is supported. Trace an invalid citation into retrieval-only fallback.
   Explain what data leaves the machine, what `store=False` does not guarantee,
   why automatic retries are disabled, and how a conservative UTF-8 byte bound
   differs from exact model token counting. The default input bound includes
   prompt/schema bytes plus protocol allowance; it does not fill every model's
   context window exactly.

## src/quiz_generator.py

1. **What it does:** selects quiz evidence, requests exactly 5/10/20 MCQs at the
   chosen difficulty, validates the complete response, and scores a submission.
2. **Why it exists:** generation and scoring need clear boundaries. Generated
   questions must have four options, a valid answer index, and traceable evidence;
   scoring itself should be deterministic and require no API call.
3. **Python concepts:** dataclasses, tuples, `deque`, round-robin iteration, Unicode
   normalization, sets, JSON schemas, strict integer checks, pure functions, and
   dependency injection for a fake provider.
4. **Connections:** `app.py` passes current extracted chunks and settings. Context
   selection takes turns among documents with size and overlap checks. Shared
   source/citation records preserve original metadata. The OpenAI request uses
   the configured model; scoring consumes validated questions and selected indexes.
   No search index, embedding model, or conversation history is needed.
5. **How to test:** run `python -m pytest -q -k quiz`. Tests can simulate JSON
   responses and transport failures, then exercise wrong counts, repeated options,
   false quotes, invalid answer indexes, unanswered questions, frozen submissions,
   and retakes. See `verification.md`; simulated success is not live API success.
6. **Before continuing:** explain why Python booleans must be excluded from index
   validation, why normalized strings help catch duplicates, and why they cannot
   detect all meaning-level repetition. Trace one unanswered choice into a score
   with the full denominator. Explain why verified quotes do not prove the keyed
   answer is correct or the distractors unambiguous. Distinguish a no-cost retake
   of the same questions from a fresh generation that may incur API charges.

## evaluation/run_retrieval.py

1. **What it does:** loads a fixed question/corpus dataset, runs the actual retrieval
   pipeline, computes document-level Hit@K and macro Recall@K, reports negative-
   query false positives separately, and writes a JSON record of the run.
2. **Why it exists:** a portfolio needs reproducible evidence about retrieval,
   including failures. Passing plumbing tests cannot measure a model's semantic
   ranking quality. Fixed inputs let you compare future changes fairly.
3. **Python concepts:** argparse, pathlib, JSON, set intersections, deduplication,
   ratios and averages, SHA-256, UTC timestamps, package metadata, and `finally`
   cleanup. Missing denominators use `None`/JSON `null` rather than guessed scores.
4. **Connections:** `dataset.json` names eight files in `corpus/` and labels twenty
   questions. The runner calls the normal loader, chunker, embedder, and search
   engine. It retrieves up to twenty chunks at 0.25 similarity, then keeps the
   first per document so K counts documents. JSON records the model revision,
   settings, dataset fingerprint, runtime versions, and individual query outcomes.
5. **How to test:** run `python -m pytest -q -k evaluation` for deterministic metric
   and input-validation tests. Run `python -m evaluation.run_retrieval --output evaluation/results.json`
   for actual model measurements. First use downloads
   the pinned weights; cached runs can use `HF_HUB_OFFLINE=1`. No OpenAI API is used.
6. **Before continuing:** calculate Hit@3 and Recall@3 for a question with two
   relevant documents when one is found. Explain why negative questions need a
   separate denominator and why two negative or Hinglish examples prove little
   about general behavior. Compare the report's per-query failures before changing
   a threshold; tuning to this tiny dataset is not independent validation.

## tests, dependencies, and CI

1. **What they do:** assert expected behavior and run it on fresh CI environments.
2. **Why needed:** failure cases should remain correct as features are added.
3. **Concepts:** assertions, parametrization, fixtures, generated inputs,
   temporary paths, monkeypatching, and Streamlit AppTest.
4. **Connections:** `requirements.txt` installs runtime packages including
   PyMuPDF, Sentence Transformers, Chroma, and OpenAI; dev requirements add pytest.
   GitHub Actions runs the same tests on Python 3.11/3.12. Tests use deterministic embedding substitutes for reproducible
   behavior checks. Real Chroma tests verify storage without model downloads. The
   evaluation folder includes a real-model smoke script and a fixed retrieval
   evaluation. Mocked answer/quiz providers exercise validation without paid calls.
5. **How to test:** `python -m pytest -q` and `python -m pip check`. Read
   `docs/verification.md` for actual recorded results and limitations.
6. **Before continuing:** distinguish a deterministic unit test from a browser
   check and a retrieval benchmark. Passing extraction tests does not establish
   retrieval accuracy or AI grounding.

## A short practice exercise

Upload `dbms_notes.pdf`, choose a source page, and trace one chunk back to the
page text. Then explain the flow without looking at the code:

`uploaded bytes → pages → chunks → local vectors → search → selected evidence → optional answer`

Ask a question, then identify the source page and offsets of the first returned
passage. Try a question whose answer is absent and explain why even an apparently
similar passage may not support an answer.

If you configure an API key, generate an answer and trace every citation to its
source quote. If you leave the key blank, explain why the app still shows useful
passages but cannot claim it generated an answer.

For a quiz exercise, leave one question unanswered and calculate the expected
percentage before submitting. Retake the same quiz and verify that previous
answers are cleared. Change the difficulty and explain why the old quiz resets.

For an interview, explain model loading versus inference, cosine similarity,
workspace isolation, stale-state invalidation, bounded context, evidence checks,
and deterministic scoring. Distinguish structural validation from semantic
correctness and a measured retrieval metric from a guarantee of answer quality.
Run the evaluation, inspect one failure, and propose a small change you can test.


## scripts/build_release.py

1. **What it does:** builds a versioned source ZIP and SHA-256 checksum from
   `release-files.txt`. Unlisted files are not included.
2. **Why it exists:** packaging should select reviewed project files rather than
   copy a whole working folder that may contain notes, caches, or credentials.
3. **Python concepts:** pathlib, sets, byte strings, regular expressions, ZIP
   metadata, temporary files, atomic replacement, and cryptographic hashes.
4. **Connections:** `VERSION` determines the filename and root directory; the
   manifest lists the source files. CI checks the same builder locally used for
   release assets. GitHub publication is a separate manual action.
5. **How to test:** run `python -m pytest tests/test_release.py -q`, then
   `python scripts/build_release.py --output-dir dist`. Verify the checksum from
   the `dist` directory as described in the release guide.
6. **Before continuing:** explain why a SHA-256 checksum verifies byte integrity,
   not publisher identity; why an allowlist does not inspect arbitrary file contents
   for secrets; and why ZIP/checksum replacements are individually atomic, not one
   transaction. Fixed ZIP metadata gives identical bytes for identical input with
   the same Python/zlib versions.
