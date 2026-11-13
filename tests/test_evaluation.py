"""Metric math and a real Chroma evaluation run with fixed offline vectors."""
from copy import deepcopy
import json

import pytest

from evaluation.run_retrieval import (
    DEFAULT_DATASET, EvaluationError, compute_metrics, dataset_sha256,
    evaluate_dataset, load_dataset, rank_documents, validate_dataset,
)
from src.chunker import Chunk
from src.vector_store import SearchHit


def row(relevant, retrieved):
    return {"relevant_documents": relevant,
            "retrieved_documents": [{"filename": name} for name in retrieved]}


def test_known_macro_hit_recall_and_unanswerable_false_positive_rates():
    rows = [row(["a"], ["b", "a"]), row(["a", "c"], ["c"]), row(["d"], []),
            row([], ["a"]), row([], [])]
    metrics = compute_metrics(rows)
    assert metrics["answerable_questions"] == 3
    assert metrics["unanswerable_questions"] == 2
    assert metrics["hit_at_k"] == {"1": pytest.approx(1 / 3), "3": pytest.approx(2 / 3), "5": pytest.approx(2 / 3)}
    assert metrics["macro_recall_at_k"] == {"1": pytest.approx(1 / 6), "3": 0.5, "5": 0.5}
    assert metrics["unanswerable_false_positive_count"] == 1
    assert metrics["unanswerable_false_positive_rate"] == 0.5


def test_missing_denominators_are_none_not_perfect_or_zero_scores():
    empty = compute_metrics([])
    assert empty["hit_at_k"] == {"1": None, "3": None, "5": None}
    assert empty["macro_recall_at_k"] == {"1": None, "3": None, "5": None}
    assert empty["unanswerable_false_positive_rate"] is None
    unanswered_only = compute_metrics([row([], [])])
    assert unanswered_only["hit_at_k"]["1"] is None
    assert unanswered_only["unanswerable_false_positive_rate"] == 0
    answerable_only = compute_metrics([row(["a"], [])])
    assert answerable_only["hit_at_k"]["1"] == 0
    assert answerable_only["macro_recall_at_k"]["1"] == 0
    assert answerable_only["unanswerable_false_positive_rate"] is None


def test_document_cutoff_deduplicates_retrieved_filenames_before_counting():
    metrics = compute_metrics([row(["a", "b"], ["a", "a", "a", "b"])], ks=(1, 2))
    assert metrics["macro_recall_at_k"] == {"1": 0.5, "2": 1.0}
    assert metrics["hit_at_k"] == {"1": 1.0, "2": 1.0}


def test_equal_score_document_order_is_preserved_and_duplicate_chunks_do_not_add_ranks():
    first = Chunk("b1", "doc-b", "b.txt", None, "First source", 0, 12)
    second = Chunk("b2", "doc-b", "b.txt", None, "Later source", 20, 32)
    third = Chunk("a1", "doc-a", "a.txt", None, "Third source", 0, 12)
    ranked = rank_documents((SearchHit(first, 0.8), SearchHit(second, 0.8), SearchHit(third, 0.8)))
    assert [item["filename"] for item in ranked] == ["b.txt", "a.txt"]
    assert ranked[0]["chunk_id"] == "b1"
    assert ranked[0]["similarity"] == 0.8


@pytest.mark.parametrize("ks", [(), (0,), (True,), (1.5,), (1, 1)])
def test_invalid_cutoffs_are_rejected(ks):
    with pytest.raises(EvaluationError):
        compute_metrics([], ks=ks)


@pytest.fixture
def tiny_dataset(tmp_path):
    corpus = tmp_path / "corpus"
    corpus.mkdir()
    (corpus / "alpha.txt").write_text("Alpha notes about the first topic.")
    (corpus / "beta.txt").write_text("Beta notes about a separate second topic.")
    data = {"schema_version": 1, "description": "Offline metric test only.",
            "documents": ["alpha.txt", "beta.txt"], "questions": [
                {"id": "q1", "question": "Explain alpha", "relevant_documents": ["alpha.txt"], "language": "en"},
                {"id": "q2", "question": "Explain beta", "relevant_documents": ["beta.txt"], "language": "en"},
                {"id": "q3", "question": "Unknown gamma", "relevant_documents": [], "language": "en"},
            ]}
    path = tmp_path / "dataset.json"
    path.write_text(json.dumps(data))
    return path, data


