"""PadhAI: study notes, local retrieval, optional AI answers, and quizzes."""
from hashlib import sha256

import streamlit as st

from src.answer_generator import generate_answer
from src.chunker import chunk_document
from src.config import ConfigurationError, load_settings
from src.document_loader import DocumentError, load_document
from src.retriever import RetrievalError, SearchEngine
from src.quiz_generator import QuizValidationError, generate_quiz, score_quiz

MAX_DOCUMENTS = 20
MAX_SESSION_BYTES = 50 * 1024 * 1024
MAX_SESSION_CHARACTERS = 2_000_000
MAX_BATCH_FILES = 20
PREVIEW_CHARACTERS = 5000


def clear_search_results():
    st.session_state.search_results = None
    st.session_state.submitted_question = ""
    st.session_state.answer_result = None


def reset_quiz_attempt():
    """Fresh widget keys prevent answers from leaking into a new attempt."""
    st.session_state.quiz_generation = st.session_state.get("quiz_generation", 0) + 1
    st.session_state.quiz_answers = None
    st.session_state.quiz_score = None


def reset_quiz():
    st.session_state.quiz_result = None
    reset_quiz_attempt()


def invalidate_search():
    """Drop the handle even if cleanup fails; old passages must never be reused."""
    engine = st.session_state.pop("search_engine", None)
    clear_search_results()
    clear_engine(engine)
    reset_quiz()


def clear_engine(engine):
    if engine is not None:
        try:
            engine.clear()
        except RetrievalError:
            message = "An unused index could not be fully cleaned up. It has been detached from this session's search."
            st.session_state.search_cleanup_warning = message
            st.warning(message)


def reset_uploads():
    """A new widget key discards pending uploads on the next rerun."""
    st.session_state.upload_generation += 1
    st.session_state.upload_results = []


def process_uploads(uploads, max_bytes):
    """Validate each file independently; add it only after all checks pass."""
    notes = st.session_state.notes
    results = []
    changed = False
    if len(uploads) > MAX_BATCH_FILES:
        return [("", "error", "Select at most 20 files in one batch.")]
    for upload in uploads:
        # Check the declared size before copying bytes; the loader checks again.
        if upload.size > max_bytes:
            results.append((upload.name, "error", "This file exceeds the configured per-file size limit."))
            continue
        content = upload.getvalue()
        document_id = sha256(content).hexdigest()
        if document_id in notes:
            results.append((upload.name, "info", "Identical file already present; kept the existing copy."))
            continue
        if len(notes) >= MAX_DOCUMENTS:
            results.append((upload.name, "error", "This session holds at most 20 documents. Remove a document first."))
            continue
        used_bytes = sum(item["document"].byte_size for item in notes.values())
        if used_bytes + len(content) > MAX_SESSION_BYTES:
            results.append((upload.name, "error", "The 50 MiB session limit would be exceeded. Remove a document first."))
            continue
        try:
            document = load_document(upload.name, content, max_bytes=max_bytes)
        except DocumentError as error:
            results.append((upload.name, "error", str(error)))
            continue
        used_characters = sum(len(page.text) for item in notes.values() for page in item["document"].pages)
        new_characters = sum(len(page.text) for page in document.pages)
        if used_characters + new_characters > MAX_SESSION_CHARACTERS:
            results.append((upload.name, "error", "The session limit of 2 million extracted characters would be exceeded."))
            continue
        chunks = chunk_document(document)
        if not changed:
            invalidate_search()
            changed = True
        notes[document.document_id] = {"document": document, "chunks": chunks}
        results.append((document.filename, "success", "Document processed and ready to inspect."))
    return results


