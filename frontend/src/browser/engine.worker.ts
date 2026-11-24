import { buildIndex, indexReady } from './indexer';
import { LIMITS, LocalError, safeError } from './constants';
import { LocalStore, freshData, requireVersion, activity } from './store';
import type { StoredNote } from './store';
import { rankPassages } from './text';
import { parseFile } from './parser';
import { embedText, loadModel } from './model';
import { prepareContext, verifyLocalCitations, publicQuiz, submitQuiz } from './ai-context';
import type { Job, Note, Workspace, Quiz, StudySummary, AnswerResult } from '../lib/types';

const store = new LocalStore();
const jobs = new Map<string, Job>();
let active: Job | undefined;
let generation = 0;
let importing = false;
let searching = false;
let startingIndex = false;
const metadata = ({ pages: _pages, ...note }: StoredNote): Note => note;
const ready = indexReady;
let indexFailure: { id: string; revision: number; code: string; message: string } | undefined;
let indexTimer: ReturnType<typeof setTimeout> | undefined;
function scheduleIndex() {
  clearTimeout(indexTimer);
  indexTimer = setTimeout(() => {
    void indexNotes(false).catch(() => {});
  }, 150);
}
async function workspace(): Promise<Workspace> {
  const state = await store.read();
  scheduleIndex();
  const failure =
    state.index_failure?.revision === state.revision
      ? state.index_failure
      : indexFailure?.id === state.id && indexFailure.revision === state.revision
        ? indexFailure
        : undefined;
  const busy =
    active &&
    ['queued', 'running'].includes(active.status) &&
    (active.kind === 'index' || active.revision === state.revision);
  return {
    id: state.id,
    name: state.name,
    revision: state.revision,
    created_at: state.created_at,
    expires_at: '',
    settings: { result_limit: state.result_limit, ai_consent: state.ai_consent ?? false },
    capabilities: {
      semantic_search: true,
      ai_available: false,
      ai_requests_remaining: 0,
      ai_model: null,
    },
    limits: {
      max_upload_bytes: LIMITS.fileBytes,
      max_documents: LIMITS.documents,
      max_workspace_bytes: LIMITS.workspaceBytes,
      max_characters: LIMITS.characters,
    },
    stats: {
      documents: state.documents.length,
      chunks: state.documents.reduce((s, n) => s + n.chunk_count, 0),
      bytes: state.documents.reduce((s, n) => s + n.byte_size, 0),
      characters: state.documents.reduce((s, n) => s + n.character_count, 0),
      completed_quizzes: (state.quizzes ?? []).filter((q) => q.submitted).length,
    },
    index: {
      error: failure?.message ?? null,
      error_code: failure?.code ?? null,
      status:
        busy && active?.kind === 'index'
          ? 'indexing'
          : ready(state)
            ? 'ready'
            : state.documents.length
              ? 'not_indexed'
              : 'empty',
      indexed_chunks: ready(state) ? state.index!.passages.length : 0,
    },
    active_job: busy ? active! : null,
    documents: state.documents.map(metadata),
    quizzes: (state.quizzes ?? []).map(
      ({ questions: _questions, answers: _answers, coverage: _coverage, ...quiz }) => quiz,
    ),
    activity: state.activity,
  };
}
async function addDocument(filename: string, bytes: ArrayBuffer) {
  if (importing)
    throw new LocalError(
      'import_busy',
      'Another document is processing. Please wait and retry.',
      429,
    );
  importing = true;
  try {
    const owner = await store.read();
    const note = await parseFile(filename, bytes);
    return await store.update((state) => {
      requireVersion(state, owner.id, owner.revision);
      const duplicate = state.documents.find((item) => item.id === note.id);
      if (duplicate) return { status: 'duplicate', document: metadata(duplicate) };
      if (state.documents.length >= LIMITS.documents)
        throw new LocalError(
          'note_limit',
          'This workspace has 20 notes. Delete a note before adding another.',
        );
      const all = [...state.documents, note];
      if (
        all.reduce((sum, n) => sum + n.byte_size, 0) > LIMITS.workspaceBytes ||
        all.reduce((sum, n) => sum + n.character_count, 0) > LIMITS.characters ||
        all.reduce((sum, n) => sum + n.chunk_count, 0) > LIMITS.chunks
      )
        throw new LocalError(
          'workspace_limit',
          'These notes exceed the local workspace allowance. Remove some notes before adding this file.',
        );
      state.documents.push(note);
      state.revision++;
      state.index_failure = undefined;
      activity(state, 'upload', `Added ${note.filename}`);
      return { status: 'added', document: metadata(note) };
    });
  } finally {
    importing = false;
    scheduleIndex();
  }
}
async function indexNotes(retry = true, rebuild = false): Promise<Job | null> {
  if (
    startingIndex ||
    importing ||
    searching ||
    (active && ['queued', 'running'].includes(active.status))
  )
    return active?.kind === 'index' ? active : null;
  startingIndex = true;
  try {
    const state = await store.read();
    if (!state.documents.length || (ready(state) && !rebuild)) return null;
    if (
      !retry &&
      (state.index_failure?.revision === state.revision ||
        (indexFailure?.id === state.id && indexFailure.revision === state.revision))
    )
      return null;
    if (retry) {
      await store.update((current) => {
        requireVersion(current, state.id, state.revision);
        current.index_failure = undefined;
      });
      indexFailure = undefined;
    }
    if (!navigator.locks) {
      await store.update((current) => {
        requireVersion(current, state.id, state.revision);
        current.index_failure = {
          revision: state.revision,
          code: 'browser_support',
          message:
            'Use a recent browser with Web Locks support to prepare notes safely across tabs.',
        };
      });
      return null;
    }
    return await new Promise<Job | null>((resolve, reject) => {
      void navigator.locks
        .request(`padhai-index:${state.id}`, { ifAvailable: true }, async (lock) => {
          if (!lock) {
            resolve(null);
            return;
          }
          const current = await store.read();
          if (
            current.id !== state.id ||
            (ready(current) && !rebuild) ||
            (!retry && current.index_failure?.revision === current.revision)
          ) {
            resolve(null);
            return;
          }
          const job: Job = {
            id: crypto.randomUUID(),
            kind: 'index',
            status: 'running',
            phase: 'Preparing your notes...',
            revision: current.revision,
            result: null,
            error: null,
          };
          active = job;
          jobs.set(job.id, job);
          if (jobs.size > 10) jobs.delete(jobs.keys().next().value!);
          const version = ++generation;
          resolve(job);
          try {
            job.result = await buildIndex(
              store,
              loadModel,
              embedText,
              () => generation !== version,
              () => {},
              rebuild,
            );
            job.status = 'completed';
            job.phase = 'Your notes are ready!';
          } catch (error) {
            const safe = safeError(error);
            job.status = 'failed';
            job.error = safe;
            job.phase = 'Preparation paused';
            if (safe.code !== 'notes_changed')
              indexFailure = {
                id: current.id,
                revision: current.revision,
                code: safe.code,
                message: safe.message,
              };
            if (safe.code !== 'notes_changed')
              await store
                .update((latest) => {
                  if (latest.id === current.id && latest.revision === current.revision)
                    latest.index_failure = {
                      revision: latest.revision,
                      code: safe.code,
                      message: safe.message,
                    };
                })
                .catch(() => {});
          } finally {
            scheduleIndex();
          }
        })
        .catch(async (error) => {
          const safe = safeError(error);
          indexFailure = {
            id: state.id,
            revision: state.revision,
            code: safe.code,
            message: safe.message,
          };
          reject(error);
        });
    });
  } finally {
    startingIndex = false;
  }
}
async function startAIJob(kind: 'answer' | 'summary' | 'quiz', body: Record<string, unknown>) {
  if (startingIndex || searching || (active && ['queued', 'running'].includes(active.status)))
    throw new LocalError('busy', 'Wait for current processing to finish.', 409);
  startingIndex = true;
  try {
    const state = await store.read();
    if (!state.ai_consent)
      throw new LocalError(
        'consent_required',
        'Allow sharing selected excerpts with Groq in Settings first.',
        403,
      );
    if (typeof body.csrf !== 'string' || !body.csrf)
      throw new LocalError('locked', 'Retry the AI connection in Settings first.', 401);
    const context = prepareContext(state, kind, body);
    const job: Job = {
      id: crypto.randomUUID(),
      kind,
      status: 'queued',
      phase: 'Preparing selected excerpts…',
      revision: state.revision,
      result: null,
      error: null,
    };
    active = job;
    jobs.set(job.id, job);
    if (jobs.size > 10) jobs.delete(jobs.keys().next().value!);
    const version = ++generation;
    void (async () => {
      try {
        job.status = 'running';
        job.phase = `Groq is generating from ${context.sources.length} selected passages…`;
        let response: Response;
        try {
          response = await fetch('/api/ai?action=generate', {
            method: 'POST',
            credentials: 'same-origin',
            cache: 'no-store',
            headers: { 'Content-Type': 'application/json', 'X-PadhAI-CSRF': String(body.csrf) },
            body: JSON.stringify({
              task: kind,
              request_id: job.id,
              consent: true,
              language: body.language ?? 'English',
              length: kind === 'quiz' ? undefined : (body.length ?? 'short'),
              question: kind === 'answer' ? body.question : undefined,
              count: kind === 'quiz' ? body.count : undefined,
              difficulty: kind === 'quiz' ? body.difficulty : undefined,
              sources: context.sources.map(
                ({ document_id, filename, page_number, start_char, end_char, text }) => ({
                  document_id,
                  filename,
                  page_number,
                  start_char,
                  end_char,
                  text,
                }),
              ),
            }),
            signal: AbortSignal.timeout(40000),
          });
        } catch {
          throw new LocalError(
            'ai_network',
            'AI could not finish this request. Your local notes are safe. Check the cooldown before retrying.',
            504,
          );
        }
        const data = await response.json().catch(() => null);
        if (!response.ok || !data?.result)
          throw new LocalError(
            data?.error?.code ?? 'ai_unavailable',
            data?.error?.message ?? 'AI is temporarily unavailable. Nothing was saved.',
            response.status,
            data?.error?.retry_after,
          );
        const result = data.result;
        if (result.mode !== 'generated' && result.mode !== 'insufficient')
          throw new LocalError('invalid_result', 'The AI result could not be validated.');
        if (kind !== 'answer' && result.mode === 'insufficient')
          throw new LocalError('insufficient_evidence', result.message);
        if (kind === 'quiz') {
          if (!Array.isArray(result.questions) || result.questions.length !== body.count)
            throw new LocalError('invalid_quiz', 'The quiz was incomplete. Try fewer questions.');
          result.questions.forEach((q: Quiz['questions'][number]) =>
            verifyLocalCitations(q.citations ?? [], context.sources),
          );
        } else {
          if (!Array.isArray(result.claims))
            throw new LocalError('invalid_answer', 'The answer was incomplete.');
          result.claims.forEach((c: AnswerResult['claims'][number]) =>
            verifyLocalCitations(c.citations, context.sources),
          );
        }
        await store.update((current) => {
          requireVersion(current, state.id, state.revision);
          if (generation !== version || !current.ai_consent)
            throw new LocalError(
              'cancelled',
              'Notes or sharing preferences changed. The response was discarded.',
            );
          if (kind === 'quiz') {
            const quiz: Quiz = {
              id: job.id,
              count: Number(body.count),
              difficulty: String(body.difficulty),
              created_at: new Date().toISOString(),
              attempt_number: 1,
              submitted: false,
              score: null,
              answers: null,
              can_retake: true,
              questions: result.questions,
              coverage: context.coverage,
            };
            current.quizzes = [quiz, ...(current.quizzes ?? [])].slice(0, 10);
            job.result = { quiz_id: quiz.id };
          } else if (kind === 'summary') {
            const summary: StudySummary = {
              id: job.id,
              created_at: new Date().toISOString(),
              language: String(body.language ?? 'English'),
              length: String(body.length ?? 'short'),
              document_ids: body.document_ids as string[],
              coverage: context.coverage,
              mode: result.mode,
              message: result.message,
              claims: result.claims,
            };
            current.summaries = [summary, ...(current.summaries ?? [])].slice(0, 10);
            job.result = { summary_id: summary.id };
          } else
            job.result = { ...result, question: String(body.question), passages: context.sources };
          activity(current, kind, `Created an AI ${kind} from selected excerpts`);
        });
        job.status = 'completed';
        job.phase = 'Evidence checked against your local notes';
      } catch (error) {
        job.status = 'failed';
        job.error = safeError(error);
        job.phase = 'Generation not completed';
      }
    })();
    return job;
  } finally {
    startingIndex = false;
  }
}
async function dispatch(path: string, method: string, body: Record<string, unknown> = {}) {
  const url = new URL(path, 'https://padhai.local');
  const route = url.pathname;
  if (route === '/workspace' && method === 'GET') return workspace();
  if (route === '/workspace' && method === 'PATCH') {
    const name = String(body.name ?? '').trim();
    const count = Number(body.result_limit);
    if (!name || name.length > 60 || !Number.isInteger(count) || count < 1 || count > 10)
      throw new LocalError(
        'preferences',
        'Use a workspace name of 1–60 characters and 1–10 results.',
      );
    if (typeof body.ai_consent !== 'boolean')
      throw new LocalError('consent', 'Choose whether to share excerpts with Groq.');
    await store.update((state) => {
      state.name = name;
      state.result_limit = count;
      if (state.ai_consent && !body.ai_consent) generation++;
      state.ai_consent = body.ai_consent as boolean;
    });
    return workspace();
  }
  if (route === '/session' && method === 'DELETE') {
    generation++;
    await store.update((state) => {
      Object.assign(state, freshData());
    });
    return null;
  }
  if (route === '/documents/sample' && method === 'POST') {
    const file =
      body.sample === 'dbms'
        ? 'dbms_notes.pdf'
        : body.sample === 'cloud'
          ? 'cloud_computing.txt'
          : null;
    if (!file) throw new LocalError('sample', 'Choose an available sample.');
    const response = await fetch(`/samples/${file}`);
    if (!response.ok)
      throw new LocalError(
        'sample_unavailable',
        'The sample could not load. Check your connection and retry.',
      );
    return addDocument(file, await response.arrayBuffer());
  }
  if (route === '/documents' && method === 'POST') {
    if (typeof body.filename !== 'string' || !(body.bytes instanceof ArrayBuffer))
      throw new LocalError('invalid_upload', 'Choose a readable file.');
    return addDocument(body.filename, body.bytes);
  }
  if ((route === '/documents' || route.startsWith('/documents/')) && method === 'DELETE') {
    generation++;
    await store.update((state) => {
      if (route !== '/documents' && !state.documents.some((doc) => doc.id === route.split('/')[2]))
        throw new LocalError('not_found', 'This note has already been removed.', 404);
      state.documents =
        route === '/documents' ? [] : state.documents.filter((n) => n.id !== route.split('/')[2]);
      if (state.index)
        state.index.passages = state.index.passages.filter((p) =>
          state.documents.some((n) => n.id === p.document_id),
        );
      if (!state.documents.length) state.index = null;
      state.index_failure = undefined;
      state.revision++;
      state.activity = [];
      state.quizzes = [];
      state.summaries = [];
    });
    return null;
  }
  if (route.startsWith('/documents/') && method === 'GET') {
    const state = await store.read();
    const note = state.documents.find((n) => n.id === route.split('/')[2]);
    if (!note)
      throw new LocalError('not_found', 'This note no longer exists in this browser.', 404);
    const pageIndex = Number(url.searchParams.get('page') ?? 0),
      offset = Number(url.searchParams.get('offset') ?? 0);
    if (
      !Number.isInteger(pageIndex) ||
      pageIndex < 0 ||
      pageIndex >= note.pages.length ||
      !Number.isInteger(offset) ||
      offset < 0
    )
      throw new LocalError('not_found', 'This source page does not exist.', 404);
    const page = note.pages[pageIndex];
    if (offset > page.text.length)
      throw new LocalError('not_found', 'This source position does not exist.', 404);
    return {
      ...metadata(note),
      page: {
        index: pageIndex,
        page_number: page.page_number,
        offset,
        total_characters: page.text.length,
        text: page.text.slice(offset, offset + 12000),
        truncated: offset + 12000 < page.text.length,
      },
    };
  }
  if (route === '/index' && method === 'POST') return indexNotes(true, body.rebuild === true);
  if (route === '/index' && method === 'DELETE') {
    generation++;
    if (active?.kind === 'index')
      await store.update((state) => {
        state.index_failure = {
          revision: state.revision,
          code: 'cancelled',
          message: 'Preparation paused. Your notes are saved; retry when you are ready.',
        };
      });
    return null;
  }
  if (route.startsWith('/jobs/') && method === 'GET') {
    const job = jobs.get(route.split('/')[2]);
    if (!job)
      throw new LocalError(
        'not_found',
        'Processing was interrupted when the tab closed. Your notes remain saved.',
        404,
      );
    return job;
  }
  if (route === '/search' && method === 'POST') {
    const question = String(body.question ?? '').trim();
    if (!question || question.length > 2000)
      throw new LocalError('question', 'Use a question of 1–2,000 characters.');
    if (searching || (active && ['queued', 'running'].includes(active.status)))
      throw new LocalError('search_busy', 'Wait for the current search or index to finish.', 429);
    searching = true;
    try {
      const state = await store.read();
      if (!ready(state))
        throw new LocalError(
          'index_required',
          'Your notes are still being prepared. Please wait or retry preparation if it failed.',
          409,
        );
      const limit = body.limit === undefined ? state.result_limit : Number(body.limit);
      if (!Number.isInteger(limit) || limit < 1 || limit > 10)
        throw new LocalError('result_limit', 'Choose 1–10 search passages.');
      const vector = await embedText(question);
      requireVersion(await store.read(), state.id, state.revision);
      const passages = rankPassages(state.index!.passages, vector, limit);
      return {
        question,
        revision: state.revision,
        mode: passages.length ? 'passages' : 'no_evidence',
        passages,
      };
    } finally {
      searching = false;
    }
  }
  if (route === '/ai/context' && method === 'POST')
    return prepareContext(await store.read(), String(body.task), body);
  if (route === '/answers' && method === 'POST') return startAIJob('answer', body);
  if (route === '/summaries' && method === 'POST') return startAIJob('summary', body);
  if (route === '/summaries' && method === 'GET') return (await store.read()).summaries ?? [];
  if (route.startsWith('/summaries/') && method === 'DELETE') {
    await store.update((state) => {
      state.summaries = (state.summaries ?? []).filter((s) => s.id !== route.split('/')[2]);
    });
    return null;
  }
  if (route === '/quizzes' && method === 'POST') return startAIJob('quiz', body);
  if (route.startsWith('/quizzes/')) {
    const id = route.split('/')[2],
      action = route.split('/')[3];
    if (method === 'GET' && !action) {
      const quiz = (await store.read()).quizzes?.find((q) => q.id === id);
      if (!quiz)
        throw new LocalError('not_found', 'This quiz no longer exists in your local library.', 404);
      return publicQuiz(quiz);
    }
    return store.update((state) => {
      const quiz = state.quizzes?.find((q) => q.id === id);
      if (!quiz)
        throw new LocalError('not_found', 'This quiz no longer exists in your local library.', 404);
      if (method === 'POST' && action === 'submit') {
        if (body.attempt_number !== quiz.attempt_number)
          throw new LocalError(
            'stale_attempt',
            'This quiz was retaken in another tab. Reopen the current attempt.',
            409,
          );
        return submitQuiz(quiz, body.answers);
      }
      if (method === 'POST' && action === 'retake') {
        if (!quiz.submitted)
          throw new LocalError(
            'unfinished_quiz',
            'Finish this attempt before starting a retake.',
            409,
          );
        quiz.attempt_number++;
        quiz.submitted = false;
        quiz.answers = null;
        quiz.score = null;
        return publicQuiz(quiz);
      }
      if (method === 'DELETE' && !action) {
        state.quizzes = state.quizzes!.filter((q) => q.id !== id);
        return null;
      }
      throw new LocalError('not_found', 'This quiz action is unavailable.', 404);
    });
  }
  throw new LocalError('not_found', 'This action is unavailable in the browser version.', 404);
}
self.onmessage = async ({ data }) => {
  try {
    self.postMessage({ id: data.id, result: await dispatch(data.path, data.method, data.body) });
  } catch (error) {
    self.postMessage({ id: data.id, error: safeError(error) });
  }
};
