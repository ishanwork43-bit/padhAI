"""Real Chroma integration plus injected failures at the database boundary."""
from dataclasses import replace

import chromadb
from chromadb.config import Settings
import pytest

from src.chunker import Chunk
from src.vector_store import StoreError, WorkspaceStore

MODEL = "test-embedding@revision-1"


def chunk(key="c1", document="d1", text="Study material", page=1):
    return Chunk(key, document, "chapter.pdf", page, text, 0, len(text))


@pytest.fixture
def client():
    return chromadb.EphemeralClient(Settings(anonymized_telemetry=False))


@pytest.fixture
def stores(client):
    created = []
    def make():
        store = WorkspaceStore(client=client)
        created.append(store)
        return store
    yield make
    for store in created:
        store.clear()


def test_lazy_construction_and_empty_search():
    store = WorkspaceStore()
    assert store._client is None
    assert store.count == 0
    assert store.search([1.0, 0.0], model_id=MODEL) == ()
    store.clear()
    assert store._client is None


def test_real_cosine_search_returns_canonical_metadata(stores):
    store = stores()
    first = chunk(text="First source", page=4)
    second = chunk("c2", "d2", "Second source", None)
    store.replace((first, second), [[3, 0], [0, 2]], MODEL)
    hits = store.search([8, 0], model_id=MODEL, k=20, min_similarity=0.5)
    assert len(hits) == 1
    assert hits[0].chunk is first
    assert hits[0].similarity == pytest.approx(1.0)
    assert hits[0].chunk.page_number == 4
    assert store.count == 2
    stored = store._collection.get(ids=[second.chunk_id], include=["metadatas", "documents"])
    assert stored["metadatas"][0] == {
        "document_id": "d2", "filename": "chapter.pdf", "page_number": 0,
        "start_char": 0, "end_char": len(second.text),
    }
    assert stored["documents"] == [second.text]


def test_workspace_isolation_with_identical_ids(stores):
    left, right = stores(), stores()
    original = chunk()
    other = replace(original, filename="private-other.pdf")
    left.replace((original,), [[1, 0]], MODEL)
    right.replace((other,), [[0, 1]], MODEL)
    assert left._collection.name != right._collection.name
    assert left.search([1, 0], model_id=MODEL)[0].chunk is original
    assert right.search([1, 0], model_id=MODEL) == ()
    left.clear()
    assert right.search([0, 1], model_id=MODEL)[0].chunk is other


def test_fewer_results_empty_relevance_and_tie_order(stores):
    store = stores()
    store.replace((chunk("z"), chunk("a")), [[1, 0], [1, 0]], MODEL)
    assert [hit.chunk.chunk_id for hit in store.search([1, 0], model_id=MODEL, k=20)] == ["a", "z"]
    assert store.search([-1, 0], model_id=MODEL) == ()
    assert len(store.search([-1, 0], model_id=MODEL, min_similarity=-1)) == 2


def test_replacement_changes_model_and_dimension(stores):
    store = stores()
    store.replace((chunk(),), [[1, 0]], MODEL)
    store.replace((chunk("new"),), [[0, 0, 1]], "different@revision-2")
    assert store.count == 1
    assert store.search([0, 0, 1], model_id="different@revision-2")[0].chunk.chunk_id == "new"
    with pytest.raises(StoreError):
        store.search([1, 0], model_id=MODEL)


def test_failed_staged_replacement_preserves_previous_index(stores, client, monkeypatch):
    store = stores()
    original = chunk()
    store.replace((original,), [[1, 0]], MODEL)
    previous_name = store._collection.name
    names_before = {collection.name for collection in client.list_collections()}
    collection_type = type(store._collection)
    real_add = collection_type.add
    calls = 0
    def failing_add(self, *args, **kwargs):
        nonlocal calls
        calls += 1
        real_add(self, *args, **kwargs)
        if calls == 2:
            raise RuntimeError("private study material")
    with monkeypatch.context() as patch:
        patch.setattr(client, "get_max_batch_size", lambda: 1)
        patch.setattr(collection_type, "add", failing_add)
        with pytest.raises(StoreError) as caught:
            store.replace((chunk("new1"), chunk("new2")), [[0, 1], [0, 1]], MODEL)
        assert "private study material" not in str(caught.value)
    assert store._collection.name == previous_name
    assert store.count == 1
    assert store.search([1, 0], model_id=MODEL)[0].chunk is original
    assert {collection.name for collection in client.list_collections()} == names_before


def test_failed_creation_does_not_leave_unremovable_cleanup_entry(stores, client, monkeypatch):
    store = stores()
    with monkeypatch.context() as patch:
        def fail(*args, **kwargs):
            raise RuntimeError("private data")
        patch.setattr(client, "create_collection", fail)
        with pytest.raises(StoreError):
            store.replace((chunk(),), [[1, 0]], MODEL)
    assert not store._retired_names
    store.clear()


