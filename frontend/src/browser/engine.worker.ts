import { LIMITS, LocalError, MODEL_ID, safeError } from './constants';
import { LocalStore, freshData, requireVersion, activity } from './store';
import type { LocalData, StoredNote, VectorPassage } from './store';
import { chunksFor, rankPassages } from './text';
import { parseFile } from './parser';
import { embedText, loadModel } from './model';
import type { Job, Note, Workspace } from '../lib/types';

const store = new LocalStore();
const jobs = new Map<string, Job>();
let active: Job | undefined;
let generation = 0;
let importing = false;
let searching = false;
let startingIndex = false;
const metadata = ({ pages: _pages, ...note }: StoredNote): Note => note;
function ready(state: LocalData) {
  return state.index?.revision === state.revision && state.index.model_id === MODEL_ID;
}
async function workspace(): Promise<Workspace> {
  const state = await store.read();
  const busy =
    active && ['queued', 'running'].includes(active.status) && active.revision === state.revision;
  return {
    id: state.id,
    name: state.name,
    revision: state.revision,
    created_at: state.created_at,
    expires_at: '',
    settings: { result_limit: state.result_limit, ai_consent: false },
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
      completed_quizzes: 0,
    },
    index: {
      status: busy
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
    quizzes: [],
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
      state.index = null;
      activity(state, 'upload', `Added ${note.filename}`);
      return { status: 'added', document: metadata(note) };
    });
  } finally {
    importing = false;
  }
}
async function indexNotes() {
  if (startingIndex || searching || (active && ['queued', 'running'].includes(active.status)))
    throw new LocalError(
      'index_busy',
      'Local processing is already running. Wait for it to finish.',
      409,
    );
  startingIndex = true;
  try {
    const state = await store.read();
    if (!state.documents.length)
      throw new LocalError('empty_workspace', 'Add notes before building an index.', 409);
    const job: Job = {
      id: crypto.randomUUID(),
      kind: 'index',
      status: 'queued',
      phase: 'Preparing your notes…',
      revision: state.revision,
      result: null,
      error: null,
    };
    active = job;
    jobs.set(job.id, job);
    if (jobs.size > 10) jobs.delete(jobs.keys().next().value!);
    const version = ++generation;
    // The response is immediate; progress is read by the existing UI job poller.
    void (async () => {
      try {
        job.status = 'running';
        await loadModel((message) => {
          job.phase = message;
        });
        const chunks = state.documents.flatMap(chunksFor);
        const passages: VectorPassage[] = [];
        for (const chunk of chunks) {
          if (generation !== version)
            throw new LocalError('cancelled', 'Indexing stopped. Your notes are still saved.');
          requireVersion(await store.read(), state.id, state.revision);
          job.phase = `Indexing passage ${passages.length + 1} of ${chunks.length} on your device…`;
          passages.push({ ...chunk, vector: await embedText(chunk.text) });
        }
        await store.update((current) => {
          requireVersion(current, state.id, state.revision);
          if (generation !== version)
            throw new LocalError('cancelled', 'Indexing stopped. Your notes are still saved.');
          current.index = { revision: state.revision, model_id: MODEL_ID, passages };
          activity(current, 'index', `Indexed ${chunks.length} source passages`);
        });
        job.status = 'completed';
        job.phase = 'Ready to search';
        job.result = { indexed_chunks: chunks.length };
      } catch (error) {
        job.status = 'failed';
        job.error = safeError(error);
        job.phase = 'Index not completed';
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
    if (body.ai_consent)
      throw new LocalError(
        'ai_unavailable',
        'AI generation is unavailable in the browser version.',
      );
    await store.update((state) => {
      state.name = name;
      state.result_limit = count;
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
      state.index = null;
      state.revision++;
      state.activity = [];
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
  if (route === '/index' && method === 'POST') return indexNotes();
  if (route === '/index' && method === 'DELETE') {
    generation++;
    return null;
  }
  if (route.startsWith('/jobs/') && method === 'GET') {
    const job = jobs.get(route.split('/')[2]);
    if (!job)
      throw new LocalError(
        'not_found',
        'Processing was interrupted when the tab closed. Build the index again.',
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
        throw new LocalError('index_required', 'Build an index for your current notes first.', 409);
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
  if (route.startsWith('/quizzes') || route === '/answers')
    throw new LocalError(
      'ai_unavailable',
      'Generated answers and quizzes need the FastAPI backend. This browser version provides real semantic search and sources without paid AI.',
      503,
    );
  throw new LocalError('not_found', 'This action is unavailable in the browser version.', 404);
}
self.onmessage = async ({ data }) => {
  try {
    self.postMessage({ id: data.id, result: await dispatch(data.path, data.method, data.body) });
  } catch (error) {
    self.postMessage({ id: data.id, error: safeError(error) });
  }
};
