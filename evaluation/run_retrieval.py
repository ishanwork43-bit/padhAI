"""Measure document retrieval on a small, fixed, hand-authored dataset.

Run: python -m evaluation.run_retrieval --output evaluation/results.json
First use downloads the pinned local embedding model. HF_HUB_OFFLINE=1 can be
used after caching its weights. No OpenAI request is made by this evaluation.
"""
import argparse
from datetime import datetime, timezone
import hashlib
from importlib.metadata import PackageNotFoundError, version
import json
import math
from pathlib import Path
import platform

from src.chunker import chunk_document
from src.document_loader import load_document
from src.embeddings import LocalEmbedder, MODEL_NAME, MODEL_REVISION
from src.retriever import SearchEngine

DEFAULT_DATASET = Path(__file__).with_name("dataset.json")
CHUNK_SIZE = 1000
CHUNK_OVERLAP = 150
CANDIDATE_CHUNKS = 20
MIN_SIMILARITY = 0.25
KS = (1, 3, 5)


class EvaluationError(ValueError):
    """An evaluation input is invalid; no score should be reported."""


def _unique_object(pairs):
    data = {}
    for key, value in pairs:
        if key in data:
            raise EvaluationError("Duplicate JSON keys are not allowed in the dataset.")
        data[key] = value
    return data


def validate_dataset(data, corpus_dir):
    if (not isinstance(data, dict)
            or set(data) != {"schema_version", "description", "documents", "questions"}
            or type(data["schema_version"]) is not int or data["schema_version"] != 1
            or not isinstance(data["description"], str) or not data["description"].strip()):
        raise EvaluationError("Dataset must follow schema version 1 with a description, documents, and questions.")
    documents = data["documents"]
    if not isinstance(documents, list) or not documents:
        raise EvaluationError("List at least one corpus document.")
    names = set()
    for name in documents:
        if (not isinstance(name, str) or not name or name in {".", ".."}
                or "/" in name or "\\" in name or "\x00" in name or name in names):
            raise EvaluationError("Corpus document filenames must be unique basenames.")
        path = corpus_dir / name
        if not path.is_file() or path.is_symlink():
            raise EvaluationError("Every labeled corpus document must exist as a regular, non-symlink file.")
        names.add(name)
    questions = data["questions"]
    if not isinstance(questions, list) or not questions:
        raise EvaluationError("List at least one evaluation question.")
    ids = set()
    for item in questions:
        if not isinstance(item, dict) or set(item) != {"id", "question", "relevant_documents", "language"}:
            raise EvaluationError("Each question needs id, question, relevant_documents, and language fields.")
        if not isinstance(item["id"], str) or not item["id"].strip() or item["id"] in ids:
            raise EvaluationError("Question IDs must be nonempty and unique.")
        if (not isinstance(item["question"], str) or not item["question"].strip()
                or len(item["question"]) > 2000):
            raise EvaluationError("Question text must contain 1–2,000 nonblank characters.")
        if item["language"] not in ("en", "hinglish"):
            raise EvaluationError("Question language must be en or hinglish.")
        relevant = item["relevant_documents"]
        if (not isinstance(relevant, list) or any(not isinstance(name, str) for name in relevant)
                or len(set(relevant)) != len(relevant) or not set(relevant) <= names):
            raise EvaluationError("Relevance labels must list distinct known corpus filenames; [] means unanswerable.")
        ids.add(item["id"])
    return data


def load_dataset(path=DEFAULT_DATASET):
    path = Path(path)
    try:
        data = json.loads(path.read_text(encoding="utf-8"), object_pairs_hook=_unique_object)
    except (OSError, UnicodeError, json.JSONDecodeError) as error:
        raise EvaluationError("Cannot read the evaluation dataset as UTF-8 JSON.") from error
    return validate_dataset(data, path.parent / "corpus")


def dataset_sha256(dataset_path, data):
    """Hash the manifest and every named file, with length-delimited components."""
    path = Path(dataset_path)
    digest = hashlib.sha256()
    components = [path.read_bytes()]
    for name in data["documents"]:
        components.extend([name.encode("utf-8"), (path.parent / "corpus" / name).read_bytes()])
    for content in components:
        digest.update(len(content).to_bytes(8, "big"))
        digest.update(content)
    return digest.hexdigest()


def rank_documents(hits):
    """Keep the best-ranked chunk per document; preserve the search result order."""
    seen = set()
    ranked = []
    for hit in hits:
        source = hit.chunk
        if source.document_id in seen:
            continue
        if not math.isfinite(hit.similarity):
            raise EvaluationError("A retrieval score was not finite.")
        seen.add(source.document_id)
        ranked.append({"filename": source.filename, "document_id": source.document_id,
                       "similarity": hit.similarity, "chunk_id": source.chunk_id,
                       "page_number": source.page_number})
    return ranked


def compute_metrics(rows, ks=KS):
    """Macro-average answerable queries; no-answer false positives are separate.

    A missing denominator is represented as None, not a perfect or zero score.
    Hit@K is binary per question. Recall@K gives partial credit for questions with
    several relevant documents. K counts unique documents, not overlapping chunks.
    """
    if not ks or any(type(k) is not int or k < 1 for k in ks) or len(set(ks)) != len(ks):
        raise EvaluationError("Metric cutoffs must be distinct positive integers.")
    answerable = [row for row in rows if row["relevant_documents"]]
    unanswerable = [row for row in rows if not row["relevant_documents"]]
    hit_rates = {}
    recall_rates = {}
    for k in ks:
        hits = []
        recalls = []
        for row in answerable:
            expected = set(row["relevant_documents"])
            # Defensively deduplicate filenames even when a caller supplies raw rows.
            retrieved = list(dict.fromkeys(item["filename"] for item in row["retrieved_documents"]))[:k]
            found = len(expected.intersection(retrieved))
            hits.append(int(found > 0))
            recalls.append(found / len(expected))
        hit_rates[str(k)] = sum(hits) / len(hits) if hits else None
        recall_rates[str(k)] = sum(recalls) / len(recalls) if recalls else None
    false_positives = sum(bool(row["retrieved_documents"]) for row in unanswerable)
    return {
        "answerable_questions": len(answerable), "unanswerable_questions": len(unanswerable),
        "hit_at_k": hit_rates, "macro_recall_at_k": recall_rates,
        "unanswerable_false_positive_count": false_positives,
        "unanswerable_false_positive_rate": false_positives / len(unanswerable) if unanswerable else None,
    }


