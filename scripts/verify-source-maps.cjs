'use strict';

const { readFileSync } = require('node:fs');
const path = require('node:path');

/**
 * Verify that every packed source map embeds aligned source text.
 *
 * @param {string} packageRoot directory containing the packed file layout
 * @param {string[]} packedFiles paths included in the package artifact
 * @return {void}
 */
function verifySelfContainedSourceMaps(packageRoot, packedFiles) {
  const sourceMapFiles = packedFiles.filter((filePath) =>
    filePath.endsWith('.map')
  );

  if (sourceMapFiles.length === 0) {
    throw new Error('Tarball does not contain source maps.');
  }

  for (const sourceMapFile of sourceMapFiles) {
    const sourceMap = JSON.parse(
      readFileSync(path.join(packageRoot, sourceMapFile), 'utf8')
    );

    if (!Array.isArray(sourceMap.sources) || sourceMap.sources.length === 0) {
      throw new Error(`${sourceMapFile} must name at least one source.`);
    }

    if (!Array.isArray(sourceMap.sourcesContent)) {
      throw new Error(`${sourceMapFile} must include a sourcesContent array.`);
    }

    if (sourceMap.sourcesContent.length !== sourceMap.sources.length) {
      throw new Error(
        `${sourceMapFile} must align sourcesContent with sources.`
      );
    }

    sourceMap.sources.forEach((source, index) => {
      if (typeof source !== 'string' || source.length === 0) {
        throw new Error(`${sourceMapFile} contains an empty source path.`);
      }

      const sourceContent = sourceMap.sourcesContent[index];

      if (typeof sourceContent !== 'string' || sourceContent.length === 0) {
        throw new Error(
          `${sourceMapFile} does not embed nonempty content for ${source}.`
        );
      }
    });
  }
}

module.exports = { verifySelfContainedSourceMaps };