def test_fixed_dataset_labels_and_fingerprint_are_complete():
    data = load_dataset()
    assert len(data["documents"]) == 8
    assert len(data["questions"]) == 20
    assert sum(not item["relevant_documents"] for item in data["questions"]) == 2
    assert sum(len(item["relevant_documents"]) > 1 for item in data["questions"]) == 2
    assert sum(item["language"] == "hinglish" for item in data["questions"]) == 2
    first = dataset_sha256(DEFAULT_DATASET, data)
    assert len(first) == 64
    assert first == dataset_sha256(DEFAULT_DATASET, data)


def test_fingerprint_covers_corpus_and_manifest(tiny_dataset):
    path, data = tiny_dataset
    original = dataset_sha256(path, data)
    (path.parent / "corpus" / "alpha.txt").write_text("Alpha updated content.")
    changed = dataset_sha256(path, data)
    assert changed != original
    path.write_text(json.dumps(data, indent=2))
    assert dataset_sha256(path, data) != changed


@pytest.mark.parametrize("mutation", [
    lambda data: data.update(schema_version=True),
    lambda data: data.update(extra="invalid field"),
    lambda data: data.update(documents=["alpha.txt", "alpha.txt"]),
    lambda data: data.update(documents=["../alpha.txt"]),
    lambda data: data.update(documents=["missing.txt"]),
    lambda data: data["questions"][1].update(id="q1"),
    lambda data: data["questions"][0].update(relevant_documents=["missing.txt"]),
    lambda data: data["questions"][0].update(relevant_documents=["alpha.txt", "alpha.txt"]),
    lambda data: data["questions"][0].pop("relevant_documents"),
    lambda data: data["questions"][0].update(question="   "),
    lambda data: data["questions"][0].update(question=" " * 2000 + "q"),
    lambda data: data["questions"][0].update(language="unknown"),
])
def test_invalid_dataset_is_rejected_before_evaluation(tiny_dataset, mutation):
    path, data = tiny_dataset
    changed = deepcopy(data)
    mutation(changed)
    with pytest.raises(EvaluationError):
        validate_dataset(changed, path.parent / "corpus")


def test_duplicate_json_keys_are_rejected(tiny_dataset):
    path, _ = tiny_dataset
    path.write_text('{"schema_version":1,"schema_version":1}')
    with pytest.raises(EvaluationError):
        load_dataset(path)


class FixedEmbedder:
    """Deliberate synthetic vectors: this is a pipeline test, not a model benchmark."""
    model_id = "test-fixed-vectors@1"

    def embed(self, texts):
        vectors = []
        for text in texts:
            lower = text.lower()
            vectors.append([1.0, 0.0, 0.0] if "alpha" in lower else
                           [0.0, 1.0, 0.0] if "beta" in lower else
                           [0.0, 0.0, 1.0])
        return vectors


def test_offline_evaluation_runs_actual_loader_chunker_and_chroma(tiny_dataset):
    path, _ = tiny_dataset
    report = evaluate_dataset(path, embedder=FixedEmbedder())
    assert report["embedding"]["real_model_run"] is False
    assert report["embedding"]["model_id"] == "test-fixed-vectors@1"
    assert report["embedding"]["revision"] is None
    assert report["dataset_counts"] == {"documents": 2, "chunks": 2, "questions": 3}
    assert report["metrics"]["hit_at_k"]["1"] == 1.0
    assert report["metrics"]["macro_recall_at_k"]["1"] == 1.0
    assert report["metrics"]["unanswerable_false_positive_rate"] == 0.0
    assert [item["filename"] for item in report["queries"][0]["retrieved_documents"]] == ["alpha.txt"]
    assert report["queries"][0]["relevant_found_at_k"]["1"] == 1
    assert report["queries"][2]["retrieved_documents"] == []
    assert report["retrieval"]["candidate_chunk_limit"] == 20
    assert report["retrieval"]["min_cosine_similarity"] == 0.25
    assert report["runtime"]["packages"]["chromadb"]
    assert report["generated_at_utc"].endswith("+00:00")
    json.dumps(report, allow_nan=False)


def test_duplicate_document_bytes_make_labels_ambiguous(tiny_dataset):
    path, _ = tiny_dataset
    (path.parent / "corpus" / "beta.txt").write_bytes((path.parent / "corpus" / "alpha.txt").read_bytes())
    with pytest.raises(EvaluationError, match="distinct content"):
        evaluate_dataset(path, embedder=FixedEmbedder())
