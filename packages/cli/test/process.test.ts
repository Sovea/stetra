import assert from 'node:assert/strict';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import test from 'node:test';

import { runBufferedCommand } from '../src/infrastructure/process.ts';

test('command resolution respects cwd, PATH, missing executables, and real exits', async () => {
  const root = mkdtempSync(join(tmpdir(), 'stetra-process-runner-'));
  const originalPath = process.env.PATH;
  try {
    const binDirectory = join(root, 'bin');
    mkdirSync(binDirectory);
    const commandName = 'stetra-process-fixture';
    const commandPath = process.platform === 'win32'
      ? join(binDirectory, `${commandName}.cmd`)
      : join(binDirectory, commandName);
    writeFileSync(
      commandPath,
      process.platform === 'win32'
        ? '@echo off\r\nexit /b 7\r\n'
        : '#!/bin/sh\nexit 7\n',
      'utf8',
    );
    if (process.platform !== 'win32') chmodSync(commandPath, 0o755);
    process.env.PATH = [
      'bin',
      ...(originalPath ? [originalPath] : []),
    ].join(delimiter);

    const pathCommand = await runBufferedCommand({
      file: commandName,
      args: [],
      cwd: root,
      maxBuffer: 1_024,
    });
    assert.equal(pathCommand.executionError, false);
    assert.equal(pathCommand.exitCode, 7);
    assert.equal(pathCommand.failed, true);

    const relativeCommand = await runBufferedCommand({
      file: process.platform === 'win32'
        ? `.\\bin\\${commandName}`
        : `./bin/${commandName}`,
      args: [],
      cwd: root,
      maxBuffer: 1_024,
    });
    assert.equal(relativeCommand.executionError, false);
    assert.equal(relativeCommand.exitCode, 7);

    const missingCommand = await runBufferedCommand({
      file: 'stetra-definitely-missing-executable',
      args: [],
      cwd: root,
      maxBuffer: 1_024,
    });
    assert.equal(missingCommand.code, 'ENOENT');
    assert.equal(missingCommand.executionError, true);
    assert.equal(missingCommand.exitCode, null);
    assert.equal(missingCommand.failed, true);
  } finally {
    if (originalPath === undefined) delete process.env.PATH;
    else process.env.PATH = originalPath;
    rmSync(root, { recursive: true, force: true });
  }
});
