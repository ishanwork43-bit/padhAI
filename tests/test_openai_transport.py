"""Check real OpenAI SDK serialization/failures using in-process HTTP responses."""
import json

import httpx
from openai import OpenAI
import pytest

from src.answer_generator import generate_answer
from src.chunker import chunk_document
from src.config import Settings
from src.document_loader import load_document
from src.vector_store import SearchHit


@pytest.fixture
def hits():
    chunk = chunk_document(load_document('private_filename.txt', b'Normalization reduces database redundancy.'))[0]
    return (SearchHit(chunk, 0.8),)


def test_real_sdk_sends_one_bounded_request_and_maps_returned_sources(hits):
    calls = []
    def handle(request):
        calls.append(request)
        assert request.url.path == '/v1/chat/completions'
        body = json.loads(request.content)
        assert body['model'] == 'gpt-4o-mini'
        assert body['store'] is False
        assert body['max_completion_tokens'] == 1600
        assert body['response_format']['json_schema']['strict'] is True
        assert 'private_filename' not in request.content.decode()
        payload = json.loads(body['messages'][1]['content'])
        assert payload['sources'][0]['source_id'] == 'S1'
        response = {'status': 'answered', 'claims': [{'text': 'Normalization reduces redundancy.',
                    'evidence': [{'source_id': 'S1', 'quote': 'Normalization reduces database redundancy.'}]}]}
        return httpx.Response(200, json={'id':'test', 'object':'chat.completion', 'created':0,
            'model':'gpt-4o-mini', 'choices':[{'index':0, 'finish_reason':'stop',
            'message':{'role':'assistant', 'content':json.dumps(response), 'refusal':None}}]})
    with httpx.Client(transport=httpx.MockTransport(handle)) as http:
        with OpenAI(api_key='fake-test-key', http_client=http, max_retries=0) as client:
            result = generate_answer('Explain normalization', hits, Settings(openai_api_key='fake-test-key'), client=client)
    assert len(calls) == 1
    assert result.mode == 'generated'
    assert result.claims[0].citations[0].chunk == hits[0].chunk


@pytest.mark.parametrize('status', [401, 403, 429, 500, 503])
def test_actual_sdk_error_types_fall_back_without_leaking_response(hits, status):
    calls = []
    def handle(request):
        calls.append(request)
        return httpx.Response(status, json={'error': {'message':'PRIVATE provider details', 'type':'api_error'}})
    with httpx.Client(transport=httpx.MockTransport(handle)) as http:
        with OpenAI(api_key='fake-test-key', http_client=http, max_retries=0) as client:
            result = generate_answer('Explain normalization', hits, Settings(openai_api_key='fake-test-key'), client=client)
    assert len(calls) == 1
    assert result.mode == 'retrieval_only'
    assert not result.claims
    assert 'PRIVATE' not in result.message


def test_actual_sdk_timeout_is_safe_and_not_retried(hits):
    calls = []
    def handle(request):
        calls.append(request)
        raise httpx.ReadTimeout('PRIVATE timeout details', request=request)
    with httpx.Client(transport=httpx.MockTransport(handle)) as http:
        with OpenAI(api_key='fake-test-key', http_client=http, max_retries=0) as client:
            result = generate_answer('Explain normalization', hits, Settings(openai_api_key='fake-test-key'), client=client)
    assert len(calls) == 1
    assert result.mode == 'retrieval_only'
    assert 'PRIVATE' not in result.message
