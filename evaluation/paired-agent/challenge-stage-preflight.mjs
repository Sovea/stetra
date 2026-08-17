const SHA256 = /^sha256:[a-f0-9]{64}$/;
const COMMIT = /^[a-f0-9]{40}$/;

export function assertChallengeStagePreflight(record) {
  object(record, '$');
  equal(record.protocol, 'cognitive-adoption-challenge-stage-preflight', 'protocol');
  equal(record.schemaVersion, '1', 'schemaVersion');
  text(record.taskId, 'taskId');
  match(record.repositoryCommit, COMMIT, 'repositoryCommit');

  object(record.stetra, 'stetra');
  match(record.stetra.commit, COMMIT, 'stetra.commit');
  for (const field of ['coreArchiveDigest', 'cliArchiveDigest', 'hostAdapterDigest']) {
    match(record.stetra[field], SHA256, `stetra.${field}`);
  }

  object(record.beforePrepare, 'beforePrepare');
  digest(record.beforePrepare.registeredWorktreeFingerprint, 'beforePrepare.registeredWorktreeFingerprint');
  digest(record.beforePrepare.observedWorktreeFingerprint, 'beforePrepare.observedWorktreeFingerprint');
  equal(
    record.beforePrepare.observedWorktreeFingerprint,
    record.beforePrepare.registeredWorktreeFingerprint,
    'beforePrepare worktree fingerprint',
  );
  equal(record.beforePrepare.candidateChangePresent, false, 'beforePrepare.candidateChangePresent');

  object(record.afterCollect, 'afterCollect');
  digest(record.afterCollect.factCollectionId, 'afterCollect.factCollectionId');
  object(record.afterCollect.patch, 'afterCollect.patch');
  equal(record.afterCollect.patch.required, true, 'afterCollect.patch.required');
  equal(record.afterCollect.patch.present, true, 'afterCollect.patch.present');
  digest(record.afterCollect.patch.registeredDigest, 'afterCollect.patch.registeredDigest');
  digest(record.afterCollect.patch.observedDigest, 'afterCollect.patch.observedDigest');
  equal(
    record.afterCollect.patch.observedDigest,
    record.afterCollect.patch.registeredDigest,
    'afterCollect patch digest',
  );

  object(record.afterCollect.changedFiles, 'afterCollect.changedFiles');
  const expectedPaths = paths(record.afterCollect.changedFiles.expected, 'afterCollect.changedFiles.expected');
  const actualPaths = paths(record.afterCollect.changedFiles.actual, 'afterCollect.changedFiles.actual');
  equal(JSON.stringify(actualPaths), JSON.stringify(expectedPaths), 'afterCollect changed files');

  array(record.afterCollect.checkRelations, 'afterCollect.checkRelations');
  const checkKeys = new Set();
  for (const [index, relation] of record.afterCollect.checkRelations.entries()) {
    const path = `afterCollect.checkRelations[${index}]`;
    object(relation, path);
    text(relation.checkKey, `${path}.checkKey`);
    if (checkKeys.has(relation.checkKey)) fail(`${path}.checkKey`, 'must be unique');
    checkKeys.add(relation.checkKey);
    text(relation.expected, `${path}.expected`);
    text(relation.actual, `${path}.actual`);
    equal(relation.actual, relation.expected, `${path} relation`);
  }

  equal(record.status, 'passed', 'status');
  array(record.deviations, 'deviations');
  equal(record.deviations.length, 0, 'deviations');
  return structuredClone(record);
}

function paths(value, path) {
  array(value, path);
  const normalized = value.map((item, index) => {
    text(item, `${path}[${index}]`);
    if (item.startsWith('/') || item.split('/').includes('..')) {
      fail(`${path}[${index}]`, 'must be a safe repository-relative path');
    }
    return item;
  });
  if (new Set(normalized).size !== normalized.length) fail(path, 'must not contain duplicates');
  return [...normalized].sort();
}

function digest(value, path) {
  match(value, SHA256, path);
}

function match(value, pattern, path) {
  if (typeof value !== 'string' || !pattern.test(value)) fail(path, 'has an invalid identity');
}

function text(value, path) {
  if (typeof value !== 'string' || value.trim() === '') fail(path, 'must be a non-empty string');
}

function object(value, path) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(path, 'must be an object');
}

function array(value, path) {
  if (!Array.isArray(value)) fail(path, 'must be an array');
}

function equal(actual, expected, path) {
  if (actual !== expected) fail(path, `expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
}

function fail(path, message) {
  throw new Error(`Challenge stage preflight ${path}: ${message}.`);
}
