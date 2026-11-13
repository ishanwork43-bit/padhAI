from pathlib import Path
import pytest
from streamlit.testing.v1 import AppTest

APP = Path(__file__).resolve().parents[1] / 'app.py'

@pytest.fixture(autouse=True)
def clean_settings(monkeypatch):
    monkeypatch.setenv('OPENAI_API_KEY', '')
    monkeypatch.setenv('OPENAI_MODEL', 'gpt-4o-mini')
    monkeypatch.setenv('MAX_UPLOAD_MB', '10')


def test_all_pages_and_rerun():
    app = AppTest.from_file(str(APP)).run()
    assert not app.exception
    assert any('Your notes' in title.value for title in app.title)
    for page in ['My Notes', 'Ask PadhAI', 'Quiz Mode', 'Home']:
        app.radio[0].set_value(page).run()
        assert not app.exception
        assert app.info
    app.radio[0].set_value('Quiz Mode').run()
    assert app.button[0].disabled


def test_configuration_error_is_safe(monkeypatch):
    monkeypatch.setenv('MAX_UPLOAD_MB', 'private-invalid-value')
    app = AppTest.from_file(str(APP)).run()
    assert not app.exception
    assert app.error
    assert 'private-invalid-value' not in app.error[0].value
    assert not app.radio


def test_key_presence_does_not_claim_connectivity(monkeypatch):
    monkeypatch.setenv('OPENAI_API_KEY', 'example-test-key')
    app = AppTest.from_file(str(APP)).run()
    assert not app.exception
    captions = ' '.join(item.value for item in app.caption)
    assert 'connectivity not verified' in captions
    assert 'example-test-key' not in captions


def seeded_notes_app():
    from src.document_loader import load_document
    from src.chunker import chunk_document
    document = load_document('notes.md', b'<script>alert(1)</script>\n# Private study notes')
    app = AppTest.from_file(str(APP)).run()
    app.session_state['notes'] = {
        document.document_id: {'document': document, 'chunks': chunk_document(document)}
    }
    app.radio[0].set_value('My Notes').run()
    return app, document


def test_notes_preview_and_navigation_preserve_state():
    app, document = seeded_notes_app()
    assert not app.exception
    assert any('<script>alert(1)</script>' in block.value for block in app.code)
    assert not any('<script>alert(1)</script>' in block.value for block in app.markdown)
    app.radio[0].set_value('Home').run()
    app.radio[0].set_value('My Notes').run()
    assert not app.exception
    assert list(app.session_state['notes']) == [document.document_id]


@pytest.mark.parametrize('button_key', ['remove_note', 'clear_notes'])
def test_removal_clears_upload_selection(button_key):
    app, document = seeded_notes_app()
    generation = app.session_state['upload_generation']
    app.button(key=button_key).click().run()
    assert not app.exception
    assert app.session_state['notes'] == {}
    assert app.session_state['upload_generation'] == generation + 1
    assert app.session_state['upload_results'] == []
    app.run()
    assert app.session_state['notes'] == {}


def test_separate_sessions_do_not_share_notes():
    first, document = seeded_notes_app()
    second = AppTest.from_file(str(APP)).run()
    second.radio[0].set_value('My Notes').run()
    assert not second.exception
    assert second.session_state['notes'] == {}
    assert document.document_id in first.session_state['notes']


def test_empty_upload_cannot_process():
    app = AppTest.from_file(str(APP)).run()
    app.radio[0].set_value('My Notes').run()
    button = next(button for button in app.button if button.label == 'Process selected files')
    assert button.disabled


class UploadedFixture:
    def __init__(self, name, content):
        self.name = name
        self.content = content
        self.size = len(content)

    def getvalue(self):
        return self.content


def upload_app(monkeypatch, files):
    # AppTest does not provide file-uploader actions; only the uploader input is replaced.
    monkeypatch.setattr('streamlit.file_uploader', lambda *args, **kwargs: files)
    app = AppTest.from_file(str(APP)).run()
    app.radio[0].set_value('My Notes').run()
    return app


def process_files(app):
    button = next(button for button in app.button if button.label == 'Process selected files')
    button.click().run()
    assert not app.exception


