# Changelog

All notable changes to the ProdigyEMS fork are documented here.

## [1.0.0] - Unreleased

### Breaking

- Require the canonical `resolver(target, options)` API. The positional
  `models`, `requiredFilters`, and resolver-options form is rejected.
- Support Sequelize 6 only.
- Remove resolver `include` support in favor of batching and association
  resolvers.

### Added

- Package-owned TypeScript declarations for the public API.
- Structural enforcement for required authorization filters, including nested
  `AND`, `OR`, and `NOT` expressions.
- An isolated GraphQL 17 runtime-compatibility lane. GraphQL 17 remains outside
  the published peer range while graphql-relay's peer range is capped at
  GraphQL 16.
- Reproducible package verification against the exact npm tarball.

### Fixed

- Export callable CommonJS APIs from the package root.
- Respect zero limits for associations.
- Keep Relay pagination deterministic for eager-loaded associations.
- Normalize null ordering by translating unsupported `NULLS FIRST`/`NULLS LAST`
  syntax for SQL Server and MySQL while preserving native PostgreSQL and SQLite
  syntax.
- Reject unknown filter fields inside arrays and fail closed on malformed
  required-filter configuration.

### Security

- Required filters now have to constrain every satisfiable logical branch.
  Negative operators, ranges, unrelated nested fields, and empty branches
  cannot satisfy the authorization requirement.
- On 2026-07-31, `npm audit --omit=dev` reported zero vulnerabilities. The full
  development graph reported five vulnerable dependency instances: three low
  and two moderate. They arise from two underlying advisories, one affecting
  `diff` through Mocha/Sinon tooling and one affecting `uuid` through
  Sequelize's development dependency path. It reported zero high or critical
  findings.

[1.0.0]: https://github.com/ProdigyEMS/graphql-sequelize/compare/v9.5.1...prodigy-v1.0.0
