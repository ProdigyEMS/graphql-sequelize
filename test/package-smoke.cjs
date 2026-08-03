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
const {
  verifySelfContainedSourceMaps
} = require('../scripts/verify-source-maps.cjs');

const generatedModules = [
  'argsToFindOptions',
  'attributeFields',
  'base64',
  'contracts',
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
  'package.json'
].sort();
const expectedExports = [
  'DateType',
  'JSONType',
  'argsToFindOptions',
  'attributeFields',
  'createConnection',
  'createConnectionResolver',
  'createNodeInterface',
  'defaultArgs',
  'defaultListArgs',
  'relay',
  'resolver',
  'sequelizeConnection',
  'simplifyAST',
  'typeMapper'
];
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
    !packedFiles.some((filePath) =>
      /^(?:src|test|examples?|scripts|docs|coverage|\.github)\//.test(filePath)
    ),
    'Tarball contains source, test, example, tooling, or configuration files.'
  );
  assert(
    !packedFiles.some((filePath) => /^types(?:\/|$)/.test(filePath)),
    'Tarball contains the obsolete types/ directory.'
  );

  writeFileSync(
    path.join(consumerDirectory, 'package.json'),
    JSON.stringify({
      name: 'package-smoke-consumer',
      private: true,
      type: 'module'
    })
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
  const consumerScriptPath = path.join(consumerDirectory, 'package-smoke.mjs');

  assert(
    !existsSync(path.join(installedPackage, 'types')),
    'Installed package contains the obsolete types/ directory.'
  );

  for (const modulePath of generatedModules) {
    for (const extension of ['.js', '.js.map', '.d.ts', '.d.ts.map']) {
      assert(
        existsSync(path.join(installedPackage, 'lib', `${modulePath}${extension}`)),
        `Installed package omits lib/${modulePath}${extension}.`
      );
    }
  }
  verifySelfContainedSourceMaps(installedPackage, packedFiles);

  writeFileSync(
    consumerScriptPath,
    [
      "import { readFileSync } from 'node:fs';",
      "import path from 'node:path';",
      '',
      "const publicApi = await import('@prodigyems/graphql-sequelize');",
      'const expectedExports = JSON.parse(process.argv[2]);',
      'const actualExports = Object.keys(publicApi).sort();',
      "const packageRoot = path.join(process.cwd(), 'node_modules', '@prodigyems', 'graphql-sequelize');",
      '',
      'if (JSON.stringify(actualExports) !== JSON.stringify(expectedExports)) {',
      "  throw new Error('Unexpected public exports: ' + actualExports.join(', '));",
      '}',
      '',
      'for (const exportName of expectedExports) {',
      "  const expectedType = exportName === 'relay' || exportName === 'typeMapper' ||",
      "    exportName === 'JSONType' || exportName === 'DateType'",
      "    ? 'object'",
      "    : 'function';",
      '',
      '  if (typeof publicApi[exportName] !== expectedType) {',
      "    throw new Error(exportName + ' has the wrong runtime type.');",
      '  }',
      '}',
      '',
      "const declarations = readFileSync(path.join(packageRoot, 'lib', 'index.d.ts'), 'utf8');",
      'for (const exportName of expectedExports) {',
      "  if (!new RegExp('\\\\b' + exportName + '\\\\b').test(declarations)) {",
      "    throw new Error('Generated root declarations omit ' + exportName + '.');",
      '  }',
      '}',
      '',
      'let deepImportError;',
      'try {',
      "  await import('@prodigyems/graphql-sequelize/lib/argsToFindOptions.js');",
      '} catch (error) {',
      '  deepImportError = error;',
      '}',
      '',
      "if (!deepImportError || deepImportError.code !== 'ERR_PACKAGE_PATH_NOT_EXPORTED') {",
      "  throw new Error('Deep package imports must fail with ERR_PACKAGE_PATH_NOT_EXPORTED.');",
      '}',
      ''
    ].join('\n')
  );
  run(process.execPath, [consumerScriptPath, JSON.stringify(expectedExports)]);

  assert(
    JSON.stringify(packedFiles) === JSON.stringify(expectedFiles),
    `Unexpected tarball contents.\nExpected:\n${expectedFiles.join(
      '\n'
    )}\nActual:\n${packedFiles.join('\n')}`
  );

  const relayDeclarations = readFileSync(
    path.join(installedPackage, 'lib', 'relay.d.ts'),
    'utf8'
  );
  assert(
    !/\bfrom\s+['"]graphql-relay['"]/.test(relayDeclarations),
    'Generated Relay declarations depend on graphql-relay type declarations.'
  );

  run('npm', [
    'install',
    '--ignore-scripts',
    '--legacy-peer-deps',
    '--no-audit',
    '--no-fund',
    'graphql@16.6.0',
    'graphql-relay@0.4.2',
    'sequelize@6.37.8'
  ]);
  writeFileSync(
    path.join(consumerDirectory, 'relay-types.ts'),
    [
      "import { relay } from '@prodigyems/graphql-sequelize';",
      "import type { NodeInterfaceDefinition } from '@prodigyems/graphql-sequelize';",
      '',
      'declare const nodeInterface: NodeInterfaceDefinition;',
      'const nodesField = nodeInterface.nodesField;',
      "const connection = relay.handleConnection([{ id: 1 }], { first: 1 });",
      '',
      'void nodesField;',
      'void connection;',
      ''
    ].join('\n')
  );
  writeFileSync(
    path.join(consumerDirectory, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: {
        module: 'NodeNext',
        moduleResolution: 'NodeNext',
        noEmit: true,
        skipLibCheck: false,
        strict: true,
        target: 'ES2022'
      },
      include: ['relay-types.ts']
    })
  );
  run(process.execPath, [
    require.resolve('typescript/bin/tsc'),
    '--project',
    path.join(consumerDirectory, 'tsconfig.json')
  ]);
} finally {
  rmSync(consumerDirectory, { force: true, recursive: true });
}
