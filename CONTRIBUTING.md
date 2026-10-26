# Contributing

Thanks for helping. This guide covers setup, the checks a pull request must pass, and the rules that keep the analysis trustworthy.

Report a vulnerability privately as described in [SECURITY.md](SECURITY.md), never in a public issue.

## Setup

You need Node.js 22.13 or later. The published package runs on Node.js 22 or later, as `engines` in `package.json` says, but the development toolchain, ESLint and Vitest, needs 22.13. CI runs Node 22 and 24.

```bash
npm ci
```

## Layout

```
src/
├── index.ts                 public config helpers only
├── config/define.ts         defineDomain(), lifecycle(), saga(), suppress()
├── analyzer.ts              Finding, Analyzer contract, analyse()
├── analysis.ts              analyzer registry
├── engine/                  project loading, static config reading, errors, value tokens
├── analyzers/lifecycle/     lifecycle extraction and checks
├── analyzers/event-flow/    event, handler and saga extraction and checks
├── rules/                   per-rule levels and suppressions
├── report/                  text, json, sarif, baseline
└── cli/                     init, check, show, context, run, main
```

- The CLI depends only on the `Analyzer` contract. A new analyzer is a new entry in `src/analysis.ts`, not a CLI change.
- `engine/` knows nothing about analyzers, the CLI or reports. The checks under `analyzers/lifecycle/checks/` and the code in `rules/` stay pure and never import ts-morph. ESLint enforces these boundaries.
- `test/fixtures/` holds standalone projects for the end-to-end tests. They are excluded from the root typecheck and lint and must stay so.

## Before you open a pull request

All of these must pass:

```bash
npm test
npm run test:coverage
npm run typecheck
npm run lint
npm run build
npm run test:pack
```

`npm run test:pack` builds and packs the package, checks the tarball with publint and attw, installs it into a temporary project, runs the installed CLI against a copy of `test/fixtures/outside-spec`, loads the installed library entry with `import()` and, from CommonJS, with `require()`, and type-checks that project's `domain.config.ts` against the installed types. Installing the tarball needs access to the npm registry.

`npm run test:coverage` runs the suite with V8 coverage over `src/` and fails when coverage drops below the thresholds in `vitest.config.ts`.

CI runs lint, typecheck, the tests and the build on Ubuntu, Windows and macOS, each with Node 22 and 24; the Ubuntu and Node 24 job runs the tests through `npm run test:coverage`, so the thresholds apply there. `npm run test:pack` runs on Ubuntu with Node 22 and 24. CI also runs the repository's GitHub Action, `action.yml`, against `test/fixtures/outside-spec` and expects exit code `1` and a non-empty SARIF report, so a change to that fixture or to the exit codes breaks CI.

## Tests

- Write the failing test first, then the code that makes it pass.
- Tests describe behaviour, not implementation: one claim per test, arranged as arrange, act, assert.
- If something is hard to test, change the design rather than the test.
- Tests run on Windows and macOS as well as Linux, so keep them portable: build paths with `node:path` instead of joining strings with `/`, compare reported paths in their forward-slash form, and guard tests that depend on POSIX file modes with `HAS_POSIX_FILE_MODES` from `test/helpers/disk.ts`. `.gitattributes` checks every file out with LF line endings.
- In `src/`, compute a reported path with `toPosixRelative` from `src/engine/path.ts`, never with `relative` from `node:path`, so it uses forward slashes on every system. ESLint enforces this.

## No comments

There are no comments anywhere: no `//`, no `/* */` and no JSDoc, in source, tests, fixtures, YAML and README code blocks alike. The only exceptions are bare machine-read directives:

- `// @ts-expect-error`;
- the CLI shebang;
- the HTML markers that `context --write` reads and writes;
- `/** @deprecated Use <new>. */` on deprecated `DomainConfig` keys.

Put the explanation into names, smaller functions and tests instead.

## The analysis rule: unknown never produces a finding

A false positive is the worst failure: it teaches users to ignore the tool. When the analysis cannot interpret something, such as a guard, an escape of `this`, or a library member that might call back into project code, it reports nothing for that method and field.

Large silent detection losses are defects too, so every analysis change is checked in both directions:

1. Probe projects that reproduce the false-finding shapes the change targets. Keep them outside the repository.
2. A re-run of the real-world validation recorded in [docs/validation/real-world.md](docs/validation/real-world.md). Re-run the public repositories the record's Setup section lists, at the commits and with the setup it gives, compare each repository's findings with the recorded counts, triage every difference, and update the record in the same pull request. The maintainer re-runs the private reference repo. If you cannot run the re-run, say so in the pull request.

The README section [Quiet by design](README.md#quiet-by-design) must describe what the analysis actually does. Update it in the same change that alters what the analysis sees.

A ts-morph upgrade changes the bundled TypeScript compiler, so it needs a real-world validation re-run before it merges, even when every test passes.

## The public contract

These are part of the public contract, and changing any of them is a breaking change:

- the config helpers and types exported from `src/index.ts`;
- the shape of `domain.config.ts`;
- the CLI commands and flags;
- the exit codes: `0` clean or warnings only, `1` error findings, `2` a config, project or usage error, or an internal error;
- the JSON report, described by `schema/report.schema.json`, and the SARIF report;
- the baseline format.

Rules that keep it that way:

- `src/index.ts` exports only the config helpers and their types and never imports ts-morph, because the config is type-checked in the user's project.
- The runtime dependencies are `ts-morph` and `commander` only.
- `domain.config.ts` is read statically and never executed.
- User-facing errors are typed, `ConfigError`, `ProjectError` or `UsageError`, and map to exit code `2`. Exit code `1` means error findings and nothing else.
- Avoid `any`, prefer `readonly` types and non-mutating operations.

## Changelog

Record every user-visible change in [CHANGELOG.md](CHANGELOG.md) under `## [Unreleased]`, in the matching subsection such as `### Added`, `### Changed`, `### Deprecated` or `### Fixed`, ending the entry with the pull request number, as in `(#104)`.

## Commits and pull requests

- Commit messages are a subject line only: lowercase, imperative, 2 to 5 words, no conventional-commit prefix and no trailing period, such as `add baseline support` or `fix super lookup`.
- Branch from `main`, and target `main` with the pull request.
- Report a false finding with the false-finding issue form, and link that issue from the pull request that fixes it.
