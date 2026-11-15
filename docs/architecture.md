> Legacy 0.1.0 reference retained for the current deployment and rollback. See the [integrated platform guide](platform/audit.md) for the replacement architecture.

# Architecture and boundaries

## Implemented through Phase 6

```text
.env + process environment → config.py → app.py
                                            ↓
                                  session file selection
                                            ↓ explicit Process button
                                  document_loader.py
                                            ↓ Document + Page metadata
                                       chunker.py
                                            ↓ tuple of Chunk records
                                Streamlit session state
                                            ↓
                           literal previews / remove / clear
```

`load_settings` reads settings without modifying process environment variables.
A configured API key means present, not valid or connected. Local search downloads
an embedding model on the first explicit index build and then computes locally.
Optional OpenAI calls run only on the Generate AI answer or Generate quiz action.
Quiz generation consumes extracted chunks directly, so it does not load the
embedding model or require a search index.

`load_document` accepts a name and bytes, validates them, then returns an immutable
`Document`. Its SHA-256 ID identifies the original bytes. Names are display metadata:
Windows and Unix path prefixes are removed, names over 200 characters or containing controls are rejected, and no
upload path is opened or written. The file extension is case-insensitive; content
checks are stricter than extension checks alone but are not antivirus scanning.
A PDF must begin exactly with `%PDF-`; leading data is rejected. The document ID
hashes original bytes, so semantically equivalent files with different bytes
are distinct documents.

PDF text comes from PyMuPDF with sorted extraction. `Page.page_number` preserves
the original 1-based PDF page index, including blank pages. Blank pages produce
no chunks; a partly readable PDF has a warning. TXT and Markdown decode as UTF-8
with an optional BOM and use `page_number=None`. CRLF and CR become LF. Source
offsets refer to this normalized extracted text, not raw byte positions or PDF
coordinates. No Markdown, HTML, or document instructions are executed.

`chunk_document` uses 1,000-character windows with 150-character overlap by default.
It processes each page separately, skips windows with no visible text, and avoids
an extra final window containing only overlap. It requires a positive integer
chunk size and `0 <= overlap < chunk_size`, ensuring forward progress. Each
`Chunk` keeps the document ID, display filename, page number, exact text slice,
and start/end character offsets; the end offset is exclusive. Chunk IDs include
an algorithm version, document ID, page index, settings, and offsets. Reprocessing
the same content/settings gives the same IDs.

The UI stores documents/chunks in `st.session_state.notes`. It does not globally
cache private notes. One bad file does not prevent valid siblings being processed.
Duplicate bytes keep the existing document and filename; same-name files with
new bytes have distinct IDs. Navigation reruns do not re-extract stored notes.
Remove and clear actions also reset pending uploader state. Session state is
connection-scoped, not durable storage or account authentication.

## Embeddings and retrieval

```text
session chunks → LocalEmbedder → explicit vectors → WorkspaceStore/Chroma
question       → same LocalEmbedder → cosine search → canonical Chunk records
                                                        ↓
                                             literal passages + source metadata
```

`embeddings.py` pins `sentence-transformers/all-MiniLM-L6-v2` to revision
`c9745ed1d9f207416be6d2e6f8de32d1f16199bf` and uses CPU inference with remote code
trust disabled. The cached model is shared; private texts/vectors are not cached
by that function. Hugging Face caches downloaded weights on disk. A lock prevents
concurrent requests from using the shared model simultaneously.

Before encoding, the tokenizer counts each text's tokens including special tokens.
An oversized text is split into recursive halves of its original string until
each part fits the model limit. This preserves all original characters instead of
silently truncating tails. Each part is normalized, weighted by its token count,
averaged, and normalized again. The method is deterministic in its preprocessing,
not a guarantee of bit-identical floating-point inference on every platform.
Averaging may dilute multiple topics. The model is English-centric.

`WorkspaceStore` lazily creates an ephemeral Chroma client with anonymized telemetry
disabled. Every store has an opaque random namespace; callers cannot supply a
collection name from the UI. Each index contains explicit vectors and source
metadata. Chroma's default embedding function is disabled, so it does not select
or download a different model. Missing PDF page numbers are encoded as zero only
inside Chroma; canonical `Chunk` records preserve `None`.