def test_delete_document_and_clear(stores):
    store = stores()
    store.replace((chunk("c1", "d1"), chunk("c2", "d1"), chunk("c3", "d2")),
                  [[1, 0], [1, 0], [0, 1]], MODEL)
    store.delete_document("d1")
    assert store.count == 1
    assert all(hit.chunk.document_id == "d2" for hit in store.search([0, 1], model_id=MODEL))
    store.delete_document("missing")
    store.delete_document("d2")
    assert store.count == 0
    assert store.search([1, 0], model_id=MODEL) == ()
    store.clear()
    store.clear()
    assert store._collection is None


def test_empty_replacement_clears_index(stores):
    store = stores()
    store.replace((chunk(),), [[1, 0]], MODEL)
    store.replace((), [], MODEL)
    assert store.count == 0
    assert store._collection is None


def test_clear_failure_preserves_active_reference(stores, client, monkeypatch):
    store = stores()
    store.replace((chunk(),), [[1, 0]], MODEL)
    active = store._collection
    with monkeypatch.context() as patch:
        def fail(*args, **kwargs):
            raise RuntimeError("private collection info")
        patch.setattr(client, "delete_collection", fail)
        with pytest.raises(StoreError) as caught:
            store.clear()
        assert "private collection info" not in str(caught.value)
        assert store._collection is active
        assert store.count == 1
        assert store.search([1, 0], model_id=MODEL)


@pytest.mark.parametrize("vector", [[], [0, 0], [float("nan"), 0], [float("inf"), 1],
                                    [True, 0], ["x", 1], [10**1000, 1]])
def test_invalid_vectors_are_rejected_without_replacing_index(stores, vector):
    store = stores()
    store.replace((chunk(),), [[1, 0]], MODEL)
    with pytest.raises(StoreError):
        store.replace((chunk("new"),), [vector], MODEL)
    assert store.search([1, 0], model_id=MODEL)[0].chunk.chunk_id == "c1"
    with pytest.raises(StoreError):
        store.search(vector, model_id=MODEL)


def test_extreme_finite_vectors_are_normalized_safely(stores):
    store = stores()
    store.replace((chunk(),), [[1e300, 0]], MODEL)
    assert store.search([1e-300, 0], model_id=MODEL)[0].similarity == pytest.approx(1)


@pytest.mark.parametrize("chunks,vectors", [
    ((chunk(),), []),
    ((chunk(), chunk()), [[1, 0], [0, 1]]),
    ((chunk(), chunk("c2")), [[1, 0], [1, 0, 0]]),
    ((replace(chunk(), page_number=0),), [[1, 0]]),
    ((replace(chunk(), end_char=100),), [[1, 0]]),
    ((replace(chunk(), filename=""),), [[1, 0]]),
])
def test_invalid_chunk_batches(stores, chunks, vectors):
    with pytest.raises(StoreError):
        stores().replace(chunks, vectors, MODEL)


@pytest.mark.parametrize("options", [{"k": 0}, {"k": 21}, {"k": True}, {"k": 1.5},
                                      {"min_similarity": float("nan")}, {"min_similarity": 1.1},
                                      {"min_similarity": -1.1}, {"min_similarity": True},
                                      {"min_similarity": 10**1000}])
def test_search_parameter_validation(stores, options):
    with pytest.raises(StoreError):
        stores().search([1, 0], model_id=MODEL, **options)


def test_model_identity_and_query_dimension_validation(stores):
    store = stores()
    store.replace((chunk(),), [[1, 0]], MODEL)
    for model in ["", " ", None, "other@revision-1"]:
        with pytest.raises(StoreError):
            store.search([1, 0], model_id=model)
    with pytest.raises(StoreError):
        store.search([1, 0, 0], model_id=MODEL)


@pytest.mark.parametrize("result", [
    {"ids": [["unknown-source"]], "distances": [[0.0]]},
    {"ids": [["c1", "c1"]], "distances": [[0.0, 0.0]]},
    {"ids": [["c1"]], "distances": [[]]},
    {"ids": [["c1"]], "distances": [[float("nan")]]},
    {"ids": [["c1"]], "distances": [[-100.0]]},
])
def test_invalid_database_results_never_become_sources(stores, monkeypatch, result):
    store = stores()
    store.replace((chunk(),), [[1, 0]], MODEL)
    with monkeypatch.context() as patch:
        patch.setattr(type(store._collection), "query", lambda *args, **kwargs: result)
        with pytest.raises(StoreError):
            store.search([1, 0], model_id=MODEL)


def test_delete_failure_keeps_canonical_sources(stores, monkeypatch):
    store = stores()
    store.replace((chunk(),), [[1, 0]], MODEL)
    with monkeypatch.context() as patch:
        def fail(*args, **kwargs):
            raise RuntimeError("private source")
        patch.setattr(type(store._collection), "delete", fail)
        with pytest.raises(StoreError) as caught:
            store.delete_document("d1")
        assert "private source" not in str(caught.value)
    assert store.count == 1
