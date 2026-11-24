// @vitest-environment node
import 'fake-indexeddb/auto';
import { expect, it, vi } from 'vitest';
import { buildIndex, indexReady } from './indexer';
import { LocalStore } from './store';
import type { StoredNote } from './store';

const note = (id: string): StoredNote => ({
  id,
  filename: `${id}.txt`,
  type: 'txt',
  byte_size: 60,
  page_count: 1,
  chunk_count: 1,
  character_count: 60,
  created_at: '',
  warnings: [],
  pages: [
    {
      page_number: null,
      text: `Study topic ${id}: this is enough source text to form one useful passage.`,
    },
  ],
});
async function setup(ids = ['a', 'b']) {
  const store = new LocalStore('index-test-' + crypto.randomUUID());
  await store.update((state) => {
    state.documents = ids.map(note);
    state.revision = 1;
  });
  const load = vi.fn(async () => {}),
    embed = vi.fn(async () => new Float32Array(384).fill(0.25));
  const run = (force = false) =>
    buildIndex(
      store,
      load,
      embed,
      () => false,
      () => {},
      force,
    );
  return { store, load, embed, run };
}
it('reuses unchanged notes, skips ready indexes, and supports an explicit full rebuild', async () => {
  const { store, load, embed, run } = await setup();
  await run();
  expect(embed).toHaveBeenCalledTimes(2);
  await run();
  expect(embed).toHaveBeenCalledTimes(2);
  expect(load).toHaveBeenCalledTimes(1);
  await store.update((state) => {
    state.documents.push(note('c'));
    state.revision++;
  });
  await run();
  expect(embed).toHaveBeenCalledTimes(3);
  expect(indexReady(await store.read())).toBe(true);
  await run(true);
  expect(embed).toHaveBeenCalledTimes(6);
  await store.close();
});
it('keeps completed vectors after failure and resumes them after storage is reopened', async () => {
  const { store, embed, run } = await setup();
  embed.mockImplementationOnce(async () => new Float32Array(384).fill(0.25));
  embed.mockImplementationOnce(async () => {
    throw new Error('Interrupted embedding');
  });
  await expect(run()).rejects.toThrow('Interrupted');
  expect(indexReady(await store.read())).toBe(false);
  expect((await store.read()).index?.passages).toHaveLength(1);
  await store.close();
  await run();
  expect(embed).toHaveBeenCalledTimes(3);
  expect(indexReady(await store.read())).toBe(true);
  await store.close();
});
it('a failed manual rebuild remains incomplete and can be retried normally', async () => {
  const { store, load, embed, run } = await setup();
  await run();
  load.mockRejectedValueOnce(new Error('Model unavailable'));
  await expect(run(true)).rejects.toThrow('Model unavailable');
  expect(indexReady(await store.read())).toBe(false);
  await run();
  expect(embed).toHaveBeenCalledTimes(4);
  expect(indexReady(await store.read())).toBe(true);
  await store.close();
});
it('an upload during embedding rejects the stale commit and reuses prior checkpoints', async () => {
  const { store, embed, run } = await setup();
  embed.mockImplementationOnce(async () => new Float32Array(384).fill(0.25));
  embed.mockImplementationOnce(async () => {
    await store.update((state) => {
      state.documents.push(note('c'));
      state.revision++;
    });
    return new Float32Array(384).fill(0.25);
  });
  await expect(run()).rejects.toThrow('changed');
  expect((await store.read()).index?.passages).toHaveLength(1);
  await run();
  expect(embed).toHaveBeenCalledTimes(4);
  expect((await store.read()).index?.passages).toHaveLength(3);
  await store.close();
});
it('deleted notes cannot be restored by an in-flight embedding', async () => {
  const { store, embed, run } = await setup(['a']);
  embed.mockImplementationOnce(async () => {
    await store.update((state) => {
      state.documents = [];
      state.index = null;
      state.revision++;
    });
    return new Float32Array(384).fill(0.25);
  });
  await expect(run()).rejects.toThrow('changed');
  expect((await store.read()).index).toBeNull();
  expect((await store.read()).documents).toEqual([]);
  await store.close();
});
it('cancellation preserves saved progress and model changes invalidate cached vectors', async () => {
  const { store, load, embed, run } = await setup();
  let stopped = false;
  embed.mockImplementationOnce(async () => new Float32Array(384).fill(0.25));
  embed.mockImplementationOnce(async () => {
    stopped = true;
    return new Float32Array(384).fill(0.25);
  });
  await expect(
    buildIndex(
      store,
      load,
      embed,
      () => stopped,
      () => {},
    ),
  ).rejects.toThrow('stopped');
  expect((await store.read()).index?.passages).toHaveLength(1);
  await run();
  expect(embed).toHaveBeenCalledTimes(3);
  await store.update((state) => {
    state.index!.model_id = 'obsolete-model';
  });
  await run();
  expect(embed).toHaveBeenCalledTimes(5);
  await store.close();
});
