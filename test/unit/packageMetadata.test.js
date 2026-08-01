'use strict';

import { expect } from 'chai';
import { existsSync, readFileSync } from 'fs';
import path from 'path';

const packageJson = JSON.parse(
  readFileSync(path.resolve('package.json'), 'utf8')
);

describe('package metadata', function () {
  it('publishes a native ESM root with generated declarations', function () {
    expect(packageJson.type).to.equal('module');
    expect(packageJson.main).to.equal('./lib/index.js');
    expect(packageJson.types).to.equal('./lib/index.d.ts');
    expect(packageJson.exports).to.deep.equal({
      '.': {
        types: './lib/index.d.ts',
        import: './lib/index.js'
      }
    });
  });

  it('packs only generated declarations', function () {
    expect(packageJson.files).not.to.include('types/');
    expect(existsSync(path.resolve('types'))).to.equal(false);
  });

  it('does not retain the obsolete Babel toolchain', function () {
    expect(existsSync(path.resolve('babel.config.json'))).to.equal(false);
    expect(
      Object.keys(packageJson.devDependencies).filter((dependency) =>
        dependency.startsWith('@babel/')
      )
    ).to.deep.equal([]);
  });

  it('builds declarations before checking the public type contract', function () {
    expect(packageJson.scripts['test:types']).to.equal(
      'npm run build && tsc --project test/types/tsconfig.json'
    );
  });

  it('does not advertise GraphQL 17 in the standard peer graph', function () {
    expect(packageJson.peerDependencies.graphql.split(' || ')).not.to.include(
      '^17'
    );
  });

  it('runs the package-owned type contract during check', function () {
    expect(packageJson.scripts.check).to.equal(
      'npm run lint && npm run test:types && npm run test:inventory && ' +
        'npm run test:unit'
    );
  });
});
