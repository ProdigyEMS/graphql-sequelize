'use strict';

const {
  existsSync,
  readFileSync,
  readdirSync,
  writeFileSync
} = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const repositoryRoot = path.resolve(__dirname, '..');
const inventoryPath = path.join(repositoryRoot, 'test/test-inventory.json');
const testDirectories = [
  path.join(repositoryRoot, 'test/unit'),
  path.join(repositoryRoot, 'test/integration')
];

/**
 * Compare strings without depending on the host locale.
 *
 * @param {string} left first string
 * @param {string} right second string
 * @return {number} sort order
 */
function compareStrings(left, right) {
  if (left < right) {
    return -1;
  }

  if (left > right) {
    return 1;
  }

  return 0;
}

/**
 * Find every JavaScript and TypeScript file below a directory.
 *
 * @param {string} directory directory to search
 * @return {string[]} sorted absolute file paths
 */
function findTestFiles(directory) {
  const files = [];

  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...findTestFiles(entryPath));
    } else if (entry.isFile() && /\.(?:js|ts)$/.test(entry.name)) {
      files.push(entryPath);
    }
  }

  return files.sort(compareStrings);
}

/**
 * Read a statically declared test title.
 *
 * Literal concatenation is supported because the existing suite contains one
 * long title split across lines. Dynamic expressions are intentionally ignored.
 *
 * @param {import('typescript').Expression} expression title expression
 * @return {string|undefined} static title, when present
 */
function readStaticTitle(expression) {
  if (ts.isStringLiteral(expression) ||
      ts.isNoSubstitutionTemplateLiteral(expression)) {
    return expression.text;
  }

  if (ts.isBinaryExpression(expression) &&
      expression.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const left = readStaticTitle(expression.left);
    const right = readStaticTitle(expression.right);

    if (left !== undefined && right !== undefined) {
      return left + right;
    }
  }

  return undefined;
}

/**
 * Collect statically named it(...) and test(...) calls from a source file.
 *
 * @param {string} filePath absolute test file path
 * @return {{file: string, title: string}[]} discovered test cases
 */
function collectFileTests(filePath) {
  const sourceFile = ts.createSourceFile(
    filePath,
    readFileSync(filePath, 'utf8'),
    ts.ScriptTarget.Latest,
    true
  );
  const tests = [];
  const relativeFilePath = path.relative(repositoryRoot, filePath)
    .split(path.sep)
    .join('/');

  /**
   * Visit a TypeScript AST node and collect matching calls.
   *
   * @param {import('typescript').Node} node current AST node
   * @return {void}
   */
  function visit(node) {
    if (ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        (node.expression.text === 'it' || node.expression.text === 'test') &&
        node.arguments.length > 0) {
      const title = readStaticTitle(node.arguments[0]);

      if (title !== undefined) {
        tests.push({ file: relativeFilePath, title });
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);

  return tests;
}

/**
 * Build the sorted test inventory with duplicate occurrences numbered per file.
 *
 * @return {{file: string, title: string, occurrence: number}[]} test inventory
 */
function collectInventory() {
  const tests = testDirectories
    .flatMap(findTestFiles)
    .flatMap(collectFileTests)
    .sort((left, right) =>
      compareStrings(left.file, right.file) ||
      compareStrings(left.title, right.title)
    );
  const occurrences = new Map();

  return tests.map(({ file, title }) => {
    const key = JSON.stringify([file, title]);
    const occurrence = (occurrences.get(key) || 0) + 1;

    occurrences.set(key, occurrence);

    return { file, title, occurrence };
  });
}

/**
 * Create a stable comparison key for an inventory entry.
 *
 * @param {{file: string, title: string, occurrence: number}} entry inventory entry
 * @return {string} serialized key
 */
function inventoryKey(entry) {
  return JSON.stringify([entry.file, entry.title, entry.occurrence]);
}

const unexpectedArguments = process.argv.slice(2).filter(
  argument => argument !== '--write'
);

if (unexpectedArguments.length > 0) {
  process.stderr.write(
    `Unexpected argument(s): ${unexpectedArguments.join(', ')}\n`
  );
  process.exitCode = 1;
} else {
  const inventory = collectInventory();

  if (process.argv.includes('--write')) {
    writeFileSync(inventoryPath, `${JSON.stringify(inventory, null, 2)}\n`);
    process.stdout.write(`Wrote ${inventory.length} test cases to ${inventoryPath}.\n`);
  } else if (!existsSync(inventoryPath)) {
    process.stderr.write(
      `Test inventory snapshot does not exist: ${inventoryPath}\n` +
      'Run this command with --write to create it.\n'
    );
    process.exitCode = 1;
  } else {
    const expectedInventory = JSON.parse(readFileSync(inventoryPath, 'utf8'));
    const currentKeys = new Set(inventory.map(inventoryKey));
    const missingTests = expectedInventory.filter(
      entry => !currentKeys.has(inventoryKey(entry))
    );

    if (missingTests.length > 0) {
      process.stderr.write(
        `Missing ${missingTests.length} test case(s) from the saved inventory:\n`
      );

      for (const entry of missingTests) {
        process.stderr.write(
          `- ${entry.file}: ${entry.title} (occurrence ${entry.occurrence})\n`
        );
      }

      process.exitCode = 1;
    } else {
      process.stdout.write(
        `Verified all ${expectedInventory.length} saved test cases ` +
        `(${inventory.length} currently present).\n`
      );
    }
  }
}