Store writes check unique chunk IDs, nonempty metadata, valid offsets, vector
counts, dimensions, finite values, and nonzero magnitude. Vectors are normalized
before storage. Replacement builds a new staging collection, publishes it only
after all batches succeed, and then retires the previous collection. A failed
store replacement leaves its previous active index available. Failed collection
cleanup names are tracked for a later clear attempt. Model identity includes the
pinned revision and windowing algorithm version; a query with a mismatched model
or dimension is rejected.

Search uses cosine distance, with similarity `1 - distance`, bounded to [-1, 1].
It asks Chroma for at most the available chunk count, rejects unknown source IDs
or malformed responses, and returns source text only through the workspace's
canonical chunk mapping. Hits below 0.25 are filtered by default. Returned hits
are sorted by descending similarity and then chunk ID for ties; the approximate
nearest-neighbor cutoff can still vary when additional candidates tie.
The threshold is not calibrated answer confidence. Returning no hits is not proof
that the documents do not contain the answer.

`SearchEngine` coordinates full builds and queries. The UI requires an explicit
build after uploads; note additions, removal, or clearing invalidate the active
index and displayed results. No partial build is published. The backend supports
individual document deletion; the UI conservatively clears the complete index on
note changes so it can be rebuilt from the current session's chunks. A failed
manual rebuild preserves the previous completed UI index; a successful build
replaces it and clears stale results.

Chroma data is not intentionally persisted to disk. Connection isolation does not
provide authentication or automatic lifecycle cleanup: disconnected sessions can
leave collections in process memory until server shutdown. Explicit removal and
clear attempt collection cleanup; a failure is reported and stale results are
invalidated. This is a learning app, not a durable multi-user storage service.

## Optional answer generation

```text
submitted question + retrieved hits
              ↓ select_context: whole, deduplicated, bounded passages
       source labels S1…S6 + text
              ↓ explicit Generate AI answer button
      OpenAI strict JSON-schema Chat Completions
              ↓ validate_response
     supported source IDs + exact quote membership
              ↓
   claim text + citations from original Chunk metadata
```

`answer_generator.py` sends only the current question and selected excerpt texts
with temporary source IDs. It omits filename/page metadata and conversation
history. The current chat-style interface holds one question/answer exchange.
Selected text can itself contain names, page labels, or personal information;
omitting metadata does not anonymize document contents. Local retrieval remains
available without a key or when generation fails.

Context selection keeps ranked whole passages, deduplicates chunk IDs, rejects
conflicting identities, and skips same-document/page overlap covering at least
half the shorter passage. It selects at most six sources and 12,000 characters.
A serialized UTF-8 byte count of messages plus response schema, with 256 reserved
for protocol overhead, is used as a conservative 6,000-token input bound. There
is no tokenizer download. The bound is designed for the default `gpt-4o-mini`;
it is not exact, model-specific token accounting for arbitrary settings.

The SDK uses an explicit `https://api.openai.com/v1` endpoint, so unrelated
`OPENAI_BASE_URL` environment settings do not redirect notes. Requests use a
30-second timeout, `max_retries=0`, `max_completion_tokens=1600`, `store=False`,
and a strict JSON response schema. `store=False` does not guarantee zero provider
retention; applicable API data policies still apply. No previous exchange is sent.

The system prompt identifies sources as untrusted evidence and asks for claims
supported only by those sources. Validation independently checks the response:

- Exactly the expected JSON fields; no duplicate keys or extra fields.
- A complete, non-refused single response, with status `answered` or `insufficient`.
- `insufficient` has no claims and displays a fixed application message.
- `answered` has 1–6 nonblank claims, each at most 1,000 characters.
- Each claim has 1–3 distinct, known source IDs and exact quotes of 10–500
  characters, with a trimmed length of at least 10 characters.
- Square brackets in claim text (including fabricated source labels), invalid
  Unicode, and unsupported control characters are rejected. This conservative
  rule also rejects bracketed formulas/code; the prompt asks for prose instead.
  Displayed citations are built from original `Chunk` objects,
  never model-provided filenames or page numbers.

Any validation failure rejects the complete generated answer rather than showing
partly checked claims. Missing keys, no fitting context, request failures,
refusals, truncation, unknown sources, or mismatched quotes retain retrieval-only
results. Error messages avoid echoing SDK diagnostics, secrets, notes, or queries.
A user must explicitly retry; navigation reruns do not make a new API request.

