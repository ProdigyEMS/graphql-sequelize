import {spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import {describe, expect, it} from 'vitest';

interface PackResult {
  filename: string;
  files: Array<{path: string}>;
}

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
const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const npmDryRunEnvironmentKey = 'npm_config_dry_run';
const npmDryRunUppercaseEnvironmentKey = 'NPM_CONFIG_DRY_RUN';

interface TemporaryDirectoryOperations {
  create(prefix: string): string;
  remove(directory: string): void;
}

const temporaryDirectoryOperations: TemporaryDirectoryOperations = {
  /** Create a temporary directory for one package-smoke phase. */
  create(prefix) {
    return mkdtempSync(path.join(tmpdir(), prefix));
  },
  /** Recursively remove a package-smoke temporary directory. */
  remove(directory) {
    rmSync(directory, {force: true, recursive: true});
  }
};

/** Run package checks with isolated directories that are always removed. */
function withPackageSmokeDirectories<T>(
  action: (packDirectory: string, consumerDirectory: string) => T,
  operations: TemporaryDirectoryOperations = temporaryDirectoryOperations
): T {
  const packDirectory = operations.create('graphql-sequelize-pack-');

  try {
    const consumerDirectory = operations.create('graphql-sequelize-consumer-');

    try {
      return action(packDirectory, consumerDirectory);
    } finally {
      operations.remove(consumerDirectory);
    }
  } finally {
    operations.remove(packDirectory);
  }
}

/**
 * Copy an npm lifecycle environment with local dry-run behavior disabled.
 *
 * npm recognizes both environment spellings. Setting both on the copied
 * object keeps an outer publish dry-run while allowing temporary artifacts.
 *
 * @param environment parent environment inherited by the package smoke test
 * @return isolated environment for local npm package operations
 */
function npmChildEnvironment(
  environment: NodeJS.ProcessEnv = process.env
): NodeJS.ProcessEnv {
  return {
    ...environment,
    [npmDryRunEnvironmentKey]: 'false',
    [npmDryRunUppercaseEnvironmentKey]: 'false'
  };
}

/**
 * Run a command and return its standard output or fail with diagnostics.
 *
 * @param command executable name or path
 * @param args command arguments
 * @param cwd command working directory
 * @param environment environment inherited by the command
 * @return command standard output
 */
function run(
  command: string,
  args: string[],
  cwd: string,
  environment: NodeJS.ProcessEnv = process.env
): string {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    env: environment,
    stdio: ['ignore', 'pipe', 'pipe']
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(' ')} exited with ${result.status}.\n` +
        `${result.stdout || ''}${result.stderr || ''}`
    );
  }

  return result.stdout;
}

/**
 * Run an npm command that intentionally writes only temporary test artifacts.
 *
 * @param args npm command arguments
 * @param cwd npm command working directory
 * @return command standard output
 */
function runNpm(args: string[], cwd: string): string {
  return run('npm', args, cwd, npmChildEnvironment());
}

/** Parse the single artifact description emitted by `npm pack --json`. */
function parsePackResult(output: string): PackResult {
  const jsonStart = output.indexOf('[');

  if (jsonStart === -1) {
    throw new Error(`npm pack did not emit JSON:\n${output}`);
  }

  const packResults = JSON.parse(output.slice(jsonStart)) as unknown;

  if (!Array.isArray(packResults) || packResults.length !== 1) {
    throw new Error('Expected npm pack to emit exactly one artifact.');
  }

  const [packResult] = packResults;
  if (
    typeof packResult !== 'object' ||
    packResult === null ||
    !('filename' in packResult) ||
    typeof packResult.filename !== 'string' ||
    !('files' in packResult) ||
    !Array.isArray(packResult.files)
  ) {
    throw new Error('npm pack emitted an invalid artifact description.');
  }

  return packResult as PackResult;
}

/** Write and run consumer-side runtime checks against the installed tarball. */
function verifyConsumerRuntime(
  consumerDirectory: string,
  installedPackage: string
): void {
  const consumerScriptPath = path.join(
    consumerDirectory,
    'package-smoke.mjs'
  );

  writeFileSync(
    consumerScriptPath,
    [
      "import {readFileSync} from 'node:fs';",
      "import path from 'node:path';",
      '',
      "const publicApi = await import('@prodigyems/graphql-sequelize');",
      `const expectedExports = ${JSON.stringify(expectedExports)};`,
      'const actualExports = Object.keys(publicApi).sort();',
      `const packageRoot = ${JSON.stringify(installedPackage)};`,
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
      'const connection = publicApi.relay.handleConnection(',
      '  [{id: 1}, {id: 2}],',
      '  {first: 1}',
      ');',
      'if (connection.edges.length !== 1 || connection.edges[0].node.id !== 1) {',
      "  throw new Error('Relay connection runtime contract is broken.');",
      '}',
      'if (!connection.pageInfo.hasNextPage || connection.pageInfo.hasPreviousPage) {',
      "  throw new Error('Relay pagination runtime contract is broken.');",
      '}',
      '',
      'let deepImportError;',
      'try {',
      "  await import('@prodigyems/graphql-sequelize/lib/argsToFindOptions.js');",
      '} catch (error) {',
      '  deepImportError = error;',
      '}',
      "if (!deepImportError || deepImportError.code !== 'ERR_PACKAGE_PATH_NOT_EXPORTED') {",
      "  throw new Error('Deep package imports must fail with ERR_PACKAGE_PATH_NOT_EXPORTED.');",
      '}',
      ''
    ].join('\n')
  );

  run(process.execPath, [consumerScriptPath], consumerDirectory);
}

/** Compile a strict consumer contract against the oldest supported Relay. */
function verifyConsumerTypes(consumerDirectory: string): void {
  runNpm(
    [
      'install',
      '--ignore-scripts',
      '--legacy-peer-deps',
      '--no-audit',
      '--no-fund',
      'graphql@16.6.0',
      'graphql-relay@0.4.2',
      'sequelize@6.37.8'
    ],
    consumerDirectory
  );

  writeFileSync(
    path.join(consumerDirectory, 'relay-types.ts'),
    [
      "import {relay} from '@prodigyems/graphql-sequelize';",
      "import type {NodeInterfaceDefinition} from '@prodigyems/graphql-sequelize';",
      '',
      'declare const nodeInterface: NodeInterfaceDefinition;',
      'const nodesField = nodeInterface.nodesField;',
      "const connection = relay.handleConnection([{id: 1}], {first: 1});",
      'const nodeId: number = connection.edges[0].node.id;',
      'const hasNextPage: boolean = connection.pageInfo.hasNextPage;',
      '',
      'void nodesField;',
      'void nodeId;',
      'void hasNextPage;',
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

  run(
    process.execPath,
    [
      require.resolve('typescript/bin/tsc'),
      '--project',
      path.join(consumerDirectory, 'tsconfig.json')
    ],
    consumerDirectory
  );
}

describe('package consumer smoke', function () {
  it('disables inherited npm dry-run for local package checks', () => {
    const inheritedEnvironment: NodeJS.ProcessEnv = {
      [npmDryRunEnvironmentKey]: 'true',
      [npmDryRunUppercaseEnvironmentKey]: 'true',
      PACKAGE_SMOKE_SENTINEL: 'preserved'
    };

    const childEnvironment = npmChildEnvironment(inheritedEnvironment);

    expect(childEnvironment[npmDryRunEnvironmentKey]).to.equal('false');
    expect(childEnvironment[npmDryRunUppercaseEnvironmentKey]).to.equal(
      'false'
    );
    expect(childEnvironment.PACKAGE_SMOKE_SENTINEL).to.equal('preserved');
    expect(inheritedEnvironment[npmDryRunEnvironmentKey]).to.equal('true');
    expect(inheritedEnvironment[npmDryRunUppercaseEnvironmentKey]).to.equal(
      'true'
    );
  });

  it('removes the pack directory when consumer directory creation fails', () => {
    const removedDirectories: string[] = [];
    let creationCount = 0;
    const operations: TemporaryDirectoryOperations = {
      /** Return one directory before simulating the second creation failure. */
      create() {
        creationCount += 1;

        if (creationCount === 1) {
          return '/temporary/pack';
        }

        throw new Error('consumer directory creation failed');
      },
      /** Record each directory selected for cleanup. */
      remove(directory) {
        removedDirectories.push(directory);
      }
    };

    expect(() =>
      withPackageSmokeDirectories(() => undefined, operations)
    ).to.throw('consumer directory creation failed');
    expect(removedDirectories).to.deep.equal(['/temporary/pack']);
  });

  it('packs and validates the real package from an isolated consumer', () => {
    withPackageSmokeDirectories((packDirectory, consumerDirectory) => {
      const output = runNpm(
        ['pack', '--json', '--pack-destination', packDirectory],
        repositoryRoot
      );
      const packResult = parsePackResult(output);
      const tarballPath = path.join(packDirectory, packResult.filename);
      const packedFiles = packResult.files
        .map(({path: filePath}) => filePath)
        .sort();

      expect(existsSync(tarballPath)).to.equal(true);
      expect(packedFiles).to.deep.equal(expectedFiles);
      expect(
        packedFiles.some((filePath) =>
          /^(?:src|test|examples?|scripts|docs|coverage|\.github)\//.test(
            filePath
          )
        )
      ).to.equal(false);
      expect(
        packedFiles.some((filePath) => /^types(?:\/|$)/.test(filePath))
      ).to.equal(false);

      writeFileSync(
        path.join(consumerDirectory, 'package.json'),
        JSON.stringify({
          name: 'package-smoke-consumer',
          private: true,
          type: 'module'
        })
      );
      runNpm(
        [
          'install',
          '--ignore-scripts',
          '--no-audit',
          '--no-fund',
          tarballPath
        ],
        consumerDirectory
      );

      const installedPackage = path.join(
        consumerDirectory,
        'node_modules',
        '@prodigyems',
        'graphql-sequelize'
      );

      expect(existsSync(path.join(installedPackage, 'types'))).to.equal(false);
      for (const modulePath of generatedModules) {
        for (const extension of ['.js', '.js.map', '.d.ts', '.d.ts.map']) {
          expect(
            existsSync(
              path.join(installedPackage, 'lib', `${modulePath}${extension}`)
            ),
            `Installed package omits lib/${modulePath}${extension}.`
          ).to.equal(true);
        }
      }

      verifyConsumerRuntime(consumerDirectory, installedPackage);

      const relayDeclarations = readFileSync(
        path.join(installedPackage, 'lib', 'relay.d.ts'),
        'utf8'
      );
      expect(relayDeclarations).not.to.match(
        /\bfrom\s+['"]graphql-relay['"]/
      );

      verifyConsumerTypes(consumerDirectory);
    });
  }, 120_000);
});
