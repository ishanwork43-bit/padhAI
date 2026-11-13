"""Workspace-isolated, in-memory Chroma storage with explicit embeddings.

Chroma is imported only when an index is created. A failed replacement never
publishes its partially built collection as the workspace's active index.
"""
from dataclasses import dataclass
import math
from numbers import Real
from threading import RLock
from uuid import uuid4

from src.chunker import Chunk


class StoreError(ValueError):
    """Safe storage error: never contains study text or underlying DB diagnostics."""


@dataclass(frozen=True)
class SearchHit:
    chunk: Chunk
    similarity: float


def _model_identity(model_id: str) -> None:
    if not isinstance(model_id, str) or not model_id.strip():
        raise StoreError("Provide the embedding model identity, including its revision.")


def _unit_vector(vector, dimension: int | None = None) -> list[float]:
    if not isinstance(vector, (list, tuple)) or not vector:
        raise StoreError("Embeddings must be nonempty numeric vectors.")
    if dimension is not None and len(vector) != dimension:
        raise StoreError("Embedding dimensions do not match the workspace index.")
    try:
        invalid = any(isinstance(value, bool) or not isinstance(value, Real)
                      or not math.isfinite(value) for value in vector)
    except (OverflowError, TypeError):
        invalid = True
    if invalid:
        raise StoreError("Embeddings must contain finite numbers.")
    # Scale before normalizing to avoid overflow/underflow for extreme inputs.
    scale = max(abs(value) for value in vector)
    if scale == 0:
        raise StoreError("Zero embeddings cannot be searched with cosine similarity.")
    scaled = [float(value / scale) for value in vector]
    norm = math.hypot(*scaled)
    return [value / norm for value in scaled]


def _check_chunk(chunk: Chunk) -> None:
    if not isinstance(chunk, Chunk):
        raise StoreError("The index requires chunks with source metadata.")
    if any(not isinstance(value, str) or not value.strip()
           for value in (chunk.chunk_id, chunk.document_id, chunk.filename, chunk.text)):
        raise StoreError("Chunk identifiers, source names, and text must be nonempty.")
    if (type(chunk.start_char) is not int or type(chunk.end_char) is not int
            or chunk.start_char < 0 or chunk.end_char - chunk.start_char != len(chunk.text)
            or (chunk.page_number is not None
                and (type(chunk.page_number) is not int or chunk.page_number < 1))):
        raise StoreError("Chunk source offsets or page metadata are invalid.")


