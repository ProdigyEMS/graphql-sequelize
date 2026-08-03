'use strict';

import { expect } from 'chai';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { publishNextRelease } = require(
  path.resolve('scripts/publish-next-release.cjs')
);

const RELEASE_COMMIT = '1234567890abcdef1234567890abcdef12345678';
const RELEASE_TAG = 'prodigy-v2.0.0';
const TAG_REFERENCE = `refs/tags/${RELEASE_TAG}`;
const PUBLISH_INVOCATION = ['npm', 'publish', '--tag', 'next'];

/**
 * Convert a command invocation to a stable lookup key.
 *
 * @param {string} command executable name
 * @param {string[]} args command arguments
 * @return {string} stable invocation key
 */
function invocationKey(command, args) {
  return JSON.stringify([command, ...args]);
}

/**
 * Build a deterministic command runner for release orchestration tests.
 *
 * @param {object} [options] command-result overrides
 * @param {string} [options.remoteReleaseCommit] remote tag target
 * @param {string} [options.failedInvocation] invocation that must fail
 * @return {{calls: string[][], runCommand: function(string, string[]): string}}
 * command log and injected runner
 */
function createCommandRunner({
  remoteReleaseCommit = RELEASE_COMMIT,
  failedInvocation
} = {}) {
  const calls = [];
  const outputs = new Map([
    [invocationKey('git', ['status', '--porcelain=v1', '--untracked-files=all']), ''],
    [invocationKey('git', ['rev-parse', 'HEAD']), `${RELEASE_COMMIT}\n`],
    [invocationKey('git', ['fetch', 'origin', 'master']), ''],
    [
      invocationKey('git', [
        'merge-base',
        '--is-ancestor',
        RELEASE_COMMIT,
        'origin/master'
      ]),
      ''
    ],
    [invocationKey('git', ['cat-file', '-t', TAG_REFERENCE]), 'tag\n'],
    [
      invocationKey('git', ['rev-parse', `${TAG_REFERENCE}^{}`]),
      `${RELEASE_COMMIT}\n`
    ],
    [invocationKey('git', ['verify-tag', RELEASE_TAG]), ''],
    [invocationKey('npm', ['pack', '--dry-run']), 'package preview\n'],
    [
      invocationKey('git', [
        'push',
        'origin',
        `${TAG_REFERENCE}:${TAG_REFERENCE}`
      ]),
      ''
    ],
    [
      invocationKey('git', ['ls-remote', 'origin', `${TAG_REFERENCE}^{}`]),
      `${remoteReleaseCommit}\t${TAG_REFERENCE}^{}\n`
    ],
    [
      invocationKey(PUBLISH_INVOCATION[0], PUBLISH_INVOCATION.slice(1)),
      'published\n'
    ],
    [
      invocationKey('npm', [
        'view',
        '@prodigyems/graphql-sequelize@2.0.0',
        'dist.integrity'
      ]),
      'sha512-release-integrity\n'
    ]
  ]);

  /**
   * Return a configured result or simulate a command failure.
   *
   * @param {string} command executable name
   * @param {string[]} args command arguments
   * @return {string} configured standard output
   */
  function runCommand(command, args) {
    calls.push([command, ...args]);
    const key = invocationKey(command, args);

    if (key === failedInvocation) {
      throw new Error(`Simulated failure: ${key}`);
    }

    if (!outputs.has(key)) {
      throw new Error(`Unexpected command: ${key}`);
    }

    return outputs.get(key);
  }

  return { calls, runCommand };
}

describe('next release publisher', function () {
  it('runs every verification gate before publishing and checking integrity', function () {
    const { calls, runCommand } = createCommandRunner();

    const integrity = publishNextRelease(RELEASE_COMMIT, { runCommand });

    expect(integrity).to.equal('sha512-release-integrity');
    expect(calls).to.deep.equal([
      ['git', 'status', '--porcelain=v1', '--untracked-files=all'],
      ['git', 'rev-parse', 'HEAD'],
      ['git', 'fetch', 'origin', 'master'],
      [
        'git',
        'merge-base',
        '--is-ancestor',
        RELEASE_COMMIT,
        'origin/master'
      ],
      ['git', 'cat-file', '-t', TAG_REFERENCE],
      ['git', 'rev-parse', `${TAG_REFERENCE}^{}`],
      ['git', 'verify-tag', RELEASE_TAG],
      ['npm', 'pack', '--dry-run'],
      ['git', 'status', '--porcelain=v1', '--untracked-files=all'],
      [
        'git',
        'push',
        'origin',
        `${TAG_REFERENCE}:${TAG_REFERENCE}`
      ],
      ['git', 'ls-remote', 'origin', `${TAG_REFERENCE}^{}`],
      PUBLISH_INVOCATION,
      [
        'npm',
        'view',
        '@prodigyems/graphql-sequelize@2.0.0',
        'dist.integrity'
      ]
    ]);
  });

  it('does not publish when the explicit tag push fails', function () {
    const tagPush = invocationKey('git', [
      'push',
      'origin',
      `${TAG_REFERENCE}:${TAG_REFERENCE}`
    ]);
    const { calls, runCommand } = createCommandRunner({
      failedInvocation: tagPush
    });

    expect(() => publishNextRelease(RELEASE_COMMIT, { runCommand })).to.throw(
      'Simulated failure'
    );
    expect(calls).not.to.deep.include(PUBLISH_INVOCATION);
  });

  it('does not push the tag or publish when the package dry-run fails', function () {
    const packageDryRun = invocationKey('npm', ['pack', '--dry-run']);
    const tagPush = [
      'git',
      'push',
      'origin',
      `${TAG_REFERENCE}:${TAG_REFERENCE}`
    ];
    const { calls, runCommand } = createCommandRunner({
      failedInvocation: packageDryRun
    });

    expect(() => publishNextRelease(RELEASE_COMMIT, { runCommand })).to.throw(
      'Simulated failure'
    );
    expect(calls).not.to.deep.include(tagPush);
    expect(calls).not.to.deep.include(PUBLISH_INVOCATION);
  });

  it('does not publish when the remote annotated-tag target mismatches', function () {
    const { calls, runCommand } = createCommandRunner({
      remoteReleaseCommit: 'abcdef1234567890abcdef1234567890abcdef12'
    });

    expect(() => publishNextRelease(RELEASE_COMMIT, { runCommand })).to.throw(
      'Remote prodigy-v2.0.0 target does not equal the validated release SHA.'
    );
    expect(calls).not.to.deep.include(PUBLISH_INVOCATION);
  });
});
