"""Coordinate a complete index build and retrieval without generating answers."""
import math

from src.embeddings import EmbeddingError, LocalEmbedder
from src.vector_store import StoreError, WorkspaceStore


class RetrievalError(ValueError):
    """A user-visible failure that never includes document or query contents."""


class SearchEngine:
    def __init__(self, embedder=None, store=None):
        self._embedder = embedder
        self._store = store if store is not None else WorkspaceStore()

    def build(self, chunks):
        chunks = tuple(chunks)
        if not chunks:
            raise RetrievalError("Add readable notes before building a search index.")
        if len(chunks) > 5000:
            raise RetrievalError("Too many chunks. Use fewer or shorter documents in this session.")
        try:
            if self._embedder is None:
                self._embedder = LocalEmbedder()
            vectors = self._embedder.embed([chunk.text for chunk in chunks])
            self._store.replace(chunks, vectors, self._embedder.model_id)
            return self._store.count
        except (EmbeddingError, StoreError) as error:
            raise RetrievalError(str(error)) from None

    def search(self, question, k=5, min_similarity=0.25):
        if not isinstance(question, str) or not question.strip():
            raise RetrievalError("Enter a question before searching.")
        if len(question) > 2000:
            raise RetrievalError("Keep questions to 2,000 characters or fewer.")
        if type(k) is not int or not 1 <= k <= 20:
            raise RetrievalError("Choose between 1 and 20 search results.")
        if (isinstance(min_similarity, bool) or not isinstance(min_similarity, (int, float))
                or not -1 <= min_similarity <= 1 or not math.isfinite(min_similarity)):
            raise RetrievalError("Similarity threshold must be between -1 and 1.")
        if self._embedder is None or self._store.count == 0:
            raise RetrievalError("Build a search index from your notes first.")
        try:
            vector = self._embedder.embed([question.strip()])[0]
            return self._store.search(vector, model_id=self._embedder.model_id,
                                      k=k, min_similarity=min_similarity)
        except (EmbeddingError, StoreError) as error:
            raise RetrievalError(str(error)) from None

    def clear(self):
        try:
            self._store.clear()
        except StoreError as error:
            raise RetrievalError(str(error)) from None
