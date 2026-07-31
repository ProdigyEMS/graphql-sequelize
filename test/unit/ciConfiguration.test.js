'use strict';

import { expect } from 'chai';
import { existsSync, readFileSync } from 'fs';
import path from 'path';
import { createSequelize } from '../support/helper';

const repositoryFile = (filePath) =>
  readFileSync(path.resolve(filePath), 'utf8');
const packageJson = JSON.parse(repositoryFile('package.json'));

describe('continuous integration configuration', function () {
  it('uses supported Node runtimes locally and in GitHub Actions', function () {
    const dockerfile = repositoryFile('Dockerfile');

    expect(dockerfile).to.match(/^FROM node:22-alpine/m);
    expect(packageJson.engines.node).to.equal('>=22.0.0');
    expect(existsSync(path.resolve('.dockerignore'))).to.equal(true);
    expect(existsSync(path.resolve('.github/workflows/ci.yml'))).to.equal(true);

    const workflow = repositoryFile('.github/workflows/ci.yml');

    expect(workflow).to.include('node-version: [22, 24]');
    expect(workflow.match(
      /actions\/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7/g
    )).to.have.length(3);
    expect(workflow.match(
      /actions\/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7/g
    )).to.have.length(3);
    expect(workflow.match(
      /actions\/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a # v7/g
    )).to.have.length(1);
    expect(workflow.match(/persist-credentials: false/g)).to.have.length(3);
    expect(workflow).not.to.match(/actions\/[^@\s]+@v\d+/);
    expect(existsSync(path.resolve('.travis.yml'))).to.equal(false);
  });

  it('builds a reproducible non-root Node image', function () {
    const dockerfile = repositoryFile('Dockerfile');
    const compose = repositoryFile('docker-compose.yml');

    expect(dockerfile).to.match(
      /^FROM node:22-alpine@sha256:[0-9a-f]{64}$/m
    );
    expect(dockerfile).to.include('RUN apk add --no-cache bash=5.3.9-r1');
    expect(dockerfile).to.include(
      'COPY --chown=node:node package.json package-lock.json ./'
    );
    expect(dockerfile).to.include('RUN npm ci --ignore-scripts');
    expect(dockerfile).to.include('COPY --chown=node:node . .');
    expect(dockerfile).to.include('RUN npm rebuild && npm run build');
    expect(dockerfile).to.include('USER node');
    expect(dockerfile).to.include('CMD ["npm", "test"]');
    expect(compose.match(/\/src\/graphql-sequelize\/node_modules/g))
      .to.have.length(2);
  });

  it('keeps the default test command local and isolated', function () {
    expect(packageJson.scripts.check).to.equal(
      'npm run lint && npm run test:types && npm run test:inventory && ' +
        'npm run test:unit'
    );
    expect(packageJson.scripts.test).to.equal(
      'npm run lint && npm run test:types && npm run test:unit && ' +
        'DIALECT=sqlite npm run test:integration && npm run test:package'
    );
    expect(packageJson.scripts['test:docker']).to.equal(
      'bash scripts/test-docker.sh'
    );
    expect(packageJson.scripts['build:docker']).to.equal(
      'docker compose build'
    );
  });

  it('limits coverage to the isolated unit suite', function () {
    expect(packageJson.scripts.cover).to.include('.build/test/unit/**/*.test.js');
    expect(packageJson.scripts.cover).not.to.include('integration');
  });

  it('lints source, tests, and maintained CommonJS scripts', function () {
    expect(packageJson.scripts.lint).to.equal(
      'eslint src test scripts/*.cjs'
    );
  });

  it('keeps database failure artifacts inside an explicitly safe root', function () {
    const runner = repositoryFile('scripts/test-docker.sh');

    expect(runner).to.include(
      'GRAPHQL_SEQUELIZE_TEST_DOCKER_ARTIFACT_ROOT'
    );
    expect(runner).to.include('Artifact root must be an absolute non-root path.');
  });

  it('uses the provisioned database credentials when CI is set', function () {
    const originalEnvironment = { ...process.env };

    try {
      Object.assign(process.env, {
        CI: 'true',
        DIALECT: 'postgres',
        POSTGRES_PORT_5432_TCP_ADDR: '127.0.0.1',
        POSTGRES_PORT_5432_TCP_PORT: '54321',
        POSTGRES_ENV_POSTGRES_USER: 'graphql_sequelize_test',
        POSTGRES_ENV_POSTGRES_PASSWORD: 'graphql_sequelize_test',
        POSTGRES_ENV_POSTGRES_DATABASE: 'graphql_sequelize_test'
      });

      const postgres = createSequelize();

      expect(postgres.config.username).to.equal('graphql_sequelize_test');
      expect(postgres.config.password).to.equal('graphql_sequelize_test');

      Object.assign(process.env, {
        DIALECT: 'mysql',
        MYSQL_PORT_3306_TCP_ADDR: '127.0.0.1',
        MYSQL_PORT_3306_TCP_PORT: '54322',
        MYSQL_ENV_MYSQL_USER: 'test',
        MYSQL_ENV_MYSQL_PASSWORD: 'test',
        MYSQL_ENV_MYSQL_DATABASE: 'test'
      });

      const mysql = createSequelize();

      expect(mysql.config.username).to.equal('test');
      expect(mysql.config.password).to.equal('test');
    } finally {
      Object.keys(process.env).forEach((name) => {
        if (!(name in originalEnvironment)) {
          delete process.env[name];
        }
      });
      Object.assign(process.env, originalEnvironment);
    }
  });

});