def show_notes(max_bytes):
    st.title("My Notes")
    st.caption("Notes stay in this browser session's server memory. Reloading or disconnecting may clear them. Uploaded notes are not saved to disk.")
    st.write(f"PDF, UTF-8 TXT, and Markdown · {max_bytes // (1024 * 1024)} MiB per file · up to 20 documents / 50 MiB per session.")
    uploads = st.file_uploader(
        "Choose study materials", type=["pdf", "txt", "md"], accept_multiple_files=True,
        key=f"uploads_{st.session_state.upload_generation}",
    )
    if st.button("Process selected files", disabled=not uploads, type="primary"):
        with st.spinner("Reading your notes…"):
            st.session_state.upload_results = process_uploads(uploads, max_bytes)
    for filename, level, message in st.session_state.upload_results:
        if filename:
            st.text(filename)
        getattr(st, level)(message)

    notes = st.session_state.notes
    if not notes:
        st.info("Add a document to preview its extracted text and chunks. Scanned PDFs need OCR before upload.")
        return
    st.divider()
    st.subheader("Your documents")
    st.caption(f"{len(notes)} document(s) · {sum(item['document'].byte_size for item in notes.values()) / (1024 * 1024):.2f} MiB")
    if st.button("Clear all notes", key="clear_notes"):
        notes.clear()
        invalidate_search()
        reset_uploads()
        st.rerun()
    selected_id = st.selectbox(
        "Document", list(notes),
        format_func=lambda value: f"{notes[value]['document'].filename} · {value[:8]}",
    )
    item = notes[selected_id]
    document, chunks = item["document"], item["chunks"]
    st.text(document.filename)
    page_count = sum(page.page_number is not None for page in document.pages)
    st.caption(f"{page_count} PDF page(s) · {len(chunks)} chunks" if page_count else f"Text document · {len(chunks)} chunks · no page numbers")
    for warning in document.warnings:
        st.warning(warning)
    if st.button("Remove this document", key="remove_note"):
        del notes[selected_id]
        invalidate_search()
        reset_uploads()
        st.rerun()
    st.subheader("Extracted text")
    page_index = st.selectbox(
        "Source page", list(range(len(document.pages))),
        format_func=lambda index: f"Page {document.pages[index].page_number}" if document.pages[index].page_number else "Text document",
        key=f"page_{selected_id}",
    )
    source_page = document.pages[page_index]
    if source_page.text.strip():
        # Plain code blocks keep uploaded Markdown and HTML inert.
        st.code(source_page.text[:PREVIEW_CHARACTERS], language=None)
        if len(source_page.text) > PREVIEW_CHARACTERS:
            st.caption("Preview shows the first 5,000 characters. The extracted document retains the full text within the processing limits.")
    else:
        st.info("This page has no extractable text.")
    with st.expander("Inspect chunks"):
        st.caption("Chunks keep their source page and overlap by up to 150 characters. They supply the passages shown by search.")
        if chunks:
            chunk_number = st.number_input("Chunk number", min_value=1, max_value=len(chunks), value=1, step=1, key=f"chunk_{selected_id}")
            chunk = chunks[chunk_number - 1]
            st.caption(f"Source page: {chunk.page_number or 'not applicable'} · characters {chunk.start_char}–{chunk.end_char} (end excluded)")
            st.code(chunk.text, language=None)
        else:
            st.info("No nonempty chunks were produced.")


