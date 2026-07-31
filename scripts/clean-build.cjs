'use strict';

const { rmSync } = require('node:fs');
const path = require('node:path');

const buildDirectory = path.resolve(__dirname, '..', 'lib');

rmSync(buildDirectory, { force: true, recursive: true });
