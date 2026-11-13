"""Use the actual SDK with in-process HTTP fixtures; no paid API requests."""
import json

import httpx
from openai import OpenAI
import pytest

from src.chunker import chunk_document
from src.config import Settings
from src.document_loader import load_document
from src.quiz_generator import generate_quiz


def notes():
    return chunk_document(load_document('private-name.txt', b'Normalization reduces redundancy in database tables.'))


def response_content(count):
    return {'status': 'ready', 'questions': [
        {'question': f'Which process reduces redundancy in example {i + 1}?',
         'options': ['Normalization', 'Replication', 'Encryption', 'Sorting'],
         'correct_index': 0, 'explanation': 'The source states that normalization reduces redundancy.',
         'evidence': [{'source_id': 'S1', 'quote': 'Normalization reduces redundancy in database tables.'}]}
        for i in range(count)
    ]}


@pytest.mark.parametrize('count', [5, 10, 20])
def test_sdk_serializes_requested_quiz_and_validates_evidence(count):
    calls = []
    def handle(request):
        calls.append(request)
        body = json.loads(request.content)
        assert request.url.path == '/v1/chat/completions'
        assert body['max_completion_tokens'] == count * 600
        assert body['store'] is False
        assert body['response_format']['json_schema']['strict'] is True
        data = json.loads(body['messages'][1]['content'])
        assert data['question_count'] == count
        assert data['difficulty'] == 'medium'
        assert 'private-name.txt' not in request.content.decode()
        return httpx.Response(200, json={'id':'fixture', 'object':'chat.completion', 'created':0,
            'model':'gpt-4o-mini', 'choices':[{'index':0, 'finish_reason':'stop',
            'message':{'role':'assistant', 'content':json.dumps(response_content(count)), 'refusal':None}}]})
    with httpx.Client(transport=httpx.MockTransport(handle)) as http:
        with OpenAI(api_key='fake-test-key', http_client=http, max_retries=0) as client:
            result = generate_quiz(notes(), count, 'medium', Settings(openai_api_key='fake-test-key'), client=client)
    assert len(calls) == 1
    assert result.mode == 'generated'
    assert len(result.questions) == count
    assert result.questions[0].citations[0].chunk == notes()[0]


@pytest.mark.parametrize('status', [401, 429, 500])
def test_sdk_failure_never_returns_partial_quiz_or_diagnostics(status):
    calls = []
    def handle(request):
        calls.append(request)
        return httpx.Response(status, json={'error': {'message':'PRIVATE provider data', 'type':'api_error'}})
    with httpx.Client(transport=httpx.MockTransport(handle)) as http:
        with OpenAI(api_key='fake-test-key', http_client=http, max_retries=0) as client:
            result = generate_quiz(notes(), 5, 'easy', Settings(openai_api_key='fake-test-key'), client=client)
    assert len(calls) == 1
    assert result.mode == 'error'
    assert result.questions == ()
    assert 'PRIVATE' not in result.message
