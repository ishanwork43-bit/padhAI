"""Local CPU embeddings; only model weights are shared, never study material."""
from functools import lru_cache
import math
from threading import Lock

MODEL_NAME = "sentence-transformers/all-MiniLM-L6-v2"
MODEL_REVISION = "c9745ed1d9f207416be6d2e6f8de32d1f16199bf"
MODEL_ID = f"{MODEL_NAME}@{MODEL_REVISION}:weighted-windows-v1"
_MODEL_LOCK = Lock()


class EmbeddingError(ValueError):
    """A safe, actionable local model error."""


@lru_cache(maxsize=1)
def _load_model():
    try:
        from sentence_transformers import SentenceTransformer
        return SentenceTransformer(MODEL_NAME, revision=MODEL_REVISION,
                                   device="cpu", trust_remote_code=False)
    except Exception:
        raise EmbeddingError("The local embedding model could not load. Check your internet connection on first use, available disk space, and installed dependencies; then retry.") from None


def _windows(text, model):
    """Split oversized text before encoding so the tokenizer cannot truncate it.

    Splitting original strings preserves every character. Recursive halves are
    simple and bounded by the input length; most normal chunks need no split.
    """
    token_count = len(model.tokenizer.encode(text, add_special_tokens=True))
    if token_count <= model.max_seq_length:
        return [(text, max(1, token_count - model.tokenizer.num_special_tokens_to_add()))]
    if len(text) < 2:
        raise EmbeddingError("Text cannot fit the embedding model's token limit.")
    midpoint = len(text) // 2
    return _windows(text[:midpoint], model) + _windows(text[midpoint:], model)


class LocalEmbedder:
    model_id = MODEL_ID

    def __init__(self, model=None):
        self._model = model if model is not None else _load_model()

    def embed(self, texts: list[str]) -> list[list[float]]:
        if not isinstance(texts, (list, tuple)):
            raise EmbeddingError("Provide a list of texts to embed.")
        if any(not isinstance(text, str) or not text.strip() or len(text) > 10_000 for text in texts):
            raise EmbeddingError("Embedding inputs must contain 1–10,000 characters of nonblank text.")
        if not texts:
            return []
        try:
            import numpy as np
            output = []
            # Bound each encode batch; long documents do not allocate all windows at once.
            with _MODEL_LOCK:
                for text in texts:
                    windows = _windows(text, self._model)
                    encoded = self._model.encode([part for part, _ in windows],
                                                 normalize_embeddings=True,
                                                 convert_to_numpy=True,
                                                 show_progress_bar=False, batch_size=32)
                    array = np.asarray(encoded, dtype=float)
                    if array.ndim != 2 or array.shape[0] != len(windows) or not np.isfinite(array).all():
                        raise EmbeddingError("The local model returned invalid embeddings. Rebuild the index and retry.")
                    averaged = np.average(array, axis=0, weights=[weight for _, weight in windows])
                    norm = float(np.linalg.norm(averaged))
                    if not math.isfinite(norm) or norm <= 0:
                        raise EmbeddingError("The local model returned an empty embedding. Try different material.")
                    output.append((averaged / norm).tolist())
            return output
        except EmbeddingError:
            raise
        except Exception:
            raise EmbeddingError("Local embedding failed. Check available memory and model installation, then retry.") from None