These checks establish source identity and exact quote existence. They do not
prove that a claim follows logically from its quote, detect all hallucinations,
or guarantee prompt-injection resistance. Retrieved similarity is also not
confidence that an answer is supported. The UI asks users to check evidence.

## Quiz generation and scoring

```text
current notes' chunks → bounded round-robin context → explicit Generate quiz
              ↓ OpenAI strict JSON-schema response
      validate complete requested quiz + exact evidence
              ↓
       questions/options → submitted choices → immutable score
                                                   ↓
                                  explanations + original-source citations
```

`quiz_generator.py` accepts 5, 10, or 20 questions with easy/medium/hard difficulty.
It groups chunks by document and takes turns among those groups, preserving whole
passages. Duplicate chunk IDs are removed, conflicting identities are rejected,
and same-page overlaps of at least half the shorter passage are skipped. Limits
are 12 sources, 16,000 characters, and a conservative 14,000-token input bound
using serialized UTF-8 bytes plus schema and 256 protocol allowance. This avoids
embedding/model setup for quizzes. Context limits can omit material; round-robin
selection is not a guarantee that the quiz covers all uploaded documents.

The request sends quiz settings and selected source text with temporary source
IDs. It omits original files and filename/page metadata, but excerpt text may
contain personal information or all the text of a short file. It uses the same
explicit OpenAI endpoint and model setting as answers, with strict schema output,
`store=False`, a 60-second timeout, zero automatic retries, and an output allowance
of `question_count * 600` tokens. Provider data policies still apply.

Validation accepts either exactly the requested number of questions or an
`insufficient` status with no questions. The complete response is rejected on
malformed/duplicate/extra JSON fields, refusals, truncation, invalid counts, invalid
source IDs, or mismatched quotes. Each accepted question has:

- A nonempty question of at most 500 characters, distinct from other normalized
  questions in the quiz.
- Four nonempty, distinct options of at most 250 characters each.
- One zero-based integer correct index in 0–3; booleans are rejected.
- A nonempty explanation of at most 1,000 characters.
- One to three distinct known sources with exact quotes of 10–500 characters,
  whose trimmed length is at least 10 characters.

Question/option duplicate checks apply Unicode NFKC normalization, case folding,
whitespace collapsing, removal of invisible `Cf` formatting, and trimming common
end punctuation. Operators such as plus and equals remain significant. These
checks catch superficial repetition; they do not identify every semantic duplicate.
Question and explanation text reject square brackets, while options allow them
for formulas/code. Invalid Unicode and unsupported controls are rejected. All
model text is displayed literally; citation labels use original chunk metadata.

The UI reveals answers, explanations, and source quotes only after submission.
`score_quiz` accepts one option index or `None` per question. An unanswered item
scores zero; the denominator is the total quiz length. It returns an immutable
score with correct count, total, unanswered count, percentage, and per-item results.
The submitted selections and score are frozen. Retaking uses new widget keys and
the same validated questions without another API call. Changing count/difficulty
or adding/removing notes clears the quiz and attempt; unchanged duplicate uploads
do not. Unsubmitted selections may be lost when navigating away.

Without a key, the generation control is disabled and the backend returns a
clear disabled status. Failures never create an invented local or partial quiz.
Tests can simulate a provider and exercise scoring without a paid request. Source
and quote checks cannot establish factual correctness, actual difficulty,
semantic uniqueness, or that distractors leave exactly one defensible answer.
Users should review the displayed explanation and source evidence.

## Reproducible retrieval evaluation

`evaluation/run_retrieval.py` reads `evaluation/dataset.json` and its named files
under `evaluation/corpus/`. The fixed fixture contains eight documents and twenty
questions: eighteen answerable and two unanswerable. Two answerable questions
are Hinglish, and two have multiple relevant documents. Labels identify document
filenames; they do not claim that every passage in a relevant document supports
the question.

The runner uses the application's loader, 1,000-character/150-overlap chunker,
real pinned CPU embedder, and Chroma store. It requests up to twenty chunks at
cosine threshold 0.25, then keeps the first chunk for each document ID in search
order. Hit@1/3/5 and macro Recall@1/3/5 use distinct documents and only the eighteen
answerable questions. On the two unanswerable questions, returning any above-
threshold document counts as a false positive. This is a retrieval measure,
not a test of generated-answer abstention. Missing metric denominators are `null`,
not a fabricated perfect/zero score.

