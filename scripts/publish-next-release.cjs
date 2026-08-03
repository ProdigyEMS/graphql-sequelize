'use strict';

const path = require('node:path');
const { spawnSync } = require('node:child_process');

const repositoryRoot = path.resolve(__dirname, '..');
const packageVersion = '2.0.0';
const packageName = '@prodigyems/graphql-sequelize';
const releaseTag = `prodigy-v${packageVersion}`;
const tagReference = `refs/tags/${releaseTag}`;

/**
 * Run one release command without a shell and return its standard output.
 *
 * @param {string} command executable name
 * @param {string[]} args command arguments
 * @return {string} standard output
 * @throws {Error} when the executable cannot run or exits unsuccessfully
 */
function runSystemCommand(command, args) {
  const result = spawnSync(command, args, {
    cwd: repositoryRoot,
    encoding: 'utf8',
    stdio: ['inherit', 'pipe', 'pipe']
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    const standardError = result.stderr.trim();
    const detail = standardError === '' ? '' : `\n${standardError}`;

    throw new Error(
      `${command} ${args.join(' ')} exited with ${result.status}.${detail}`
    );
  }

  return result.stdout;
}

/**
 * Require a command result to match its release invariant.
 *
 * @param {boolean} condition release invariant result
 * @param {string} message failure diagnostic
 * @return {void}
 * @throws {Error} when the invariant is false
 */
function requireReleaseInvariant(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

/**
 * Require both tracked and untracked release files to be clean.
 *
 * @param {function(string, string[]): string} runCommand command executor
 * @return {void}
 * @throws {Error} when the working tree contains release changes
 */
function requireCleanWorkingTree(runCommand) {
  const workingTreeStatus = runCommand('git', [
    'status',
    '--porcelain=v1',
    '--untracked-files=all'
  ]);
  requireReleaseInvariant(
    workingTreeStatus.trim() === '',
    'Release working tree must be clean, including untracked files.'
  );
}

/**
 * Extract the commit from the remote annotated-tag dereference response.
 *
 * @param {string} output git ls-remote output
 * @return {string | undefined} dereferenced remote tag target
 */
function remoteTagTarget(output) {
  const dereferencedTag = `${tagReference}^{}`;
  const matchingLines = output
    .trim()
    .split('\n')
    .filter((line) => line.trim() !== '')
    .filter((line) => line.trim().split(/\s+/)[1] === dereferencedTag);

  if (matchingLines.length !== 1) {
    return undefined;
  }

  return matchingLines[0].trim().split(/\s+/)[0];
}

/**
 * Publish the validated 2.0.0 release only after every Git gate passes.
 *
 * @param {string} releaseCommit full validated release commit SHA
 * @param {object} [dependencies] injectable command dependency
 * @param {function(string, string[]): string} [dependencies.runCommand]
 * command executor
 * @return {string} registry integrity for the published version
 * @throws {Error} when validation, tag publication, npm publication, or the
 * integrity lookup fails
 */
function publishNextRelease(
  releaseCommit,
  { runCommand = runSystemCommand } = {}
) {
  requireReleaseInvariant(
    /^[0-9a-f]{40}$/.test(releaseCommit),
    'Release commit must be a full lowercase 40-character Git SHA.'
  );

  requireCleanWorkingTree(runCommand);

  const headCommit = runCommand('git', ['rev-parse', 'HEAD']).trim();
  requireReleaseInvariant(
    headCommit === releaseCommit,
    'HEAD does not equal the validated release SHA.'
  );

  runCommand('git', ['fetch', 'origin', 'master']);
  runCommand('git', [
    'merge-base',
    '--is-ancestor',
    releaseCommit,
    'origin/master'
  ]);

  const tagType = runCommand('git', [
    'cat-file',
    '-t',
    tagReference
  ]).trim();
  requireReleaseInvariant(
    tagType === 'tag',
    `${releaseTag} must be an annotated tag.`
  );

  const localTagTarget = runCommand('git', [
    'rev-parse',
    `${tagReference}^{}`
  ]).trim();
  requireReleaseInvariant(
    localTagTarget === releaseCommit,
    `Local ${releaseTag} target does not equal the validated release SHA.`
  );
  runCommand('git', ['verify-tag', releaseTag]);

  runCommand('npm', ['pack', '--dry-run']);
  requireCleanWorkingTree(runCommand);

  runCommand('git', [
    'push',
    'origin',
    `${tagReference}:${tagReference}`
  ]);

  const remoteTagOutput = runCommand('git', [
    'ls-remote',
    'origin',
    `${tagReference}^{}`
  ]);
  requireReleaseInvariant(
    remoteTagTarget(remoteTagOutput) === releaseCommit,
    `Remote ${releaseTag} target does not equal the validated release SHA.`
  );

  runCommand('npm', ['publish', '--tag', 'next']);
  const integrity = runCommand('npm', [
    'view',
    `${packageName}@${packageVersion}`,
    'dist.integrity'
  ]).trim();
  requireReleaseInvariant(
    integrity !== '',
    'Published package integrity lookup returned no value.'
  );

  return integrity;
}

if (require.main === module) {
  try {
    const integrity = publishNextRelease(process.argv[2]);

    process.stdout.write(
      `Published ${packageName}@${packageVersion} with integrity ${integrity}.\n`
    );
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = { publishNextRelease };
