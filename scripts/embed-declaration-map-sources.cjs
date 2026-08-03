'use strict';

const {
  readFileSync,
  readdirSync,
  writeFileSync
} = require('node:fs');
const path = require('node:path');

const repositoryRoot = path.resolve(__dirname, '..');
const buildDirectory = path.join(repositoryRoot, 'lib');
const declarationMapFiles = readdirSync(buildDirectory, { recursive: true })
  .filter((filePath) => filePath.endsWith('.d.ts.map'));

if (declarationMapFiles.length === 0) {
  throw new Error('Build did not emit declaration maps.');
}

for (const declarationMapFile of declarationMapFiles) {
  const declarationMapPath = path.join(buildDirectory, declarationMapFile);
  const declarationMap = JSON.parse(readFileSync(declarationMapPath, 'utf8'));

  if (!Array.isArray(declarationMap.sources) || declarationMap.sources.length === 0) {
    throw new Error(`${declarationMapFile} must name at least one source.`);
  }

  const sourceRoot = declarationMap.sourceRoot || '';

  // TypeScript intentionally omits inlineSources from declaration maps, so
  // resolve the compiler-authored paths and embed the same inputs after emit.
  declarationMap.sourcesContent = declarationMap.sources.map((source) => {
    const sourcePath = path.resolve(
      path.dirname(declarationMapPath),
      sourceRoot,
      source
    );
    const repositoryRelativeSource = path.relative(repositoryRoot, sourcePath);

    if (
      repositoryRelativeSource.startsWith(`..${path.sep}`) ||
      path.isAbsolute(repositoryRelativeSource)
    ) {
      throw new Error(
        `${declarationMapFile} references source outside the repository: ${source}`
      );
    }

    const sourceContent = readFileSync(sourcePath, 'utf8');

    if (sourceContent.length === 0) {
      throw new Error(`${declarationMapFile} references an empty source: ${source}`);
    }

    return sourceContent;
  });

  writeFileSync(declarationMapPath, JSON.stringify(declarationMap));
}
