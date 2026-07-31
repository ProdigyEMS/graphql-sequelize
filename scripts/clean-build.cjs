'use strict';

const { rmSync } = require('node:fs');
const path = require('node:path');

const typescriptBuildDirectory = path.resolve(__dirname, '..', 'lib');

// JavaScript, source maps, declarations, and declaration maps are all emitted
// beneath lib, so removing the directory also prevents stale TypeScript output.
rmSync(typescriptBuildDirectory, { force: true, recursive: true });
