import {spawnSync} from 'node:child_process';
import path from 'node:path';

import {expect} from 'chai';

/**
 * Exercise a benchmark entrypoint in an isolated process.
 *
 * A bounded child process proves module loading does not start a persistent
 * server or begin a database seed as an import side effect.
 *
 * @param {string} modulePath repository-relative module path
 * @param {string} exportName callable export expected from the module
 * @param {string} exerciseScript optional entrypoint lifecycle exercise
 * @return {import('node:child_process').SpawnSyncReturns<string>} child result
 */
function exerciseBenchmarkEntrypoint(
  modulePath,
  exportName,
  exerciseScript = ''
) {
  return spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '--eval',
      `const entrypoint = await import(${JSON.stringify(modulePath)});
       if (typeof entrypoint[${JSON.stringify(exportName)}] !== 'function') {
         throw new Error(${JSON.stringify(exportName)} + ' is not callable.');
       }
       ${exerciseScript}`
    ],
    {
      cwd: path.resolve('.'),
      encoding: 'utf8',
      timeout: 3000
    }
  );
}

/**
 * Assert an entrypoint imports and completes its requested exercise cleanly.
 *
 * @param {string} modulePath repository-relative module path
 * @param {string} exportName callable export expected from the module
 * @param {string} exerciseScript optional entrypoint lifecycle exercise
 * @return {void}
 */
function expectEntrypointSuccess(modulePath, exportName, exerciseScript) {
  const result = exerciseBenchmarkEntrypoint(
    modulePath,
    exportName,
    exerciseScript
  );
  const diagnostics = [result.error?.message, result.stdout, result.stderr]
    .filter(Boolean)
    .join('\n');

  expect(result.status, diagnostics).to.equal(0);
}

describe('benchmark entrypoints', function () {
  it('starts the server on an ephemeral port and closes it', function () {
    expectEntrypointSuccess(
      './test/benchmark.js',
      'startBenchmarkServer',
      `const server = await entrypoint.startBenchmarkServer(0);
       if (!server.listening) {
         await new Promise((resolve, reject) => {
           server.once('listening', resolve);
           server.once('error', reject);
         });
       }
       const address = server.address();
       if (!address || typeof address === 'string' || address.port === 0) {
         throw new Error('Benchmark server did not bind an ephemeral port.');
       }
       const response = await fetch(
         'http://127.0.0.1:' + address.port + '/graphql',
         {
           method: 'POST',
           headers: {'content-type': 'application/json'},
           body: JSON.stringify({query: '{ __typename }'})
         }
       );
       const payload = await response.json();
       if (!response.ok || !payload.data?.__typename) {
         throw new Error('Benchmark GraphQL endpoint did not respond.');
       }
       await new Promise((resolve, reject) => {
         server.close((error) => error ? reject(error) : resolve());
       });`
    );
  });

  it('imports the seed launcher without writing data', function () {
    expectEntrypointSuccess(
      './test/benchmark/seed.js',
      'seedBenchmarkDatabase'
    );
  });
});
