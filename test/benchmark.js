import {createServer} from 'node:http';
import {pathToFileURL} from 'node:url';

import {createHandler} from 'graphql-http/lib/use/http';

import {schema} from './benchmark/schema.js';

/**
 * HOW TO run the benchmarks:
 *
 * sudo docker-compose up -d postgres
 * sudo docker-compose run benchmark_server node test/benchmark/seed.js
 * npm run build && sudo docker-compose kill benchmark_server && sudo docker-compose up -d benchmark_server
 * ab -p test/benchmark/[FILE].json -T application/json -n 500 -c 20 http://localhost:4001/graphql
 */

/**
 * Start the benchmark GraphQL HTTP server.
 *
 * @param {number} [port=4001] TCP port to bind
 * @return {import('node:http').Server} listening HTTP server
 */
export function startBenchmarkServer(port = 4001) {
  const server = createServer(handleBenchmarkRequest);

  return server.listen(port, function () {
    const address = server.address();
    const listeningPort = address && typeof address !== 'string'
      ? address.port
      : port;

    console.log(`Benchmarking server listening on port ${listeningPort}`);
  });
}

/**
 * Format benchmark GraphQL errors with diagnostic stack information.
 *
 * @param {import('graphql').GraphQLError} error GraphQL execution error
 * @return {{message: string, locations: unknown, stack: string | undefined}}
 * serializable error response
 */
function formatBenchmarkError(error) {
  console.log(error.stack);

  return {
    message: error.message,
    locations: error.locations,
    stack: error.stack
  };
}

const graphqlHandler = createHandler({
  schema,
  formatError: formatBenchmarkError
});

/**
 * Route benchmark GraphQL requests through the GraphQL-over-HTTP handler.
 *
 * @param {import('node:http').IncomingMessage} request HTTP request
 * @param {import('node:http').ServerResponse} response HTTP response
 * @return {void}
 */
function handleBenchmarkRequest(request, response) {
  const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;

  if (pathname !== '/graphql') {
    response.writeHead(404).end();

    return;
  }

  graphqlHandler(request, response);
}

const executedModuleUrl = process.argv[1]
  ? pathToFileURL(process.argv[1]).href
  : undefined;

if (import.meta.url === executedModuleUrl) {
  await startBenchmarkServer();
}
