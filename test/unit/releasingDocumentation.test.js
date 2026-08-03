'use strict';

import { expect } from 'chai';
import { readFileSync } from 'fs';
import path from 'path';

const releasing = readFileSync(path.resolve('RELEASING.md'), 'utf8');
const normalizedReleasing = releasing.replace(/\s+/g, ' ');

describe('release documentation', function () {
  it('requires high-severity and production dependency audits', function () {
    expect(normalizedReleasing).to.include('npm audit --audit-level=high');
    expect(normalizedReleasing).to.include('npm audit --omit=dev');
  });

  it('requires the validated release commit to reach master', function () {
    expect(normalizedReleasing).to.include(
      'git merge-base --is-ancestor "$release_commit" origin/master'
    );
    expect(normalizedReleasing).to.include(
      'Never publish a release commit that exists only on a pull request branch.'
    );
    expect(normalizedReleasing).to.include(
      'repeat the complete library and Git-backed consumer validation'
    );

    const tagCreation = 'git tag -s prodigy-v2.0.0 "$release_commit"';
    const releaseHelper =
      'node scripts/publish-next-release.cjs "$release_commit"';

    expect(normalizedReleasing).to.include(tagCreation);
    expect(normalizedReleasing).to.include(releaseHelper);
    expect(normalizedReleasing.indexOf(tagCreation)).to.be.lessThan(
      normalizedReleasing.indexOf(releaseHelper)
    );
    expect(releasing).not.to.match(
      /^git push origin prodigy-v2\.0\.0$/m
    );
    expect(releasing).not.to.match(
      /^npm publish --tag next$/m
    );
    expect(releasing).not.to.match(
      /^npm pack --dry-run$/m
    );
    expect(normalizedReleasing).to.include(
      'exits immediately on the first failed command or mismatched invariant'
    );
    expect(normalizedReleasing).to.include(
      'runs `npm pack --dry-run` and rechecks the clean working tree afterward'
    );
  });

  it('requires complete registry-backed validation before promotion', function () {
    const requiredGates = [
      '"@prodigyems/graphql-sequelize": "2.0.0"',
      'temporary Git dependency and `allowBuilds` entry',
      'npm view @prodigyems/graphql-sequelize@2.0.0 dist.integrity',
      'contains no Git resolution',
      'pnpm --dir node install --frozen-lockfile',
      'pnpm --dir node test',
      'pnpm --dir node lint',
      'pnpm --dir node typecheck',
      'pnpm --dir node build',
      'pnpm --dir node test:esm-build',
      'pnpm --dir node test:esm-startup',
      'pnpm --dir frontend validate',
      "CYPRESS_SPEC='cypress/e2e/reporting_spec.ts,cypress/e2e/organization_reporting_spec.ts' pnpm e2e",
      'Safe Chain package-age quarantine',
      'registry-backed required CI checks',
      'git push'
    ];

    for (const gate of requiredGates) {
      expect(normalizedReleasing).to.include(gate);
    }

    expect(normalizedReleasing.indexOf('npm publish --tag next')).to.be.lessThan(
      normalizedReleasing.indexOf('"@prodigyems/graphql-sequelize": "2.0.0"')
    );
    expect(
      normalizedReleasing.indexOf('registry-backed required CI checks')
    ).to.be.lessThan(
      normalizedReleasing.indexOf(
        'npm dist-tag add @prodigyems/graphql-sequelize@2.0.0 latest'
      )
    );
  });
});
