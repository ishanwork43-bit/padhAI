"""Exercise retrieval orchestration with real Chroma and fixed local vectors."""
import pytest

from src.chunker import chunk_document
from src.document_loader import load_document
from src.embeddings import EmbeddingError
from src.retriever import RetrievalError, SearchEngine
from src.vector_store import StoreError, WorkspaceStore


class TopicEmbedder:
    model_id = 'test-topics@revision1'

    def __init__(self):
        self.calls = []
        self.fail = False

    def embed(self, texts):
        self.calls.append(texts)
        if self.fail:
            raise EmbeddingError('Local model unavailable; retry.')
        return [[1., 0.] if 'database' in text.lower() else [0., 1.] for text in texts]


def chunks(name, text):
    return chunk_document(load_document(name, text.encode()))


@pytest.fixture
def engine():
    item = SearchEngine(embedder=TopicEmbedder(), store=WorkspaceStore())
    yield item
    item.clear()


def test_build_query_returns_original_passages_and_metadata(engine):
    first = chunks('db.md', 'Database normalization reduces redundancy.')
    second = chunks('cloud.txt', 'Cloud platforms host applications.')
    assert engine.build(first + second) == 2
    hits = engine.search('database concepts', k=5)
    assert len(hits) == 1
    assert hits[0].chunk == first[0]
    assert hits[0].similarity == pytest.approx(1.)
    assert hits[0].chunk.page_number is None


def test_rebuild_replaces_old_sources(engine):
    first = chunks('db.txt', 'Database notes')
    second = chunks('cloud.txt', 'Cloud notes')
    engine.build(first)
    engine.build(second)
    assert engine.search('database') == ()
    assert engine.search('cloud')[0].chunk.document_id == second[0].document_id


def test_failed_embedding_preserves_previous_working_index(engine):
    old = chunks('db.txt', 'Database notes')
    engine.build(old)
    engine._embedder.fail = True
    with pytest.raises(RetrievalError, match='Local model unavailable'):
        engine.build(chunks('new.txt', 'Cloud notes'))
    engine._embedder.fail = False
    assert engine.search('database')[0].chunk == old[0]


def test_failed_store_replacement_preserves_previous_index(engine, monkeypatch):
    old = chunks('db.txt', 'Database notes')
    engine.build(old)
    def fail(*args, **kwargs):
        raise StoreError('Indexing failed. Previous index preserved.')
    monkeypatch.setattr(engine._store, 'replace', fail)
    with pytest.raises(RetrievalError, match='Indexing failed'):
        engine.build(chunks('new.txt', 'Cloud notes'))
    assert engine.search('database')[0].chunk == old[0]


def test_two_engines_keep_workspaces_separate(engine):
    other = SearchEngine(embedder=TopicEmbedder(), store=WorkspaceStore())
    try:
        engine.build(chunks('first.txt', 'Database session one'))
        other.build(chunks('second.txt', 'Database session two'))
        assert engine.search('database')[0].chunk.filename == 'first.txt'
        assert other.search('database')[0].chunk.filename == 'second.txt'
    finally:
        other.clear()


def test_clear_prevents_search_until_rebuilt(engine):
    material = chunks('notes.txt', 'Database notes')
    engine.build(material)
    engine.clear()
    with pytest.raises(RetrievalError, match='Build a search index'):
        engine.search('database')
    assert engine.build(material) == 1


@pytest.mark.parametrize('question', ['', '  \n', None, 42, 'x' * 2001])
def test_invalid_questions_fail_without_embedding(engine, question):
    with pytest.raises(RetrievalError):
        engine.search(question)
    assert engine._embedder.calls == []


@pytest.mark.parametrize('k', [0, 21, True, 1.5, '5'])
def test_invalid_result_counts_fail_without_embedding(engine, k):
    with pytest.raises(RetrievalError):
        engine.search('database', k=k)
    assert engine._embedder.calls == []


@pytest.mark.parametrize('threshold', [float('nan'), float('inf'), -1.1, 1.1, True, '0.5', 10**1000])
def test_invalid_similarity_thresholds(engine, threshold):
    with pytest.raises(RetrievalError):
        engine.search('database', min_similarity=threshold)
    assert engine._embedder.calls == []


def test_empty_build_is_rejected(engine):
    with pytest.raises(RetrievalError, match='readable notes'):
        engine.build(())
    assert engine._embedder.calls == []


def test_oversized_index_is_rejected_before_embedding(engine):
    material = chunks('notes.txt', 'Database notes')
    with pytest.raises(RetrievalError, match='Too many chunks'):
        engine.build(material * 5001)
    assert engine._embedder.calls == []


def test_search_without_build_does_not_load_model(monkeypatch):
    def unexpected_load():
        raise AssertionError('Search must not load a model before indexing')
    monkeypatch.setattr('src.retriever.LocalEmbedder', unexpected_load)
    with pytest.raises(RetrievalError, match='Build a search index'):
        SearchEngine().search('database')


def test_question_whitespace_is_stripped(engine):
    engine.build(chunks('notes.txt', 'Database notes'))
    engine.search('  database \n')
    assert engine._embedder.calls[-1] == ['database']


def test_clear_failure_is_reported(engine, monkeypatch):
    def fail():
        raise StoreError('Workspace storage could not be cleared.')
    monkeypatch.setattr(engine._store, 'clear', fail)
    with pytest.raises(RetrievalError, match='could not be cleared'):
        engine.clear()
    monkeypatch.undo()
