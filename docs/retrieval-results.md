# Measured retrieval results

This is a small, hand-authored learning evaluation, not a held-out benchmark.
The corpus and labels were frozen before this run; no question, label, threshold,
or chunk setting was tuned after observing the results.

Corpus: 8 documents, 8 chunks; 20 questions
(18 answerable, including two multi-document and two Hinglish questions; two negatives).

| K (unique documents) | Hit@K | Macro Recall@K |
| --- | --- | --- |
| 1 | 100.0% | 94.4% |
| 3 | 100.0% | 100.0% |
| 5 | 100.0% | 100.0% |

Unanswerable false positives: **0/2** at cosine threshold **0.25**.

Hit@K counts an answerable question as successful if any expected document is
retrieved. Recall@K averages the fraction of expected documents retrieved per
answerable question. The two multi-document questions require two sources,
which explains lower Recall@1 even though every leading hit was relevant.

The runner requests up to 20 chunks, then keeps the first result per document.
All eight corpus chunks fit that candidate limit. These figures do not estimate
quality on larger collections, varied student notes, or other languages.
Two negative questions do not calibrate the similarity threshold.

Reproduce from the project root with the virtual environment active:

```bash
python -m evaluation.run_retrieval --output evaluation/results.json
```

After the model is cached, set `HF_HUB_OFFLINE=1` to run without Hub access.

Model: `sentence-transformers/all-MiniLM-L6-v2@c9745ed1d9f207416be6d2e6f8de32d1f16199bf:weighted-windows-v1`

Dataset SHA-256: `2380e50ca16136ce09a682dabce851d3c64073e1b9f4bdcfaa72917c9f4228a1`

See [the full JSON report](../evaluation/results.json) for per-query rankings,
scores, source IDs, runtime/package versions, and the run timestamp. The
evaluation does not test generated answers or quiz quality.
