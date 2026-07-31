'use strict';

import { expect } from 'chai';
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { spawnSync } from 'child_process';

describe('GraphQL 17 compatibility script', function () {
  const temporaryDirectories = [];

  afterEach(function () {
    temporaryDirectories.splice(0).forEach((directory) => {
      rmSync(directory, { recursive: true, force: true });
    });
  });

  /**
   * Run the compatibility script against a fake npm executable.
   *
   * @param {Object} options simulated command failures
   * @param {String} [options.failCommand] npm arguments that should fail
   * @param {Number} [options.failStatus] status for the simulated test failure
   * @param {Number} [options.restoreStatus] status for the simulated npm ci
   * @return {{calls: String[], status: Number, stderr: String}} execution result
   */
  function runCompatibilityScript({
    failCommand = '',
    failStatus = 0,
    restoreStatus = 0
  } = {}) {
    const directory = mkdtempSync(
      path.join(tmpdir(), 'graphql17-script-test-')
    );
    const fakeNpm = path.join(directory, 'npm');
    const callLog = path.join(directory, 'calls.log');
    temporaryDirectories.push(directory);

    writeFileSync(
      fakeNpm,
      `#!/bin/sh
printf '%s\n' "$*" >> "$GRAPHQL17_TEST_CALL_LOG"
if [ "$1" = "ci" ] && [ "$GRAPHQL17_TEST_RESTORE_STATUS" -ne 0 ]; then
  exit "$GRAPHQL17_TEST_RESTORE_STATUS"
fi
if [ "$*" = "$GRAPHQL17_TEST_FAIL_COMMAND" ]; then
  exit "$GRAPHQL17_TEST_FAIL_STATUS"
fi
exit 0
`
    );
    chmodSync(fakeNpm, 0o755);

    const result = spawnSync(
      'sh',
      [path.resolve('scripts/test-graphql17.sh')],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          PATH: `${directory}:${process.env.PATH}`,
          GRAPHQL17_TEST_CALL_LOG: callLog,
          GRAPHQL17_TEST_FAIL_COMMAND: failCommand,
          GRAPHQL17_TEST_FAIL_STATUS: String(failStatus),
          GRAPHQL17_TEST_RESTORE_STATUS: String(restoreStatus)
        }
      }
    );
    const calls = readFileSync(callLog, 'utf8').trim().split('\n');

    return {
      calls,
      status: result.status,
      stderr: result.stderr
    };
  }

  it('restores the strict graph after successful tests', function () {
    const result = runCompatibilityScript();

    expect(result.status, result.stderr).to.equal(0);
    expect(result.calls[result.calls.length - 1]).to.equal('ci');
  });

  it('restores the strict graph and preserves a test failure', function () {
    const result = runCompatibilityScript({
      failCommand: 'run test:unit',
      failStatus: 7
    });

    expect(result.status, result.stderr).to.equal(7);
    expect(result.calls[result.calls.length - 1]).to.equal('ci');
    expect(result.calls).not.to.include('run test:integration');
  });

  it('fails when restoring the strict graph fails', function () {
    const result = runCompatibilityScript({
      restoreStatus: 9
    });

    expect(result.status, result.stderr).to.equal(9);
    expect(result.calls[result.calls.length - 1]).to.equal('ci');
  });
});
