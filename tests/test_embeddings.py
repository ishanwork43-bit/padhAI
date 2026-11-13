"""Embedding adapter checks using a tiny deterministic model, never downloads."""
import sys
from types import SimpleNamespace

import numpy as np
import pytest

from src.embeddings import EmbeddingError, LocalEmbedder, _load_model, _windows


class CharacterTokenizer:
    def encode(self, text, add_special_tokens=True):
        return list(text) + (["CLS", "SEP"] if add_special_tokens else [])

    def num_special_tokens_to_add(self):
        return 2


class TinyModel:
    tokenizer = CharacterTokenizer()
    max_seq_length = 6

    def __init__(self):
        self.seen = []

    def encode(self, texts, **kwargs):
        self.seen.extend(texts)
        assert all(len(self.tokenizer.encode(text)) <= self.max_seq_length for text in texts)
        return np.array([[1., 0.] if text.startswith('a') else [0., 1.] for text in texts])


@pytest.mark.parametrize('text', ['short', 'पढ़ाई🙂漢字' * 30, 'one\n two\tthree ' * 20])
def test_long_input_is_fully_preserved_without_truncation(text):
    model = TinyModel()
    windows = _windows(text, model)
    assert ''.join(part for part, weight in windows) == text
    assert all(0 < len(model.tokenizer.encode(part)) <= model.max_seq_length for part, _ in windows)
    output = LocalEmbedder(model=model).embed([text])
    assert ''.join(model.seen) == text
    assert len(output) == 1
    assert np.linalg.norm(output[0]) == pytest.approx(1.)


def test_subwindow_vectors_are_token_weighted_then_normalized():
    # Five characters split into lengths two and three; semantic vectors differ.
    model = TinyModel()
    output = LocalEmbedder(model=model).embed(['aabbb'])
    assert model.seen == ['aa', 'bbb']
    assert output[0] == pytest.approx(np.array([2., 3.]) / np.sqrt(13))


def test_multiple_inputs_produce_separate_vectors():
    output = LocalEmbedder(model=TinyModel()).embed(['aaa', 'bbb'])
    assert output == [[1., 0.], [0., 1.]]


def test_empty_batch_does_not_call_model():
    model = TinyModel()
    assert LocalEmbedder(model=model).embed([]) == []
    assert not model.seen


@pytest.mark.parametrize('value', ['', ' \n\t ', 'a' * 10001, None, 7])
def test_invalid_input_is_rejected_before_encoding(value):
    model = TinyModel()
    with pytest.raises(EmbeddingError):
        LocalEmbedder(model=model).embed([value])
    assert not model.seen


@pytest.mark.parametrize('array', [np.array([1., 2.]), np.array([[np.nan, 1.]]),
                                    np.array([[np.inf, 1.]]), np.array([[0., 0.]]),
                                    np.array([[1., 0.], [0., 1.]]), np.empty((1, 0))])
def test_invalid_model_output_is_not_accepted(array):
    model = TinyModel()
    model.encode = lambda *args, **kwargs: array
    with pytest.raises(EmbeddingError):
        LocalEmbedder(model=model).embed(['aaa'])


def test_model_encoding_failure_does_not_disclose_inputs():
    model = TinyModel()
    def fail(*args, **kwargs):
        raise RuntimeError('PRIVATE-STUDY-TEXT')
    model.encode = fail
    with pytest.raises(EmbeddingError) as caught:
        LocalEmbedder(model=model).embed(['aaa'])
    assert 'PRIVATE-STUDY-TEXT' not in str(caught.value)


def test_failed_model_download_is_safe_and_retryable(monkeypatch):
    _load_model.cache_clear()
    calls = []
    def fail(*args, **kwargs):
        calls.append(1)
        raise OSError('PRIVATE-CACHE-PATH')
    monkeypatch.setitem(sys.modules, 'sentence_transformers', SimpleNamespace(SentenceTransformer=fail))
    try:
        for _ in range(2):
            with pytest.raises(EmbeddingError) as caught:
                _load_model()
            assert 'PRIVATE-CACHE-PATH' not in str(caught.value)
        assert len(calls) == 2  # Failed loads must not become a cached error.
    finally:
        _load_model.cache_clear()


@pytest.mark.parametrize('batch', ['ordinary text', None, 42])
def test_batch_must_be_a_sequence_of_texts(batch):
    with pytest.raises(EmbeddingError):
        LocalEmbedder(model=TinyModel()).embed(batch)