class WorkspaceStore:
    """An opaque workspace namespace; never accepts a user-provided collection ID.

    model_id must identify both the embedding model and its revision. No model is
    downloaded by Chroma: all writes and queries require caller-supplied vectors.
    The optional client is for tests or application-managed Chroma configuration.
    """

    def __init__(self, client=None):
        self._client = client
        self._namespace = f"padhai-{uuid4().hex}"
        self._collection = None
        self._chunks: dict[str, Chunk] = {}
        self._dimension = None
        self._model_id = None
        self._retired_names: set[str] = set()
        self._lock = RLock()

    def _get_client(self):
        if self._client is None:
            try:
                import chromadb
                from chromadb.config import Settings
                self._client = chromadb.EphemeralClient(Settings(anonymized_telemetry=False))
            except Exception:
                raise StoreError("Vector storage could not start. Check the installed Chroma dependency.") from None
        return self._client

    def _retire(self, name: str) -> None:
        """Keep a failed cleanup name so clear() can retry it later."""
        try:
            self._client.delete_collection(name=name)
            self._retired_names.discard(name)
        except Exception:
            self._retired_names.add(name)

    @property
    def count(self) -> int:
        with self._lock:
            return len(self._chunks)

    def replace(self, chunks: tuple[Chunk, ...], vectors: list[list[float]], model_id: str) -> None:
        _model_identity(model_id)
        if len(chunks) != len(vectors):
            raise StoreError("Each chunk must have exactly one embedding.")
        canonical = {}
        dimension = None
        normalized = []
        for chunk, vector in zip(chunks, vectors):
            _check_chunk(chunk)
            if chunk.chunk_id in canonical:
                raise StoreError("Duplicate chunk IDs cannot be indexed.")
            normalized.append(_unit_vector(vector, dimension))
            dimension = len(normalized[-1])
            canonical[chunk.chunk_id] = chunk
        with self._lock:
            if not chunks:
                self.clear()
                return
            client = self._get_client()
            stage_name = f"{self._namespace}-{uuid4().hex}"
            stage = None
            try:
                stage = client.create_collection(
                    name=stage_name, embedding_function=None,
                    metadata={"hnsw:space": "cosine", "model_id": model_id},
                )
                batch_size = min(500, client.get_max_batch_size())
                for start in range(0, len(chunks), batch_size):
                    batch = chunks[start:start + batch_size]
                    stage.add(
                        ids=[chunk.chunk_id for chunk in batch],
                        documents=[chunk.text for chunk in batch],
                        embeddings=normalized[start:start + batch_size],
                        metadatas=[{
                            "document_id": chunk.document_id,
                            "filename": chunk.filename,
                            "page_number": chunk.page_number or 0,
                            "start_char": chunk.start_char,
                            "end_char": chunk.end_char,
                        } for chunk in batch],
                    )
            except Exception:
                if stage is not None:
                    self._retire(stage_name)
                raise StoreError("Indexing failed. The previous workspace index has been preserved.") from None
            previous = self._collection
            self._collection = stage
            self._chunks = canonical
            self._dimension = dimension
            self._model_id = model_id
            if previous is not None:
                self._retire(previous.name)

    def search(self, vector: list[float], *, model_id: str, k: int = 5,
               min_similarity: float = 0.25) -> tuple[SearchHit, ...]:
        _model_identity(model_id)
        if type(k) is not int or not 1 <= k <= 20:
            raise StoreError("Result count must be an integer from 1 to 20.")
        if (isinstance(min_similarity, bool) or not isinstance(min_similarity, Real)
                or not -1 <= min_similarity <= 1 or not math.isfinite(min_similarity)):
            raise StoreError("Minimum similarity must be a finite number from -1 to 1.")
        with self._lock:
            query = _unit_vector(vector, self._dimension)
            if self._collection is None or not self._chunks:
                return ()
            if model_id != self._model_id:
                raise StoreError("The embedding model changed. Rebuild the workspace index before searching.")
            try:
                result = self._collection.query(
                    query_embeddings=[query], n_results=min(k, len(self._chunks)),
                    include=["distances"],
                )
                ids, distances = result["ids"][0], result["distances"][0]
                if len(ids) != len(distances) or len(set(ids)) != len(ids):
                    raise ValueError("Invalid search response")
                hits = []
                for chunk_id, distance in zip(ids, distances):
                    if (chunk_id not in self._chunks or isinstance(distance, bool)
                            or not math.isfinite(distance) or not -1e-5 <= distance <= 2.00001):
                        raise ValueError("Invalid search source")
                    similarity = max(-1.0, min(1.0, 1.0 - distance))
                    if similarity >= min_similarity:
                        hits.append(SearchHit(self._chunks[chunk_id], similarity))
                hits.sort(key=lambda hit: (-hit.similarity, hit.chunk.chunk_id))
                return tuple(hits)
            except Exception:
                raise StoreError("Search failed. The workspace index may need to be rebuilt.") from None

    def delete_document(self, document_id: str) -> None:
        if not isinstance(document_id, str) or not document_id.strip():
            raise StoreError("Provide a valid document ID to remove.")
        with self._lock:
            ids = [key for key, chunk in self._chunks.items() if chunk.document_id == document_id]
            if not ids:
                return
            try:
                self._collection.delete(ids=ids)
            except Exception:
                raise StoreError("The document could not be removed from the index. Try again.") from None
            for chunk_id in ids:
                del self._chunks[chunk_id]

    def clear(self) -> None:
        with self._lock:
            # Clean retired/staged collections first. A failure preserves the active
            # reference and canonical sources so the caller can report/retry safely.
            for name in tuple(self._retired_names):
                try:
                    self._client.delete_collection(name=name)
                except Exception:
                    raise StoreError("Workspace storage could not be fully cleared. Try again.") from None
                self._retired_names.discard(name)
            if self._collection is not None:
                try:
                    self._client.delete_collection(name=self._collection.name)
                except Exception:
                    raise StoreError("Workspace storage could not be cleared. Try again.") from None
            self._collection = None
            self._chunks = {}
            self._dimension = None
            self._model_id = None
