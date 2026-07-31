'use strict';

const { rmSync, mkdtempSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const repositoryRoot = path.resolve(__dirname, '..');
const buildDirectory = path.join(repositoryRoot, 'lib');
const packDirectory = mkdtempSync(path.join(tmpdir(), 'graphql-sequelize-pack-'));

/**
 * Run a command and return its standard output.
 *
 * @param {string} command executable name
 * @param {string[]} args command arguments
 * @return {string} standard output
 */
function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: repositoryRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    process.stderr.write(result.stdout || '');
    process.stderr.write(result.stderr || '');
    throw new Error(`${command} ${args.join(' ')} exited with ${result.status}`);
  }

  return result.stdout;
}

/**
 * Parse the JSON emitted by npm pack.
 *
 * @param {string} output npm pack output
 * @return {object} the single packed artifact description
 */
function parsePackResult(output) {
  const jsonStart = output.indexOf('[');

  if (jsonStart === -1) {
    throw new Error(`npm pack did not emit JSON:\n${output}`);
  }

  const packResults = JSON.parse(output.slice(jsonStart));

  if (packResults.length !== 1) {
    throw new Error(`Expected one packed artifact, received ${packResults.length}`);
  }

  return packResults[0];
}

try {
  // A publish check must prove the lifecycle creates the distributable itself.
  rmSync(buildDirectory, { force: true, recursive: true });

  const output = run('npm', [
    'pack',
    '--json',
    '--pack-destination',
    packDirectory
  ]);
  const packResult = parsePackResult(output);
  const tarballPath = path.join(packDirectory, packResult.filename);

  run(process.execPath, [
    path.join(repositoryRoot, 'test/package-smoke.cjs'),
    tarballPath,
    JSON.stringify(packResult.files.map(({ path: filePath }) => filePath))
  ]);

  process.stdout.write(
    `Verified ${packResult.filename} (${packResult.files.length} files).\n`
  );
} finally {
  rmSync(packDirectory, { force: true, recursive: true });
}