def test_mixed_batch_and_repeat_do_not_lose_valid_notes(monkeypatch):
    files = [UploadedFixture('empty.txt', b''), UploadedFixture('notes.txt', b'First note'),
             UploadedFixture('notes.txt', b'Second note'), UploadedFixture('copy.md', b'First note')]
    app = upload_app(monkeypatch, files)
    process_files(app)
    assert len(app.session_state['notes']) == 2
    assert len(app.error) == 1
    assert len(app.success) == 2
    assert any('Identical file' in info.value for info in app.info)
    process_files(app)
    assert len(app.session_state['notes']) == 2
    assert not app.success


def test_batch_limit_rejects_before_processing(monkeypatch):
    app = upload_app(monkeypatch, [UploadedFixture(f'{i}.txt', str(i).encode()) for i in range(21)])
    process_files(app)
    assert app.session_state['notes'] == {}
    assert '20 files' in app.error[0].value


def test_oversized_file_is_rejected_before_read(monkeypatch):
    file = UploadedFixture('large.txt', b'data')
    file.size = 10 * 1024 * 1024 + 1
    def unexpected_read():
        raise AssertionError('Oversized upload should not be copied')
    file.getvalue = unexpected_read
    app = upload_app(monkeypatch, [file])
    process_files(app)
    assert app.session_state['notes'] == {}
    assert 'size limit' in app.error[0].value


def test_document_count_limit_preserves_existing_notes(monkeypatch):
    from src.document_loader import load_document
    from src.chunker import chunk_document
    app = upload_app(monkeypatch, [UploadedFixture('new.txt', b'new')])
    entries = {}
    for i in range(20):
        document = load_document(f'{i}.txt', f'note {i}'.encode())
        entries[document.document_id] = {'document': document, 'chunks': chunk_document(document)}
    app.session_state['notes'] = entries
    process_files(app)
    assert len(app.session_state['notes']) == 20
    assert '20 documents' in app.error[0].value


def test_session_byte_limit_preserves_existing_notes(monkeypatch):
    from dataclasses import replace
    from src.document_loader import load_document
    app = upload_app(monkeypatch, [UploadedFixture('new.txt', b'new')])
    document = replace(load_document('old.txt', b'old'), byte_size=50 * 1024 * 1024)
    app.session_state['notes'] = {document.document_id: {'document': document, 'chunks': ()}}
    process_files(app)
    assert list(app.session_state['notes']) == [document.document_id]
    assert '50 MiB' in app.error[0].value


def test_session_text_limit_preserves_existing_notes(monkeypatch):
    from dataclasses import replace
    from src.document_loader import load_document
    app = upload_app(monkeypatch, [UploadedFixture('new.txt', b'new')])
    document = load_document('old.txt', b'old')
    document = replace(document, pages=(replace(document.pages[0], text='x' * 2_000_000),))
    app.session_state['notes'] = {document.document_id: {'document': document, 'chunks': ()}}
    process_files(app)
    assert list(app.session_state['notes']) == [document.document_id]
    assert '2 million' in app.error[0].value


@pytest.fixture
def fake_engine(monkeypatch):
    """Exercise UI lifecycle without downloading models or creating a real index."""
    from types import SimpleNamespace
    from src.retriever import RetrievalError

    class FakeEngine:
        instances = []
        fail_build = False
        fail_search = False
        fail_clear = False
        no_matches = False

        def __init__(self):
            self.chunks = ()
            self.clear_calls = 0
            self.search_calls = []
            self.instances.append(self)

        def build(self, chunks):
            if self.fail_build:
                raise RetrievalError('Local model unavailable. Try again.')
            self.chunks = chunks
            return len(chunks)

        def search(self, question, k=5, min_similarity=.25):
            self.search_calls.append(question)
            if not question.strip():
                raise RetrievalError('Enter a question.')
            if self.fail_search:
                raise RetrievalError('Search unavailable. Try again.')
            if self.no_matches:
                return ()
            return tuple(SimpleNamespace(chunk=chunk, similarity=.75) for chunk in self.chunks[:k])

        def clear(self):
            self.clear_calls += 1
            if self.fail_clear:
                raise RetrievalError('Cleanup failed.')
            self.chunks = ()

    monkeypatch.setattr('src.retriever.SearchEngine', FakeEngine)
    return FakeEngine


