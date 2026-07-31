'use strict';

import { expect } from 'chai';
import { readFileSync } from 'fs';
import path from 'path';

const packageJson = JSON.parse(
  readFileSync(path.resolve('package.json'), 'utf8')
);

describe('package metadata', function () {
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
