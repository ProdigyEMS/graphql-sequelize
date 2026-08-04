'use strict';

import { afterEach, describe, expect, it } from 'vitest';
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { spawnSync } from 'child_process';

const repositoryRoot = path.resolve('.');

describe('test-docker script', function () {
  interface ScenarioStatuses {
    up?: number;
    portFailOn?: number;
    npm?: number;
    tee?: number;
    down?: number;
  }

  const temporaryDirectories: string[] = [];

  afterEach(function () {
    temporaryDirectories.splice(0).forEach((directory) => {
      rmSync(directory, { recursive: true, force: true });
    });
  });

  /**
   * Write an executable fake command.
   *
   * @param {string} directory fake PATH directory
   * @param {string} name executable name
   * @param {string} source shell source
   * @return {void}
   */
  function writeExecutable(
    directory: string,
    name: string,
    source: string
  ): void {
    const executable = path.join(directory, name);
    writeFileSync(executable, source);
    chmodSync(executable, 0o755);
  }

  /**
   * Run the database test wrapper with deterministic fake commands.
   *
   * @param {Object} statuses simulated command statuses
   * @param {number} [statuses.up] database provisioning status
   * @param {number} [statuses.portFailOn] port lookup invocation to fail
   * @param {number} [statuses.npm] integration command status
   * @param {number} [statuses.tee] output capture status
   * @param {number} [statuses.down] cleanup status
   * @return {{
   *   artifactDirectory: string,
   *   calls: string[],
   *   result: import('child_process').SpawnSyncReturns<string>
   * }}
   */
  function runScenario({
    up = 0,
    portFailOn = 0,
    npm = 0,
    tee = 0,
    down = 0
  }: ScenarioStatuses = {}) {
    const directory = mkdtempSync(path.join(tmpdir(), 'test-docker-script-'));
    const callLog = path.join(directory, 'calls.log');
    const portCount = path.join(directory, 'port-count');
    const artifactRoot = path.join(directory, 'artifacts');
    const artifactDirectory = path.join(artifactRoot, 'postgres');
    temporaryDirectories.push(directory);

    writeExecutable(directory, 'git', `#!/usr/bin/env bash
set -eu
printf 'git %s\\n' "$*" >> "$FAKE_CALL_LOG"
case "$*" in
  "rev-parse --show-toplevel")
    printf '%s\\n' "$TEST_REPOSITORY_ROOT"
    ;;
  *" hash-object --stdin")
    cat >/dev/null
    printf '%s\\n' "0123456789abcdef0123456789abcdef01234567"
    ;;
  *)
    exit 90
    ;;
esac
`);
    writeExecutable(directory, 'docker', `#!/usr/bin/env bash
set -eu
printf 'docker %s\\n' "$*" >> "$FAKE_CALL_LOG"
case " $* " in
  *" up --detach --wait --no-deps "*)
    exit "$FAKE_UP_STATUS"
    ;;
  *" port "*)
    port_count=0
    if [ -f "$FAKE_PORT_COUNT" ]; then
      port_count="$(cat "$FAKE_PORT_COUNT")"
    fi
    port_count=$((port_count + 1))
    printf '%s\\n' "$port_count" > "$FAKE_PORT_COUNT"
    if [ "$FAKE_PORT_FAIL_ON" -eq "$port_count" ]; then
      exit 32
    fi
    printf '%s\\n' "127.0.0.1:54321"
    ;;
  *" down --volumes --remove-orphans "*)
    exit "$FAKE_DOWN_STATUS"
    ;;
  *" ps --all "*)
    printf '%s\\n' "fake database status"
    ;;
  *" logs --no-color "*)
    printf '%s\\n' "fake database log"
    ;;
  *)
    ;;
esac
`);
    writeExecutable(directory, 'npm', `#!/usr/bin/env bash
set -eu
printf 'npm %s\\n' "$*" >> "$FAKE_CALL_LOG"
exit "$FAKE_NPM_STATUS"
`);
    writeExecutable(directory, 'tee', `#!/usr/bin/env bash
set -u
"$REAL_TEE" "$@"
tee_status="$FAKE_TEE_STATUS"
exit "$tee_status"
`);

    const result = spawnSync(
      'bash',
      [path.join(repositoryRoot, 'scripts', 'test-docker.sh'), 'postgres'],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          PATH: `${directory}:${process.env.PATH}`,
          FAKE_CALL_LOG: callLog,
          FAKE_DOWN_STATUS: String(down),
          FAKE_NPM_STATUS: String(npm),
          FAKE_PORT_COUNT: portCount,
          FAKE_PORT_FAIL_ON: String(portFailOn),
          FAKE_TEE_STATUS: String(tee),
          FAKE_UP_STATUS: String(up),
          GRAPHQL_SEQUELIZE_TEST_DOCKER_ARTIFACT_ROOT: artifactRoot,
          REAL_TEE: '/usr/bin/tee',
          TEST_REPOSITORY_ROOT: repositoryRoot
        }
      }
    );
    const calls = existsSync(callLog)
      ? readFileSync(callLog, 'utf8').trim().split('\n')
      : [];

    return { artifactDirectory, calls, result };
  }

  /**
   * Assert cleanup and failure diagnostics were attempted exactly once.
   *
   * @param {string[]} calls fake command call log
   * @param {string} artifactDirectory scenario-owned artifact directory
   * @return {void}
   */
  function expectFailureCleanup(
    calls: string[],
    artifactDirectory: string
  ): void {
    expect(calls.filter((call) =>
      call.includes(' down --volumes --remove-orphans')
    )).to.have.length(1);
    expect(calls.filter((call) =>
      call.includes(' logs --no-color postgres')
    )).to.have.length(1);
    expect(calls.filter((call) =>
      call.includes(' ps --all')
    )).to.have.length(1);
    expect(readFileSync(
      path.join(artifactDirectory, 'database.log'),
      'utf8'
    )).to.include('fake database log');
    expect(readFileSync(
      path.join(artifactDirectory, 'test.log'),
      'utf8'
    )).to.include('Dialect: postgres');
  }

  it('preserves a provisioning failure and still cleans up', function () {
    const { artifactDirectory, calls, result } = runScenario({ up: 31 });

    expect(result.status, result.stderr).to.equal(31);
    expect(calls.some((call) => call.includes('npm run test:integration')))
      .to.equal(false);
    expectFailureCleanup(calls, artifactDirectory);
  });

  it('fails when the post-provision environment cannot be sourced', function () {
    const { artifactDirectory, calls, result } = runScenario({
      portFailOn: 2
    });

    expect(result.status, result.stderr).to.equal(1);
    expect(calls.some((call) => call.includes('npm run test:integration')))
      .to.equal(false);
    expectFailureCleanup(calls, artifactDirectory);
  });

  it('preserves an integration failure and still cleans up', function () {
    const { artifactDirectory, calls, result } = runScenario({ npm: 33 });

    expect(result.status, result.stderr).to.equal(33);
    expectFailureCleanup(calls, artifactDirectory);
  });

  it('fails when tee cannot capture output and still cleans up', function () {
    const { artifactDirectory, calls, result } = runScenario({ tee: 47 });

    expect(result.status, result.stderr).to.equal(47);
    expectFailureCleanup(calls, artifactDirectory);
  });

  it('preserves the producer status when the producer and tee fail', function () {
    const { artifactDirectory, calls, result } = runScenario({
      npm: 33,
      tee: 47
    });

    expect(result.status, result.stderr).to.equal(33);
    expectFailureCleanup(calls, artifactDirectory);
  });

  it('turns a cleanup failure after success into a failure', function () {
    const { artifactDirectory, calls, result } = runScenario({ down: 34 });

    expect(result.status, result.stderr).to.equal(34);
    expectFailureCleanup(calls, artifactDirectory);
  });

  it('does not mask an earlier failure with a cleanup failure', function () {
    const { artifactDirectory, calls, result } = runScenario({
      npm: 33,
      down: 34
    });

    expect(result.status, result.stderr).to.equal(33);
    expectFailureCleanup(calls, artifactDirectory);
  });

  it('returns success without failure artifacts', function () {
    const { artifactDirectory, calls, result } = runScenario();

    expect(result.status, result.stderr).to.equal(0);
    expect(calls.filter((call) =>
      call.includes(' down --volumes --remove-orphans')
    )).to.have.length(1);
    expect(calls.some((call) => call.includes(' logs --no-color postgres')))
      .to.equal(false);
    expect(existsSync(artifactDirectory)).to.equal(false);
  });

  it('rejects relative and filesystem-root artifact overrides', function () {
    ['relative/artifacts', '/'].forEach((artifactRoot) => {
      const result = spawnSync(
        'bash',
        [path.join(repositoryRoot, 'scripts', 'test-docker.sh'), 'postgres'],
        {
          encoding: 'utf8',
          env: {
            ...process.env,
            GRAPHQL_SEQUELIZE_TEST_DOCKER_ARTIFACT_ROOT: artifactRoot
          }
        }
      );

      expect(result.status, result.stderr).to.equal(64);
      expect(result.stderr).to.include(
        'Artifact root must be an absolute non-root path.'
      );
    });
  });
});
