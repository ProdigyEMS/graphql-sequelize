#!/usr/bin/env node
'use strict';

/**
 * Run each integration spec file in its own mocha process, sequentially.
 *
 * All three spec files share the `sequelize` singleton exported by
 * test/support/helper and define models under the same names, so they land on
 * the same tables. Run together in one process they interfere, and the result
 * is not reproducible -- two consecutive runs of the whole suite against the
 * same postgres database gave 55 passing then 57 passing, while any single
 * file run three times in a row gave an identical result every time.
 *
 * Isolating the files into separate processes removes the shared state. They
 * are run sequentially rather than with mocha's --parallel because they all
 * target one database and would otherwise collide on the same tables.
 */

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const BUILD_DIR = path.join(ROOT, '.build', 'test', 'integration');

/**
 * Recursively collect compiled spec files.
 *
 * @param {String} dir directory to walk
 * @return {String[]} absolute paths of *.test.js files, sorted
 */
function findSpecs(dir) {
  if (!fs.existsSync(dir)) {
    return [];
  }

  return fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        return findSpecs(full);
      }

      return entry.name.endsWith('.test.js') ? [full] : [];
    })
    .sort();
}

const specs = findSpecs(BUILD_DIR);

if (specs.length === 0) {
  console.error(`No integration specs found in ${BUILD_DIR}. Run the build first.`);
  process.exit(1);
}

const mocha = path.join(ROOT, 'node_modules', '.bin', 'mocha');
const failed = [];

for (const spec of specs) {
  const relative = path.relative(ROOT, spec);
  console.log(`\n=== ${relative} ===`);

  const result = spawnSync(mocha, [spec], { stdio: 'inherit', cwd: ROOT });

  if (result.status !== 0) {
    failed.push(relative);
  }
}

if (failed.length > 0) {
  console.error(`\n${failed.length} integration spec file(s) failed:`);
  failed.forEach((name) => console.error(`  - ${name}`));
  process.exit(1);
}

console.log('\nAll integration spec files passed.');
