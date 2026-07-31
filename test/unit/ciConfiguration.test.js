'use strict';

import { expect } from 'chai';
import { ESLint } from 'eslint';
import { existsSync, readFileSync } from 'fs';
import path from 'path';
import { createSequelize } from '../support/helper';

const repositoryFile = (filePath) =>
  readFileSync(path.resolve(filePath), 'utf8');
const repositoryJson = (filePath) => JSON.parse(repositoryFile(filePath));
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

  it('compiles production and maintained test sources with TypeScript', function () {
    const buildConfig = repositoryJson('tsconfig.build.json');
    const testConfig = repositoryJson('tsconfig.test.json');

    expect(buildConfig).to.deep.equal({
      compilerOptions: {
        allowJs: true,
        checkJs: false,
        declaration: true,
        declarationMap: true,
        esModuleInterop: true,
        forceConsistentCasingInFileNames: true,
        module: 'NodeNext',
        moduleResolution: 'NodeNext',
        noEmitOnError: true,
        outDir: 'lib',
        rootDir: 'src',
        skipLibCheck: false,
        sourceMap: true,
        strict: true,
        target: 'ES2022'
      },
      include: ['src/**/*.js', 'src/**/*.ts']
    });
    expect(testConfig).to.deep.equal({
      extends: './tsconfig.build.json',
      compilerOptions: {
        allowJs: true,
        declaration: false,
        declarationMap: false,
        outDir: '.build',
        rootDir: '.'
      },
      include: [
        'src/**/*',
        'test/unit/**/*.js',
        'test/integration/**/*.js',
        'test/support/**/*.js'
      ]
    });
    expect(packageJson.type).to.equal('commonjs');
    expect(packageJson.main).to.equal('lib/index.js');
    expect(packageJson.types).to.equal('types/index.d.ts');
    expect(packageJson.scripts.build).to.equal(
      'node scripts/clean-build.cjs && tsc -p tsconfig.build.json'
    );
    expect(packageJson.scripts['build:test']).to.equal(
      'rm -rf .build && tsc -p tsconfig.test.json'
    );
    expect(packageJson.scripts.build).not.to.match(/\bbabel\b/i);
    expect(packageJson.scripts['build:test']).not.to.match(/\bbabel\b/i);
    expect(existsSync(path.resolve('eslint.config.cjs'))).to.equal(true);
    expect(existsSync(path.resolve('eslint.config.js'))).to.equal(false);
  });

  it('applies TypeScript-aware lint rules only to source TypeScript', async function () {
    const eslint = new ESLint();
    const sourceConfig = await eslint.calculateConfigForFile('src/example.ts');
    const testConfig = await eslint.calculateConfigForFile(
      'test/types/public-api.test.ts'
    );

    expect(sourceConfig).not.to.equal(undefined);
    expect(sourceConfig.languageOptions.parser.meta.name).to.equal(
      'typescript-eslint/parser'
    );
    expect(sourceConfig.rules['no-undef'][0]).to.equal(0);
    expect(sourceConfig.rules['no-redeclare'][0]).to.equal(0);
    expect(sourceConfig.rules['no-array-constructor'][0]).to.equal(0);
    expect(sourceConfig.rules['no-unused-vars'][0]).to.equal(0);
    expect(sourceConfig.rules['@typescript-eslint/no-array-constructor'][0])
      .to.equal(2);
    expect(sourceConfig.rules['@typescript-eslint/no-unused-vars'][0])
      .to.equal(2);
    expect(sourceConfig.rules['@typescript-eslint/no-explicit-any'][0])
      .to.equal(2);
    expect(testConfig).to.equal(undefined);
  });

  it('allows valid TypeScript declaration merging', async function () {
    const eslint = new ESLint();
    const [result] = await eslint.lintText(
      [
        'interface Entity { id: string; }',
        'interface Entity { name: string; }',
        "export const entity: Entity = { id: '1', name: 'Ada' };"
      ].join('\n') + '\n',
      { filePath: 'src/declarationMerging.ts' }
    );

    expect(result.messages).to.deep.equal([]);
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