def indexed_app(fake_engine):
    app, document = seeded_notes_app()
    app.radio[0].set_value('Ask PadhAI').run()
    assert fake_engine.instances == []
    app.button(key='build_index').click().run()
    assert not app.exception
    return app, document, fake_engine.instances[-1]


def search_app(app, question='private study notes'):
    app.text_area(key='search_question').set_value(question)
    next(button for button in app.button if button.label == 'Find passages').click().run()
    assert not app.exception


def test_search_build_is_explicit_and_passages_have_sources(fake_engine):
    app, document, engine = indexed_app(fake_engine)
    search_app(app)
    assert any(document.filename == item.value for item in app.text)
    assert any('<script>alert(1)</script>' in item.value for item in app.code)
    assert not any('<script>alert(1)</script>' in item.value for item in app.markdown)
    assert app.session_state['submitted_question'] == 'private study notes'
    assert any('similarity 0.750' in item.value for item in app.caption)
    assert engine.search_calls == ['private study notes']


def test_build_failure_preserves_notes_and_can_retry(fake_engine):
    fake_engine.fail_build = True
    app, document, engine = indexed_app(fake_engine)
    assert 'search_engine' not in app.session_state
    assert engine.clear_calls == 1
    assert document.document_id in app.session_state['notes']
    assert any('Local model unavailable' in item.value for item in app.error)
    fake_engine.fail_build = False
    app.button(key='build_index').click().run()
    assert not app.exception
    assert 'search_engine' in app.session_state
    search_app(app)
    assert app.session_state['search_results']


@pytest.mark.parametrize('question', ['', 'another question'])
def test_failed_query_clears_previous_passages(fake_engine, question):
    app, document, engine = indexed_app(fake_engine)
    search_app(app)
    engine.fail_search = True
    search_app(app, question)
    assert app.session_state['search_results'] is None
    assert not app.code
    assert app.error


def test_unmatched_question_has_honest_empty_state(fake_engine):
    app, document, engine = indexed_app(fake_engine)
    search_app(app)
    engine.no_matches = True
    search_app(app, 'unrelated question')
    assert app.session_state['search_results'] == ()
    assert not app.code
    assert any('No sufficiently similar' in item.value for item in app.info)


@pytest.mark.parametrize('button_key', ['remove_note', 'clear_notes'])
def test_deleting_notes_discards_index_and_results(fake_engine, button_key):
    app, document, engine = indexed_app(fake_engine)
    search_app(app)
    app.radio[0].set_value('My Notes').run()
    app.button(key=button_key).click().run()
    assert not app.exception
    assert 'search_engine' not in app.session_state
    assert app.session_state['search_results'] is None
    assert engine.clear_calls == 1
    app.radio[0].set_value('Ask PadhAI').run()
    assert not app.code
    assert not app.text_area


def test_cleanup_failure_cannot_reuse_old_results(fake_engine):
    app, document, engine = indexed_app(fake_engine)
    search_app(app)
    engine.fail_clear = True
    app.radio[0].set_value('My Notes').run()
    app.button(key='clear_notes').click().run()
    assert not app.exception
    assert 'search_engine' not in app.session_state
    assert app.session_state['search_results'] is None


def test_duplicate_upload_retains_index_but_new_notes_invalidate(fake_engine, monkeypatch):
    app, document, engine = indexed_app(fake_engine)
    search_app(app)
    uploads = [UploadedFixture('copy.md', b'<script>alert(1)</script>\n# Private study notes')]
    monkeypatch.setattr('streamlit.file_uploader', lambda *args, **kwargs: uploads)
    app.radio[0].set_value('My Notes').run()
    process_files(app)
    assert app.session_state['search_engine'] is engine
    assert app.session_state['search_results']
    assert engine.clear_calls == 0
    uploads.append(UploadedFixture('new.txt', b'A new topic'))
    process_files(app)
    assert 'search_engine' not in app.session_state
    assert app.session_state['search_results'] is None
    assert engine.clear_calls == 1


def test_failed_upload_preserves_index(fake_engine, monkeypatch):
    app, document, engine = indexed_app(fake_engine)
    monkeypatch.setattr('streamlit.file_uploader', lambda *args, **kwargs: [UploadedFixture('empty.txt', b'')])
    app.radio[0].set_value('My Notes').run()
    process_files(app)
    assert app.session_state['search_engine'] is engine
    assert engine.clear_calls == 0


