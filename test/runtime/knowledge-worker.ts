import assert from 'node:assert/strict';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { MemoryStore } from '../../src/runtime/knowledge/store.js';
import { StetraError } from '../../src/runtime/shared.js';

const [mode, root, id, revision, title] = process.argv.slice(2);
if (!mode || !root || !id) throw new Error('Missing worker arguments.');
const store = new MemoryStore(root);
process.send?.({ ready: true });
await once(process, 'message');

try {
  if (mode === 'cas') {
    if (!revision || !title) throw new Error('A CAS worker needs a revision and title.');
    try {
      await store.update(id, revision, { title, body: 'Keep the existing query contract.', source: 'developer' });
      process.send?.({ result: 'updated' });
    } catch (error) {
      if (!(error instanceof StetraError) || error.code !== 'conflict') throw error;
      process.send?.({ result: error.code });
    }
  } else if (mode === 'index-write') {
    let memory = await store.get(id);
    for (let index = 0; index < 12; index++) {
      memory = await store.update(id, memory.revision, {
        title: 'Failure behavior', body: `Cache behavior at revision ${index}`, source: 'developer',
      });
      await delay(1);
    }
    await store.delete(id, memory.revision);
    process.send?.({ result: 'done' });
  } else if (mode === 'index-read') {
    for (let index = 0; index < 24; index++) {
      const result = await store.search({ query: 'cache' });
      assert.deepEqual(result.issues, []);
      assert.ok(result.matches.length <= 1);
      if (result.matches.length) assert.equal(result.matches[0]!.memory.id, id);
      await delay(1);
    }
    process.send?.({ result: 'done' });
  } else throw new Error(`Unknown worker mode: ${mode}`);
} finally { process.disconnect?.(); }