def show_search(settings):
    st.title("Ask PadhAI")
    st.info("Search your notes locally, then optionally request an AI answer with supporting source quotes. Local search needs no OpenAI key.")
    if not st.session_state.notes:
        st.write("Add documents in My Notes before building a search index.")
        return
    st.caption("The first build downloads the all-MiniLM-L6-v2 model. After that, embeddings and searches run locally. This model works best with English; other languages may retrieve less reliably.")
    existing_engine = st.session_state.get("search_engine")
    label = "Rebuild search index" if existing_engine is not None else "Build search index"
    if st.button(label, key="build_index", type="primary"):
        clear_search_results()
        candidate = None
        try:
            with st.spinner("Preparing the local model and indexing your notes…"):
                candidate = SearchEngine()
                chunks = tuple(chunk for item in st.session_state.notes.values() for chunk in item["chunks"])
                count = candidate.build(chunks)
            # Publish only the completed index, so failures cannot expose partial results.
            st.session_state.search_engine = candidate
            clear_engine(existing_engine)
            st.success(f"Search is ready for {count} chunks.")
        except RetrievalError as error:
            if candidate is not None:
                try:
                    candidate.clear()
                except RetrievalError:
                    pass
            st.error(str(error))
            st.caption("Your notes are still available. Check the reported issue and try building again.")
            if existing_engine is not None:
                st.info("Your previous completed index is still available for searching.")
    engine = st.session_state.get("search_engine")
    if engine is None:
        return
    st.caption("Each question is independent. Previous questions and answers are not sent as conversation history.")
    with st.form("search_form"):
        question = st.text_area("What would you like to find in your notes?", max_chars=2000, key="search_question")
        count = st.slider("Maximum passages", min_value=1, max_value=10, value=5)
        submitted = st.form_submit_button("Find passages")
    if submitted:
        clear_search_results()
        try:
            with st.spinner("Finding relevant passages…"):
                results = engine.search(question, k=count)
            st.session_state.search_results = results
            st.session_state.submitted_question = question.strip()
        except RetrievalError as error:
            st.error(str(error))
    results = st.session_state.get("search_results")
    if results is None:
        return
    with st.chat_message("user"):
        st.text(st.session_state.submitted_question)
    with st.chat_message("assistant"):
        st.caption("Generate AI answer sends the current question and selected excerpts to OpenAI and may incur API charges. This happens only when you click the button.")
        if not settings.ai_configured:
            st.caption("AI generation is disabled because no OpenAI API key is configured. Relevant passages remain available below.")
        if st.button("Generate AI answer", key="generate_answer", disabled=not settings.ai_configured or not results):
            with st.spinner("Generating an answer from the selected excerpts…"):
                st.session_state.answer_result = generate_answer(
                    st.session_state.submitted_question, tuple(results), settings,
                )
        answer = st.session_state.get("answer_result")
        if answer is not None:
            st.text(answer.message)
            if answer.mode == "generated":
                st.subheader("AI answer")
                st.caption("Source quotes are checked against the excerpts. Review whether they support each claim; this is not a guarantee that every claim is correct.")
                for claim in answer.claims:
                    # Model text and document names stay literal, just like uploaded notes.
                    st.text(claim.text)
                    for citation in claim.citations:
                        st.text(f"[{citation.source_id}] {citation.chunk.filename}")
                        st.caption(f"Page: {citation.chunk.page_number or 'not applicable'} · characters {citation.chunk.start_char}–{citation.chunk.end_char} (end excluded)")
                        st.code(citation.quote, language=None)
        elif results:
            st.caption("Retrieval-only results: these are passages from your notes, not an AI-generated answer.")
        if not results:
            st.info("No sufficiently similar passages were found. Your notes may not contain this information, or the wording may need to be more specific.")
            return
        st.subheader("Retrieved passages")
        st.caption("Similarity measures text relatedness, not answer confidence or factual support. Check each passage against your question.")
        for index, hit in enumerate(results, start=1):
            chunk = hit.chunk
            st.subheader(f"Passage {index}")
            st.text(chunk.filename)
            st.caption(f"Page: {chunk.page_number or 'not applicable'} · characters {chunk.start_char}–{chunk.end_char} (end excluded) · similarity {hit.similarity:.3f}")
            st.code(chunk.text, language=None)