def test_rebuild_failure_preserves_previous_complete_index(fake_engine):
    app, document, engine = indexed_app(fake_engine)
    search_app(app)
    fake_engine.fail_build = True
    app.button(key='build_index').click().run()
    assert not app.exception
    assert app.session_state['search_engine'] is engine
    assert app.session_state['search_results'] is None
    assert engine.clear_calls == 0
    assert not app.code
    search_app(app, 'still searchable')
    assert app.session_state['search_results']


def test_search_sessions_do_not_share_indexes(fake_engine):
    first, document, engine = indexed_app(fake_engine)
    second = AppTest.from_file(str(APP)).run()
    second.radio[0].set_value('Ask PadhAI').run()
    assert 'search_engine' not in second.session_state
    assert first.session_state['search_engine'] is engine
    assert len(fake_engine.instances) == 1


def test_successful_rebuild_replaces_and_cleans_old_index(fake_engine):
    app, document, engine = indexed_app(fake_engine)
    search_app(app)
    app.button(key='build_index').click().run()
    assert not app.exception
    assert app.session_state['search_engine'] is not engine
    assert engine.clear_calls == 1
    assert app.session_state['search_results'] is None
    search_app(app)
    assert app.session_state['search_results']


@pytest.fixture
def fake_answer(monkeypatch):
    from types import SimpleNamespace

    state = {'calls': [], 'mode': 'generated'}

    def generate(question, hits, settings, *, client=None):
        state['calls'].append((question, hits, settings))
        if state['mode'] != 'generated':
            return SimpleNamespace(mode=state['mode'], message='Unable to produce a supported answer. Review the passages.', claims=())
        citation = SimpleNamespace(source_id='S1', chunk=hits[0].chunk, quote=hits[0].chunk.text)
        claim = SimpleNamespace(text='<script>Generated claim</script>', citations=(citation,))
        return SimpleNamespace(mode='generated', message='Answer based on selected excerpts.', claims=(claim,))

    monkeypatch.setattr('src.answer_generator.generate_answer', generate)
    return state


def generated_answer_app(fake_engine, fake_answer, monkeypatch):
    monkeypatch.setenv('OPENAI_API_KEY', 'test-key')
    app, document, engine = indexed_app(fake_engine)
    search_app(app)
    assert fake_answer['calls'] == []
    app.button(key='generate_answer').click().run()
    assert not app.exception
    return app, document, engine


def test_no_key_disables_generation_without_calling_provider(fake_engine, fake_answer):
    app, document, engine = indexed_app(fake_engine)
    search_app(app)
    assert app.button(key='generate_answer').disabled
    assert fake_answer['calls'] == []
    assert any('no OpenAI API key' in caption.value for caption in app.caption)
    assert app.code
    assert len(app.chat_message) == 2


def test_generation_is_explicit_and_citations_are_plain_text(fake_engine, fake_answer, monkeypatch):
    app, document, engine = generated_answer_app(fake_engine, fake_answer, monkeypatch)
    assert len(fake_answer['calls']) == 1
    assert fake_answer['calls'][0][0] == 'private study notes'
    assert fake_answer['calls'][0][1] == app.session_state['search_results']
    assert any('[S1] notes.md' == item.value for item in app.text)
    assert any('<script>Generated claim</script>' == item.value for item in app.text)
    assert not any('<script>Generated claim</script>' in item.value for item in app.markdown)
    assert any('may incur API charges' in item.value for item in app.caption)
    assert any('selected excerpts to OpenAI' in item.value for item in app.caption)
    assert any('not a guarantee' in item.value for item in app.caption)


def test_generation_does_not_repeat_on_rerun_or_navigation(fake_engine, fake_answer, monkeypatch):
    app, document, engine = generated_answer_app(fake_engine, fake_answer, monkeypatch)
    app.run()
    app.radio[0].set_value('Home').run()
    app.radio[0].set_value('Ask PadhAI').run()
    assert not app.exception
    assert len(fake_answer['calls']) == 1
    assert app.session_state['answer_result'].mode == 'generated'
    assert any('<script>Generated claim</script>' == item.value for item in app.text)


