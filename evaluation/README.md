# Retrieval evaluation

Run from the project root:

```bash
python -m evaluation.run_retrieval --output evaluation/results.json
```

This uses the real application loader, character chunker, pinned local Sentence
Transformers model, and an isolated in-memory Chroma index. It makes no OpenAI
request. First use may download model weights. After caching the model, use:

```bash
HF_HUB_OFFLINE=1 python -m evaluation.run_retrieval --output evaluation/results.json
```

## Fixed learning dataset

`dataset.json` labels 20 questions against eight short documents in `corpus/`:
normalization, transactions, cloud services, network protocols, operating-system
memory, searching algorithms, overfitting, and data splits/leakage. There are 18
answerable questions, including two multi-document questions and two Hinglish
questions. The remaining two questions have no answer in the corpus.

The documents and labels were authored and frozen before running the real model.
They are a small learning dataset, not a held-out or representative benchmark.
Do not change labels or questions after observing scores merely to improve them.
A SHA-256 fingerprint covers the manifest and every corpus file. Changes require
a new run and produce a different fingerprint.

## What is measured

The runner chunks each document into 1,000-character windows with 150-character
overlap. Each query requests up to **20 chunks**, filtered at cosine similarity
**0.25**. It then keeps the first result per document ID, preserving retrieval
order, and computes metrics at **1, 3, and 5 unique documents**. These are document
cutoffs, not chunk cutoffs. The report records whether all corpus chunks fit
inside the 20-chunk candidate limit; they do for the supplied corpus.

- **Hit@K:** fraction of answerable questions with at least one labeled relevant
  document among the first K unique documents.
- **Macro Recall@K:** for each answerable question, divide the number of retrieved
  relevant documents by its total labeled relevant documents; average those
  fractions across questions. This gives partial credit to multi-document queries.
- **Unanswerable false-positive rate:** fraction of no-answer questions returning
  any document above the threshold. These questions are excluded from Hit/Recall
  denominators. The count and denominator are also reported.

A missing denominator is JSON `null`, not zero or a perfect score. The threshold
is a heuristic and does not establish whether a passage supports a generated
answer. Chroma chooses approximate candidates; the application sorts returned
candidates by descending similarity and then chunk ID for ties.

## Report and reproducibility

`results.json` is produced only by actually running the evaluator. It records:

- Dataset fingerprint, description, document/chunk/question counts, and UTC time.
- Model identity and pinned revision, CPU runtime, Python/platform, and package versions.
- Chunk settings, threshold, candidate rule, document cutoffs, and limitations.
- Per-question labels, ranked document names and scores, chunk/source metadata,
  and relevant-document counts at each cutoff.
- Aggregate metrics with answerable and unanswerable denominators separated.

`tests/test_evaluation.py` checks known metric arithmetic and runs the same
pipeline with fixed fake embeddings and real Chroma. Such injected runs are
explicitly labeled `real_model_run: false`; their synthetic scores are not model
performance measurements. The normal pytest suite does not download a model.

These metrics do not evaluate answer generation, factual entailment, quiz quality,
large private corpora, or multilingual reliability. Two Hinglish examples are
not sufficient evidence of broad Hindi or multilingual performance.

## Earlier smoke check

`smoke_retrieval.py` remains available:

```bash
python -m evaluation.smoke_retrieval
```

It checks two expected leading sources and one unrelated query using sample
files, then clears its temporary index. It is a small integration check, separate
from the labeled evaluation above.
