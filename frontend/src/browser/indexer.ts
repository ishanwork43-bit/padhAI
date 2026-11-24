import { LocalError, MODEL_ID } from './constants';
import { activity, requireVersion } from './store';
import type { LocalData, LocalStore, VectorPassage } from './store';
import { chunksFor } from './text';

export const indexReady = (state: LocalData) =>
  state.index?.revision === state.revision && state.index.model_id === MODEL_ID;

// The caller holds the workspace Web Lock. Checkpoints are deliberately not searchable
// until every current chunk is present; unchanged vectors can survive uploads/refreshes.
export async function buildIndex(
  store: LocalStore,
  load: (progress: (message: string) => void) => Promise<unknown>,
  embed: (text: string) => Promise<Float32Array>,
  cancelled: () => boolean,
  progress: (message: string) => void,
  force = false,
) {
  const state = await store.read();
  if (indexReady(state) && !force) return { indexed_chunks: state.index!.passages.length };
  const chunks = state.documents.flatMap(chunksFor);
  const old = new Map(
    !force && state.index?.model_id === MODEL_ID
      ? state.index.passages.map((p) => [p.chunk_id, p])
      : [],
  );
  const cached = new Map<string, VectorPassage>();
  for (const chunk of chunks) {
    const item = old.get(chunk.chunk_id);
    if (
      item &&
      item.text === chunk.text &&
      item.filename === chunk.filename &&
      item.document_id === chunk.document_id &&
      item.page_number === chunk.page_number &&
      item.start_char === chunk.start_char &&
      item.end_char === chunk.end_char &&
      item.vector instanceof Float32Array &&
      item.vector.length === 384 &&
      item.vector.every(Number.isFinite)
    )
      cached.set(chunk.chunk_id, item);
  }
  const check = (current: LocalData) => {
    requireVersion(current, state.id, state.revision);
    if (cancelled())
      throw new LocalError('cancelled', 'Preparation stopped. Your notes are saved.');
  };
  if (force)
    await store.update((current) => {
      check(current);
      current.index = { revision: -1, model_id: MODEL_ID, passages: [] };
    });
  let loaded = false;
  for (const chunk of chunks) {
    check(await store.read());
    if (cached.has(chunk.chunk_id)) continue;
    if (!loaded) {
      await load(progress);
      loaded = true;
      check(await store.read());
    }
    const vector = await embed(chunk.text);
    cached.set(chunk.chunk_id, { ...chunk, vector });
    await store.update((current) => {
      check(current);
      current.index = { revision: -1, model_id: MODEL_ID, passages: [...cached.values()] };
    });
    progress('Preparing your notes...');
  }
  await store.update((current) => {
    check(current);
    current.index = {
      revision: state.revision,
      model_id: MODEL_ID,
      passages: chunks.map((c) => cached.get(c.chunk_id)!),
    };
    current.index_failure = undefined;
    activity(current, 'index', `Prepared ${chunks.length} source passages`);
  });
  return { indexed_chunks: chunks.length };
}