@pytest.mark.parametrize('mode', ['retrieval_only', 'insufficient'])
def test_generation_fallback_keeps_passages(fake_engine, fake_answer, monkeypatch, mode):
    fake_answer['mode'] = mode
    app, document, engine = generated_answer_app(fake_engine, fake_answer, monkeypatch)
    assert app.session_state['answer_result'].mode == mode
    assert any('Unable to produce a supported answer' in item.value for item in app.text)
    assert any(document.pages[0].text in item.value for item in app.code)
    assert not any('<script>Generated claim</script>' == item.value for item in app.text)
    assert len(fake_answer['calls']) == 1


def test_no_matches_disable_generation_even_with_key(fake_engine, fake_answer, monkeypatch):
    monkeypatch.setenv('OPENAI_API_KEY', 'test-key')
    app, document, engine = indexed_app(fake_engine)
    engine.no_matches = True
    search_app(app)
    assert app.button(key='generate_answer').disabled
    assert fake_answer['calls'] == []


@pytest.mark.parametrize('action', ['question', 'failed_question', 'rebuild', 'remove_note', 'clear_notes', 'new_document'])
def test_generated_answer_is_cleared_when_context_changes(fake_engine, fake_answer, monkeypatch, action):
    app, document, engine = generated_answer_app(fake_engine, fake_answer, monkeypatch)
    if action in {'question', 'failed_question'}:
        engine.fail_search = action == 'failed_question'
        search_app(app, 'another topic')
    elif action == 'rebuild':
        app.button(key='build_index').click().run()
    else:
        if action == 'new_document':
            monkeypatch.setattr('streamlit.file_uploader', lambda *args, **kwargs: [UploadedFixture('extra.txt', b'Extra learning material')])
        app.radio[0].set_value('My Notes').run()
        if action == 'new_document':
            process_files(app)
        else:
            app.button(key=action).click().run()
        app.radio[0].set_value('Ask PadhAI').run()
    assert not app.exception
    assert app.session_state['answer_result'] is None
    assert len(fake_answer['calls']) == 1
    assert not any('<script>Generated claim</script>' == item.value for item in app.text)


def test_failed_generation_can_be_retried_explicitly(fake_engine, fake_answer, monkeypatch):
    fake_answer['mode'] = 'retrieval_only'
    app, document, engine = generated_answer_app(fake_engine, fake_answer, monkeypatch)
    fake_answer['mode'] = 'generated'
    app.button(key='generate_answer').click().run()
    assert not app.exception
    assert len(fake_answer['calls']) == 2
    assert app.session_state['answer_result'].mode == 'generated'


@pytest.fixture
def fake_quiz(monkeypatch):
    from src.answer_generator import Citation
    from src.quiz_generator import QuizQuestion, QuizResult

    state = {'calls': [], 'mode': 'generated'}

    def generate(chunks, question_count, difficulty, settings, *, client=None):
        state['calls'].append((chunks, question_count, difficulty, settings))
        if state['mode'] != 'generated':
            return QuizResult(mode=state['mode'], message='Quiz unavailable. Check the selected material.', questions=())
        citation = Citation(source_id='S1', chunk=chunks[0], quote=chunks[0].text)
        questions = tuple(QuizQuestion(
            question=f'<script>Question {index + 1}</script>',
            options=('<img src=x onerror=alert(1)>', 'Second choice', 'Third choice', 'Fourth choice'),
            correct_index=1, explanation=f'Explanation only after submission {index + 1}',
            citations=(citation,),
        ) for index in range(question_count))
        return QuizResult(mode='generated', message='Quiz ready.', questions=questions)

    monkeypatch.setattr('src.quiz_generator.generate_quiz', generate)
    return state


def quiz_app(fake_quiz, monkeypatch, *, generate=True):
    monkeypatch.setenv('OPENAI_API_KEY', 'test-key')
    app, document = seeded_notes_app()
    app.radio(key='navigation').set_value('Quiz Mode').run()
    assert fake_quiz['calls'] == []
    if generate:
        app.button(key='generate_quiz').click().run()
        assert not app.exception
    return app, document


def quiz_answer_radios(app):
    return [radio for radio in app.radio if radio.key.startswith('quiz_answer_')]


def submit_quiz(app):
    next(button for button in app.button if button.label == 'Submit quiz').click().run()
    assert not app.exception


