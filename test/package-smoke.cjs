'use strict';

const {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const generatedModules = [
  'argsToFindOptions',
  'attributeFields',
  'base64',
  'defaultArgs',
  'defaultListArgs',
  'index',
  'normalizeVariableValues',
  'relay',
  'replaceWhereOperators',
  'resolver',
  'sequelizeOps',
  'simplifyAST',
  'typeMapper',
  'types/dateType',
  'types/jsonType'
];
const expectedFiles = [
  'CHANGELOG.md',
  'LICENSE',
  'README.md',
  ...generatedModules.flatMap((modulePath) => [
    `lib/${modulePath}.d.ts`,
    `lib/${modulePath}.d.ts.map`,
    `lib/${modulePath}.js`,
    `lib/${modulePath}.js.map`
  ]),
  'package.json',
  'types/index.d.ts'
].sort();
const tarballPath = process.argv[2];
const packedFiles = JSON.parse(process.argv[3] || '[]').sort();
const consumerDirectory = mkdtempSync(
  path.join(tmpdir(), 'graphql-sequelize-consumer-')
);

/**
 * Assert a package-smoke invariant.
 *
 * @param {unknown} condition asserted value
 * @param {string} message failure message
 * @return {void}
 */
function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

/**
 * Run a command in the temporary consumer.
 *
 * @param {string} command executable name
 * @param {string[]} args command arguments
 * @return {void}
 */
function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: consumerDirectory,
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
}

try {
  assert(tarballPath, 'Expected the packed tarball path.');
  assert(existsSync(tarballPath), `Tarball does not exist: ${tarballPath}`);
  assert(
    JSON.stringify(packedFiles) === JSON.stringify(expectedFiles),
    `Unexpected tarball contents.\nExpected:\n${expectedFiles.join(
      '\n'
    )}\nActual:\n${packedFiles.join('\n')}`
  );
  assert(
    !packedFiles.some((filePath) =>
      /^(?:src|test|examples?|scripts|docs|coverage|\.github)\//.test(filePath)
    ),
    'Tarball contains source, test, example, tooling, or configuration files.'
  );

  writeFileSync(
    path.join(consumerDirectory, 'package.json'),
    JSON.stringify({ name: 'package-smoke-consumer', private: true })
  );
  run('npm', [
    'install',
    '--ignore-scripts',
    '--no-audit',
    '--no-fund',
    tarballPath
  ]);

  const installedPackage = path.join(
    consumerDirectory,
    'node_modules',
    '@prodigyems',
    'graphql-sequelize'
  );
  const publicApi = require(installedPackage);
  const compiledPublicApi = require(
    path.join(installedPackage, 'lib', 'index.js')
  );
  const argsToFindOptions = require(
    path.join(installedPackage, 'lib', 'argsToFindOptions.js')
  );

  assert(typeof publicApi.resolver === 'function', 'resolver is not callable.');
  assert(
    typeof compiledPublicApi.resolver === 'function',
    'The direct compiled package entry point is not usable.'
  );
  assert(
    typeof publicApi.argsToFindOptions === 'function',
    'argsToFindOptions is not callable.'
  );
  assert(
    typeof publicApi.sequelizeConnection === 'function',
    'sequelizeConnection is not callable.'
  );
  assert(
    typeof argsToFindOptions.default === 'function',
    'The direct argsToFindOptions module is not usable.'
  );
  assert(
    readFileSync(path.join(installedPackage, 'types', 'index.d.ts'), 'utf8')
      .includes('export const resolver'),
    'The package-owned TypeScript declarations are missing.'
  );
} finally {
  rmSync(consumerDirectory, { force: true, recursive: true });
}
