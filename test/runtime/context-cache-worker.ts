import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { ContextCache } from '../../src/runtime/context/cache.js';

const [mode, root, selectedId] = process.argv.slice(2);
if (!root || !selectedId || !['replace', 'refresh'].includes(mode ?? '')) throw new Error('Missing cache worker arguments.');
const cache = new ContextCache(root, { host: 'pi', sessionId: 'shared-native-session' });
process.send?.({ event: 'ready' });
await once(process, 'message');
try {
  process.send?.({ event: 'attempting' });
  await cache.update({ create: false, reset: false }, async previous => {
    if (!previous) throw new Error('Expected an existing selection.');
    process.send?.({ event: 'entered', ids: previous.selection.ids });
    if (mode === 'replace') {
      await once(process, 'message');
      return { result: null, cache: { schemaVersion: 1, selection: { ids: [selectedId], paths: ['src/new'] }, provided: {} } };
    }
    // A refresh must read the selection after a competing replacement commits.
    // Without a lock around read and callback, this delay lets stale data win.
    await delay(100);
    return { result: null, cache: { ...previous, provided: Object.fromEntries(previous.selection.ids.map(id => [id, 'b'.repeat(64)])) } };
  });
  process.send?.({ event: 'done' });
} finally { process.disconnect?.(); }