def test_quiz_no_key_or_notes_disables_generation(fake_quiz, monkeypatch):
    app = AppTest.from_file(str(APP)).run()
    app.radio(key='navigation').set_value('Quiz Mode').run()
    assert app.button(key='generate_quiz').disabled
    assert any('no OpenAI API key' in item.value for item in app.caption)
    monkeypatch.setenv('OPENAI_API_KEY', 'test-key')
    app.run()
    assert app.button(key='generate_quiz').disabled
    assert any('Add readable documents' in item.value for item in app.caption)
    assert fake_quiz['calls'] == []


@pytest.mark.parametrize('count,difficulty', [(5, 'easy'), (10, 'medium'), (20, 'hard')])
def test_quiz_generation_is_explicit_and_has_requested_settings(fake_quiz, monkeypatch, count, difficulty):
    app, document = quiz_app(fake_quiz, monkeypatch, generate=False)
    app.selectbox(key='quiz_count').set_value(count).run()
    app.selectbox(key='quiz_difficulty').set_value(difficulty).run()
    assert fake_quiz['calls'] == []
    app.button(key='generate_quiz').click().run()
    assert not app.exception
    assert fake_quiz['calls'][0][1:3] == (count, difficulty)
    assert len(app.session_state['quiz_result'].questions) == count
    assert len(quiz_answer_radios(app)) == count
    assert 'search_engine' not in app.session_state
    assert any('may incur API charges' in item.value for item in app.caption)


def test_quiz_hides_explanations_and_renders_model_text_literally(fake_quiz, monkeypatch):
    app, document = quiz_app(fake_quiz, monkeypatch)
    assert any('<script>Question 1</script>' in item.value for item in app.text)
    assert any('<img src=x onerror=alert(1)>' in item.value for item in app.text)
    assert not any('<script>Question' in item.value or '<img src=x' in item.value for item in app.markdown)
    assert not any('Explanation only after submission' in item.value or 'Correct answer:' in item.value for item in app.text)
    assert not app.code
    assert all(radio.options == ['A', 'B', 'C', 'D'] for radio in quiz_answer_radios(app))
    assert all(radio.value is None for radio in quiz_answer_radios(app))


def test_partial_quiz_submission_scores_all_questions_and_reveals_feedback(fake_quiz, monkeypatch):
    app, document = quiz_app(fake_quiz, monkeypatch)
    radios = quiz_answer_radios(app)
    radios[0].set_value('B')
    radios[1].set_value('A')
    submit_quiz(app)
    score = app.session_state['quiz_score']
    assert (score.correct, score.total, score.unanswered, score.percentage) == (1, 5, 3, 20)
    assert all(radio.disabled for radio in quiz_answer_radios(app))
    assert next(button for button in app.button if button.label == 'Submit quiz').disabled
    assert any('Explanation only after submission 1' == item.value for item in app.text)
    assert any('[S1] notes.md' == item.value for item in app.text)
    assert any(document.pages[0].text == item.value for item in app.code)
    app.run()
    assert app.session_state['quiz_score'] == score
    assert len(fake_quiz['calls']) == 1


def test_all_unanswered_quiz_is_valid_zero_score(fake_quiz, monkeypatch):
    app, document = quiz_app(fake_quiz, monkeypatch)
    submit_quiz(app)
    score = app.session_state['quiz_score']
    assert (score.correct, score.total, score.unanswered, score.percentage) == (0, 5, 5, 0)


def test_retake_clears_answers_and_feedback_without_api_call(fake_quiz, monkeypatch):
    app, document = quiz_app(fake_quiz, monkeypatch)
    quiz_answer_radios(app)[0].set_value('B')
    submit_quiz(app)
    questions = app.session_state['quiz_result'].questions
    old_generation = app.session_state['quiz_generation']
    app.button(key='retake_quiz').click().run()
    assert not app.exception
    assert app.session_state['quiz_result'].questions == questions
    assert app.session_state['quiz_generation'] > old_generation
    assert app.session_state['quiz_score'] is None
    assert app.session_state['quiz_answers'] is None
    assert all(radio.value is None and not radio.disabled for radio in quiz_answer_radios(app))
    assert not any('Explanation only after submission' in item.value for item in app.text)
    assert len(fake_quiz['calls']) == 1


