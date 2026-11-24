import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { LocalStore, freshData, requireVersion } from './store';
describe('durable local workspace', () => {
  it('persists after reopening and serializes writes from two tabs', async () => {
    const name = 'test-' + crypto.randomUUID(),
      one = new LocalStore(name),
      two = new LocalStore(name);
    const initial = await one.read();
    await Promise.all([
      one.update((state) => {
        state.revision++;
      }),
      two.update((state) => {
        state.revision++;
      }),
    ]);
    await one.close();
    const reopened = await new LocalStore(name).read();
    expect(reopened.id).toBe(initial.id);
    expect(reopened.revision).toBe(2);
    await two.close();
  });
  it('rolls back a failed write and prevents stale index commits after reset', async () => {
    const store = new LocalStore('test-' + crypto.randomUUID());
    const initial = await store.read();
    await expect(
      store.update((state) => {
        state.name = 'Must not persist';
        throw new Error('write failed');
      }),
    ).rejects.toThrow('write failed');
    expect((await store.read()).name).toBe(initial.name);
    await store.update((state) => {
      Object.assign(state, freshData());
    });
    await expect(
      store.update((state) => {
        requireVersion(state, initial.id, initial.revision);
        state.name = 'Stale notes';
      }),
    ).rejects.toThrow('changed');
    const current = await store.read();
    expect(current.id).not.toBe(initial.id);
    expect(current.documents).toEqual([]);
    expect(current.index).toBeNull();
    await store.close();
  });
});