Dataset validation checks schema, unique IDs, source files, and relevance labels.
The report includes a SHA-256 fingerprint of the manifest and corpus contents,
model revision, package/Python versions, UTC timestamp, chunk/search settings,
and per-query results. Source changes during a run abort reporting. The runner
clears its temporary index in a `finally` block. Tests can inject deterministic
embeddings, but reports label such runs as test embeddings rather than real-model
measurements. A small fixed fixture is useful for regression checks; it is not a
held-out or representative estimate of general retrieval quality.

## Acceptance limits

| Boundary | Default/limit |
| --- | --- |
| Actual file bytes | Configurable 1–50 MiB, default 10 MiB |
| PDF pages | 300 |
| Extracted characters per document | 1,000,000 |
| Selected files per batch | 20 |
| Stored documents per session | 20 |
| Sum of original file sizes per session | 50 MiB |
| Extracted characters per session | 2,000,000 |
| Rendered page preview | 5,000 characters |
| Chunks per index build | 5,000 |
| Question length | 2,000 characters |
| Search results | 1–10 in UI, 1–20 in backend |
| Default minimum cosine similarity | 0.25, heuristic |
| Selected answer sources | At most 6 whole passages |
| Selected answer source characters | At most 12,000 |
| Conservative answer input bound | 6,000 tokens including schema/protocol reserve |
| Requested answer output limit | 1,600 tokens |
| Accepted answer claims | 1–6, each at most 1,000 characters |
| Evidence per claim | 1–3 exact quotes, each 10–500 characters |
| Answer API timeout / automatic retries | 30 seconds / 0 |
| Quiz questions / difficulty | 5, 10, or 20 / easy, medium, or hard |
| Selected quiz sources / characters | At most 12 / 16,000 |
| Conservative quiz input bound | 14,000 tokens including schema/protocol reserve |
| Requested quiz output limit | 600 tokens per question |
| Quiz question / option / explanation length | 500 / 250 / 1,000 characters |
| Quiz options / evidence per question | 4 / 1–3 exact quotes |
| Quiz API timeout / automatic retries | 60 seconds / 0 |

Per-file byte checks happen before parsing. Page count is checked before page
extraction, and character limits are checked while/after text is extracted.
They bound accepted output; native PDF parsing can allocate memory or consume
CPU before those checks finish. Upload widgets also hold transient bytes in
server memory. Streamlit's per-file transport ceiling is 50 MiB, configured separately from
the application's accepted per-file limit. This is not an isolated parser sandbox.

## Handled cases and future work

Phase 1 handles missing/blank settings, malformed values, configuration precedence,
and secret-safe messages. Phase 2 adds unsupported extensions, oversized/empty
files, invalid UTF-8, text-control/binary detection, PDF header mismatch, corrupted
or repaired PDFs, encryption, absent extractable text, mixed blank pages, duplicate
content, same-name collisions, filename path prefixes, extraction limits, page
metadata, chunk overlap boundaries, session limits, and deletion.

Phase 3 adds explicit local model loading, token-limit handling, normalized
vectors, opaque workspace collections, source identity validation, dimension/model
mismatch detection, replacement failure handling, query limits, zero-result
behavior, and index invalidation after note changes. Tests using fake embeddings
exercise failure paths deterministically; they do not establish model quality.

Phase 4 adds bounded context selection, explicit optional API calls, safe
retrieval-only fallback, strict response validation, source/quote verification,
and invalidation of previous answers after new searches or note changes. Mocked
providers and SDK transports exercise error paths without sending study material.
They do not establish live service availability or semantic correctness.

Phase 5 adds bounded quiz context, exact-count MCQ structure and source checks,
insufficient-material handling, deterministic partial-submission scoring, frozen
submissions, retakes, and reset behavior. Simulated API tests do not establish
live provider availability or question quality.

Phase 6 adds a fixed retrieval evaluation fixture and runner, documentation, and
verification of the complete MVP. The evaluation uses actual local embeddings
and Chroma; unit tests deliberately keep fake model inputs for repeatability.
Recorded results belong in the evaluation report and `verification.md`.

Future improvements include broader independent evaluation, multilingual model
comparisons, token-aware chunks, better table extraction, calibrated abstention,
and durable workspaces with explicit lifecycle management. These remain future
work; the current app is not a production-secure hosted service.

See `verification.md` for checks actually executed. There is no claim that all
possible document formats or adversarial PDF edge cases are handled.