def show_quiz(settings):
    st.title("Quiz Mode")
    st.info("Generate a quiz from your notes, then submit your answers to see explanations and supporting quotes.")
    counts, difficulties = [5, 10, 20], ["easy", "medium", "hard"]
    previous = st.session_state.get("quiz_parameters", (5, "easy"))
    question_count = st.selectbox("Number of questions", counts, index=counts.index(previous[0]), key="quiz_count")
    difficulty = st.selectbox("Difficulty", difficulties, index=difficulties.index(previous[1]), key="quiz_difficulty")
    if (question_count, difficulty) != previous:
        reset_quiz()
    st.session_state.quiz_parameters = (question_count, difficulty)
    chunks = tuple(chunk for item in st.session_state.notes.values() for chunk in item["chunks"])
    st.caption("Generate quiz sends selected excerpts to OpenAI and may incur API charges. The selection has a size limit and may omit some material. No search index is required.")
    if not settings.ai_configured:
        st.caption("Quiz generation is disabled because no OpenAI API key is configured. There is no local quiz generator.")
    if not chunks:
        st.caption("Add readable documents in My Notes to generate a quiz.")
    if st.button("Generate quiz", key="generate_quiz", disabled=not settings.ai_configured or not chunks, type="primary"):
        reset_quiz()
        with st.spinner("Creating a quiz from selected excerpts…"):
            st.session_state.quiz_result = generate_quiz(chunks, question_count, difficulty, settings)
    result = st.session_state.get("quiz_result")
    if result is None:
        return
    st.text(result.message)
    if result.mode != "generated":
        return
    if st.session_state.quiz_score is not None:
        if st.button("Retake this quiz", key="retake_quiz"):
            reset_quiz_attempt()
    score = st.session_state.quiz_score
    saved_answers = st.session_state.quiz_answers
    st.caption("Unanswered questions count as incorrect. Submit before leaving this page; unsubmitted choices may be lost. Retaking uses the same questions without another API request.")
    with st.form(f"quiz_form_{st.session_state.quiz_generation}"):
        choices = []
        for index, question in enumerate(result.questions):
            st.text(f"Question {index + 1}. {question.question}")
            for letter, option in zip("ABCD", question.options):
                st.text(f"{letter}. {option}")
            # Only fixed letters appear in radio labels; model text stays literal.
            choice = st.radio(
                f"Your answer for question {index + 1}", list("ABCD"),
                index=saved_answers[index] if saved_answers is not None else None,
                horizontal=True, disabled=score is not None,
                key=f"quiz_answer_{st.session_state.quiz_generation}_{index}",
            )
            choices.append(None if choice is None else "ABCD".index(choice))
        submitted = st.form_submit_button("Submit quiz", disabled=score is not None)
    if submitted and score is None:
        try:
            st.session_state.quiz_score = score_quiz(result.questions, tuple(choices))
            st.session_state.quiz_answers = tuple(choices)
        except QuizValidationError as error:
            st.error(str(error))
        else:
            # Rerender immediately with disabled inputs and the frozen submitted score.
            st.rerun()
    score = st.session_state.quiz_score
    if score is None:
        return
    st.subheader(f"Score: {score.correct}/{score.total} ({score.percentage:.0f}%)")
    st.caption(f"Unanswered: {score.unanswered}. All {score.total} questions count toward the score.")
    st.caption("Quotes are checked against source excerpts. Review whether the explanations are supported; this does not guarantee every generated question is correct.")
    for index, question in enumerate(result.questions):
        selected = st.session_state.quiz_answers[index]
        st.subheader(f"Question {index + 1}: {'Correct' if score.correctness[index] else 'Incorrect'}")
        st.text(f"Your answer: {'Unanswered' if selected is None else 'ABCD'[selected]}")
        st.text(f"Correct answer: {'ABCD'[question.correct_index]}")
        st.text(question.explanation)
        for citation in question.citations:
            st.text(f"[{citation.source_id}] {citation.chunk.filename}")
            st.caption(f"Page: {citation.chunk.page_number or 'not applicable'}")
            st.code(citation.quote, language=None)


st.set_page_config(page_title="PadhAI · Study smarter", page_icon="📚", layout="centered")
try:
    settings = load_settings()
except ConfigurationError as error:
    st.error(str(error))
    st.info("Fix your project .env settings, then rerun the app.")
    st.stop()

# Session state belongs to one connection; private notes are never globally cached.
if "notes" not in st.session_state:
    st.session_state.notes = {}
if "upload_generation" not in st.session_state:
    st.session_state.upload_generation = 0
if "upload_results" not in st.session_state:
    st.session_state.upload_results = []
if "search_results" not in st.session_state:
    clear_search_results()
if "quiz_result" not in st.session_state:
    reset_quiz()
cleanup_warning = st.session_state.pop("search_cleanup_warning", None)
if cleanup_warning:
    st.warning(cleanup_warning)

with st.sidebar:
    st.title("PadhAI")
    st.caption("Padhai ka smarter way.")
    page = st.radio("Navigation", ["Home", "My Notes", "Ask PadhAI", "Quiz Mode"], key="navigation")
    st.divider()
    st.caption("Notes · Answers · Quizzes")
    if settings.ai_configured:
        st.caption("API key configured · connectivity not verified")
    else:
        st.caption("No API key configured")

if page == "Home":
    st.title("Your notes. Your learning companion.")
    st.write("PadhAI — Padhai ka smarter way.")
    st.write("Bring your study materials together and inspect the text that will support your learning.")
    st.info("Upload PDF, TXT, or Markdown in My Notes, then search locally in Ask PadhAI. With an OpenAI key, request an answer or quiz based on selected excerpts.")
    for title, description in [
        ("1. Bring your notes", "Ready: upload documents, inspect text and page metadata, and remove notes from your session."),
        ("2. Ask with evidence", "Ready: search source passages locally and optionally generate an AI answer with checked source quotes."),
        ("3. Check your understanding", "Ready: generate multiple-choice quizzes, submit answers, and review your score and source quotes."),
    ]:
        st.subheader(title)
        st.write(description)
    st.caption("Local retrieval finds passages. It is not full local AI answer generation.")
elif page == "My Notes":
    show_notes(settings.max_upload_mb * 1024 * 1024)
elif page == "Ask PadhAI":
    show_search(settings)
else:
    show_quiz(settings)