def _versions():
    result = {}
    for package in ("sentence-transformers", "transformers", "torch", "chromadb", "PyMuPDF", "numpy"):
        try:
            result[package] = version(package)
        except PackageNotFoundError:
            result[package] = None
    return result


def evaluate_dataset(dataset_path=DEFAULT_DATASET, *, embedder=None):
    """Use the application's loader, chunker, embedding interface, and Chroma store.

    An injected embedder is only for deterministic tests; reports explicitly label
    those runs. Such numbers must never be presented as real-model measurements.
    """
    path = Path(dataset_path)
    data = load_dataset(path)
    fingerprint = dataset_sha256(path, data)
    chunks = []
    document_ids = set()
    for name in data["documents"]:
        document = load_document(name, (path.parent / "corpus" / name).read_bytes())
        if document.document_id in document_ids:
            raise EvaluationError("Corpus documents must have distinct content; duplicate bytes would make filename labels ambiguous.")
        document_ids.add(document.document_id)
        chunks.extend(chunk_document(document, chunk_size=CHUNK_SIZE, overlap=CHUNK_OVERLAP))
    injected = embedder is not None
    if embedder is None:
        embedder = LocalEmbedder()
    engine = SearchEngine(embedder=embedder)
    rows = []
    try:
        chunk_count = engine.build(tuple(chunks))
        for item in data["questions"]:
            hits = engine.search(item["question"], k=CANDIDATE_CHUNKS, min_similarity=MIN_SIMILARITY)
            ranked = rank_documents(hits)
            expected = set(item["relevant_documents"])
            rows.append({**item, "retrieved_chunk_count": len(hits), "retrieved_documents": ranked,
                         "relevant_found_at_k": {
                             str(k): len(expected.intersection(row["filename"] for row in ranked[:k])) for k in KS
                         }})
    finally:
        engine.clear()
    # Detect source edits during a run instead of publishing mixed-version metrics.
    if dataset_sha256(path, data) != fingerprint:
        raise EvaluationError("The dataset changed during evaluation. Rerun against a fixed snapshot.")
    return {
        "schema_version": 1, "generated_at_utc": datetime.now(timezone.utc).isoformat(),
        "dataset_sha256": fingerprint,
        "dataset_description": data["description"],
        "dataset_counts": {"documents": len(data["documents"]), "chunks": chunk_count, "questions": len(rows)},
        "runtime": {"python": platform.python_version(), "platform": platform.platform(), "packages": _versions()},
        "embedding": {"model_id": embedder.model_id, "model_name": None if injected else MODEL_NAME,
                      "revision": None if injected else MODEL_REVISION,
                      "device": "injected-test-embedder" if injected else "cpu",
                      "real_model_run": not injected,
                      "aggregation": None if injected else "token-weighted normalized window average"},
        "retrieval": {"chunk_size_characters": CHUNK_SIZE, "chunk_overlap_characters": CHUNK_OVERLAP,
                      "candidate_chunk_limit": CANDIDATE_CHUNKS, "min_cosine_similarity": MIN_SIMILARITY,
                      "metric_document_cutoffs": list(KS),
                      "ranking_rule": "Retrieve up to 20 chunks at threshold 0.25, then keep the first chunk per document ID in returned order. K counts unique documents.",
                      "all_corpus_chunks_fit_candidate_limit": chunk_count <= CANDIDATE_CHUNKS,
                      "ties": "Use application order: descending similarity then chunk ID among Chroma candidates.",
                      "unanswerable_rule": "Any returned document above threshold is a false positive on an unanswerable question."},
        "metrics": compute_metrics(rows), "queries": rows,
        "limitations": [
            "Small hand-authored learning dataset, fixed before measuring; not a held-out estimate of general retrieval quality.",
            "Relevance labels and metric denominators are document-level. Answer generation, quiz quality, and factual entailment are not evaluated.",
            "Questions and document coverage are limited; two Hinglish questions do not establish multilingual quality.",
            "Threshold and chunk settings are fixed for this run. Approximate search may vary across library/runtime versions.",
        ],
    }


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dataset", type=Path, default=DEFAULT_DATASET)
    parser.add_argument("--output", type=Path, default=Path("evaluation/results.json"))
    args = parser.parse_args(argv)
    try:
        report = evaluate_dataset(args.dataset)
        args.output.parent.mkdir(parents=True, exist_ok=True)
        # allow_nan=False ensures the artifact remains portable strict JSON.
        args.output.write_text(json.dumps(report, indent=2, ensure_ascii=False, allow_nan=False) + "\n", encoding="utf-8")
    except (ValueError, OSError) as error:
        parser.exit(1, f"Evaluation failed: {error}\n")
    print(json.dumps(report["metrics"], indent=2, allow_nan=False))
    print(f"Saved measured retrieval results to {args.output}")


if __name__ == "__main__":
    main()