def test_submitted_quiz_and_settings_survive_navigation(fake_quiz, monkeypatch):
    app, document = quiz_app(fake_quiz, monkeypatch, generate=False)
    app.selectbox(key='quiz_count').set_value(10).run()
    app.selectbox(key='quiz_difficulty').set_value('hard').run()
    app.button(key='generate_quiz').click().run()
    quiz_answer_radios(app)[0].set_value('B')
    submit_quiz(app)
    score = app.session_state['quiz_score']
    app.radio(key='navigation').set_value('Home').run()
    app.radio(key='navigation').set_value('Quiz Mode').run()
    assert not app.exception
    assert app.session_state['quiz_score'] == score
    assert app.selectbox(key='quiz_count').value == 10
    assert app.selectbox(key='quiz_difficulty').value == 'hard'
    assert quiz_answer_radios(app)[0].value == 'B'
    assert quiz_answer_radios(app)[0].disabled
    assert len(fake_quiz['calls']) == 1


@pytest.mark.parametrize('setting,value', [('quiz_count', 20), ('quiz_difficulty', 'medium')])
def test_quiz_parameter_changes_invalidate_attempt(fake_quiz, monkeypatch, setting, value):
    app, document = quiz_app(fake_quiz, monkeypatch)
    submit_quiz(app)
    app.selectbox(key=setting).set_value(value).run()
    assert not app.exception
    assert app.session_state['quiz_result'] is None
    assert app.session_state['quiz_score'] is None
    assert app.session_state['quiz_answers'] is None
    assert not quiz_answer_radios(app)
    assert len(fake_quiz['calls']) == 1


@pytest.mark.parametrize('action', ['remove_note', 'clear_notes', 'new_document'])
def test_note_changes_invalidate_quiz(fake_quiz, monkeypatch, action):
    app, document = quiz_app(fake_quiz, monkeypatch)
    submit_quiz(app)
    if action == 'new_document':
        monkeypatch.setattr('streamlit.file_uploader', lambda *args, **kwargs: [UploadedFixture('extra.txt', b'New note topic')])
    app.radio(key='navigation').set_value('My Notes').run()
    if action == 'new_document':
        process_files(app)
    else:
        app.button(key=action).click().run()
    app.radio(key='navigation').set_value('Quiz Mode').run()
    assert not app.exception
    assert app.session_state['quiz_result'] is None
    assert app.session_state['quiz_score'] is None
    assert app.session_state['quiz_answers'] is None


def test_duplicate_upload_preserves_quiz(fake_quiz, monkeypatch):
    app, document = quiz_app(fake_quiz, monkeypatch)
    submit_quiz(app)
    result, score = app.session_state['quiz_result'], app.session_state['quiz_score']
    monkeypatch.setattr('streamlit.file_uploader', lambda *args, **kwargs: [UploadedFixture('duplicate.md', b'<script>alert(1)</script>\n# Private study notes')])
    app.radio(key='navigation').set_value('My Notes').run()
    process_files(app)
    app.radio(key='navigation').set_value('Quiz Mode').run()
    assert not app.exception
    assert app.session_state['quiz_result'] == result
    assert app.session_state['quiz_score'] == score
    assert len(fake_quiz['calls']) == 1


@pytest.mark.parametrize('mode', ['disabled', 'insufficient', 'error'])
def test_failed_quiz_generation_hides_previous_attempt(fake_quiz, monkeypatch, mode):
    app, document = quiz_app(fake_quiz, monkeypatch)
    submit_quiz(app)
    fake_quiz['mode'] = mode
    app.button(key='generate_quiz').click().run()
    assert not app.exception
    assert app.session_state['quiz_result'].mode == mode
    assert app.session_state['quiz_score'] is None
    assert app.session_state['quiz_answers'] is None
    assert not quiz_answer_radios(app)
    assert not any('Correct answer:' in item.value for item in app.text)
    assert any('Quiz unavailable' in item.value for item in app.text)


def test_search_requery_does_not_invalidate_quiz(fake_quiz, fake_engine, monkeypatch):
    app, document = quiz_app(fake_quiz, monkeypatch)
    result = app.session_state['quiz_result']
    app.radio(key='navigation').set_value('Ask PadhAI').run()
    app.button(key='build_index').click().run()
    search_app(app)
    app.radio(key='navigation').set_value('Quiz Mode').run()
    assert not app.exception
    assert app.session_state['quiz_result'] == result
    assert len(fake_quiz['calls']) == 1
