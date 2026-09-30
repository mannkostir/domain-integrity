# domain-integrity v0.1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `domain-integrity` v0.1: a TypeScript CLI that extracts aggregate lifecycles from code, compares them with a small typed declaration, and fails CI on terminal-state leaks, unreachable states, outside mutations, and transition drift.

**Architecture:** A pure-analysis core built on ts-morph (engine → lifecycle analyzer → checks), exposed through an `Analyzer` contract so later analyzers plug in without touching the CLI. A thin commander-based CLI (`init`, `check`, `show`, `context`) sits on top. The user's `domain.config.ts` is read statically through the type checker and never executed.

**Tech Stack:** Node 20+, TypeScript 5, ts-morph, commander, vitest, tsup, eslint + typescript-eslint.

**Spec:** `docs/superpowers/specs/2026-09-30-domain-integrity-v0.1-design.md`

**Branch:** execute on a feature branch: `git checkout main && git checkout -b feat/v0.1` (there is no remote yet, so there is nothing to pull).

## Global Constraints

- Node `>=20`; analysed projects use TypeScript 5+.
- Single npm package named `domain-integrity`, ESM (`"type": "module"`), CLI binary `domain-integrity`.
- Runtime dependencies: `ts-morph` and `commander` only.
- `src/index.ts` exports only the config helpers and their types; it must never import ts-morph.
- Exit codes: `0` no error-level findings, `1` error-level findings, `2` configuration, project, or usage error.
- `domain.config.ts` is read statically and never executed.
- **Unknown never produces a finding**: when analysis cannot interpret something, it reports nothing for it.
- **Zero comments** in production code and tests: no `//`, `/* */`, or JSDoc. The only allowed exceptions are machine-read directives (`// @ts-expect-error`, the `#!/usr/bin/env node` shebang, and the HTML markers written by `context --write`).
- Prefer `readonly` types and non-mutating operations; mutation stays inside a function's own locals.
- Every commit message ends with the line `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>` (pass it as a second `-m`).

## Deviations from the spec (decided while planning)

1. **State values in the config are typed loosely** (`string | number | boolean`), not as the field's own value type. State usually lives in a `protected props` object, which TypeScript types cannot reach from outside the class. Values are validated during analysis instead; an unknown value is a problem (exit 2). Enum references still give rename safety.
2. **The `Analyzer` contract has four more members** besides extract/suggest/check/diagram: `problems`, `summarize` (for `context`), `isEmpty`, and `rules` (for SARIF).
3. **`unreachable-state` is skipped when the aggregate's creation is unknown**, meaning no constructor assignment, property initializer, or static factory sets the field. This extends "unknown never produces a finding".
4. **Generated imports have no file extension** (`./src/order`). Projects using `NodeNext` module resolution must add `.js` by hand; the README says so.
5. **License: MIT.**

## Review Focus

1. **State stored in `protected props` vs. own fields vs. private fields vs. optional (`?`) fields.** Every form must resolve to the same kinds of state field (tests in Task 4).
2. **`domain.config.ts` at the repository root, outside the tsconfig `include` globs.** This is the common layout, and it must still load (test in Task 2).
3. **Aggregates that extend an intermediate abstract base, or a base class imported from a module that doesn't resolve.** They must still be discovered (tests in Task 4).
4. **Re-running `init` on an existing config.** It must add only undeclared aggregates and keep hand-edited declarations byte-for-byte (test in Task 15).
5. **`context --write` into a file that already has content, with or without markers.** Content outside the markers must survive (tests in Task 14).

## File Structure

```
package.json, tsconfig.json, tsup.config.ts, vitest.config.ts, eslint.config.js, .gitignore, LICENSE, README.md, action.yml
.github/workflows/ci.yml
src/
  index.ts                         public API: config helpers only
  config/define.ts                 defineDomain(), lifecycle(), config types
  analyzer.ts                      Finding, RuleDescription, Analyzer, AnalysisResult, analyse(), findingKey()
  analysis.ts                      runAnalyzers(): the analyzer registry
  engine/errors.ts                 DomainIntegrityError, ConfigError, ProjectError, UsageError
  engine/project.ts                loadProject, configSourceFile, analysedSourceFiles
  engine/value-token.ts            literalToken, isNullish, SET, UNSET
  engine/declaration.ts            resolved declaration types + defaults
  engine/read-config.ts            readDeclaration
  analyzers/lifecycle/
    model.ts                       lifecycle model types
    values.ts                      set helpers, AssignedValues helpers, allTokens
    discover.ts                    discoverAggregates, aggregateName
    state-field.ts                 resolveStateField
    field-ref.ts                   fieldNameOf, isRootedAtThis, thisGetterExpression, referencesField
    guards.ts                      evaluate, methodSources
    assigned.ts                    assignedValue, setsOf
    mutation.ts                    mutatingMethods
    initial.ts                     initialValues
    outside.ts                     outsideAssignments
    candidates.ts                  candidateFields
    extract.ts                     extractLifecycles
    checks/format.ts               labelsOf, quoted, fieldOf
    checks/terminal-state-leak.ts
    checks/unreachable-state.ts
    checks/outside-mutation.ts
    checks/transition-drift.ts
    checks/index.ts                runChecks, LIFECYCLE_RULES
    suggest.ts                     suggestLifecycles
    diagram.ts                     fieldDiagram, lifecycleDiagrams
    summary.ts                     lifecycleSummary
    analyzer.ts                    lifecycleAnalyzer
  report/text.ts, report/json.ts, report/sarif.ts, report/baseline.ts
  cli/io.ts                        Io, Paths, Prompt
  cli/session.ts                   openSession, noAggregatesMessage
  cli/section.ts                   replaceSection
  cli/check.ts, cli/show.ts, cli/context.ts, cli/init.ts, cli/config-writer.ts
  cli/run.ts                       run(argv, io)
  cli/main.ts                      process entry point
test/
  helpers/in-memory.ts, helpers/describe.ts, helpers/model.ts, helpers/disk.ts
  (unit tests mirror src/)
  fixtures/enum-inline, fixtures/boolean-rule, fixtures/nullable-timestamp, fixtures/outside-spec
  e2e/fixtures.test.ts
docs/validation/real-world.md
```

---

### Task 1: Project scaffold and typed config helpers

**Files:**
- Create: `package.json`, `tsconfig.json`, `tsup.config.ts`, `vitest.config.ts`, `eslint.config.js`, `.gitignore`, `src/config/define.ts`, `src/index.ts`
- Test: `test/config/define.test.ts`

**Interfaces:**
- Produces: `defineDomain(config: DomainConfig): DomainConfig`, `lifecycle<T extends object>(target: { readonly prototype: T }, spec: LifecycleSpec<T>): LifecycleDeclaration`, types `StateToken`, `FieldSpec<T>`, `LifecycleSpec<T>`, `LifecycleDeclaration`, `DomainConfig`.

- [ ] **Step 1: Write the package and tool configs**

`package.json`:

```json
{
  "name": "domain-integrity",
  "version": "0.1.0",
  "description": "Checks that a TypeScript domain's aggregate lifecycles match their declared intent.",
  "type": "module",
  "license": "MIT",
  "engines": { "node": ">=20" },
  "bin": { "domain-integrity": "dist/cli.js" },
  "exports": { ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js" } },
  "files": ["dist"],
  "scripts": {
    "build": "tsup",
    "test": "vitest run",
    "typecheck": "tsc --noEmit",
    "lint": "eslint ."
  }
}
```

`tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "types": ["node"],
    "noEmit": true
  },
  "include": ["src", "test", "tsup.config.ts", "vitest.config.ts"],
  "exclude": ["test/fixtures"]
}
```

`tsup.config.ts`:

```ts
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { index: 'src/index.ts', cli: 'src/cli/main.ts' },
  format: ['esm'],
  dts: { entry: { index: 'src/index.ts' } },
  target: 'node20',
  clean: true,
});
```

`vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { include: ['test/**/*.test.ts'], testTimeout: 60_000 },
});
```

`eslint.config.js`:

```js
import tseslint from 'typescript-eslint';

export default tseslint.config({ ignores: ['dist', 'test/fixtures'] }, ...tseslint.configs.recommended);
```

`.gitignore`:

```
node_modules
dist
coverage
```

- [ ] **Step 2: Install dependencies**

Run: `npm install ts-morph commander && npm install -D typescript vitest tsup eslint typescript-eslint @types/node`
Expected: `package.json` gains `dependencies` and `devDependencies`; `package-lock.json` is created.

- [ ] **Step 3: Write the failing test**

`test/config/define.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { defineDomain, lifecycle } from '../../src/index';

enum TicketStatus {
  open = 'OPEN',
  closed = 'CLOSED',
}

class Ticket {
  private constructor(private status: TicketStatus) {}

  static open(): Ticket {
    return new Ticket(TicketStatus.open);
  }

  close(): void {
    this.status = TicketStatus.closed;
  }
}

describe('config helpers', () => {
  it('return the configuration they are given', () => {
    const declaration = lifecycle(Ticket, {
      states: { status: { terminal: [TicketStatus.closed], transitions: { close: [TicketStatus.open] } } },
    });

    expect(defineDomain({ lifecycles: [declaration] })).toEqual({ lifecycles: [declaration] });
  });

  it('accept a single terminal value', () => {
    const declaration = lifecycle(Ticket, { states: { closedAt: { terminal: 'set' } } });

    expect(declaration.kind).toBe('lifecycle');
  });

  it('reject transitions for methods the class does not have', () => {
    const declaration = lifecycle(Ticket, {
      // @ts-expect-error
      states: { status: { terminal: [TicketStatus.closed], transitions: { reopen: [TicketStatus.closed] } } },
    });

    expect(declaration.kind).toBe('lifecycle');
  });

  it('reject allowAfterTerminal entries that are not methods', () => {
    const declaration = lifecycle(Ticket, {
      states: { status: { terminal: [TicketStatus.closed] } },
      // @ts-expect-error
      allowAfterTerminal: ['archive'],
    });

    expect(declaration.kind).toBe('lifecycle');
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npx vitest run test/config/define.test.ts`
Expected: FAIL, cannot resolve `../../src/index`.

- [ ] **Step 5: Write the implementation**

`src/config/define.ts`:

```ts
export type StateToken = string | number | boolean;

type MethodName<T> = {
  [K in keyof T]: T[K] extends (...args: never[]) => unknown ? K : never;
}[keyof T] &
  string;

export type FieldSpec<T> = {
  readonly terminal: StateToken | readonly StateToken[];
  readonly transitions?: Partial<Record<MethodName<T>, readonly StateToken[]>>;
};

export type LifecycleSpec<T> = {
  readonly states: Readonly<Record<string, FieldSpec<T>>>;
  readonly allowAfterTerminal?: readonly MethodName<T>[];
};

export type LifecycleDeclaration = {
  readonly kind: 'lifecycle';
  readonly target: object;
  readonly spec: object;
};

export type DomainConfig = {
  readonly aggregateBaseClasses?: readonly string[];
  readonly auditFields?: readonly string[];
  readonly eventMethods?: readonly string[];
  readonly lifecycles?: readonly LifecycleDeclaration[];
};

export const lifecycle = <T extends object>(
  target: { readonly prototype: T },
  spec: LifecycleSpec<T>,
): LifecycleDeclaration => ({ kind: 'lifecycle', target, spec });

export const defineDomain = (config: DomainConfig): DomainConfig => config;
```

`src/index.ts`:

```ts
export { defineDomain, lifecycle } from './config/define';
export type { DomainConfig, FieldSpec, LifecycleDeclaration, LifecycleSpec, StateToken } from './config/define';
```

- [ ] **Step 6: Run tests and type check**

Run: `npx vitest run test/config/define.test.ts && npm run typecheck && npm run lint`
Expected: 4 tests PASS; `tsc` reports no errors, which proves both `@ts-expect-error` lines are needed; eslint is clean.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: scaffold package and typed config helpers" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Engine: errors, project loading, value tokens, test helper

**Files:**
- Create: `src/engine/errors.ts`, `src/engine/project.ts`, `src/engine/value-token.ts`, `test/helpers/in-memory.ts`
- Test: `test/engine/project.test.ts`, `test/engine/value-token.test.ts`

**Interfaces:**
- Produces:
  - `class DomainIntegrityError extends Error { readonly exitCode: number }` (value 2), plus subclasses `ConfigError`, `ProjectError`, `UsageError`
  - `loadProject(tsconfigPath: string): Project`
  - `configSourceFile(project: Project, configPath: string): SourceFile`
  - `analysedSourceFiles(project: Project, root: string, excluded?: SourceFile): SourceFile[]`
  - `literalToken(type: Type): string | undefined`, `isNullish(type: Type): boolean`, `SET = 'set'`, `UNSET = 'unset'`
  - test helpers `inMemoryProject(files: Readonly<Record<string, string>>): Project` and `AGGREGATE_ROOT: string`

- [ ] **Step 1: Write the test helper**

`test/helpers/in-memory.ts`:

```ts
import { readFileSync } from 'node:fs';
import { ModuleKind, ModuleResolutionKind, Project, ScriptTarget } from 'ts-morph';

const HELPERS_SOURCE = readFileSync(new URL('../../src/config/define.ts', import.meta.url), 'utf8');

export const AGGREGATE_ROOT = `
export abstract class AggregateRoot<P extends object = object> {
  protected props: P;
  private events: object[] = [];

  constructor(props: P) {
    this.props = props;
  }

  protected addEvent(event: object): void {
    this.events.push(event);
  }
}
`;

export const inMemoryProject = (files: Readonly<Record<string, string>>): Project => {
  const project = new Project({
    useInMemoryFileSystem: true,
    compilerOptions: {
      strict: true,
      target: ScriptTarget.ES2022,
      module: ModuleKind.ESNext,
      moduleResolution: ModuleResolutionKind.Bundler,
      baseUrl: '/',
      paths: { 'domain-integrity': ['/lib/domain-integrity.ts'] },
    },
  });
  project.createSourceFile('/lib/domain-integrity.ts', HELPERS_SOURCE);
  Object.entries(files).forEach(([path, text]) => project.createSourceFile(path, text));
  return project;
};
```

- [ ] **Step 2: Write the failing tests**

`test/engine/project.test.ts`:

```ts
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ConfigError, ProjectError } from '../../src/engine/errors';
import { analysedSourceFiles, configSourceFile, loadProject } from '../../src/engine/project';
import { inMemoryProject } from '../helpers/in-memory';

const projectWithRootConfig = (): string => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'domain-integrity-')));
  mkdirSync(join(dir, 'src'));
  writeFileSync(join(dir, 'tsconfig.json'), JSON.stringify({ compilerOptions: { strict: true }, include: ['src'] }));
  writeFileSync(join(dir, 'src', 'a.ts'), 'export const a = 1;\n');
  writeFileSync(join(dir, 'domain.config.ts'), 'export default {};\n');
  return dir;
};

describe('loadProject', () => {
  it('fails with a ProjectError when the tsconfig does not exist', () => {
    expect(() => loadProject('/definitely/missing/tsconfig.json')).toThrow(ProjectError);
  });
});

describe('configSourceFile', () => {
  it('loads a config that lives outside the tsconfig include globs', () => {
    const dir = projectWithRootConfig();
    const project = loadProject(join(dir, 'tsconfig.json'));

    expect(configSourceFile(project, join(dir, 'domain.config.ts')).getFilePath()).toBe(join(dir, 'domain.config.ts'));
  });

  it('fails with a ConfigError that suggests init when the config does not exist', () => {
    const dir = projectWithRootConfig();
    const project = loadProject(join(dir, 'tsconfig.json'));

    expect(() => configSourceFile(project, join(dir, 'missing.config.ts'))).toThrow(/domain-integrity init/);
  });

  it('uses ConfigError for a missing config', () => {
    const project = inMemoryProject({});

    expect(() => configSourceFile(project, '/domain.config.ts')).toThrow(ConfigError);
  });
});

describe('analysedSourceFiles', () => {
  it('keeps only project files under the root and leaves out the config', () => {
    const project = inMemoryProject({
      '/app/src/a.ts': 'export const a = 1;',
      '/app/domain.config.ts': 'export default {};',
      '/other/b.ts': 'export const b = 2;',
    });
    const config = project.getSourceFileOrThrow('/app/domain.config.ts');

    expect(analysedSourceFiles(project, '/app', config).map((file) => file.getFilePath())).toEqual(['/app/src/a.ts']);
  });
});
```

`test/engine/value-token.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { literalToken } from '../../src/engine/value-token';
import { inMemoryProject } from '../helpers/in-memory';

const project = inMemoryProject({
  '/values.ts': `
export enum Named { a = 'A', b = 'B' }
export enum Numbered { x, y }
export const named = Named.b;
export const numbered = Numbered.y;
export const text = 'hello' as const;
export const flag = true as const;
export const date = new Date();
`,
});

const typeOf = (name: string) =>
  project.getSourceFileOrThrow('/values.ts').getVariableDeclarationOrThrow(name).getInitializerOrThrow().getType();

describe('literalToken', () => {
  it.each([
    ['named', 'B'],
    ['numbered', '1'],
    ['text', 'hello'],
    ['flag', 'true'],
  ])('turns the literal type of %s into %s', (name, token) => {
    expect(literalToken(typeOf(name))).toBe(token);
  });

  it('returns undefined for a non-literal type', () => {
    expect(literalToken(typeOf('date'))).toBeUndefined();
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run test/engine`
Expected: FAIL, cannot resolve `../../src/engine/errors`.

- [ ] **Step 4: Write the implementation**

`src/engine/errors.ts`:

```ts
export class DomainIntegrityError extends Error {
  readonly exitCode: number = 2;
}

export class ConfigError extends DomainIntegrityError {
  override readonly name = 'ConfigError';
}

export class ProjectError extends DomainIntegrityError {
  override readonly name = 'ProjectError';
}

export class UsageError extends DomainIntegrityError {
  override readonly name = 'UsageError';
}
```

`src/engine/project.ts`:

```ts
import { existsSync } from 'node:fs';
import { Project, SourceFile } from 'ts-morph';
import { ConfigError, ProjectError } from './errors';

export const loadProject = (tsconfigPath: string): Project => {
  if (!existsSync(tsconfigPath)) throw new ProjectError(`tsconfig not found: ${tsconfigPath}`);
  try {
    return new Project({ tsConfigFilePath: tsconfigPath });
  } catch (error) {
    throw new ProjectError(`Cannot load ${tsconfigPath}: ${error instanceof Error ? error.message : String(error)}`);
  }
};

export const configSourceFile = (project: Project, configPath: string): SourceFile => {
  const loaded = project.getSourceFile(configPath);
  if (loaded) return loaded;
  if (!project.getFileSystem().fileExistsSync(configPath)) {
    throw new ConfigError(`${configPath} not found. Run "domain-integrity init" to create it.`);
  }
  return project.addSourceFileAtPath(configPath);
};

const asDirectoryPrefix = (root: string): string => {
  const normalised = root.replace(/\\/g, '/');
  return normalised.endsWith('/') ? normalised : `${normalised}/`;
};

export const analysedSourceFiles = (project: Project, root: string, excluded?: SourceFile): SourceFile[] => {
  const prefix = asDirectoryPrefix(root);
  return project
    .getSourceFiles()
    .filter(
      (file) =>
        file !== excluded &&
        !file.isDeclarationFile() &&
        !file.isInNodeModules() &&
        file.getFilePath().startsWith(prefix),
    );
};
```

`src/engine/value-token.ts`:

```ts
import { Type } from 'ts-morph';

export const SET = 'set';
export const UNSET = 'unset';

export const literalToken = (type: Type): string | undefined => {
  if (type.isBooleanLiteral()) return type.getText();
  const value = type.getLiteralValue();
  return typeof value === 'string' || typeof value === 'number' ? String(value) : undefined;
};

export const isNullish = (type: Type): boolean => type.isNull() || type.isUndefined();
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run test/engine && npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: add engine project loading, errors and value tokens" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Static config reader

**Files:**
- Create: `src/engine/declaration.ts`, `src/engine/read-config.ts`
- Test: `test/engine/read-config.test.ts`

**Interfaces:**
- Consumes: `ConfigError` (Task 2), `literalToken`, `SET`, `UNSET` (Task 2).
- Produces:

```ts
type DeclaredField = { readonly name: string; readonly terminal: readonly string[]; readonly transitions: ReadonlyMap<string, readonly string[]> | undefined };
type DeclaredLifecycle = { readonly target: ClassDeclaration; readonly fields: readonly DeclaredField[]; readonly allowAfterTerminal: readonly string[] };
type DomainDeclaration = { readonly aggregateBaseClasses: readonly string[]; readonly auditFields: readonly string[]; readonly eventMethods: readonly string[]; readonly lifecycles: readonly DeclaredLifecycle[] };
const DEFAULT_DECLARATION: DomainDeclaration;
readDeclaration(file: SourceFile): DomainDeclaration;
```

- [ ] **Step 1: Write the failing test**

`test/engine/read-config.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { ConfigError } from '../../src/engine/errors';
import { readDeclaration } from '../../src/engine/read-config';
import { AGGREGATE_ROOT, inMemoryProject } from '../helpers/in-memory';

const DOMAIN = {
  '/src/aggregate-root.ts': AGGREGATE_ROOT,
  '/src/order.ts': `
import { AggregateRoot } from './aggregate-root';
export enum OrderStatus { pending = 'PENDING', cancelled = 'CANCELLED' }
export class Order extends AggregateRoot<{ status: OrderStatus }> {
  cancel(): void { this.props.status = OrderStatus.cancelled; }
}
`,
};

const read = (config: string) => {
  const project = inMemoryProject({ ...DOMAIN, '/domain.config.ts': config });
  return readDeclaration(project.getSourceFileOrThrow('/domain.config.ts'));
};

describe('readDeclaration', () => {
  it('applies defaults when optional lists are omitted', () => {
    const declaration = read(`
import { defineDomain } from 'domain-integrity';
export default defineDomain({});
`);

    expect(declaration).toEqual({
      aggregateBaseClasses: ['AggregateRoot', 'Entity'],
      auditFields: ['createdAt', 'updatedAt', 'version'],
      eventMethods: ['addEvent', 'addDomainEvent', 'apply'],
      lifecycles: [],
    });
  });

  it('resolves the class, enum values, transitions and exemptions of a lifecycle', () => {
    const [order] = read(`
import { defineDomain, lifecycle } from 'domain-integrity';
import { Order, OrderStatus } from './src/order';
export default defineDomain({
  lifecycles: [lifecycle(Order, { states: { status: { terminal: [OrderStatus.cancelled], transitions: { cancel: [OrderStatus.pending] } } }, allowAfterTerminal: ['cancel'] })],
});
`).lifecycles;

    expect({
      target: order?.target.getName(),
      fields: order?.fields,
      allowAfterTerminal: order?.allowAfterTerminal,
    }).toEqual({
      target: 'Order',
      fields: [{ name: 'status', terminal: ['CANCELLED'], transitions: new Map([['cancel', ['PENDING']]]) }],
      allowAfterTerminal: ['cancel'],
    });
  });

  it('reads single terminal values for nullable and boolean fields', () => {
    const [order] = read(`
import { defineDomain, lifecycle } from 'domain-integrity';
import { Order } from './src/order';
export default defineDomain({
  lifecycles: [lifecycle(Order, { states: { closedAt: { terminal: 'set' }, archived: { terminal: true } } })],
});
`).lifecycles;

    expect(order?.fields.map((field) => field.terminal)).toEqual([['set'], ['true']]);
  });

  it('reports type errors in the config as a ConfigError', () => {
    expect(() =>
      read(`
import { defineDomain, lifecycle } from 'domain-integrity';
import { Order, OrderStatus } from './src/order';
export default defineDomain({
  lifecycles: [lifecycle(Order, { states: { status: { terminal: [OrderStatus.cancelled], transitions: { reopen: [] } } } })],
});
`),
    ).toThrow(/Type errors in domain.config.ts/);
  });

  it('requires a default export of defineDomain', () => {
    expect(() => read('export default {};')).toThrow(ConfigError);
  });

  it('rejects syntax it cannot read statically, with the line', () => {
    expect(() =>
      read(`
import { defineDomain } from 'domain-integrity';
const lifecycles = [] as const;
export default defineDomain({ lifecycles });
`),
    ).toThrow(/domain.config.ts:4/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/engine/read-config.test.ts`
Expected: FAIL, cannot resolve `../../src/engine/read-config`.

- [ ] **Step 3: Write the implementation**

`src/engine/declaration.ts`:

```ts
import { ClassDeclaration } from 'ts-morph';

export type DeclaredField = {
  readonly name: string;
  readonly terminal: readonly string[];
  readonly transitions: ReadonlyMap<string, readonly string[]> | undefined;
};

export type DeclaredLifecycle = {
  readonly target: ClassDeclaration;
  readonly fields: readonly DeclaredField[];
  readonly allowAfterTerminal: readonly string[];
};

export type DomainDeclaration = {
  readonly aggregateBaseClasses: readonly string[];
  readonly auditFields: readonly string[];
  readonly eventMethods: readonly string[];
  readonly lifecycles: readonly DeclaredLifecycle[];
};

export const DEFAULT_DECLARATION: DomainDeclaration = {
  aggregateBaseClasses: ['AggregateRoot', 'Entity'],
  auditFields: ['createdAt', 'updatedAt', 'version'],
  eventMethods: ['addEvent', 'addDomainEvent', 'apply'],
  lifecycles: [],
};
```

`src/engine/read-config.ts`:

```ts
import {
  CallExpression,
  ClassDeclaration,
  Expression,
  Node,
  ObjectLiteralExpression,
  PropertyAssignment,
  SourceFile,
  ts,
} from 'ts-morph';
import { DEFAULT_DECLARATION, DeclaredField, DeclaredLifecycle, DomainDeclaration } from './declaration';
import { ConfigError } from './errors';
import { SET, UNSET, literalToken } from './value-token';

const unsupported = (node: Node, what: string): ConfigError =>
  new ConfigError(
    `domain.config.ts:${node.getStartLineNumber()} ${what}. Use literal objects, arrays and direct references.`,
  );

const assertNoTypeErrors = (file: SourceFile): void => {
  const errors = file
    .getPreEmitDiagnostics()
    .filter((diagnostic) => diagnostic.getCategory() === ts.DiagnosticCategory.Error);
  if (errors.length === 0) return;
  const lines = errors.map(
    (diagnostic) =>
      `domain.config.ts:${diagnostic.getLineNumber() ?? '?'} ${ts.flattenDiagnosticMessageText(diagnostic.compilerObject.messageText, '\n')}`,
  );
  throw new ConfigError(`Type errors in domain.config.ts:\n${lines.join('\n')}`);
};

const callNamed = (node: Node | undefined, name: string): CallExpression | undefined =>
  Node.isCallExpression(node) && node.getExpression().getText() === name ? node : undefined;

const objectArgument = (call: CallExpression, index: number): ObjectLiteralExpression => {
  const argument = call.getArguments()[index];
  if (!Node.isObjectLiteralExpression(argument)) {
    throw unsupported(call, `argument ${index + 1} of ${call.getExpression().getText()}() must be an object literal`);
  }
  return argument;
};

const propertyName = (property: PropertyAssignment): string => {
  const nameNode = property.getNameNode();
  return Node.isStringLiteral(nameNode) ? nameNode.getLiteralText() : nameNode.getText();
};

const properties = (object: ObjectLiteralExpression): PropertyAssignment[] =>
  object.getProperties().map((property) => {
    if (!Node.isPropertyAssignment(property)) throw unsupported(property, 'only plain "key: value" properties are supported');
    return property;
  });

const valueOf = (object: ObjectLiteralExpression, name: string): Expression | undefined =>
  properties(object)
    .find((property) => propertyName(property) === name)
    ?.getInitializerOrThrow();

const arrayElements = (expression: Expression): Expression[] => {
  if (!Node.isArrayLiteralExpression(expression)) throw unsupported(expression, 'expected an array literal');
  return expression.getElements();
};

const stringList = (expression: Expression | undefined, fallback: readonly string[]): readonly string[] =>
  expression === undefined
    ? fallback
    : arrayElements(expression).map((element) => {
        if (!Node.isStringLiteral(element)) throw unsupported(element, 'expected a string literal');
        return element.getLiteralText();
      });

const valueToken = (expression: Expression): string => {
  if (Node.isStringLiteral(expression) && [SET, UNSET].includes(expression.getLiteralText())) {
    return expression.getLiteralText();
  }
  const token = literalToken(expression.getType());
  if (token === undefined) throw unsupported(expression, `cannot resolve "${expression.getText()}" to a literal state value`);
  return token;
};

const tokens = (expression: Expression): readonly string[] =>
  Node.isArrayLiteralExpression(expression) ? expression.getElements().map(valueToken) : [valueToken(expression)];

const readTransitions = (expression: Expression): ReadonlyMap<string, readonly string[]> => {
  if (!Node.isObjectLiteralExpression(expression)) throw unsupported(expression, '"transitions" must be an object literal');
  return new Map(properties(expression).map((property) => [propertyName(property), tokens(property.getInitializerOrThrow())]));
};

const readField = (field: PropertyAssignment): DeclaredField => {
  const spec = field.getInitializerOrThrow();
  if (!Node.isObjectLiteralExpression(spec)) throw unsupported(spec, 'a state field spec must be an object literal');
  const terminal = valueOf(spec, 'terminal');
  if (terminal === undefined) throw unsupported(spec, `state field "${propertyName(field)}" needs "terminal"`);
  const transitions = valueOf(spec, 'transitions');
  return {
    name: propertyName(field),
    terminal: tokens(terminal),
    transitions: transitions === undefined ? undefined : readTransitions(transitions),
  };
};

const targetClass = (call: CallExpression): ClassDeclaration => {
  const [target] = call.getArguments();
  const declaration = Node.isIdentifier(target)
    ? target.getDefinitionNodes().find((node) => Node.isClassDeclaration(node))
    : undefined;
  if (!Node.isClassDeclaration(declaration)) {
    throw unsupported(call, 'the first argument of lifecycle() must be an imported class');
  }
  return declaration;
};

const readLifecycle = (element: Expression): DeclaredLifecycle => {
  const call = callNamed(element, 'lifecycle');
  if (!call) throw unsupported(element, 'each entry of "lifecycles" must be a lifecycle(...) call');
  const spec = objectArgument(call, 1);
  const states = valueOf(spec, 'states');
  if (!Node.isObjectLiteralExpression(states)) throw unsupported(spec, '"states" must be an object literal');
  return {
    target: targetClass(call),
    fields: properties(states).map(readField),
    allowAfterTerminal: stringList(valueOf(spec, 'allowAfterTerminal'), []),
  };
};

export const readDeclaration = (file: SourceFile): DomainDeclaration => {
  assertNoTypeErrors(file);
  const exported = file.getExportAssignment((assignment) => !assignment.isExportEquals());
  const call = callNamed(exported?.getExpression(), 'defineDomain');
  if (!call) throw new ConfigError('domain.config.ts must "export default defineDomain({...})".');
  const config = objectArgument(call, 0);
  const lifecycles = valueOf(config, 'lifecycles');
  return {
    aggregateBaseClasses: stringList(valueOf(config, 'aggregateBaseClasses'), DEFAULT_DECLARATION.aggregateBaseClasses),
    auditFields: stringList(valueOf(config, 'auditFields'), DEFAULT_DECLARATION.auditFields),
    eventMethods: stringList(valueOf(config, 'eventMethods'), DEFAULT_DECLARATION.eventMethods),
    lifecycles: lifecycles === undefined ? [] : arrayElements(lifecycles).map(readLifecycle),
  };
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/engine/read-config.test.ts && npm run typecheck`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: read domain.config.ts statically" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Lifecycle model, state field resolution, aggregate discovery

**Files:**
- Create: `src/analyzers/lifecycle/model.ts`, `src/analyzers/lifecycle/values.ts`, `src/analyzers/lifecycle/discover.ts`, `src/analyzers/lifecycle/state-field.ts`, `test/helpers/describe.ts`
- Test: `test/analyzers/lifecycle/state-field.test.ts`, `test/analyzers/lifecycle/discover.test.ts`

**Interfaces:**
- Consumes: `literalToken`, `isNullish`, `SET`, `UNSET` (Task 2).
- Produces (`model.ts`):

```ts
export type StateFieldKind = 'enum' | 'union' | 'boolean' | 'nullable';
export type StateValue = { readonly token: string; readonly label: string; readonly source: string };
export type EnumReference = { readonly name: string; readonly file: string };
export type StateField = { readonly name: string; readonly kind: StateFieldKind; readonly values: readonly StateValue[]; readonly enumReference: EnumReference | undefined };
export type Sources = { readonly kind: 'known'; readonly values: ReadonlySet<string> } | { readonly kind: 'unknown' };
export type AssignedValues = { readonly tokens: ReadonlySet<string>; readonly unresolved: boolean };
export type FieldBehaviour = { readonly sources: Sources; readonly sets: AssignedValues };
export type MethodModel = { readonly name: string; readonly file: string; readonly line: number; readonly mutates: boolean; readonly fields: ReadonlyMap<string, FieldBehaviour> };
export type OutsideAssignment = { readonly field: string; readonly file: string; readonly line: number; readonly scope: string; readonly value: AssignedValues };
export type FieldDeclaration = { readonly terminal: ReadonlySet<string>; readonly transitions: ReadonlyMap<string, ReadonlySet<string>> | undefined };
export type AggregateModel = { readonly name: string; readonly file: string; readonly line: number; readonly declared: boolean; readonly fields: readonly StateField[]; readonly declarations: ReadonlyMap<string, FieldDeclaration>; readonly allowAfterTerminal: ReadonlySet<string>; readonly methods: readonly MethodModel[]; readonly initial: ReadonlyMap<string, AssignedValues>; readonly outside: readonly OutsideAssignment[] };
export type LifecycleModel = { readonly aggregates: readonly AggregateModel[]; readonly problems: readonly string[] };
```

- Produces (`values.ts`): `intersect`, `union`, `difference` (all `<T>(a: ReadonlySet<T>, b: ReadonlySet<T>) => ReadonlySet<T>`, preserving `a`'s order), `allTokens(field: StateField): ReadonlySet<string>`, `NOTHING_ASSIGNED`, `UNRESOLVED`, `mergeAssigned(values: readonly AssignedValues[]): AssignedValues`, `assignsAnything(value: AssignedValues): boolean`.
- Produces: `discoverAggregates(files: readonly SourceFile[], baseClasses: readonly string[], declared: readonly ClassDeclaration[]): ClassDeclaration[]`, `aggregateName(cls: ClassDeclaration): string`.
- Produces: `resolveStateField(cls: ClassDeclaration, name: string): FieldResolution`, where `FieldResolution = { readonly kind: 'resolved'; readonly field: StateField } | { readonly kind: 'problem'; readonly message: string }`.
- Produces (test helper): `resolvedField(cls, name): StateField`, `describeSources(sources): readonly string[] | 'unknown'`, `describeAssigned(value): { tokens: string[]; unresolved: boolean }`.

- [ ] **Step 1: Write the model and value helpers**

`src/analyzers/lifecycle/model.ts`: write exactly the types listed in **Interfaces** above, each on its own `export type` line.

`src/analyzers/lifecycle/values.ts`:

```ts
import { AssignedValues, StateField } from './model';

export const intersect = <T>(a: ReadonlySet<T>, b: ReadonlySet<T>): ReadonlySet<T> =>
  new Set([...a].filter((item) => b.has(item)));

export const union = <T>(a: ReadonlySet<T>, b: ReadonlySet<T>): ReadonlySet<T> => new Set([...a, ...b]);

export const difference = <T>(a: ReadonlySet<T>, b: ReadonlySet<T>): ReadonlySet<T> =>
  new Set([...a].filter((item) => !b.has(item)));

export const allTokens = (field: StateField): ReadonlySet<string> => new Set(field.values.map((value) => value.token));

export const NOTHING_ASSIGNED: AssignedValues = { tokens: new Set(), unresolved: false };

export const UNRESOLVED: AssignedValues = { tokens: new Set(), unresolved: true };

export const mergeAssigned = (values: readonly AssignedValues[]): AssignedValues => ({
  tokens: new Set(values.flatMap((value) => [...value.tokens])),
  unresolved: values.some((value) => value.unresolved),
});

export const assignsAnything = (value: AssignedValues): boolean => value.tokens.size > 0 || value.unresolved;
```

- [ ] **Step 2: Write the failing tests**

`test/helpers/describe.ts`:

```ts
import { ClassDeclaration } from 'ts-morph';
import { AssignedValues, Sources, StateField } from '../../src/analyzers/lifecycle/model';
import { resolveStateField } from '../../src/analyzers/lifecycle/state-field';

export const resolvedField = (cls: ClassDeclaration, name: string): StateField => {
  const resolution = resolveStateField(cls, name);
  if (resolution.kind === 'problem') throw new Error(resolution.message);
  return resolution.field;
};

export const describeSources = (sources: Sources): readonly string[] | 'unknown' =>
  sources.kind === 'unknown' ? 'unknown' : [...sources.values].sort();

export const describeAssigned = (value: AssignedValues): { tokens: string[]; unresolved: boolean } => ({
  tokens: [...value.tokens].sort(),
  unresolved: value.unresolved,
});
```

`test/analyzers/lifecycle/state-field.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { resolveStateField } from '../../../src/analyzers/lifecycle/state-field';
import { AGGREGATE_ROOT, inMemoryProject } from '../../helpers/in-memory';

const project = inMemoryProject({
  '/src/aggregate-root.ts': AGGREGATE_ROOT,
  '/src/samples.ts': `
import { AggregateRoot } from './aggregate-root';
export enum Status { open = 'OPEN', closed = 'CLOSED' }
export enum Priority { low, high }
export class InProps extends AggregateRoot<{ status: Status; closedAt: Date | null; archivedAt?: Date; note: string }> {}
export class OwnFields extends AggregateRoot {
  private deleted = false;
  phase: 'draft' | 'live' = 'draft';
  priority: Priority = Priority.low;
  maybe: boolean | null = null;
}
`,
});

const cls = (name: string) => project.getSourceFileOrThrow('/src/samples.ts').getClassOrThrow(name);

describe('resolveStateField', () => {
  it('resolves an enum field stored in props with labels and source text', () => {
    expect(resolveStateField(cls('InProps'), 'status')).toEqual({
      kind: 'resolved',
      field: {
        name: 'status',
        kind: 'enum',
        values: [
          { token: 'OPEN', label: 'open', source: 'Status.open' },
          { token: 'CLOSED', label: 'closed', source: 'Status.closed' },
        ],
        enumReference: { name: 'Status', file: '/src/samples.ts' },
      },
    });
  });

  it.each([
    ['InProps', 'closedAt'],
    ['InProps', 'archivedAt'],
  ])('resolves %s.%s as a nullable field', (className, field) => {
    expect(resolveStateField(cls(className), field)).toMatchObject({
      kind: 'resolved',
      field: { kind: 'nullable', values: [{ token: 'set' }, { token: 'unset' }] },
    });
  });

  it('resolves a private boolean field', () => {
    expect(resolveStateField(cls('OwnFields'), 'deleted')).toMatchObject({
      kind: 'resolved',
      field: { kind: 'boolean', values: [{ token: 'true', source: 'true' }, { token: 'false', source: 'false' }] },
    });
  });

  it('resolves a string literal union with quoted sources', () => {
    expect(resolveStateField(cls('OwnFields'), 'phase')).toMatchObject({
      kind: 'resolved',
      field: { kind: 'union', values: [{ token: 'draft', source: "'draft'" }, { token: 'live', source: "'live'" }] },
    });
  });

  it('resolves a numeric enum with member names as labels', () => {
    expect(resolveStateField(cls('OwnFields'), 'priority')).toMatchObject({
      kind: 'resolved',
      field: { kind: 'enum', values: [{ token: '0', label: 'low' }, { token: '1', label: 'high' }] },
    });
  });

  it.each([
    ['InProps', 'note'],
    ['OwnFields', 'maybe'],
  ])('reports %s.%s as an unsupported type', (className, field) => {
    expect(resolveStateField(cls(className), field)).toMatchObject({ kind: 'problem', message: expect.stringContaining('unsupported type') });
  });

  it('reports a field that does not exist', () => {
    expect(resolveStateField(cls('InProps'), 'missing')).toEqual({ kind: 'problem', message: 'InProps has no field "missing"' });
  });
});
```

`test/analyzers/lifecycle/discover.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { discoverAggregates } from '../../../src/analyzers/lifecycle/discover';
import { AGGREGATE_ROOT, inMemoryProject } from '../../helpers/in-memory';

const project = inMemoryProject({
  '/src/base.ts': `${AGGREGATE_ROOT}\nexport abstract class Versioned<P extends object> extends AggregateRoot<P> {}\n`,
  '/src/aggregates.ts': `
import { AggregateRoot, Versioned } from './base';
export class Direct extends AggregateRoot {}
export class Indirect extends Versioned<{ a: number }> {}
export class Plain {}
`,
  '/src/external.ts': `
import { AggregateRoot } from '@unresolved/ddd';
export class External extends AggregateRoot {}
`,
});

const files = project.getSourceFiles();
const names = (classes: { getName(): string | undefined }[]) => classes.map((cls) => cls.getName()).sort();

describe('discoverAggregates', () => {
  it('finds direct, transitive and unresolved-base subclasses but not abstract or plain classes', () => {
    expect(names(discoverAggregates(files, ['AggregateRoot'], []))).toEqual(['Direct', 'External', 'Indirect']);
  });

  it('includes declared classes that extend no known base', () => {
    const plain = project.getSourceFileOrThrow('/src/aggregates.ts').getClassOrThrow('Plain');

    expect(names(discoverAggregates(files, ['AggregateRoot'], [plain]))).toEqual(['Direct', 'External', 'Indirect', 'Plain']);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run test/analyzers/lifecycle`
Expected: FAIL, cannot resolve `state-field` / `discover`.

- [ ] **Step 4: Write the implementation**

`src/analyzers/lifecycle/discover.ts`:

```ts
import { ClassDeclaration, SourceFile, SyntaxKind } from 'ts-morph';

export const aggregateName = (cls: ClassDeclaration): string => cls.getName() ?? '<anonymous>';

const extendsNamed = (cls: ClassDeclaration, names: ReadonlySet<string>, seen: ReadonlySet<ClassDeclaration>): boolean => {
  const heritage = cls.getExtends();
  if (!heritage || seen.has(cls)) return false;
  const baseName = heritage.getExpression().getText().split('.').pop() ?? '';
  if (names.has(baseName)) return true;
  const base = cls.getBaseClass();
  return base !== undefined && extendsNamed(base, names, new Set([...seen, cls]));
};

export const discoverAggregates = (
  files: readonly SourceFile[],
  baseClasses: readonly string[],
  declared: readonly ClassDeclaration[],
): ClassDeclaration[] => {
  const names = new Set(baseClasses);
  const discovered = files
    .flatMap((file) => file.getDescendantsOfKind(SyntaxKind.ClassDeclaration))
    .filter((cls) => !cls.isAbstract() && extendsNamed(cls, names, new Set()));
  return [...new Set([...declared, ...discovered])];
};
```

`src/analyzers/lifecycle/state-field.ts`:

```ts
import { ClassDeclaration, Node, Type } from 'ts-morph';
import { SET, UNSET, isNullish, literalToken } from '../../engine/value-token';
import { aggregateName } from './discover';
import { EnumReference, StateField, StateFieldKind, StateValue } from './model';

export type FieldResolution =
  | { readonly kind: 'resolved'; readonly field: StateField }
  | { readonly kind: 'problem'; readonly message: string };

const SUPPORTED = 'supported state types are an enum, a string or number literal union, boolean, and a nullable non-literal type such as Date | null (requires strictNullChecks)';

const fieldType = (cls: ClassDeclaration, name: string): Type | undefined => {
  const own = cls.getType().getProperty(name);
  if (own) return own.getTypeAtLocation(cls);
  const props = cls.getType().getProperty('props');
  return props?.getTypeAtLocation(cls).getProperty(name)?.getTypeAtLocation(cls);
};

const resolved = (
  name: string,
  kind: StateFieldKind,
  values: readonly StateValue[],
  enumReference: EnumReference | undefined = undefined,
): FieldResolution => ({ kind: 'resolved', field: { name, kind, values, enumReference } });

const enumMember = (type: Type) => type.getSymbol()?.getDeclarations().find((node) => Node.isEnumMember(node));

const enumValue = (type: Type): StateValue => {
  const member = enumMember(type);
  const token = literalToken(type) ?? type.getText();
  if (!Node.isEnumMember(member)) return { token, label: token, source: type.getText() };
  return { token, label: member.getName(), source: `${member.getParent().getName()}.${member.getName()}` };
};

const enumReferenceOf = (type: Type): EnumReference | undefined => {
  const member = enumMember(type);
  if (!Node.isEnumMember(member)) return undefined;
  const declaration = member.getParent();
  return { name: declaration.getName(), file: declaration.getSourceFile().getFilePath() };
};

const literalSource = (token: string, type: Type): string => (type.isNumberLiteral() ? token : `'${token.replace(/'/g, "\\'")}'`);

const literalValue = (type: Type): StateValue => {
  const token = literalToken(type) ?? type.getText();
  return { token, label: token, source: literalSource(token, type) };
};

const BOOLEAN_VALUES: readonly StateValue[] = [
  { token: 'true', label: 'true', source: 'true' },
  { token: 'false', label: 'false', source: 'false' },
];

const NULLABLE_VALUES: readonly StateValue[] = [
  { token: SET, label: SET, source: `'${SET}'` },
  { token: UNSET, label: UNSET, source: `'${UNSET}'` },
];

export const resolveStateField = (cls: ClassDeclaration, name: string): FieldResolution => {
  const type = fieldType(cls, name);
  if (!type) return { kind: 'problem', message: `${aggregateName(cls)} has no field "${name}"` };
  const members = type.isUnion() ? type.getUnionTypes() : [type];
  const present = members.filter((member) => !isNullish(member));
  const nullable = present.length < members.length;
  if (!nullable && present.length > 0 && present.every((member) => member.isBooleanLiteral())) {
    return resolved(name, 'boolean', BOOLEAN_VALUES);
  }
  if (!nullable && present.length > 0 && present.every((member) => member.isEnumLiteral())) {
    return resolved(name, 'enum', present.map(enumValue), enumReferenceOf(present[0] as Type));
  }
  if (!nullable && present.length > 0 && present.every((member) => member.isStringLiteral() || member.isNumberLiteral())) {
    return resolved(name, 'union', present.map(literalValue));
  }
  if (nullable && present.length > 0 && present.every((member) => literalToken(member) === undefined)) {
    return resolved(name, 'nullable', NULLABLE_VALUES);
  }
  return {
    kind: 'problem',
    message: `${aggregateName(cls)}.${name} has unsupported type "${type.getText()}"; ${SUPPORTED}`,
  };
};
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run test/analyzers/lifecycle && npm run typecheck && npm run lint`
Expected: PASS. If `type.getText()` for the enum prints a fully qualified name such as `import("/src/samples").Status.open`, then the `enumValue` fallback path ran because `enumMember` found nothing; debug `enumMember` rather than changing the test.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: resolve state fields and discover aggregates" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Guard normalisation

**Files:**
- Create: `src/analyzers/lifecycle/field-ref.ts`, `src/analyzers/lifecycle/guards.ts`
- Test: `test/analyzers/lifecycle/guards.test.ts`

**Interfaces:**
- Consumes: `StateField`, `Sources` (Task 4), `allTokens`, `intersect`, `union`, `difference` (Task 4), `literalToken`, `SET`, `UNSET` (Task 2).
- Produces:
  - `fieldNameOf(node: Node): string | undefined`: `this.x` or `this.props.x` gives `'x'`
  - `isRootedAtThis(node: Node): boolean`
  - `thisGetterExpression(node: Node, cls: ClassDeclaration): Expression | undefined`
  - `referencesField(node: Node, field: string, cls: ClassDeclaration, depth?: number): boolean`
  - `methodSources(method: MethodDeclaration, field: StateField, cls: ClassDeclaration): Sources`

- [ ] **Step 1: Write the failing test**

`test/analyzers/lifecycle/guards.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { methodSources } from '../../../src/analyzers/lifecycle/guards';
import { describeSources, resolvedField } from '../../helpers/describe';
import { AGGREGATE_ROOT, inMemoryProject } from '../../helpers/in-memory';

const project = inMemoryProject({
  '/src/aggregate-root.ts': AGGREGATE_ROOT,
  '/src/ticket.ts': `
import { AggregateRoot } from './aggregate-root';
export enum Status { draft = 'DRAFT', open = 'OPEN', closed = 'CLOSED' }
class Rules {
  static notClosed(value: Status): boolean { return value !== Status.closed; }
}
function throwClosed(): never { throw new Error('closed'); }
export class Ticket extends AggregateRoot<{ status: Status; title: string }> {
  private archived = false;
  private get isOpen(): boolean { return this.props.status === Status.open; }
  private get isEditable(): boolean { return this.isOpen || this.props.status === Status.draft; }
  unguarded(): void { this.props.title = 'x'; }
  earlyReturn(): void { if (this.props.status !== Status.open) return; this.props.title = 'x'; }
  earlyThrow(): void { if (this.props.status === Status.closed) throw new Error('closed'); this.props.title = 'x'; }
  viaGetter(): void { if (!this.isOpen) return; this.props.title = 'x'; }
  viaNestedGetter(): void { if (!this.isEditable) return; this.props.title = 'x'; }
  wrapped(): void { if (this.props.status === Status.draft) { this.props.title = 'x'; } }
  combined(): void { if (this.props.status === Status.closed || this.archived) return; this.props.title = 'x'; }
  throwHelper(): void { if (this.props.status === Status.closed) throwClosed(); this.props.title = 'x'; }
  ruleObject(): void { if (!Rules.notClosed(this.props.status)) return; this.props.title = 'x'; }
  branching(): void { const next = this.props.status === Status.open ? 'a' : 'b'; this.props.title = next; }
  booleanGuard(): void { if (this.archived) return; this.props.title = 'x'; }
}
`,
});

const ticket = project.getSourceFileOrThrow('/src/ticket.ts').getClassOrThrow('Ticket');
const status = resolvedField(ticket, 'status');
const archived = resolvedField(ticket, 'archived');

describe('methodSources for an enum field', () => {
  it.each([
    ['unguarded', ['CLOSED', 'DRAFT', 'OPEN']],
    ['earlyReturn', ['OPEN']],
    ['earlyThrow', ['DRAFT', 'OPEN']],
    ['viaGetter', ['OPEN']],
    ['viaNestedGetter', ['DRAFT', 'OPEN']],
    ['wrapped', ['DRAFT']],
    ['combined', ['DRAFT', 'OPEN']],
    ['throwHelper', ['DRAFT', 'OPEN']],
    ['ruleObject', 'unknown'],
    ['branching', 'unknown'],
  ])('%s can run from %j', (method, expected) => {
    expect(describeSources(methodSources(ticket.getMethodOrThrow(method), status, ticket))).toEqual(expected);
  });
});

describe('methodSources for a boolean field', () => {
  it.each([
    ['booleanGuard', ['false']],
    ['combined', ['false']],
    ['unguarded', ['false', 'true']],
  ])('%s can run from %j', (method, expected) => {
    expect(describeSources(methodSources(ticket.getMethodOrThrow(method), archived, ticket))).toEqual(expected);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/analyzers/lifecycle/guards.test.ts`
Expected: FAIL, cannot resolve `guards`.

- [ ] **Step 3: Write the implementation**

`src/analyzers/lifecycle/field-ref.ts`:

```ts
import { ClassDeclaration, Expression, Node } from 'ts-morph';

const MAX_GETTER_DEPTH = 5;

export const fieldNameOf = (node: Node): string | undefined => {
  if (!Node.isPropertyAccessExpression(node)) return undefined;
  const receiver = node.getExpression();
  if (Node.isThisExpression(receiver)) return node.getName();
  if (
    Node.isPropertyAccessExpression(receiver) &&
    receiver.getName() === 'props' &&
    Node.isThisExpression(receiver.getExpression())
  ) {
    return node.getName();
  }
  return undefined;
};

export const isRootedAtThis = (node: Node): boolean => {
  if (Node.isThisExpression(node)) return true;
  if (
    Node.isPropertyAccessExpression(node) ||
    Node.isElementAccessExpression(node) ||
    Node.isParenthesizedExpression(node) ||
    Node.isNonNullExpression(node)
  ) {
    return isRootedAtThis(node.getExpression());
  }
  return false;
};

export const thisGetterExpression = (node: Node, cls: ClassDeclaration): Expression | undefined => {
  if (!Node.isPropertyAccessExpression(node) || !Node.isThisExpression(node.getExpression())) return undefined;
  const body = cls.getGetAccessor(node.getName())?.getBody();
  if (!Node.isBlock(body)) return undefined;
  const statements = body.getStatements();
  const [only] = statements;
  return statements.length === 1 && Node.isReturnStatement(only) ? only.getExpression() : undefined;
};

export const referencesField = (node: Node, field: string, cls: ClassDeclaration, depth = 0): boolean =>
  [node, ...node.getDescendants()].some((candidate) => {
    if (fieldNameOf(candidate) === field) return true;
    const getter = depth < MAX_GETTER_DEPTH ? thisGetterExpression(candidate, cls) : undefined;
    return getter !== undefined && referencesField(getter, field, cls, depth + 1);
  });
```

`src/analyzers/lifecycle/guards.ts`:

```ts
import {
  BinaryExpression,
  ClassDeclaration,
  Expression,
  IfStatement,
  MethodDeclaration,
  Node,
  Statement,
  SyntaxKind,
} from 'ts-morph';
import { SET, UNSET, literalToken } from '../../engine/value-token';
import { fieldNameOf, referencesField, thisGetterExpression } from './field-ref';
import { Sources, StateField } from './model';
import { allTokens, difference, intersect, union } from './values';

type Evaluation = { readonly whenTrue: ReadonlySet<string>; readonly whenFalse: ReadonlySet<string> } | 'unknown';

type GuardScan = { readonly allowed: ReadonlySet<string>; readonly recognised: ReadonlySet<Node> } | 'unknown';

const MAX_GETTER_DEPTH = 5;
const EQUALITY = new Set<SyntaxKind>([SyntaxKind.EqualsEqualsEqualsToken, SyntaxKind.EqualsEqualsToken]);
const INEQUALITY = new Set<SyntaxKind>([SyntaxKind.ExclamationEqualsEqualsToken, SyntaxKind.ExclamationEqualsToken]);

const negate = (evaluation: Evaluation): Evaluation =>
  evaluation === 'unknown' ? evaluation : { whenTrue: evaluation.whenFalse, whenFalse: evaluation.whenTrue };

const truthiness = (field: StateField): Evaluation => {
  if (field.kind === 'boolean') return { whenTrue: new Set(['true']), whenFalse: new Set(['false']) };
  if (field.kind === 'nullable') return { whenTrue: new Set([SET]), whenFalse: new Set([UNSET]) };
  return 'unknown';
};

const comparedToken = (node: Expression, field: StateField): string | undefined => {
  if (field.kind === 'nullable') return Node.isNullLiteral(node) || node.getText() === 'undefined' ? UNSET : undefined;
  const token = literalToken(node.getType());
  return token !== undefined && allTokens(field).has(token) ? token : undefined;
};

const comparedSide = (left: Expression, right: Expression, field: StateField): Expression | undefined => {
  if (fieldNameOf(left) === field.name) return right;
  if (fieldNameOf(right) === field.name) return left;
  return undefined;
};

const compare = (left: Expression, right: Expression, field: StateField): Evaluation => {
  const other = comparedSide(left, right, field);
  const token = other === undefined ? undefined : comparedToken(other, field);
  if (token === undefined) return 'unknown';
  const matching = new Set([token]);
  return { whenTrue: matching, whenFalse: difference(allTokens(field), matching) };
};

const evaluateBinary = (node: BinaryExpression, field: StateField, cls: ClassDeclaration, depth: number): Evaluation => {
  const operator = node.getOperatorToken().getKind();
  if (operator === SyntaxKind.AmpersandAmpersandToken || operator === SyntaxKind.BarBarToken) {
    const left = evaluate(node.getLeft(), field, cls, depth);
    const right = evaluate(node.getRight(), field, cls, depth);
    if (left === 'unknown' || right === 'unknown') return 'unknown';
    return operator === SyntaxKind.AmpersandAmpersandToken
      ? { whenTrue: intersect(left.whenTrue, right.whenTrue), whenFalse: union(left.whenFalse, right.whenFalse) }
      : { whenTrue: union(left.whenTrue, right.whenTrue), whenFalse: intersect(left.whenFalse, right.whenFalse) };
  }
  if (EQUALITY.has(operator)) return compare(node.getLeft(), node.getRight(), field);
  if (INEQUALITY.has(operator)) return negate(compare(node.getLeft(), node.getRight(), field));
  return 'unknown';
};

const evaluate = (node: Expression, field: StateField, cls: ClassDeclaration, depth = 0): Evaluation => {
  if (!referencesField(node, field.name, cls)) return { whenTrue: allTokens(field), whenFalse: allTokens(field) };
  if (Node.isParenthesizedExpression(node)) return evaluate(node.getExpression(), field, cls, depth);
  if (Node.isPrefixUnaryExpression(node) && node.getOperatorToken() === SyntaxKind.ExclamationToken) {
    return negate(evaluate(node.getOperand(), field, cls, depth));
  }
  if (Node.isBinaryExpression(node)) return evaluateBinary(node, field, cls, depth);
  if (fieldNameOf(node) === field.name) return truthiness(field);
  const getter = depth < MAX_GETTER_DEPTH ? thisGetterExpression(node, cls) : undefined;
  return getter === undefined ? 'unknown' : evaluate(getter, field, cls, depth + 1);
};

const exitsEarly = (statement: Statement): boolean => {
  const last = Node.isBlock(statement) ? statement.getStatements().at(-1) : statement;
  if (last === undefined) return false;
  if (Node.isReturnStatement(last) || Node.isThrowStatement(last)) return true;
  if (!Node.isExpressionStatement(last)) return false;
  const expression = last.getExpression();
  if (!Node.isCallExpression(expression)) return false;
  const calleeName = expression.getExpression().getText().split('.').pop() ?? '';
  return /^throw/i.test(calleeName);
};

const wrappingGuard = (statements: readonly Statement[]): IfStatement | undefined => {
  const [only] = statements;
  return statements.length === 1 &&
    Node.isIfStatement(only) &&
    only.getElseStatement() === undefined &&
    !exitsEarly(only.getThenStatement())
    ? only
    : undefined;
};

const scanWrapper = (wrapper: IfStatement, field: StateField, cls: ClassDeclaration): GuardScan => {
  const evaluation = evaluate(wrapper.getExpression(), field, cls);
  const then = wrapper.getThenStatement();
  const inner = scanStatements(Node.isBlock(then) ? then.getStatements() : [then], field, cls);
  if (evaluation === 'unknown' || inner === 'unknown') return 'unknown';
  return {
    allowed: intersect(evaluation.whenTrue, inner.allowed),
    recognised: new Set([wrapper.getExpression(), ...inner.recognised]),
  };
};

const scanEarlyExits = (statements: readonly Statement[], field: StateField, cls: ClassDeclaration): GuardScan =>
  statements
    .filter(Node.isIfStatement)
    .filter((statement) => statement.getElseStatement() === undefined && exitsEarly(statement.getThenStatement()))
    .reduce<GuardScan>(
      (scan, guard) => {
        if (scan === 'unknown') return scan;
        const evaluation = evaluate(guard.getExpression(), field, cls);
        if (evaluation === 'unknown') return 'unknown';
        return {
          allowed: intersect(scan.allowed, evaluation.whenFalse),
          recognised: new Set([...scan.recognised, guard.getExpression()]),
        };
      },
      { allowed: allTokens(field), recognised: new Set<Node>() },
    );

const scanStatements = (statements: readonly Statement[], field: StateField, cls: ClassDeclaration): GuardScan => {
  const wrapper = wrappingGuard(statements);
  return wrapper ? scanWrapper(wrapper, field, cls) : scanEarlyExits(statements, field, cls);
};

const influencingNodes = (method: MethodDeclaration): Node[] => [
  ...method.getDescendantsOfKind(SyntaxKind.IfStatement).map((statement) => statement.getExpression()),
  ...method.getDescendantsOfKind(SyntaxKind.ConditionalExpression).map((expression) => expression.getCondition()),
  ...method.getDescendantsOfKind(SyntaxKind.SwitchStatement).map((statement) => statement.getExpression()),
  ...method.getDescendantsOfKind(SyntaxKind.WhileStatement).map((statement) => statement.getExpression()),
  ...method.getDescendantsOfKind(SyntaxKind.CallExpression).flatMap((call) => call.getArguments()),
  ...method.getDescendantsOfKind(SyntaxKind.NewExpression).flatMap((call) => call.getArguments()),
];

export const methodSources = (method: MethodDeclaration, field: StateField, cls: ClassDeclaration): Sources => {
  const body = method.getBody();
  if (!Node.isBlock(body)) return { kind: 'known', values: allTokens(field) };
  const scan = scanStatements(body.getStatements(), field, cls);
  if (scan === 'unknown') return { kind: 'unknown' };
  const unrecognisedUse = influencingNodes(method)
    .filter((node) => !scan.recognised.has(node))
    .some((node) => referencesField(node, field.name, cls));
  return unrecognisedUse ? { kind: 'unknown' } : { kind: 'known', values: scan.allowed };
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/analyzers/lifecycle/guards.test.ts && npm run typecheck && npm run lint`
Expected: PASS (13 cases).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: normalise method guards into allowed source states" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Mutation detection, assigned values, initial values

**Files:**
- Create: `src/analyzers/lifecycle/assigned.ts`, `src/analyzers/lifecycle/mutation.ts`, `src/analyzers/lifecycle/initial.ts`
- Test: `test/analyzers/lifecycle/mutation.test.ts`

**Interfaces:**
- Consumes: `fieldNameOf`, `isRootedAtThis` (Task 5), `UNRESOLVED`, `mergeAssigned`, `assignsAnything` (Task 4), `literalToken`, `isNullish`, `SET`, `UNSET` (Task 2).
- Produces:
  - `assignedValue(value: Expression, field: StateField): AssignedValues`
  - `setsOf(scope: Node, field: StateField): AssignedValues`
  - `isAssignmentOperator(node: BinaryExpression): boolean`
  - `mutatingMethods(cls: ClassDeclaration, eventMethods: readonly string[]): ReadonlySet<string>`
  - `initialValues(cls: ClassDeclaration, field: StateField): AssignedValues`. It returns `UNRESOLVED` when nothing in the class sets the field at creation.

- [ ] **Step 1: Write the failing test**

`test/analyzers/lifecycle/mutation.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { setsOf } from '../../../src/analyzers/lifecycle/assigned';
import { initialValues } from '../../../src/analyzers/lifecycle/initial';
import { mutatingMethods } from '../../../src/analyzers/lifecycle/mutation';
import { describeAssigned, resolvedField } from '../../helpers/describe';
import { AGGREGATE_ROOT, inMemoryProject } from '../../helpers/in-memory';

const project = inMemoryProject({
  '/src/aggregate-root.ts': AGGREGATE_ROOT,
  '/src/account.ts': `
import { AggregateRoot } from './aggregate-root';
type AccountProps = { balance: number; closedAt: Date | null; items: string[] };
export class Account extends AggregateRoot<AccountProps> {
  private lockedAt: Date | null = null;
  private status: 'active' | 'frozen' = 'active';
  static open(): Account { return new Account({ balance: 0, closedAt: null, items: [] }); }
  balanceOf(): number { return this.props.balance; }
  deposit(amount: number): void { this.props.balance += amount; }
  addItem(item: string): void { this.props.items.push(item); }
  touch(): void { this.addEvent({ type: 'touched' }); }
  close(): void { this.props.closedAt = new Date(); }
  reopen(): void { this.props.closedAt = null; }
  closeViaHelper(): void { this.close(); }
  lock(): void { this.lockedAt = new Date(); }
  freeze(next: 'active' | 'frozen'): void { this.status = next; }
  freezeNow(): void { this.status = 'frozen'; }
  replaceAll(props: AccountProps): void { this.props = props; }
  count(): number { let n = 0; n += 1; return n; }
}
export class Assigned extends AggregateRoot<object> {
  private phase!: 'a' | 'b';
  constructor(input: { phase: 'a' | 'b' }) { super({}); Object.assign(this, input); }
}
export class Hydrated extends AggregateRoot<{ phase: 'a' | 'b' }> {}
`,
});

const file = project.getSourceFileOrThrow('/src/account.ts');
const account = file.getClassOrThrow('Account');
const closedAt = resolvedField(account, 'closedAt');
const status = resolvedField(account, 'status');
const lockedAt = resolvedField(account, 'lockedAt');

describe('mutatingMethods', () => {
  it('finds assignments, collection changes, events and calls to mutating methods', () => {
    expect([...mutatingMethods(account, ['addEvent'])].sort()).toEqual([
      'addItem',
      'close',
      'closeViaHelper',
      'deposit',
      'freeze',
      'freezeNow',
      'lock',
      'reopen',
      'replaceAll',
      'touch',
    ]);
  });
});

describe('setsOf', () => {
  it.each([
    ['close', closedAt, { tokens: ['set'], unresolved: false }],
    ['reopen', closedAt, { tokens: ['unset'], unresolved: false }],
    ['freezeNow', status, { tokens: ['frozen'], unresolved: false }],
    ['freeze', status, { tokens: [], unresolved: true }],
    ['replaceAll', closedAt, { tokens: [], unresolved: true }],
    ['deposit', closedAt, { tokens: [], unresolved: false }],
  ] as const)('%s', (method, field, expected) => {
    expect(describeAssigned(setsOf(account.getMethodOrThrow(method), field))).toEqual(expected);
  });
});

describe('initialValues', () => {
  it('reads a property initializer', () => {
    expect(describeAssigned(initialValues(account, status))).toEqual({ tokens: ['active'], unresolved: false });
  });

  it('reads a null initializer as unset', () => {
    expect(describeAssigned(initialValues(account, lockedAt))).toEqual({ tokens: ['unset'], unresolved: false });
  });

  it('reads the value a static factory passes', () => {
    expect(describeAssigned(initialValues(account, closedAt))).toEqual({ tokens: ['unset'], unresolved: false });
  });

  it('treats Object.assign in the constructor as unresolved', () => {
    const assigned = file.getClassOrThrow('Assigned');

    expect(initialValues(assigned, resolvedField(assigned, 'phase')).unresolved).toBe(true);
  });

  it('treats an aggregate created only outside the class as unresolved', () => {
    const hydrated = file.getClassOrThrow('Hydrated');

    expect(initialValues(hydrated, resolvedField(hydrated, 'phase')).unresolved).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/analyzers/lifecycle/mutation.test.ts`
Expected: FAIL, cannot resolve `assigned`.

- [ ] **Step 3: Write the implementation**

`src/analyzers/lifecycle/assigned.ts`:

```ts
import { BinaryExpression, Expression, Node, SyntaxKind } from 'ts-morph';
import { SET, UNSET, isNullish, literalToken } from '../../engine/value-token';
import { fieldNameOf } from './field-ref';
import { AssignedValues, StateField } from './model';
import { UNRESOLVED, allTokens, mergeAssigned } from './values';

export const isAssignmentOperator = (node: BinaryExpression): boolean => {
  const kind = node.getOperatorToken().getKind();
  return kind >= SyntaxKind.FirstAssignment && kind <= SyntaxKind.LastAssignment;
};

const tokenOfAssigned = (value: Expression, field: StateField): string | undefined => {
  const type = value.getType();
  if (field.kind === 'nullable') {
    if (isNullish(type)) return UNSET;
    const members = type.isUnion() ? type.getUnionTypes() : [type];
    return members.some(isNullish) ? undefined : SET;
  }
  const token = literalToken(type);
  return token !== undefined && allTokens(field).has(token) ? token : undefined;
};

export const assignedValue = (value: Expression, field: StateField): AssignedValues => {
  const token = tokenOfAssigned(value, field);
  return token === undefined ? UNRESOLVED : { tokens: new Set([token]), unresolved: false };
};

export const setsOf = (scope: Node, field: StateField): AssignedValues => {
  const assignments = scope
    .getDescendantsOfKind(SyntaxKind.BinaryExpression)
    .filter((binary) => binary.getOperatorToken().getKind() === SyntaxKind.EqualsToken);
  const direct = assignments
    .filter((binary) => fieldNameOf(binary.getLeft()) === field.name)
    .map((binary) => assignedValue(binary.getRight(), field));
  const replacesProps = assignments.some((binary) => binary.getLeft().getText() === 'this.props');
  return mergeAssigned(replacesProps ? [...direct, UNRESOLVED] : direct);
};
```

`src/analyzers/lifecycle/mutation.ts`:

```ts
import { ClassDeclaration, MethodDeclaration, Node, SyntaxKind } from 'ts-morph';
import { isAssignmentOperator } from './assigned';
import { isRootedAtThis } from './field-ref';

const COLLECTION_MUTATORS = new Set([
  'push',
  'pop',
  'shift',
  'unshift',
  'splice',
  'sort',
  'reverse',
  'fill',
  'copyWithin',
  'set',
  'add',
  'delete',
  'clear',
]);

const INCREMENTS = new Set<SyntaxKind>([SyntaxKind.PlusPlusToken, SyntaxKind.MinusMinusToken]);

const assignsThis = (method: MethodDeclaration): boolean =>
  method
    .getDescendantsOfKind(SyntaxKind.BinaryExpression)
    .some((binary) => isAssignmentOperator(binary) && isRootedAtThis(binary.getLeft()));

const incrementsThis = (method: MethodDeclaration): boolean =>
  [
    ...method.getDescendantsOfKind(SyntaxKind.PrefixUnaryExpression),
    ...method.getDescendantsOfKind(SyntaxKind.PostfixUnaryExpression),
  ].some((unary) => INCREMENTS.has(unary.getOperatorToken()) && isRootedAtThis(unary.getOperand()));

const callsMutator = (method: MethodDeclaration, eventMethods: ReadonlySet<string>): boolean =>
  method.getDescendantsOfKind(SyntaxKind.CallExpression).some((call) => {
    const callee = call.getExpression();
    if (!Node.isPropertyAccessExpression(callee)) return false;
    const receiver = callee.getExpression();
    if (Node.isThisExpression(receiver)) return eventMethods.has(callee.getName());
    if (COLLECTION_MUTATORS.has(callee.getName()) && isRootedAtThis(receiver)) return true;
    const [target] = call.getArguments();
    return callee.getText() === 'Object.assign' && target !== undefined && isRootedAtThis(target);
  });

const calledThisMethods = (method: MethodDeclaration): string[] =>
  method
    .getDescendantsOfKind(SyntaxKind.CallExpression)
    .map((call) => call.getExpression())
    .filter(Node.isPropertyAccessExpression)
    .filter((callee) => Node.isThisExpression(callee.getExpression()))
    .map((callee) => callee.getName());

const closeOverCalls = (methods: readonly MethodDeclaration[], mutating: ReadonlySet<string>): ReadonlySet<string> => {
  const next = new Set([
    ...mutating,
    ...methods
      .filter((method) => calledThisMethods(method).some((name) => mutating.has(name)))
      .map((method) => method.getName()),
  ]);
  return next.size === mutating.size ? mutating : closeOverCalls(methods, next);
};

export const mutatingMethods = (cls: ClassDeclaration, eventMethods: readonly string[]): ReadonlySet<string> => {
  const events = new Set(eventMethods);
  const methods = cls.getMethods().filter((method) => !method.isStatic());
  const direct = new Set(
    methods
      .filter((method) => assignsThis(method) || incrementsThis(method) || callsMutator(method, events))
      .map((method) => method.getName()),
  );
  return closeOverCalls(methods, direct);
};
```

`src/analyzers/lifecycle/initial.ts`:

```ts
import { ClassDeclaration, SyntaxKind } from 'ts-morph';
import { assignedValue, setsOf } from './assigned';
import { AssignedValues, StateField } from './model';
import { UNRESOLVED, assignsAnything, mergeAssigned } from './values';

const OBJECT_ASSIGN_TO_THIS = /Object\.assign\(\s*this\b/;

export const initialValues = (cls: ClassDeclaration, field: StateField): AssignedValues => {
  const initializer = cls.getProperty(field.name)?.getInitializer();
  const factoryValues = cls
    .getStaticMethods()
    .flatMap((method) => method.getDescendantsOfKind(SyntaxKind.PropertyAssignment))
    .filter((property) => property.getName() === field.name)
    .map((property) => assignedValue(property.getInitializerOrThrow(), field));
  const assignsWholeObject = cls.getConstructors().some((constructor) => OBJECT_ASSIGN_TO_THIS.test(constructor.getText()));
  const merged = mergeAssigned([
    ...cls.getConstructors().map((constructor) => setsOf(constructor, field)),
    ...(initializer ? [assignedValue(initializer, field)] : []),
    ...factoryValues,
    ...(assignsWholeObject ? [UNRESOLVED] : []),
  ]);
  return assignsAnything(merged) ? merged : UNRESOLVED;
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/analyzers/lifecycle/mutation.test.ts && npm run typecheck && npm run lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: detect mutations, assigned and initial state values" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Outside mutation detection

**Files:**
- Create: `src/analyzers/lifecycle/outside.ts`
- Test: `test/analyzers/lifecycle/outside.test.ts`

**Interfaces:**
- Consumes: `isAssignmentOperator`, `assignedValue` (Task 6), `UNRESOLVED` (Task 4), `OutsideAssignment` (Task 4).
- Produces: `outsideAssignments(files: readonly SourceFile[], cls: ClassDeclaration, field: StateField): OutsideAssignment[]`

- [ ] **Step 1: Write the failing test**

`test/analyzers/lifecycle/outside.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { outsideAssignments } from '../../../src/analyzers/lifecycle/outside';
import { describeAssigned, resolvedField } from '../../helpers/describe';
import { AGGREGATE_ROOT, inMemoryProject } from '../../helpers/in-memory';

const project = inMemoryProject({
  '/src/aggregate-root.ts': AGGREGATE_ROOT,
  '/src/invitation.ts': `
import { AggregateRoot } from './aggregate-root';
export type InvitationStatus = 'pending' | 'accepted' | 'rejected';
export class Invitation extends AggregateRoot<{ note: string }> {
  status: InvitationStatus = 'pending';
  accept(): void { this.status = 'accepted'; }
}
`,
  '/src/with-status.ts': `
import { Invitation, InvitationStatus } from './invitation';
export class WithStatus {
  constructor(private readonly status: InvitationStatus) {}
  mutate(target: Invitation): void { target.status = this.status; }
}
`,
  '/src/service.ts': `
import { Invitation } from './invitation';
export const acceptLater = (invitation: Invitation | undefined): void => { if (invitation) invitation.status = 'accepted'; };
export const unrelated = (other: { status: string }): void => { other.status = 'x'; };
`,
});

const invitation = project.getSourceFileOrThrow('/src/invitation.ts').getClassOrThrow('Invitation');

describe('outsideAssignments', () => {
  it('finds typed assignments to the field outside the aggregate class', () => {
    const found = outsideAssignments(project.getSourceFiles(), invitation, resolvedField(invitation, 'status'));

    expect(found.map((assignment) => ({ ...assignment, value: describeAssigned(assignment.value) }))).toEqual([
      { field: 'status', file: '/src/service.ts', line: 3, scope: 'acceptLater', value: { tokens: ['accepted'], unresolved: false } },
      { field: 'status', file: '/src/with-status.ts', line: 5, scope: 'WithStatus.mutate', value: { tokens: [], unresolved: true } },
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/analyzers/lifecycle/outside.test.ts`
Expected: FAIL, cannot resolve `outside`.

- [ ] **Step 3: Write the implementation**

`src/analyzers/lifecycle/outside.ts`:

```ts
import { ClassDeclaration, Node, SourceFile, SyntaxKind, Type } from 'ts-morph';
import { assignedValue, isAssignmentOperator } from './assigned';
import { OutsideAssignment, StateField } from './model';
import { UNRESOLVED } from './values';

const isInstanceOf = (type: Type, cls: ClassDeclaration): boolean =>
  type.getNonNullableType().getSymbol()?.getDeclarations().includes(cls) ?? false;

const targetsField = (left: Node, cls: ClassDeclaration, field: string): boolean => {
  if (!Node.isPropertyAccessExpression(left) || left.getName() !== field) return false;
  const receiver = left.getExpression();
  const owner =
    Node.isPropertyAccessExpression(receiver) && receiver.getName() === 'props' ? receiver.getExpression() : receiver;
  return isInstanceOf(owner.getType(), cls);
};

const nameOf = (node: Node): string | undefined => {
  if (Node.isMethodDeclaration(node) || Node.isVariableDeclaration(node)) return node.getName();
  if (Node.isFunctionDeclaration(node) || Node.isClassDeclaration(node)) return node.getName() ?? '<anonymous>';
  return undefined;
};

const enclosingName = (node: Node): string =>
  node
    .getAncestors()
    .map(nameOf)
    .filter((name): name is string => name !== undefined)
    .reverse()
    .join('.') || '<module>';

export const outsideAssignments = (
  files: readonly SourceFile[],
  cls: ClassDeclaration,
  field: StateField,
): OutsideAssignment[] =>
  files
    .flatMap((file) => file.getDescendantsOfKind(SyntaxKind.BinaryExpression))
    .filter(isAssignmentOperator)
    .filter((binary) => binary.getFirstAncestor((ancestor) => ancestor === cls) === undefined)
    .filter((binary) => targetsField(binary.getLeft(), cls, field.name))
    .map((binary) => ({
      field: field.name,
      file: binary.getSourceFile().getFilePath(),
      line: binary.getStartLineNumber(),
      scope: enclosingName(binary),
      value:
        binary.getOperatorToken().getKind() === SyntaxKind.EqualsToken
          ? assignedValue(binary.getRight(), field)
          : UNRESOLVED,
    }))
    .sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/analyzers/lifecycle/outside.test.ts && npm run typecheck && npm run lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: detect state assignments outside the aggregate" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Candidate fields and lifecycle extraction

**Files:**
- Create: `src/analyzers/lifecycle/candidates.ts`, `src/analyzers/lifecycle/extract.ts`, `src/analyzer.ts` (only the `AnalysisInput` type for now)
- Test: `test/analyzers/lifecycle/extract.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 3–7.
- Produces:
  - `src/analyzer.ts`: `export type AnalysisInput = { readonly declaration: DomainDeclaration; readonly files: readonly SourceFile[] };` (Task 11 extends this file)
  - `candidateFields(cls: ClassDeclaration, auditFields: readonly string[]): StateField[]`
  - `extractLifecycles(input: AnalysisInput): LifecycleModel`

- [ ] **Step 1: Write the failing test**

`test/analyzers/lifecycle/extract.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { extractLifecycles } from '../../../src/analyzers/lifecycle/extract';
import { DEFAULT_DECLARATION, DeclaredField } from '../../../src/engine/declaration';
import { describeAssigned, describeSources } from '../../helpers/describe';
import { AGGREGATE_ROOT, inMemoryProject } from '../../helpers/in-memory';

const project = inMemoryProject({
  '/src/aggregate-root.ts': AGGREGATE_ROOT,
  '/src/order.ts': `
import { AggregateRoot } from './aggregate-root';
export enum OrderStatus { pending = 'PENDING', cancelled = 'CANCELLED' }
export class Order extends AggregateRoot<{ status: OrderStatus; updatedAt: Date | null }> {
  static create(): Order { return new Order({ status: OrderStatus.pending, updatedAt: null }); }
  cancel(): void {
    if (this.props.status === OrderStatus.cancelled) return;
    this.props.status = OrderStatus.cancelled;
    this.props.updatedAt = new Date();
  }
}
`,
  '/src/payment.ts': `
import { AggregateRoot } from './aggregate-root';
export class Payment extends AggregateRoot<{ state: 'open' | 'paid'; amount: number; updatedAt: Date | null }> {
  pay(): void { this.props.state = 'paid'; this.props.updatedAt = new Date(); }
}
`,
});

const order = project.getSourceFileOrThrow('/src/order.ts').getClassOrThrow('Order');

const extractWith = (fields: readonly DeclaredField[]) =>
  extractLifecycles({
    declaration: { ...DEFAULT_DECLARATION, lifecycles: [{ target: order, fields, allowAfterTerminal: [] }] },
    files: project.getSourceFiles(),
  });

const aggregateNamed = (name: string, fields: readonly DeclaredField[]) =>
  extractWith(fields).aggregates.find((aggregate) => aggregate.name === name);

const STATUS: DeclaredField = {
  name: 'status',
  terminal: ['CANCELLED'],
  transitions: new Map([['cancel', ['PENDING']]]),
};

describe('extractLifecycles', () => {
  it('records the declared terminal states and transitions', () => {
    const declaration = aggregateNamed('Order', [STATUS])?.declarations.get('status');

    expect({
      terminal: [...(declaration?.terminal ?? [])],
      transitions: [...(declaration?.transitions ?? [])].map(([method, sources]) => [method, [...sources]]),
    }).toEqual({ terminal: ['CANCELLED'], transitions: [['cancel', ['PENDING']]] });
  });

  it('extracts each method behaviour for a declared field', () => {
    const cancel = aggregateNamed('Order', [STATUS])?.methods.find((method) => method.name === 'cancel');
    const behaviour = cancel?.fields.get('status');

    expect({
      mutates: cancel?.mutates,
      sources: behaviour && describeSources(behaviour.sources),
      sets: behaviour && describeAssigned(behaviour.sets),
    }).toEqual({ mutates: true, sources: ['PENDING'], sets: { tokens: ['CANCELLED'], unresolved: false } });
  });

  it('gives undeclared aggregates candidate fields without audit or non-state fields', () => {
    expect(aggregateNamed('Payment', [STATUS])?.fields.map((field) => field.name)).toEqual(['state']);
  });

  it('reports unknown values, missing methods and missing fields as problems', () => {
    const { problems } = extractWith([
      { name: 'status', terminal: ['ARCHIVED'], transitions: new Map([['reopen', ['PENDING']]]) },
      { name: 'missing', terminal: [], transitions: undefined },
    ]);

    expect(problems).toEqual([
      'Order.status: unknown state value "ARCHIVED" (known: PENDING, CANCELLED)',
      'Order: transitions refer to missing method "reopen"',
      'Order has no field "missing"',
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/analyzers/lifecycle/extract.test.ts`
Expected: FAIL, cannot resolve `extract`.

- [ ] **Step 3: Write the implementation**

`src/analyzer.ts`:

```ts
import { SourceFile } from 'ts-morph';
import { DomainDeclaration } from './engine/declaration';

export type AnalysisInput = {
  readonly declaration: DomainDeclaration;
  readonly files: readonly SourceFile[];
};
```

`src/analyzers/lifecycle/candidates.ts`:

```ts
import { ClassDeclaration, Node, Symbol as MorphSymbol, SyntaxKind } from 'ts-morph';
import { SET } from '../../engine/value-token';
import { setsOf } from './assigned';
import { referencesField } from './field-ref';
import { StateField } from './model';
import { resolveStateField } from './state-field';

const isDataProperty = (symbol: MorphSymbol): boolean =>
  symbol
    .getDeclarations()
    .some((node) => Node.isPropertyDeclaration(node) || Node.isPropertySignature(node) || Node.isParameterDeclaration(node));

const fieldNames = (cls: ClassDeclaration): string[] => {
  const own = cls.getType().getProperties().filter(isDataProperty).map((symbol) => symbol.getName());
  const props =
    cls
      .getType()
      .getProperty('props')
      ?.getTypeAtLocation(cls)
      .getProperties()
      .filter(isDataProperty)
      .map((symbol) => symbol.getName()) ?? [];
  return [...new Set([...own, ...props])];
};

const behavesLikeState = (cls: ClassDeclaration, field: StateField): boolean =>
  field.kind !== 'nullable' ||
  cls.getMethods().some((method) => setsOf(method, field).tokens.has(SET)) ||
  cls
    .getDescendantsOfKind(SyntaxKind.IfStatement)
    .some((statement) => referencesField(statement.getExpression(), field.name, cls));

export const candidateFields = (cls: ClassDeclaration, auditFields: readonly string[]): StateField[] => {
  const excluded = new Set([...auditFields, 'props']);
  return fieldNames(cls)
    .filter((name) => !excluded.has(name))
    .map((name) => resolveStateField(cls, name))
    .flatMap((resolution) => (resolution.kind === 'resolved' ? [resolution.field] : []))
    .filter((field) => behavesLikeState(cls, field));
};
```

`src/analyzers/lifecycle/extract.ts`:

```ts
import { ClassDeclaration, SourceFile } from 'ts-morph';
import { AnalysisInput } from '../../analyzer';
import { DeclaredField, DeclaredLifecycle, DomainDeclaration } from '../../engine/declaration';
import { setsOf } from './assigned';
import { candidateFields } from './candidates';
import { aggregateName, discoverAggregates } from './discover';
import { methodSources } from './guards';
import { initialValues } from './initial';
import { AggregateModel, FieldDeclaration, LifecycleModel, MethodModel, StateField } from './model';
import { mutatingMethods } from './mutation';
import { outsideAssignments } from './outside';
import { resolveStateField } from './state-field';

type DeclaredOutcome =
  | { readonly kind: 'ok'; readonly field: StateField; readonly declaration: FieldDeclaration }
  | { readonly kind: 'problems'; readonly problems: readonly string[] };

type ResolvedFields = {
  readonly fields: readonly StateField[];
  readonly declarations: ReadonlyMap<string, FieldDeclaration>;
  readonly problems: readonly string[];
};

const resolveDeclaredField = (cls: ClassDeclaration, declared: DeclaredField): DeclaredOutcome => {
  const resolution = resolveStateField(cls, declared.name);
  if (resolution.kind === 'problem') return { kind: 'problems', problems: [resolution.message] };
  const known = resolution.field.values.map((value) => value.token);
  const methods = new Set(cls.getMethods().map((method) => method.getName()));
  const transitions = [...(declared.transitions ?? new Map<string, readonly string[]>())];
  const problems = [
    ...[...declared.terminal, ...transitions.flatMap(([, sources]) => sources)]
      .filter((token) => !known.includes(token))
      .map((token) => `${aggregateName(cls)}.${declared.name}: unknown state value "${token}" (known: ${known.join(', ')})`),
    ...transitions
      .map(([method]) => method)
      .filter((method) => !methods.has(method))
      .map((method) => `${aggregateName(cls)}: transitions refer to missing method "${method}"`),
  ];
  if (problems.length > 0) return { kind: 'problems', problems };
  return {
    kind: 'ok',
    field: resolution.field,
    declaration: {
      terminal: new Set(declared.terminal),
      transitions: declared.transitions && new Map(transitions.map(([method, sources]) => [method, new Set(sources)])),
    },
  };
};

const resolveDeclared = (cls: ClassDeclaration, declared: DeclaredLifecycle): ResolvedFields => {
  const outcomes = declared.fields.map((field) => resolveDeclaredField(cls, field));
  const ok = outcomes.flatMap((outcome) => (outcome.kind === 'ok' ? [outcome] : []));
  return {
    fields: ok.map((outcome) => outcome.field),
    declarations: new Map(ok.map((outcome) => [outcome.field.name, outcome.declaration])),
    problems: outcomes.flatMap((outcome) => (outcome.kind === 'problems' ? outcome.problems : [])),
  };
};

const methodModels = (cls: ClassDeclaration, fields: readonly StateField[], eventMethods: readonly string[]): MethodModel[] => {
  const mutating = mutatingMethods(cls, eventMethods);
  return cls
    .getMethods()
    .filter((method) => !method.isStatic())
    .map((method) => ({
      name: method.getName(),
      file: method.getSourceFile().getFilePath(),
      line: method.getStartLineNumber(),
      mutates: mutating.has(method.getName()),
      fields: new Map(
        fields.map((field) => [field.name, { sources: methodSources(method, field, cls), sets: setsOf(method, field) }]),
      ),
    }));
};

const extractAggregate = (
  cls: ClassDeclaration,
  declaration: DomainDeclaration,
  files: readonly SourceFile[],
): { readonly aggregate: AggregateModel; readonly problems: readonly string[] } => {
  const declared = declaration.lifecycles.find((lifecycle) => lifecycle.target === cls);
  const resolved: ResolvedFields = declared
    ? resolveDeclared(cls, declared)
    : { fields: candidateFields(cls, declaration.auditFields), declarations: new Map(), problems: [] };
  return {
    problems: resolved.problems,
    aggregate: {
      name: aggregateName(cls),
      file: cls.getSourceFile().getFilePath(),
      line: cls.getStartLineNumber(),
      declared: declared !== undefined,
      fields: resolved.fields,
      declarations: resolved.declarations,
      allowAfterTerminal: new Set(declared?.allowAfterTerminal ?? []),
      methods: methodModels(cls, resolved.fields, declaration.eventMethods),
      initial: new Map(resolved.fields.map((field) => [field.name, initialValues(cls, field)])),
      outside: declared ? resolved.fields.flatMap((field) => outsideAssignments(files, cls, field)) : [],
    },
  };
};

export const extractLifecycles = ({ declaration, files }: AnalysisInput): LifecycleModel => {
  const classes = discoverAggregates(
    files,
    declaration.aggregateBaseClasses,
    declaration.lifecycles.map((lifecycle) => lifecycle.target),
  );
  const extracted = classes.map((cls) => extractAggregate(cls, declaration, files));
  return {
    aggregates: extracted.map((result) => result.aggregate),
    problems: extracted.flatMap((result) => result.problems),
  };
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/analyzers/lifecycle && npm run typecheck && npm run lint`
Expected: PASS for all lifecycle tests.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: extract lifecycle models for declared and discovered aggregates" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: Checks: terminal-state-leak and unreachable-state

**Files:**
- Modify: `src/analyzer.ts` (add `Severity`, `Finding`, `findingKey`)
- Create: `src/analyzers/lifecycle/checks/format.ts`, `src/analyzers/lifecycle/checks/terminal-state-leak.ts`, `src/analyzers/lifecycle/checks/unreachable-state.ts`, `test/helpers/model.ts`
- Test: `test/analyzers/lifecycle/checks/terminal-state-leak.test.ts`, `test/analyzers/lifecycle/checks/unreachable-state.test.ts`

**Interfaces:**
- Produces in `src/analyzer.ts`:

```ts
export type Severity = 'error' | 'warning';
export type Finding = {
  readonly checkId: string;
  readonly severity: Severity;
  readonly aggregate: string;
  readonly method: string | undefined;
  readonly field: string;
  readonly subject: string;
  readonly file: string;
  readonly line: number;
  readonly message: string;
  readonly fix: string;
};
export const findingKey = (finding: Finding): string;
```

- Produces: `labelsOf(field, tokens): string[]`, `quoted(field, tokens): string`, `fieldOf(aggregate, name): StateField`, `terminalStateLeak(aggregate: AggregateModel): Finding[]`, `unreachableState(aggregate: AggregateModel): Finding[]`.
- Produces (test helper `test/helpers/model.ts`): `stateField`, `known`, `unknownSources`, `assigned`, `unresolvedValue`, `method`, `declared`, `aggregate`, `STATUS`.

- [ ] **Step 1: Extend `src/analyzer.ts`**

Append to `src/analyzer.ts`:

```ts
export type Severity = 'error' | 'warning';

export type Finding = {
  readonly checkId: string;
  readonly severity: Severity;
  readonly aggregate: string;
  readonly method: string | undefined;
  readonly field: string;
  readonly subject: string;
  readonly file: string;
  readonly line: number;
  readonly message: string;
  readonly fix: string;
};

export const findingKey = (finding: Finding): string =>
  [finding.checkId, finding.aggregate, finding.method ?? '', finding.field, finding.subject].join('|');
```

- [ ] **Step 2: Write the model builder helper**

`test/helpers/model.ts`:

```ts
import {
  AggregateModel,
  AssignedValues,
  FieldBehaviour,
  FieldDeclaration,
  MethodModel,
  Sources,
  StateField,
  StateFieldKind,
} from '../../src/analyzers/lifecycle/model';

export const stateField = (name: string, kind: StateFieldKind, tokens: readonly string[]): StateField => ({
  name,
  kind,
  values: tokens.map((token) => ({ token, label: token.toLowerCase(), source: `'${token}'` })),
  enumReference: undefined,
});

export const STATUS = stateField('status', 'enum', ['PENDING', 'CONFIRMED', 'CANCELLED']);

export const known = (...values: string[]): Sources => ({ kind: 'known', values: new Set(values) });

export const unknownSources: Sources = { kind: 'unknown' };

export const assigned = (...tokens: string[]): AssignedValues => ({ tokens: new Set(tokens), unresolved: false });

export const unresolvedValue: AssignedValues = { tokens: new Set(), unresolved: true };

export const method = (name: string, mutates: boolean, fields: Record<string, FieldBehaviour>): MethodModel => ({
  name,
  file: '/app/src/order.ts',
  line: 10,
  mutates,
  fields: new Map(Object.entries(fields)),
});

export const declared = (terminal: string[], transitions?: Record<string, string[]>): FieldDeclaration => ({
  terminal: new Set(terminal),
  transitions:
    transitions && new Map(Object.entries(transitions).map(([name, sources]) => [name, new Set(sources)])),
});

export const aggregate = (overrides: Partial<AggregateModel>): AggregateModel => ({
  name: 'Order',
  file: '/app/src/order.ts',
  line: 3,
  declared: true,
  fields: [STATUS],
  declarations: new Map([['status', declared(['CANCELLED'])]]),
  allowAfterTerminal: new Set(),
  methods: [],
  initial: new Map([['status', assigned('PENDING')]]),
  outside: [],
  ...overrides,
});
```

- [ ] **Step 3: Write the failing tests**

`test/analyzers/lifecycle/checks/terminal-state-leak.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { terminalStateLeak } from '../../../../src/analyzers/lifecycle/checks/terminal-state-leak';
import { aggregate, assigned, known, method, unknownSources } from '../../../helpers/model';

const ALL = known('PENDING', 'CONFIRMED', 'CANCELLED');

describe('terminalStateLeak', () => {
  it('flags a mutating method that can run in a terminal state', () => {
    const findings = terminalStateLeak(
      aggregate({ methods: [method('annotate', true, { status: { sources: ALL, sets: assigned() } })] }),
    );

    expect(findings).toEqual([
      {
        checkId: 'terminal-state-leak',
        severity: 'error',
        aggregate: 'Order',
        method: 'annotate',
        field: 'status',
        subject: 'CANCELLED',
        file: '/app/src/order.ts',
        line: 10,
        message: "annotate() can run after status is 'cancelled'.",
        fix: "Guard annotate() so it cannot run when status is 'cancelled', or list it in allowAfterTerminal if that is intended.",
      },
    ]);
  });

  it('ignores a method whose guard excludes the terminal state', () => {
    const methods = [method('confirm', true, { status: { sources: known('PENDING'), sets: assigned('CONFIRMED') } })];

    expect(terminalStateLeak(aggregate({ methods }))).toEqual([]);
  });

  it('ignores a method that changes nothing', () => {
    const methods = [method('describe', false, { status: { sources: ALL, sets: assigned() } })];

    expect(terminalStateLeak(aggregate({ methods }))).toEqual([]);
  });

  it('ignores methods listed in allowAfterTerminal', () => {
    const methods = [method('archive', true, { status: { sources: ALL, sets: assigned() } })];

    expect(terminalStateLeak(aggregate({ methods, allowAfterTerminal: new Set(['archive']) }))).toEqual([]);
  });

  it('stays silent when the guard could not be analysed', () => {
    const methods = [method('annotate', true, { status: { sources: unknownSources, sets: assigned() } })];

    expect(terminalStateLeak(aggregate({ methods }))).toEqual([]);
  });
});
```

`test/analyzers/lifecycle/checks/unreachable-state.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { unreachableState } from '../../../../src/analyzers/lifecycle/checks/unreachable-state';
import { aggregate, assigned, declared, known, method, stateField, unresolvedValue } from '../../../helpers/model';

const CANCEL = method('cancel', true, { status: { sources: known('PENDING'), sets: assigned('CANCELLED') } });

describe('unreachableState', () => {
  it('flags a value that nothing assigns', () => {
    expect(unreachableState(aggregate({ methods: [CANCEL] }))).toEqual([
      {
        checkId: 'unreachable-state',
        severity: 'error',
        aggregate: 'Order',
        method: undefined,
        field: 'status',
        subject: 'CONFIRMED',
        file: '/app/src/order.ts',
        line: 3,
        message: "status value 'confirmed' is never assigned.",
        fix: "Add the method that moves Order into 'confirmed', or remove the value from the type.",
      },
    ]);
  });

  it('counts assignments outside the aggregate as reaching a value', () => {
    const outside = [{ field: 'status', file: '/app/src/x.ts', line: 1, scope: 'x', value: assigned('CONFIRMED') }];

    expect(unreachableState(aggregate({ methods: [CANCEL], outside }))).toEqual([]);
  });

  it('stays silent when any assignment is unresolved', () => {
    const initial = new Map([['status', unresolvedValue]]);

    expect(unreachableState(aggregate({ methods: [CANCEL], initial }))).toEqual([]);
  });

  it('ignores boolean fields', () => {
    const deleted = stateField('deleted', 'boolean', ['true', 'false']);

    expect(
      unreachableState(
        aggregate({ fields: [deleted], declarations: new Map([['deleted', declared(['true'])]]), initial: new Map() }),
      ),
    ).toEqual([]);
  });
});
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `npx vitest run test/analyzers/lifecycle/checks`
Expected: FAIL, cannot resolve the check modules.

- [ ] **Step 5: Write the implementation**

`src/analyzers/lifecycle/checks/format.ts`:

```ts
import { AggregateModel, StateField } from '../model';

export const labelsOf = (field: StateField, tokens: Iterable<string>): string[] => {
  const wanted = new Set(tokens);
  return field.values.filter((value) => wanted.has(value.token)).map((value) => value.label);
};

export const quoted = (field: StateField, tokens: Iterable<string>): string =>
  labelsOf(field, tokens)
    .map((label) => `'${label}'`)
    .join(', ');

export const fieldOf = (aggregate: AggregateModel, name: string): StateField => {
  const field = aggregate.fields.find((candidate) => candidate.name === name);
  if (!field) throw new Error(`${aggregate.name} has a declaration for unresolved field "${name}"`);
  return field;
};
```

`src/analyzers/lifecycle/checks/terminal-state-leak.ts`:

```ts
import { Finding } from '../../../analyzer';
import { AggregateModel, FieldDeclaration, MethodModel, StateField } from '../model';
import { fieldOf, quoted } from './format';

const leakFinding = (aggregate: AggregateModel, field: StateField, method: MethodModel, leaked: readonly string[]): Finding => ({
  checkId: 'terminal-state-leak',
  severity: 'error',
  aggregate: aggregate.name,
  method: method.name,
  field: field.name,
  subject: leaked.join(','),
  file: method.file,
  line: method.line,
  message: `${method.name}() can run after ${field.name} is ${quoted(field, leaked)}.`,
  fix: `Guard ${method.name}() so it cannot run when ${field.name} is ${quoted(field, leaked)}, or list it in allowAfterTerminal if that is intended.`,
});

const leaksOf = (aggregate: AggregateModel, field: StateField, declaration: FieldDeclaration): Finding[] =>
  aggregate.methods
    .filter((method) => method.mutates && !aggregate.allowAfterTerminal.has(method.name))
    .flatMap((method) => {
      const sources = method.fields.get(field.name)?.sources;
      if (sources?.kind !== 'known') return [];
      const leaked = field.values.map((value) => value.token).filter((token) => declaration.terminal.has(token) && sources.values.has(token));
      return leaked.length === 0 ? [] : [leakFinding(aggregate, field, method, leaked)];
    });

export const terminalStateLeak = (aggregate: AggregateModel): Finding[] =>
  [...aggregate.declarations].flatMap(([name, declaration]) => leaksOf(aggregate, fieldOf(aggregate, name), declaration));
```

`src/analyzers/lifecycle/checks/unreachable-state.ts`:

```ts
import { Finding } from '../../../analyzer';
import { AggregateModel, AssignedValues, StateField } from '../model';
import { fieldOf } from './format';

const assignmentsOf = (aggregate: AggregateModel, field: StateField): AssignedValues[] =>
  [
    ...aggregate.methods.map((method) => method.fields.get(field.name)?.sets),
    aggregate.initial.get(field.name),
    ...aggregate.outside.filter((assignment) => assignment.field === field.name).map((assignment) => assignment.value),
  ].filter((value): value is AssignedValues => value !== undefined);

const unreachableValues = (aggregate: AggregateModel, field: StateField): Finding[] => {
  const assignments = assignmentsOf(aggregate, field);
  if (assignments.some((value) => value.unresolved)) return [];
  const reached = new Set(assignments.flatMap((value) => [...value.tokens]));
  return field.values
    .filter((value) => !reached.has(value.token))
    .map((value) => ({
      checkId: 'unreachable-state',
      severity: 'error',
      aggregate: aggregate.name,
      method: undefined,
      field: field.name,
      subject: value.token,
      file: aggregate.file,
      line: aggregate.line,
      message: `${field.name} value '${value.label}' is never assigned.`,
      fix: `Add the method that moves ${aggregate.name} into '${value.label}', or remove the value from the type.`,
    }));
};

export const unreachableState = (aggregate: AggregateModel): Finding[] =>
  [...aggregate.declarations.keys()]
    .map((name) => fieldOf(aggregate, name))
    .filter((field) => field.kind === 'enum' || field.kind === 'union')
    .flatMap((field) => unreachableValues(aggregate, field));
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run test/analyzers/lifecycle/checks && npm run typecheck && npm run lint`
Expected: PASS (9 tests).

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: add terminal-state-leak and unreachable-state checks" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: Checks: outside-mutation and transition-drift

**Files:**
- Create: `src/analyzers/lifecycle/checks/outside-mutation.ts`, `src/analyzers/lifecycle/checks/transition-drift.ts`
- Test: `test/analyzers/lifecycle/checks/outside-mutation.test.ts`, `test/analyzers/lifecycle/checks/transition-drift.test.ts`

**Interfaces:**
- Consumes: `Finding` (Task 9), `fieldOf`, `quoted` (Task 9), `assignsAnything` (Task 4), test builders (Task 9).
- Produces: `outsideMutation(aggregate: AggregateModel): Finding[]`, `transitionDrift(aggregate: AggregateModel): Finding[]`.

- [ ] **Step 1: Write the failing tests**

`test/analyzers/lifecycle/checks/outside-mutation.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { outsideMutation } from '../../../../src/analyzers/lifecycle/checks/outside-mutation';
import { aggregate, assigned } from '../../../helpers/model';

const ASSIGNMENT = { field: 'status', file: '/app/src/spec.ts', line: 7, scope: 'WithStatus.mutate', value: assigned('CANCELLED') };

describe('outsideMutation', () => {
  it('flags an assignment to a declared state field outside the aggregate', () => {
    expect(outsideMutation(aggregate({ outside: [ASSIGNMENT] }))).toEqual([
      {
        checkId: 'outside-mutation',
        severity: 'error',
        aggregate: 'Order',
        method: undefined,
        field: 'status',
        subject: 'WithStatus.mutate',
        file: '/app/src/spec.ts',
        line: 7,
        message: 'status of Order is assigned outside the aggregate in WithStatus.mutate.',
        fix: 'Move this change into a method on Order so its guards apply.',
      },
    ]);
  });

  it('ignores fields that are not declared', () => {
    expect(outsideMutation(aggregate({ outside: [{ ...ASSIGNMENT, field: 'note' }] }))).toEqual([]);
  });
});
```

`test/analyzers/lifecycle/checks/transition-drift.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { transitionDrift } from '../../../../src/analyzers/lifecycle/checks/transition-drift';
import { aggregate, assigned, declared, known, method, unknownSources } from '../../../helpers/model';

const withTransitions = (transitions: Record<string, string[]>) =>
  new Map([['status', declared(['CANCELLED'], transitions)]]);

describe('transitionDrift', () => {
  it('flags sources the declaration does not allow as an error', () => {
    const methods = [method('cancel', true, { status: { sources: known('PENDING', 'CONFIRMED'), sets: assigned('CANCELLED') } })];

    expect(transitionDrift(aggregate({ methods, declarations: withTransitions({ cancel: ['PENDING'] }) }))).toEqual([
      expect.objectContaining({
        checkId: 'transition-drift',
        severity: 'error',
        method: 'cancel',
        subject: 'extra',
        message: "cancel() can run from 'confirmed', which the declaration does not allow.",
        fix: "Add a guard that excludes 'confirmed', or add it to transitions.cancel.",
      }),
    ]);
  });

  it('flags declared sources the code no longer allows as a warning', () => {
    const methods = [method('cancel', true, { status: { sources: known('PENDING'), sets: assigned('CANCELLED') } })];

    expect(
      transitionDrift(aggregate({ methods, declarations: withTransitions({ cancel: ['PENDING', 'CONFIRMED'] }) })),
    ).toEqual([
      expect.objectContaining({
        severity: 'warning',
        subject: 'missing',
        message: "cancel() cannot run from 'confirmed', although the declaration allows it.",
        fix: "Remove 'confirmed' from transitions.cancel, or relax the guard.",
      }),
    ]);
  });

  it('flags a method that sets the field without a declared transition', () => {
    const methods = [method('confirm', true, { status: { sources: known('PENDING'), sets: assigned('CONFIRMED') } })];

    expect(transitionDrift(aggregate({ methods, declarations: withTransitions({}) }))).toEqual([
      expect.objectContaining({
        severity: 'error',
        method: 'confirm',
        subject: 'undeclared',
        message: 'confirm() sets status but has no entry in transitions.',
        fix: 'Add transitions.confirm to the declaration.',
      }),
    ]);
  });

  it('does nothing when no transitions are declared', () => {
    const methods = [method('confirm', true, { status: { sources: known('PENDING'), sets: assigned('CONFIRMED') } })];

    expect(transitionDrift(aggregate({ methods }))).toEqual([]);
  });

  it('stays silent for a declared method whose guard could not be analysed', () => {
    const methods = [method('cancel', true, { status: { sources: unknownSources, sets: assigned('CANCELLED') } })];

    expect(transitionDrift(aggregate({ methods, declarations: withTransitions({ cancel: ['PENDING'] }) }))).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/analyzers/lifecycle/checks`
Expected: FAIL, cannot resolve `outside-mutation` / `transition-drift`.

- [ ] **Step 3: Write the implementation**

`src/analyzers/lifecycle/checks/outside-mutation.ts`:

```ts
import { Finding } from '../../../analyzer';
import { AggregateModel } from '../model';

export const outsideMutation = (aggregate: AggregateModel): Finding[] =>
  aggregate.outside
    .filter((assignment) => aggregate.declarations.has(assignment.field))
    .map((assignment) => ({
      checkId: 'outside-mutation',
      severity: 'error',
      aggregate: aggregate.name,
      method: undefined,
      field: assignment.field,
      subject: assignment.scope,
      file: assignment.file,
      line: assignment.line,
      message: `${assignment.field} of ${aggregate.name} is assigned outside the aggregate in ${assignment.scope}.`,
      fix: `Move this change into a method on ${aggregate.name} so its guards apply.`,
    }));
```

`src/analyzers/lifecycle/checks/transition-drift.ts`:

```ts
import { Finding, Severity } from '../../../analyzer';
import { AggregateModel, FieldBehaviour, MethodModel, StateField } from '../model';
import { assignsAnything } from '../values';
import { fieldOf, quoted } from './format';

type Drift = { readonly severity: Severity; readonly subject: string; readonly message: string; readonly fix: string };

const toFinding = (aggregate: AggregateModel, field: StateField, method: MethodModel, drift: Drift): Finding => ({
  checkId: 'transition-drift',
  aggregate: aggregate.name,
  method: method.name,
  field: field.name,
  file: method.file,
  line: method.line,
  ...drift,
});

const comparedWithDeclaration = (
  field: StateField,
  method: MethodModel,
  behaviour: FieldBehaviour,
  declared: ReadonlySet<string>,
): Drift[] => {
  if (behaviour.sources.kind === 'unknown') return [];
  const allowed = behaviour.sources.values;
  const extra = [...allowed].filter((token) => !declared.has(token));
  const missing = [...declared].filter((token) => !allowed.has(token));
  return [
    ...(extra.length > 0
      ? [
          {
            severity: 'error' as const,
            subject: 'extra',
            message: `${method.name}() can run from ${quoted(field, extra)}, which the declaration does not allow.`,
            fix: `Add a guard that excludes ${quoted(field, extra)}, or add ${extra.length === 1 ? 'it' : 'them'} to transitions.${method.name}.`,
          },
        ]
      : []),
    ...(missing.length > 0
      ? [
          {
            severity: 'warning' as const,
            subject: 'missing',
            message: `${method.name}() cannot run from ${quoted(field, missing)}, although the declaration allows it.`,
            fix: `Remove ${quoted(field, missing)} from transitions.${method.name}, or relax the guard.`,
          },
        ]
      : []),
  ];
};

const driftOf = (field: StateField, method: MethodModel, transitions: ReadonlyMap<string, ReadonlySet<string>>): Drift[] => {
  const behaviour = method.fields.get(field.name);
  if (!behaviour) return [];
  const declared = transitions.get(method.name);
  if (declared) return comparedWithDeclaration(field, method, behaviour, declared);
  if (!assignsAnything(behaviour.sets)) return [];
  return [
    {
      severity: 'error',
      subject: 'undeclared',
      message: `${method.name}() sets ${field.name} but has no entry in transitions.`,
      fix: `Add transitions.${method.name} to the declaration.`,
    },
  ];
};

export const transitionDrift = (aggregate: AggregateModel): Finding[] =>
  [...aggregate.declarations].flatMap(([name, declaration]) => {
    const transitions = declaration.transitions;
    if (!transitions) return [];
    const field = fieldOf(aggregate, name);
    return aggregate.methods.flatMap((method) =>
      driftOf(field, method, transitions).map((drift) => toFinding(aggregate, field, method, drift)),
    );
  });
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/analyzers/lifecycle/checks && npm run typecheck && npm run lint`
Expected: PASS (all check tests).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: add outside-mutation and transition-drift checks" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 11: Suggestions, analyzer contract, lifecycle analyzer

**Files:**
- Modify: `src/analyzer.ts` (add `RuleDescription`, `Analyzer`, `AnalysisResult`, `analyse`)
- Create: `src/analyzers/lifecycle/checks/index.ts`, `src/analyzers/lifecycle/suggest.ts`, `src/analyzers/lifecycle/analyzer.ts`, `src/analysis.ts`
- Test: `test/analyzers/lifecycle/suggest.test.ts`, `test/analyzers/lifecycle/analyzer.test.ts`

**Interfaces:**
- Produces in `src/analyzer.ts`:

```ts
export type RuleDescription = { readonly id: string; readonly description: string };
export type Analyzer<Model, Suggestion> = {
  readonly id: string;
  readonly rules: readonly RuleDescription[];
  readonly extract: (input: AnalysisInput) => Model;
  readonly problems: (model: Model) => readonly string[];
  readonly suggest: (model: Model) => readonly Suggestion[];
  readonly check: (model: Model) => readonly Finding[];
  readonly diagram: (model: Model, only: string | undefined) => string;
  readonly summarize: (model: Model, root: string) => string;
  readonly isEmpty: (model: Model) => boolean;
};
export type AnalysisResult = {
  readonly rules: readonly RuleDescription[];
  readonly problems: readonly string[];
  readonly findings: readonly Finding[];
  readonly diagram: (only: string | undefined) => string;
  readonly summary: (root: string) => string;
  readonly isEmpty: boolean;
};
export const analyse: <Model, Suggestion>(analyzer: Analyzer<Model, Suggestion>, input: AnalysisInput) => AnalysisResult;
```

- Produces: `LIFECYCLE_RULES: readonly RuleDescription[]`, `runChecks(model: LifecycleModel): Finding[]` (sorted by file, line, checkId); `FieldSuggestion = { readonly field: StateField; readonly terminal: readonly StateValue[] }`, `LifecycleSuggestion = { readonly className: string; readonly file: string; readonly fields: readonly FieldSuggestion[] }`, `suggestLifecycles(model: LifecycleModel): LifecycleSuggestion[]`; `lifecycleAnalyzer: Analyzer<LifecycleModel, LifecycleSuggestion>`; `runAnalyzers(input: AnalysisInput): readonly AnalysisResult[]`.
- Task 12 replaces the `diagram` and `summarize` stubs in `lifecycleAnalyzer`.

- [ ] **Step 1: Write the failing tests**

`test/analyzers/lifecycle/suggest.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { suggestLifecycles } from '../../../src/analyzers/lifecycle/suggest';
import { STATUS, aggregate, assigned, known, method, stateField, unknownSources } from '../../helpers/model';

const terminalLabels = (model: Parameters<typeof suggestLifecycles>[0]) =>
  suggestLifecycles(model).flatMap((suggestion) =>
    suggestion.fields.map((field) => [field.field.name, field.terminal.map((value) => value.token)]),
  );

describe('suggestLifecycles', () => {
  it('suggests reached states without outgoing transitions as terminal', () => {
    const methods = [
      method('confirm', true, { status: { sources: known('PENDING'), sets: assigned('CONFIRMED') } }),
      method('cancel', true, { status: { sources: known('PENDING', 'CONFIRMED'), sets: assigned('CANCELLED') } }),
    ];

    expect(terminalLabels({ aggregates: [aggregate({ declared: false, declarations: new Map(), methods })], problems: [] })).toEqual([
      ['status', ['CANCELLED']],
    ]);
  });

  it('treats a state that is only re-entered from itself as terminal', () => {
    const deleted = stateField('deleted', 'boolean', ['true', 'false']);
    const methods = [method('delete', true, { deleted: { sources: known('true', 'false'), sets: assigned('true') } })];

    expect(
      terminalLabels({ aggregates: [aggregate({ declared: false, declarations: new Map(), fields: [deleted], methods })], problems: [] }),
    ).toEqual([['deleted', ['true']]]);
  });

  it('suggests no terminal state when a setter guard could not be analysed', () => {
    const methods = [method('cancel', true, { status: { sources: unknownSources, sets: assigned('CANCELLED') } })];

    expect(terminalLabels({ aggregates: [aggregate({ declared: false, declarations: new Map(), methods })], problems: [] })).toEqual([
      ['status', []],
    ]);
  });

  it('skips aggregates that are already declared', () => {
    expect(suggestLifecycles({ aggregates: [aggregate({ fields: [STATUS] })], problems: [] })).toEqual([]);
  });
});
```

`test/analyzers/lifecycle/analyzer.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { analyse } from '../../../src/analyzer';
import { lifecycleAnalyzer } from '../../../src/analyzers/lifecycle/analyzer';
import { DEFAULT_DECLARATION } from '../../../src/engine/declaration';
import { AGGREGATE_ROOT, inMemoryProject } from '../../helpers/in-memory';

const project = inMemoryProject({
  '/src/aggregate-root.ts': AGGREGATE_ROOT,
  '/src/ticket.ts': `
import { AggregateRoot } from './aggregate-root';
export enum TicketStatus { open = 'OPEN', closed = 'CLOSED' }
export class Ticket extends AggregateRoot<{ status: TicketStatus; title: string }> {
  static open(title: string): Ticket { return new Ticket({ status: TicketStatus.open, title }); }
  rename(title: string): void { this.props.title = title; }
  close(): void { if (this.props.status === TicketStatus.closed) return; this.props.status = TicketStatus.closed; }
}
`,
});

const ticket = project.getSourceFileOrThrow('/src/ticket.ts').getClassOrThrow('Ticket');

describe('lifecycleAnalyzer', () => {
  it('runs all checks and reports the leak for an unguarded mutating method', () => {
    const result = analyse(lifecycleAnalyzer, {
      declaration: {
        ...DEFAULT_DECLARATION,
        lifecycles: [{ target: ticket, fields: [{ name: 'status', terminal: ['CLOSED'], transitions: undefined }], allowAfterTerminal: [] }],
      },
      files: project.getSourceFiles(),
    });

    expect(result.findings.map((finding) => `${finding.checkId} ${finding.method}`)).toEqual(['terminal-state-leak rename']);
  });

  it('describes its four rules', () => {
    expect(lifecycleAnalyzer.rules.map((rule) => rule.id)).toEqual([
      'terminal-state-leak',
      'unreachable-state',
      'outside-mutation',
      'transition-drift',
    ]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/analyzers/lifecycle/suggest.test.ts test/analyzers/lifecycle/analyzer.test.ts`
Expected: FAIL, cannot resolve `suggest` / `analyzer`.

- [ ] **Step 3: Write the implementation**

Append to `src/analyzer.ts`:

```ts
export type RuleDescription = { readonly id: string; readonly description: string };

export type Analyzer<Model, Suggestion> = {
  readonly id: string;
  readonly rules: readonly RuleDescription[];
  readonly extract: (input: AnalysisInput) => Model;
  readonly problems: (model: Model) => readonly string[];
  readonly suggest: (model: Model) => readonly Suggestion[];
  readonly check: (model: Model) => readonly Finding[];
  readonly diagram: (model: Model, only: string | undefined) => string;
  readonly summarize: (model: Model, root: string) => string;
  readonly isEmpty: (model: Model) => boolean;
};

export type AnalysisResult = {
  readonly rules: readonly RuleDescription[];
  readonly problems: readonly string[];
  readonly findings: readonly Finding[];
  readonly diagram: (only: string | undefined) => string;
  readonly summary: (root: string) => string;
  readonly isEmpty: boolean;
};

export const analyse = <Model, Suggestion>(
  analyzer: Analyzer<Model, Suggestion>,
  input: AnalysisInput,
): AnalysisResult => {
  const model = analyzer.extract(input);
  return {
    rules: analyzer.rules,
    problems: analyzer.problems(model),
    findings: analyzer.check(model),
    diagram: (only) => analyzer.diagram(model, only),
    summary: (root) => analyzer.summarize(model, root),
    isEmpty: analyzer.isEmpty(model),
  };
};
```

`src/analyzers/lifecycle/checks/index.ts`:

```ts
import { Finding, RuleDescription } from '../../../analyzer';
import { LifecycleModel } from '../model';
import { outsideMutation } from './outside-mutation';
import { terminalStateLeak } from './terminal-state-leak';
import { transitionDrift } from './transition-drift';
import { unreachableState } from './unreachable-state';

export const LIFECYCLE_RULES: readonly RuleDescription[] = [
  { id: 'terminal-state-leak', description: 'A method can change an aggregate after it reached a terminal state.' },
  { id: 'unreachable-state', description: 'A declared state value is never assigned.' },
  { id: 'outside-mutation', description: 'Aggregate state is assigned outside the aggregate.' },
  { id: 'transition-drift', description: "A method's allowed source states differ from its declared transition." },
];

const CHECKS = [terminalStateLeak, unreachableState, outsideMutation, transitionDrift];

const byLocation = (a: Finding, b: Finding): number =>
  a.file.localeCompare(b.file) || a.line - b.line || a.checkId.localeCompare(b.checkId);

export const runChecks = (model: LifecycleModel): Finding[] =>
  model.aggregates.flatMap((aggregate) => CHECKS.flatMap((check) => check(aggregate))).sort(byLocation);
```

`src/analyzers/lifecycle/suggest.ts`:

```ts
import { AggregateModel, FieldBehaviour, LifecycleModel, StateField, StateValue } from './model';
import { assignsAnything } from './values';

export type FieldSuggestion = { readonly field: StateField; readonly terminal: readonly StateValue[] };

export type LifecycleSuggestion = {
  readonly className: string;
  readonly file: string;
  readonly fields: readonly FieldSuggestion[];
};

const leavesFrom = (behaviour: FieldBehaviour, token: string): boolean =>
  behaviour.sources.kind === 'unknown' ||
  behaviour.sets.unresolved ||
  (behaviour.sources.values.has(token) && [...behaviour.sets.tokens].some((target) => target !== token));

const terminalGuess = (aggregate: AggregateModel, field: StateField): StateValue[] => {
  const setters = aggregate.methods
    .map((method) => method.fields.get(field.name))
    .filter((behaviour): behaviour is FieldBehaviour => behaviour !== undefined && assignsAnything(behaviour.sets));
  return field.values.filter(
    (value) =>
      setters.some((behaviour) => behaviour.sets.tokens.has(value.token)) &&
      !setters.some((behaviour) => leavesFrom(behaviour, value.token)),
  );
};

export const suggestLifecycles = (model: LifecycleModel): LifecycleSuggestion[] =>
  model.aggregates
    .filter((aggregate) => !aggregate.declared && aggregate.fields.length > 0)
    .map((aggregate) => ({
      className: aggregate.name,
      file: aggregate.file,
      fields: aggregate.fields.map((field) => ({ field, terminal: terminalGuess(aggregate, field) })),
    }));
```

`src/analyzers/lifecycle/analyzer.ts`:

```ts
import { Analyzer } from '../../analyzer';
import { LIFECYCLE_RULES, runChecks } from './checks';
import { extractLifecycles } from './extract';
import { LifecycleModel } from './model';
import { LifecycleSuggestion, suggestLifecycles } from './suggest';

export const lifecycleAnalyzer: Analyzer<LifecycleModel, LifecycleSuggestion> = {
  id: 'lifecycle',
  rules: LIFECYCLE_RULES,
  extract: extractLifecycles,
  problems: (model) => model.problems,
  suggest: suggestLifecycles,
  check: runChecks,
  diagram: () => '',
  summarize: () => '',
  isEmpty: (model) => model.aggregates.length === 0,
};
```

`src/analysis.ts`:

```ts
import { AnalysisInput, AnalysisResult, analyse } from './analyzer';
import { lifecycleAnalyzer } from './analyzers/lifecycle/analyzer';

export const runAnalyzers = (input: AnalysisInput): readonly AnalysisResult[] => [analyse(lifecycleAnalyzer, input)];
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/analyzers && npm run typecheck && npm run lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: add analyzer contract, suggestions and lifecycle analyzer" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 12: Mermaid diagrams and agent summary

**Files:**
- Create: `src/analyzers/lifecycle/diagram.ts`, `src/analyzers/lifecycle/summary.ts`
- Modify: `src/analyzers/lifecycle/analyzer.ts` (replace the `diagram` and `summarize` stubs)
- Test: `test/analyzers/lifecycle/diagram.test.ts`, `test/analyzers/lifecycle/summary.test.ts`

**Interfaces:**
- Consumes: `labelsOf`, `quoted` (Task 9), model builders (Task 9).
- Produces: `fieldDiagram(aggregate: AggregateModel, field: StateField): string`, `lifecycleDiagrams(model: LifecycleModel, only: string | undefined): string`, `lifecycleSummary(model: LifecycleModel, root: string): string`.

- [ ] **Step 1: Write the failing tests**

Shared fixture for both tests: define it at the top of each test file.

```ts
import { aggregate, assigned, declared, known, method, STATUS } from '../../helpers/model';

const ORDER = aggregate({
  fields: [STATUS],
  declarations: new Map([['status', declared(['CANCELLED'], { confirm: ['PENDING'], cancel: ['PENDING'] })]]),
  initial: new Map([['status', assigned('PENDING')]]),
  methods: [
    method('confirm', true, { status: { sources: known('PENDING'), sets: assigned('CONFIRMED') } }),
    method('cancel', true, { status: { sources: known('PENDING', 'CONFIRMED', 'CANCELLED'), sets: assigned('CANCELLED') } }),
  ],
});
```

`test/analyzers/lifecycle/diagram.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { fieldDiagram, lifecycleDiagrams } from '../../../src/analyzers/lifecycle/diagram';
import { aggregate, assigned, declared, known, method, STATUS } from '../../helpers/model';

const ORDER = aggregate({
  fields: [STATUS],
  declarations: new Map([['status', declared(['CANCELLED'], { confirm: ['PENDING'], cancel: ['PENDING'] })]]),
  initial: new Map([['status', assigned('PENDING')]]),
  methods: [
    method('confirm', true, { status: { sources: known('PENDING'), sets: assigned('CONFIRMED') } }),
    method('cancel', true, { status: { sources: known('PENDING', 'CONFIRMED', 'CANCELLED'), sets: assigned('CANCELLED') } }),
  ],
});

describe('fieldDiagram', () => {
  it('draws states, transitions, drift, leaks and terminal markers', () => {
    expect(fieldDiagram(ORDER, STATUS)).toBe(
      [
        'stateDiagram-v2',
        '  state "pending" as status_0',
        '  state "confirmed" as status_1',
        '  state "cancelled" as status_2',
        '  [*] --> status_0',
        '  status_0 --> status_1 : confirm',
        '  status_0 --> status_2 : cancel',
        '  status_1 --> status_2 : cancel ⚠ undeclared',
        '  status_2 --> status_2 : cancel ⚠ leak',
        '  status_2 --> [*]',
        '  classDef terminal font-weight:bold',
        '  classDef leak fill:#fde2e2,stroke:#c0392b',
        '  class status_2 leak',
      ].join('\n'),
    );
  });
});

describe('lifecycleDiagrams', () => {
  it('wraps each declared field in a titled mermaid block', () => {
    expect(lifecycleDiagrams({ aggregates: [ORDER], problems: [] }, undefined)).toBe(
      `## Order.status\n\n\`\`\`mermaid\n${fieldDiagram(ORDER, STATUS)}\n\`\`\``,
    );
  });

  it('returns an empty string when the named aggregate is not declared', () => {
    expect(lifecycleDiagrams({ aggregates: [ORDER], problems: [] }, 'Payment')).toBe('');
  });
});
```

`test/analyzers/lifecycle/summary.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { lifecycleSummary } from '../../../src/analyzers/lifecycle/summary';
import { aggregate, assigned, declared, known, method, STATUS } from '../../helpers/model';

const ORDER = aggregate({
  fields: [STATUS],
  declarations: new Map([['status', declared(['CANCELLED'], { confirm: ['PENDING'], cancel: ['PENDING'] })]]),
  initial: new Map([['status', assigned('PENDING')]]),
  methods: [
    method('confirm', true, { status: { sources: known('PENDING'), sets: assigned('CONFIRMED') } }),
    method('cancel', true, { status: { sources: known('PENDING', 'CONFIRMED', 'CANCELLED'), sets: assigned('CANCELLED') } }),
  ],
});

describe('lifecycleSummary', () => {
  it('summarises declared lifecycles and the rules for agents', () => {
    expect(lifecycleSummary({ aggregates: [ORDER], problems: [] }, '/app')).toBe(
      [
        '## Domain lifecycles',
        '',
        'Rules for changing these aggregates:',
        '- Never change an aggregate after it reaches a terminal state, except through the listed methods.',
        "- Change state only through the aggregate's own methods.",
        '- Run `domain-integrity check` after changing domain code.',
        '',
        '### Order (src/order.ts)',
        '- status: pending, confirmed, cancelled',
        '  - terminal: cancelled',
        '  - confirm: pending → confirmed',
        '  - cancel: pending → cancelled',
        '',
      ].join('\n'),
    );
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/analyzers/lifecycle/diagram.test.ts test/analyzers/lifecycle/summary.test.ts`
Expected: FAIL, cannot resolve the modules.

- [ ] **Step 3: Write the implementation**

`src/analyzers/lifecycle/diagram.ts`:

```ts
import { AggregateModel, FieldDeclaration, LifecycleModel, MethodModel, StateField } from './model';

type Edge = { readonly from: string; readonly to: string; readonly label: string };

const stateId = (field: StateField, token: string): string =>
  `${field.name}_${field.values.findIndex((value) => value.token === token)}`;

const leakedSources = (aggregate: AggregateModel, method: MethodModel, field: StateField, terminal: ReadonlySet<string>): string[] => {
  const sources = method.fields.get(field.name)?.sources;
  if (!method.mutates || aggregate.allowAfterTerminal.has(method.name) || sources?.kind !== 'known') return [];
  return [...terminal].filter((token) => sources.values.has(token));
};

const methodEdges = (
  aggregate: AggregateModel,
  method: MethodModel,
  field: StateField,
  declaration: FieldDeclaration | undefined,
): Edge[] => {
  const behaviour = method.fields.get(field.name);
  if (!behaviour || behaviour.sources.kind === 'unknown') return [];
  const terminal = declaration?.terminal ?? new Set<string>();
  const declared = declaration?.transitions?.get(method.name);
  const leaks = leakedSources(aggregate, method, field, terminal);
  const targets = [...behaviour.sets.tokens];
  const moves = [...behaviour.sources.values].flatMap((from) =>
    targets
      .filter((to) => to !== from)
      .map((to) => ({
        from,
        to,
        label: `${method.name}${declared && !declared.has(from) ? ' ⚠ undeclared' : ''}${leaks.includes(from) ? ' ⚠ leak' : ''}`,
      })),
  );
  const selfLeaks = leaks
    .filter((token) => !targets.some((to) => to !== token))
    .map((token) => ({ from: token, to: token, label: `${method.name} ⚠ leak` }));
  return [...moves, ...selfLeaks];
};

const unanalysed = (aggregate: AggregateModel, field: StateField): string[] => {
  const names = aggregate.methods
    .filter((method) => method.mutates && method.fields.get(field.name)?.sources.kind === 'unknown')
    .map((method) => method.name);
  const [first] = field.values;
  return names.length === 0 || first === undefined
    ? []
    : [`  note right of ${stateId(field, first.token)} : guard not analysed: ${names.join(', ')}`];
};

export const fieldDiagram = (aggregate: AggregateModel, field: StateField): string => {
  const declaration = aggregate.declarations.get(field.name);
  const terminal = [...(declaration?.terminal ?? new Set<string>())];
  const edges = aggregate.methods.flatMap((method) => methodEdges(aggregate, method, field, declaration));
  const leaked = new Set(edges.filter((edge) => edge.label.endsWith('⚠ leak')).map((edge) => edge.from));
  return [
    'stateDiagram-v2',
    ...field.values.map((value) => `  state "${value.label}" as ${stateId(field, value.token)}`),
    ...[...(aggregate.initial.get(field.name)?.tokens ?? [])].map((token) => `  [*] --> ${stateId(field, token)}`),
    ...edges.map((edge) => `  ${stateId(field, edge.from)} --> ${stateId(field, edge.to)} : ${edge.label}`),
    ...terminal.map((token) => `  ${stateId(field, token)} --> [*]`),
    ...unanalysed(aggregate, field),
    '  classDef terminal font-weight:bold',
    '  classDef leak fill:#fde2e2,stroke:#c0392b',
    ...terminal.map((token) => `  class ${stateId(field, token)} ${leaked.has(token) ? 'leak' : 'terminal'}`),
  ].join('\n');
};

export const lifecycleDiagrams = (model: LifecycleModel, only: string | undefined): string =>
  model.aggregates
    .filter((aggregate) => aggregate.declared && (only === undefined || aggregate.name === only))
    .flatMap((aggregate) =>
      aggregate.fields
        .filter((field) => aggregate.declarations.has(field.name))
        .map((field) => `## ${aggregate.name}.${field.name}\n\n\`\`\`mermaid\n${fieldDiagram(aggregate, field)}\n\`\`\``),
    )
    .join('\n\n');
```

`src/analyzers/lifecycle/summary.ts`:

```ts
import { relative } from 'node:path';
import { labelsOf } from './checks/format';
import { AggregateModel, FieldDeclaration, LifecycleModel, StateField } from './model';
import { assignsAnything } from './values';

const RULES = [
  '## Domain lifecycles',
  '',
  'Rules for changing these aggregates:',
  '- Never change an aggregate after it reaches a terminal state, except through the listed methods.',
  "- Change state only through the aggregate's own methods.",
  '- Run `domain-integrity check` after changing domain code.',
];

const joined = (field: StateField, tokens: Iterable<string>): string => labelsOf(field, tokens).join(', ');

const transitionLines = (aggregate: AggregateModel, field: StateField, declaration: FieldDeclaration): string[] =>
  aggregate.methods.flatMap((method) => {
    const behaviour = method.fields.get(field.name);
    if (!behaviour || !assignsAnything(behaviour.sets)) return [];
    const declared = declaration.transitions?.get(method.name);
    const from = declared
      ? joined(field, declared)
      : behaviour.sources.kind === 'known'
        ? joined(field, behaviour.sources.values)
        : 'unknown';
    const to = [...labelsOf(field, behaviour.sets.tokens), ...(behaviour.sets.unresolved ? ['(computed)'] : [])].join(', ');
    return [`  - ${method.name}: ${from} → ${to}`];
  });

const fieldLines = (aggregate: AggregateModel, field: StateField, declaration: FieldDeclaration): string[] => [
  `- ${field.name}: ${field.values.map((value) => value.label).join(', ')}`,
  `  - terminal: ${joined(field, declaration.terminal) || 'none'}`,
  ...transitionLines(aggregate, field, declaration),
];

const aggregateSection = (aggregate: AggregateModel, root: string): string[] => [
  `### ${aggregate.name} (${relative(root, aggregate.file)})`,
  ...aggregate.fields.flatMap((field) => {
    const declaration = aggregate.declarations.get(field.name);
    return declaration ? fieldLines(aggregate, field, declaration) : [];
  }),
  ...(aggregate.allowAfterTerminal.size > 0
    ? [`- may run after a terminal state: ${[...aggregate.allowAfterTerminal].join(', ')}`]
    : []),
];

export const lifecycleSummary = (model: LifecycleModel, root: string): string =>
  [
    ...RULES,
    ...model.aggregates.filter((aggregate) => aggregate.declared).flatMap((aggregate) => ['', ...aggregateSection(aggregate, root)]),
    '',
  ].join('\n');
```

In `src/analyzers/lifecycle/analyzer.ts`, add `import { lifecycleDiagrams } from './diagram';` and `import { lifecycleSummary } from './summary';`, then replace the two stub lines with:

```ts
  diagram: lifecycleDiagrams,
  summarize: lifecycleSummary,
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/analyzers && npm run typecheck && npm run lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: render lifecycle diagrams and agent summaries" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 13: Reporters and baseline

**Files:**
- Create: `src/report/text.ts`, `src/report/json.ts`, `src/report/sarif.ts`, `src/report/baseline.ts`
- Test: `test/report/text.test.ts`, `test/report/json.test.ts`, `test/report/sarif.test.ts`, `test/report/baseline.test.ts`

**Interfaces:**
- Consumes: `Finding`, `findingKey`, `RuleDescription` (Tasks 9, 11), `UsageError` (Task 2).
- Produces:
  - `Report = { readonly fresh: readonly Finding[]; readonly known: readonly Finding[]; readonly problems: readonly string[]; readonly rules: readonly RuleDescription[]; readonly root: string }` (in `src/report/text.ts`, re-exported by the others)
  - `formatText(report: Report): string`, `formatJson(report: Report): string`, `formatSarif(report: Report): string`
  - `serializeBaseline(findings: readonly Finding[]): string`, `readBaseline(path: string): ReadonlySet<string>`, `partitionByBaseline(findings: readonly Finding[], baseline: ReadonlySet<string>): { fresh: Finding[]; known: Finding[] }`

- [ ] **Step 1: Write the failing tests**

Shared builder: add to `test/helpers/model.ts`:

```ts
import { Finding } from '../../src/analyzer';

export const finding = (overrides: Partial<Finding>): Finding => ({
  checkId: 'terminal-state-leak',
  severity: 'error',
  aggregate: 'Order',
  method: 'annotate',
  field: 'status',
  subject: 'CANCELLED',
  file: '/app/src/order.ts',
  line: 10,
  message: 'M1',
  fix: 'F1',
  ...overrides,
});
```

`test/report/text.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { formatText } from '../../src/report/text';
import { finding } from '../helpers/model';

describe('formatText', () => {
  it('lists fresh findings, then known ones, then a summary', () => {
    const text = formatText({
      fresh: [finding({})],
      known: [finding({ checkId: 'unreachable-state', method: undefined, line: 3, message: 'M2', fix: 'F2' })],
      problems: [],
      rules: [],
      root: '/app',
    });

    expect(text).toBe(
      [
        'error terminal-state-leak  Order.annotate()  src/order.ts:10',
        '  M1',
        '  Fix: F1',
        '',
        'error unreachable-state  Order  src/order.ts:3 (baseline)',
        '  M2',
        '  Fix: F2',
        '',
        '1 error, 0 warnings, 1 known from baseline',
        '',
      ].join('\n'),
    );
  });

  it('prints only the summary when there is nothing to report', () => {
    expect(formatText({ fresh: [], known: [], problems: [], rules: [], root: '/app' })).toBe('0 errors, 0 warnings\n');
  });
});
```

`test/report/json.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { formatJson } from '../../src/report/json';
import { finding } from '../helpers/model';

describe('formatJson', () => {
  it('writes findings with paths relative to the root', () => {
    const parsed = JSON.parse(formatJson({ fresh: [finding({})], known: [], problems: ['p'], rules: [], root: '/app' }));

    expect(parsed).toEqual({ findings: [{ ...finding({}), file: 'src/order.ts' }], known: [], problems: ['p'] });
  });
});
```

`test/report/sarif.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { formatSarif } from '../../src/report/sarif';
import { finding } from '../helpers/model';

describe('formatSarif', () => {
  it('produces a SARIF 2.1.0 run with rules and located results', () => {
    const parsed = JSON.parse(
      formatSarif({
        fresh: [finding({ severity: 'warning' })],
        known: [],
        problems: [],
        rules: [{ id: 'terminal-state-leak', description: 'D' }],
        root: '/app',
      }),
    );

    expect(parsed).toEqual({
      $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
      version: '2.1.0',
      runs: [
        {
          tool: { driver: { name: 'domain-integrity', rules: [{ id: 'terminal-state-leak', shortDescription: { text: 'D' } }] } },
          results: [
            {
              ruleId: 'terminal-state-leak',
              level: 'warning',
              message: { text: 'M1 Fix: F1' },
              locations: [{ physicalLocation: { artifactLocation: { uri: 'src/order.ts' }, region: { startLine: 10 } } }],
            },
          ],
        },
      ],
    });
  });
});
```

`test/report/baseline.test.ts`:

```ts
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { UsageError } from '../../src/engine/errors';
import { partitionByBaseline, readBaseline, serializeBaseline } from '../../src/report/baseline';
import { finding } from '../helpers/model';

const tempFile = (content: string): string => {
  const path = join(mkdtempSync(join(tmpdir(), 'baseline-')), 'baseline.json');
  writeFileSync(path, content);
  return path;
};

describe('baseline', () => {
  it('round-trips findings by key, independent of line numbers', () => {
    const baseline = readBaseline(tempFile(serializeBaseline([finding({ line: 10 })])));

    expect(partitionByBaseline([finding({ line: 99 }), finding({ method: 'other' })], baseline)).toEqual({
      fresh: [finding({ method: 'other' })],
      known: [finding({ line: 99 })],
    });
  });

  it('rejects a missing baseline file with a usage error', () => {
    expect(() => readBaseline('/definitely/missing/baseline.json')).toThrow(UsageError);
  });

  it('rejects a file that is not a baseline', () => {
    expect(() => readBaseline(tempFile('{"nope": true}'))).toThrow(UsageError);
  });

  it('rejects invalid JSON', () => {
    expect(() => readBaseline(tempFile('not json'))).toThrow(UsageError);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/report`
Expected: FAIL, cannot resolve report modules.

- [ ] **Step 3: Write the implementation**

`src/report/text.ts`:

```ts
import { relative } from 'node:path';
import { Finding, RuleDescription } from '../analyzer';

export type Report = {
  readonly fresh: readonly Finding[];
  readonly known: readonly Finding[];
  readonly problems: readonly string[];
  readonly rules: readonly RuleDescription[];
  readonly root: string;
};

const plural = (count: number, word: string): string => `${count} ${word}${count === 1 ? '' : 's'}`;

const entry = (finding: Finding, root: string, suffix: string): string =>
  [
    `${finding.severity} ${finding.checkId}  ${finding.aggregate}${finding.method ? `.${finding.method}()` : ''}  ${relative(root, finding.file)}:${finding.line}${suffix}`,
    `  ${finding.message}`,
    `  Fix: ${finding.fix}`,
  ].join('\n');

export const formatText = (report: Report): string => {
  const errors = report.fresh.filter((finding) => finding.severity === 'error').length;
  const warnings = report.fresh.length - errors;
  const known = report.known.length > 0 ? `, ${report.known.length} known from baseline` : '';
  const summary = `${plural(errors, 'error')}, ${plural(warnings, 'warning')}${known}`;
  return `${[
    ...report.fresh.map((finding) => entry(finding, report.root, '')),
    ...report.known.map((finding) => entry(finding, report.root, ' (baseline)')),
    summary,
  ].join('\n\n')}\n`;
};
```

`src/report/json.ts`:

```ts
import { relative } from 'node:path';
import { Finding } from '../analyzer';
import { Report } from './text';

const relativeTo = (root: string) => (finding: Finding): Finding => ({ ...finding, file: relative(root, finding.file) });

export const formatJson = (report: Report): string =>
  `${JSON.stringify(
    {
      findings: report.fresh.map(relativeTo(report.root)),
      known: report.known.map(relativeTo(report.root)),
      problems: report.problems,
    },
    null,
    2,
  )}\n`;
```

`src/report/sarif.ts`:

```ts
import { relative } from 'node:path';
import { Report } from './text';

export const formatSarif = (report: Report): string =>
  `${JSON.stringify(
    {
      $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
      version: '2.1.0',
      runs: [
        {
          tool: {
            driver: {
              name: 'domain-integrity',
              rules: report.rules.map((rule) => ({ id: rule.id, shortDescription: { text: rule.description } })),
            },
          },
          results: report.fresh.map((finding) => ({
            ruleId: finding.checkId,
            level: finding.severity,
            message: { text: `${finding.message} Fix: ${finding.fix}` },
            locations: [
              {
                physicalLocation: {
                  artifactLocation: { uri: relative(report.root, finding.file) },
                  region: { startLine: finding.line },
                },
              },
            ],
          })),
        },
      ],
    },
    null,
    2,
  )}\n`;
```

`src/report/baseline.ts`:

```ts
import { existsSync, readFileSync } from 'node:fs';
import { Finding, findingKey } from '../analyzer';
import { UsageError } from '../engine/errors';

type BaselineFile = { readonly findings: readonly string[] };

const isBaselineFile = (value: unknown): value is BaselineFile =>
  typeof value === 'object' &&
  value !== null &&
  'findings' in value &&
  Array.isArray(value.findings) &&
  value.findings.every((entry: unknown) => typeof entry === 'string');

const parse = (path: string): unknown => {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    throw new UsageError(`Baseline ${path} is not valid JSON.`);
  }
};

export const serializeBaseline = (findings: readonly Finding[]): string =>
  `${JSON.stringify({ version: 1, findings: [...new Set(findings.map(findingKey))].sort() }, null, 2)}\n`;

export const readBaseline = (path: string): ReadonlySet<string> => {
  if (!existsSync(path)) throw new UsageError(`Baseline ${path} not found. Create it with --update-baseline.`);
  const parsed = parse(path);
  if (!isBaselineFile(parsed)) throw new UsageError(`Baseline ${path} is not a domain-integrity baseline.`);
  return new Set(parsed.findings);
};

export const partitionByBaseline = (
  findings: readonly Finding[],
  baseline: ReadonlySet<string>,
): { fresh: Finding[]; known: Finding[] } => ({
  fresh: findings.filter((finding) => !baseline.has(findingKey(finding))),
  known: findings.filter((finding) => baseline.has(findingKey(finding))),
});
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/report && npm run typecheck && npm run lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: add text, json and sarif reporters with baseline" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 14: CLI: check, show, context

**Files:**
- Create: `src/cli/io.ts`, `src/cli/session.ts`, `src/cli/section.ts`, `src/cli/check.ts`, `src/cli/show.ts`, `src/cli/context.ts`, `src/cli/run.ts`, `src/cli/main.ts`, `test/helpers/disk.ts`
- Test: `test/cli/section.test.ts`, `test/cli/run.test.ts`

**Interfaces:**
- Consumes: Tasks 2, 3, 11, 13.
- Produces:
  - `Prompt = (question: string) => Promise<boolean>`
  - `Io = { readonly cwd: string; readonly out: (text: string) => void; readonly err: (text: string) => void; readonly prompt: Prompt; readonly isInteractive: boolean }`
  - `Paths = { readonly tsconfig: string; readonly config: string; readonly root: string }`
  - `openSession(paths: Paths): Session`, where `Session = { readonly results: readonly AnalysisResult[] }`
  - `noAggregatesMessage(declaration: DomainDeclaration): string`
  - `replaceSection(existing: string | undefined, content: string): string`
  - `run(argv: readonly string[], io: Io): Promise<number>`
  - test helpers `writeProject(files: Readonly<Record<string, string>>): string`, `captureIo(cwd: string, answers?: readonly boolean[])`, `TICKET_PROJECT`
- Task 15 adds the `init` command to `run.ts`.

- [ ] **Step 1: Write the disk test helper**

`test/helpers/disk.ts`:

```ts
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Io } from '../../src/cli/io';
import { AGGREGATE_ROOT } from './in-memory';

const HELPERS_ENTRY = fileURLToPath(new URL('../../src/index.ts', import.meta.url));

export const TICKET_SOURCES = {
  'src/aggregate-root.ts': AGGREGATE_ROOT,
  'src/ticket.ts': `
import { AggregateRoot } from './aggregate-root';
export enum TicketStatus { open = 'OPEN', closed = 'CLOSED' }
export class Ticket extends AggregateRoot<{ status: TicketStatus; title: string }> {
  static open(title: string): Ticket { return new Ticket({ status: TicketStatus.open, title }); }
  rename(title: string): void { this.props.title = title; }
  close(): void { if (this.props.status === TicketStatus.closed) return; this.props.status = TicketStatus.closed; }
}
`,
};

export const TICKET_CONFIG = `
import { defineDomain, lifecycle } from 'domain-integrity';
import { Ticket, TicketStatus } from './src/ticket';
export default defineDomain({ lifecycles: [lifecycle(Ticket, { states: { status: { terminal: [TicketStatus.closed] } } })] });
`;

export const TICKET_PROJECT = { ...TICKET_SOURCES, 'domain.config.ts': TICKET_CONFIG };

export const writeProject = (files: Readonly<Record<string, string>>): string => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'domain-integrity-cli-')));
  const tsconfig = {
    compilerOptions: {
      strict: true,
      target: 'ES2022',
      module: 'ESNext',
      moduleResolution: 'Bundler',
      paths: { 'domain-integrity': [HELPERS_ENTRY] },
    },
    include: ['src'],
  };
  writeFileSync(join(dir, 'tsconfig.json'), JSON.stringify(tsconfig));
  Object.entries(files).forEach(([path, text]) => {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  });
  return dir;
};

export const captureIo = (cwd: string, answers: readonly boolean[] = []) => {
  const out: string[] = [];
  const err: string[] = [];
  const pending = [...answers];
  const io: Io = {
    cwd,
    out: (text) => out.push(text),
    err: (text) => err.push(text),
    prompt: async () => pending.shift() ?? true,
    isInteractive: answers.length > 0,
  };
  return { io, stdout: () => out.join(''), stderr: () => err.join('') };
};
```

- [ ] **Step 2: Write the failing tests**

`test/cli/section.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { replaceSection } from '../../src/cli/section';

const START = '<!-- domain-integrity:start -->';
const END = '<!-- domain-integrity:end -->';

describe('replaceSection', () => {
  it('creates the block when the file does not exist', () => {
    expect(replaceSection(undefined, 'body\n')).toBe(`${START}\nbody\n${END}\n`);
  });

  it('appends the block to a file without markers', () => {
    expect(replaceSection('# Agents\n', 'body')).toBe(`# Agents\n\n${START}\nbody\n${END}\n`);
  });

  it('replaces only the content between existing markers', () => {
    expect(replaceSection(`before\n${START}\nold\n${END}\nafter\n`, 'new')).toBe(`before\n${START}\nnew\n${END}\nafter\n`);
  });
});
```

`test/cli/run.test.ts`:

```ts
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { run } from '../../src/cli/run';
import { TICKET_PROJECT, TICKET_SOURCES, captureIo, writeProject } from '../helpers/disk';

describe('check', () => {
  it('exits 1 and prints the leak for an unguarded mutating method', async () => {
    const { io, stdout } = captureIo(writeProject(TICKET_PROJECT));

    expect({ code: await run(['check'], io), leak: stdout().includes('terminal-state-leak  Ticket.rename()') }).toEqual({ code: 1, leak: true });
  });

  it('writes machine-readable JSON', async () => {
    const { io, stdout } = captureIo(writeProject(TICKET_PROJECT));
    await run(['check', '--format', 'json'], io);

    expect(JSON.parse(stdout()).findings.map((finding: { method: string }) => finding.method)).toEqual(['rename']);
  });

  it('exits 0 for findings already in the baseline', async () => {
    const dir = writeProject(TICKET_PROJECT);
    await run(['check', '--update-baseline', '--baseline', 'baseline.json'], captureIo(dir).io);
    const { io, stdout } = captureIo(dir);

    expect({ code: await run(['check', '--baseline', 'baseline.json'], io), known: stdout().includes('(baseline)') }).toEqual({ code: 0, known: true });
  });

  it('exits 2 and suggests init when the config is missing', async () => {
    const { io, stderr } = captureIo(writeProject(TICKET_SOURCES));

    expect({ code: await run(['check'], io), hint: stderr().includes('domain-integrity init') }).toEqual({ code: 2, hint: true });
  });

  it('exits 2 when a declared field does not exist', async () => {
    const config = TICKET_PROJECT['domain.config.ts'].replace('status: {', 'missing: {');
    const { io, stderr } = captureIo(writeProject({ ...TICKET_PROJECT, 'domain.config.ts': config }));

    expect({ code: await run(['check'], io), problem: stderr().includes('Ticket has no field "missing"') }).toEqual({ code: 2, problem: true });
  });

  it('exits 2 for an unknown output format', async () => {
    const { io } = captureIo(writeProject(TICKET_PROJECT));

    expect(await run(['check', '--format', 'xml'], io)).toBe(2);
  });

  it('exits 2 when the project has no aggregates', async () => {
    const { io, stderr } = captureIo(
      writeProject({ 'src/a.ts': 'export const a = 1;\n', 'domain.config.ts': "import { defineDomain } from 'domain-integrity';\nexport default defineDomain({});\n" }),
    );

    expect({ code: await run(['check'], io), hint: stderr().includes('aggregateBaseClasses') }).toEqual({ code: 2, hint: true });
  });
});

describe('show', () => {
  it('prints a mermaid diagram for each declared aggregate', async () => {
    const { io, stdout } = captureIo(writeProject(TICKET_PROJECT));
    await run(['show'], io);

    expect(stdout().startsWith('## Ticket.status\n\n```mermaid\nstateDiagram-v2')).toBe(true);
  });

  it('exits 2 for an aggregate that is not declared', async () => {
    const { io } = captureIo(writeProject(TICKET_PROJECT));

    expect(await run(['show', 'Payment'], io)).toBe(2);
  });
});

describe('context', () => {
  it('prints the lifecycle summary', async () => {
    const { io, stdout } = captureIo(writeProject(TICKET_PROJECT));
    await run(['context'], io);

    expect(stdout()).toContain('### Ticket (src/ticket.ts)');
  });

  it('writes into an existing file without touching the rest of it', async () => {
    const dir = writeProject(TICKET_PROJECT);
    writeFileSync(join(dir, 'AGENTS.md'), '# Agents\n\nKeep this.\n');
    await run(['context', '--write', 'AGENTS.md'], captureIo(dir).io);
    const written = readFileSync(join(dir, 'AGENTS.md'), 'utf8');

    expect({ kept: written.startsWith('# Agents\n\nKeep this.\n'), added: written.includes('### Ticket') }).toEqual({ kept: true, added: true });
  });

  it('creates the target file when it does not exist', async () => {
    const dir = writeProject(TICKET_PROJECT);
    await run(['context', '--write', 'CLAUDE.md'], captureIo(dir).io);

    expect(existsSync(join(dir, 'CLAUDE.md'))).toBe(true);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run test/cli`
Expected: FAIL, cannot resolve CLI modules.

- [ ] **Step 4: Write the implementation**

`src/cli/io.ts`:

```ts
export type Prompt = (question: string) => Promise<boolean>;

export type Io = {
  readonly cwd: string;
  readonly out: (text: string) => void;
  readonly err: (text: string) => void;
  readonly prompt: Prompt;
  readonly isInteractive: boolean;
};

export type Paths = { readonly tsconfig: string; readonly config: string; readonly root: string };
```

`src/cli/session.ts`:

```ts
import { runAnalyzers } from '../analysis';
import { AnalysisResult } from '../analyzer';
import { DomainDeclaration } from '../engine/declaration';
import { ProjectError } from '../engine/errors';
import { analysedSourceFiles, configSourceFile, loadProject } from '../engine/project';
import { readDeclaration } from '../engine/read-config';
import { Paths } from './io';

export type Session = { readonly results: readonly AnalysisResult[] };

export const noAggregatesMessage = (declaration: DomainDeclaration): string =>
  `No aggregates found. Searched for classes extending: ${declaration.aggregateBaseClasses.join(', ')}. Set "aggregateBaseClasses" in domain.config.ts to match your base class.`;

export const openSession = (paths: Paths): Session => {
  const project = loadProject(paths.tsconfig);
  const configFile = configSourceFile(project, paths.config);
  const declaration = readDeclaration(configFile);
  const results = runAnalyzers({ declaration, files: analysedSourceFiles(project, paths.root, configFile) });
  if (results.every((result) => result.isEmpty)) throw new ProjectError(noAggregatesMessage(declaration));
  return { results };
};
```

`src/cli/section.ts`:

```ts
const START = '<!-- domain-integrity:start -->';
const END = '<!-- domain-integrity:end -->';

export const replaceSection = (existing: string | undefined, content: string): string => {
  const block = `${START}\n${content.trimEnd()}\n${END}`;
  if (existing === undefined) return `${block}\n`;
  const start = existing.indexOf(START);
  const end = existing.indexOf(END);
  if (start === -1 || end === -1 || end < start) return `${existing.trimEnd()}\n\n${block}\n`;
  return `${existing.slice(0, start)}${block}${existing.slice(end + END.length)}`;
};
```

`src/cli/check.ts`:

```ts
import { writeFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { UsageError } from '../engine/errors';
import { partitionByBaseline, readBaseline, serializeBaseline } from '../report/baseline';
import { formatJson } from '../report/json';
import { formatSarif } from '../report/sarif';
import { Report, formatText } from '../report/text';
import { Io, Paths } from './io';
import { openSession } from './session';

export type CheckOptions = {
  readonly format: string;
  readonly baseline?: string;
  readonly updateBaseline?: boolean;
};

const FORMATTERS: Readonly<Record<string, (report: Report) => string>> = {
  text: formatText,
  json: formatJson,
  sarif: formatSarif,
};

const DEFAULT_BASELINE = 'domain-integrity.baseline.json';

const formatterFor = (format: string): ((report: Report) => string) => {
  const formatter = FORMATTERS[format];
  if (!formatter) throw new UsageError(`Unknown format "${format}". Use one of: ${Object.keys(FORMATTERS).join(', ')}.`);
  return formatter;
};

export const checkCommand = (paths: Paths, options: CheckOptions, io: Io): number => {
  const format = formatterFor(options.format);
  const { results } = openSession(paths);
  const problems = results.flatMap((result) => result.problems);
  const findings = results.flatMap((result) => result.findings);
  problems.forEach((problem) => io.err(`problem: ${problem}\n`));
  if (options.updateBaseline) {
    const path = resolve(io.cwd, options.baseline ?? DEFAULT_BASELINE);
    writeFileSync(path, serializeBaseline(findings));
    io.out(`Baseline written to ${relative(io.cwd, path)} with ${findings.length} findings.\n`);
    return problems.length > 0 ? 2 : 0;
  }
  const baseline = options.baseline ? readBaseline(resolve(io.cwd, options.baseline)) : new Set<string>();
  const { fresh, known } = partitionByBaseline(findings, baseline);
  io.out(format({ fresh, known, problems, rules: results.flatMap((result) => result.rules), root: paths.root }));
  if (problems.length > 0) return 2;
  return fresh.some((finding) => finding.severity === 'error') ? 1 : 0;
};
```

`src/cli/show.ts`:

```ts
import { UsageError } from '../engine/errors';
import { Io, Paths } from './io';
import { openSession } from './session';

export const showCommand = (paths: Paths, aggregate: string | undefined, io: Io): number => {
  const { results } = openSession(paths);
  const output = results
    .map((result) => result.diagram(aggregate))
    .filter((diagram) => diagram.length > 0)
    .join('\n\n');
  if (output.length === 0) {
    throw new UsageError(
      aggregate ? `No declared aggregate named "${aggregate}".` : 'No declared aggregates to show. Run "domain-integrity init" first.',
    );
  }
  io.out(`${output}\n`);
  return 0;
};
```

`src/cli/context.ts`:

```ts
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { Io, Paths } from './io';
import { replaceSection } from './section';
import { openSession } from './session';

export const contextCommand = (paths: Paths, write: string | undefined, io: Io): number => {
  const { results } = openSession(paths);
  const summary = results.map((result) => result.summary(paths.root)).join('\n');
  if (write === undefined) {
    io.out(summary);
    return 0;
  }
  const target = resolve(io.cwd, write);
  const existing = existsSync(target) ? readFileSync(target, 'utf8') : undefined;
  writeFileSync(target, replaceSection(existing, summary));
  io.out(`Updated ${relative(io.cwd, target)}.\n`);
  return 0;
};
```

`src/cli/run.ts`:

```ts
import { dirname, resolve } from 'node:path';
import { Command, CommanderError } from 'commander';
import { DomainIntegrityError } from '../engine/errors';
import { CheckOptions, checkCommand } from './check';
import { contextCommand } from './context';
import { Io, Paths } from './io';
import { showCommand } from './show';

type CommonOptions = { readonly project: string; readonly config: string };

const pathsFrom = (options: CommonOptions, io: Io): Paths => {
  const tsconfig = resolve(io.cwd, options.project);
  return { tsconfig, config: resolve(io.cwd, options.config), root: dirname(tsconfig) };
};

const withCommonOptions = (command: Command): Command =>
  command
    .option('-p, --project <path>', 'path to tsconfig.json', 'tsconfig.json')
    .option('-c, --config <path>', 'path to domain.config.ts', 'domain.config.ts');

const buildProgram = (io: Io, outcome: { exitCode: number }): Command => {
  const program = new Command('domain-integrity')
    .description('Check that aggregate lifecycles match their declared intent.')
    .exitOverride()
    .configureOutput({ writeOut: io.out, writeErr: io.err });

  withCommonOptions(program.command('check').description('report lifecycle findings'))
    .option('--format <format>', 'text, json or sarif', 'text')
    .option('--baseline <path>', 'treat findings in this baseline file as known')
    .option('--update-baseline', 'write the current findings to the baseline file')
    .action((options: CheckOptions & CommonOptions) => {
      outcome.exitCode = checkCommand(pathsFrom(options, io), options, io);
    });

  withCommonOptions(program.command('show').description('print Mermaid state diagrams').argument('[aggregate]'))
    .action((aggregate: string | undefined, options: CommonOptions) => {
      outcome.exitCode = showCommand(pathsFrom(options, io), aggregate, io);
    });

  withCommonOptions(program.command('context').description('print or write the lifecycle summary for agents'))
    .option('--write <file>', 'replace the domain-integrity section in this file')
    .action((options: CommonOptions & { readonly write?: string }) => {
      outcome.exitCode = contextCommand(pathsFrom(options, io), options.write, io);
    });

  return program;
};

export const run = async (argv: readonly string[], io: Io): Promise<number> => {
  const outcome = { exitCode: 0 };
  try {
    await buildProgram(io, outcome).parseAsync([...argv], { from: 'user' });
    return outcome.exitCode;
  } catch (error) {
    if (error instanceof DomainIntegrityError) {
      io.err(`${error.message}\n`);
      return error.exitCode;
    }
    if (error instanceof CommanderError) return error.exitCode === 0 ? 0 : 2;
    throw error;
  }
};
```

`src/cli/main.ts`:

```ts
#!/usr/bin/env node
import { createInterface } from 'node:readline/promises';
import { run } from './run';

const prompt = async (question: string): Promise<boolean> => {
  const readline = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await readline.question(question);
  readline.close();
  return !/^n/i.test(answer.trim());
};

process.exitCode = await run(process.argv.slice(2), {
  cwd: process.cwd(),
  out: (text) => process.stdout.write(text),
  err: (text) => process.stderr.write(text),
  prompt,
  isInteractive: Boolean(process.stdin.isTTY),
});
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run test/cli && npm run typecheck && npm run lint`
Expected: PASS (15 tests). If `readDeclaration` reports a type error from the helpers entry, check that `writeProject` sets `paths` to the absolute `src/index.ts`.

- [ ] **Step 6: Build and smoke-test the binary**

Run: `npm run build && node dist/cli.js --help`
Expected: help text listing `check`, `show`, `context`; exit code 0.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: add check, show and context commands" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 15: `init` and the config writer

**Files:**
- Create: `src/cli/config-writer.ts`, `src/cli/init.ts`
- Modify: `src/cli/run.ts` (register `init`)
- Test: `test/cli/init.test.ts`

**Interfaces:**
- Consumes: `lifecycleAnalyzer`, `LifecycleSuggestion` (Task 11), `noAggregatesMessage` (Task 14), `readDeclaration`, `DEFAULT_DECLARATION` (Task 3), project helpers (Task 2).
- Produces: `writeSuggestions(project: Project, configPath: string, suggestions: readonly LifecycleSuggestion[]): SourceFile`, `initCommand(paths: Paths, options: { readonly yes?: boolean }, io: Io): Promise<number>`.

- [ ] **Step 1: Write the failing test**

`test/cli/init.test.ts`:

```ts
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { run } from '../../src/cli/run';
import { TICKET_CONFIG, TICKET_SOURCES, captureIo, writeProject } from '../helpers/disk';

const readConfig = (dir: string): string => readFileSync(join(dir, 'domain.config.ts'), 'utf8');

const PAYMENT = `
import { AggregateRoot } from './aggregate-root';
export class Payment extends AggregateRoot<{ state: 'open' | 'paid' }> {
  static open(): Payment { return new Payment({ state: 'open' }); }
  pay(): void { if (this.props.state === 'paid') return; this.props.state = 'paid'; }
}
`;

describe('init', () => {
  it('writes a config that check can read', async () => {
    const dir = writeProject(TICKET_SOURCES);
    await run(['init', '--yes'], captureIo(dir).io);

    expect(await run(['check'], captureIo(dir).io)).toBe(1);
  });

  it('declares the suggested terminal state with a real enum import', () => {
    const dir = writeProject(TICKET_SOURCES);

    return run(['init', '--yes'], captureIo(dir).io).then(() =>
      expect(readConfig(dir)).toMatch(
        /import \{ Ticket, TicketStatus \} from '\.\/src\/ticket';[\s\S]*lifecycle\(Ticket, \{ states: \{ status: \{ terminal: \[TicketStatus\.closed\] \} \} \}\)/,
      ),
    );
  });

  it('adds only undeclared aggregates and keeps existing declarations byte for byte', async () => {
    const edited = TICKET_CONFIG.replace('terminal: [TicketStatus.closed]', 'terminal: []');
    const dir = writeProject({ ...TICKET_SOURCES, 'src/payment.ts': PAYMENT, 'domain.config.ts': edited });
    await run(['init', '--yes'], captureIo(dir).io);
    const config = readConfig(dir);

    expect({
      keptTicket: config.includes("lifecycle(Ticket, { states: { status: { terminal: [] } } })"),
      addedPayment: config.includes("lifecycle(Payment, { states: { state: { terminal: ['paid'] } } })"),
      ticketCount: config.split('lifecycle(Ticket').length - 1,
    }).toEqual({ keptTicket: true, addedPayment: true, ticketCount: 1 });
  });

  it('reports when every aggregate is already declared', async () => {
    const dir = writeProject({ ...TICKET_SOURCES, 'domain.config.ts': TICKET_CONFIG });
    const { io, stdout } = captureIo(dir);
    await run(['init', '--yes'], io);

    expect(stdout()).toBe('All discovered aggregates are already declared.\n');
  });

  it('writes nothing when the only suggestion is declined', async () => {
    const dir = writeProject(TICKET_SOURCES);
    const { io, stdout } = captureIo(dir, [false]);
    await run(['init'], io);

    expect(stdout()).toBe('Nothing declared.\n');
  });

  it('refuses to prompt without a terminal', async () => {
    const { io } = captureIo(writeProject(TICKET_SOURCES));

    expect(await run(['init'], io)).toBe(2);
  });

  it('adds the lifecycle import to a hand-written config that lacks it', async () => {
    const dir = writeProject({
      ...TICKET_SOURCES,
      'domain.config.ts': "import { defineDomain } from 'domain-integrity';\nexport default defineDomain({});\n",
    });
    await run(['init', '--yes'], captureIo(dir).io);

    expect(readConfig(dir)).toContain("import { defineDomain, lifecycle } from 'domain-integrity';");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/cli/init.test.ts`
Expected: FAIL; commander reports an unknown command `init`, so the exit code is 2 and the assertions fail.

- [ ] **Step 3: Write the implementation**

`src/cli/config-writer.ts`:

```ts
import { ArrayLiteralExpression, Node, Project, QuoteKind, SourceFile } from 'ts-morph';
import { LifecycleSuggestion } from '../analyzers/lifecycle/suggest';
import { ConfigError } from '../engine/errors';

const INITIAL_CONFIG = `import { defineDomain, lifecycle } from 'domain-integrity';

export default defineDomain({
  lifecycles: [],
});
`;

const lifecyclesArray = (file: SourceFile): ArrayLiteralExpression => {
  const call = file.getExportAssignment((assignment) => !assignment.isExportEquals())?.getExpression();
  const config = Node.isCallExpression(call) ? call.getArguments()[0] : undefined;
  if (!Node.isObjectLiteralExpression(config)) {
    throw new ConfigError('domain.config.ts must "export default defineDomain({...})".');
  }
  const property =
    config.getProperty('lifecycles') ?? config.addPropertyAssignment({ name: 'lifecycles', initializer: '[]' });
  const array = Node.isPropertyAssignment(property) ? property.getInitializer() : undefined;
  if (!Node.isArrayLiteralExpression(array)) throw new ConfigError('"lifecycles" in domain.config.ts must be an array literal.');
  return array;
};

const ensureNamedImport = (file: SourceFile, name: string, moduleSpecifier: string): void => {
  const existing = file.getImportDeclaration((declaration) => declaration.getModuleSpecifierValue() === moduleSpecifier);
  if (!existing) {
    file.addImportDeclaration({ moduleSpecifier, namedImports: [name] });
    return;
  }
  if (!existing.getNamedImports().some((specifier) => specifier.getName() === name)) existing.addNamedImport(name);
};

const lifecycleSource = (suggestion: LifecycleSuggestion): string => {
  const fields = suggestion.fields
    .map((field) => `${field.field.name}: { terminal: [${field.terminal.map((value) => value.source).join(', ')}] }`)
    .join(', ');
  return `lifecycle(${suggestion.className}, { states: { ${fields} } })`;
};

export const writeSuggestions = (
  project: Project,
  configPath: string,
  suggestions: readonly LifecycleSuggestion[],
): SourceFile => {
  project.manipulationSettings.set({ quoteKind: QuoteKind.Single });
  const file = project.getSourceFile(configPath) ?? project.createSourceFile(configPath, INITIAL_CONFIG);
  const lifecycles = lifecyclesArray(file);
  ensureNamedImport(file, 'lifecycle', 'domain-integrity');
  suggestions.forEach((suggestion) => {
    ensureNamedImport(file, suggestion.className, file.getRelativePathAsModuleSpecifierTo(suggestion.file));
    suggestion.fields.forEach(({ field }) => {
      if (field.enumReference) {
        ensureNamedImport(file, field.enumReference.name, file.getRelativePathAsModuleSpecifierTo(field.enumReference.file));
      }
    });
    lifecycles.addElement(lifecycleSource(suggestion));
  });
  return file;
};
```

This writer deliberately does not call `formatText`. Formatting the whole file would reflow the user's existing declarations, and Review Focus 4 requires them to stay byte-for-byte identical.

`src/cli/init.ts`:

```ts
import { relative } from 'node:path';
import { lifecycleAnalyzer } from '../analyzers/lifecycle/analyzer';
import { LifecycleSuggestion } from '../analyzers/lifecycle/suggest';
import { DEFAULT_DECLARATION } from '../engine/declaration';
import { ProjectError, UsageError } from '../engine/errors';
import { analysedSourceFiles, configSourceFile, loadProject } from '../engine/project';
import { readDeclaration } from '../engine/read-config';
import { writeSuggestions } from './config-writer';
import { Io, Paths } from './io';
import { noAggregatesMessage } from './session';

const describeSuggestion = (suggestion: LifecycleSuggestion, root: string): string => {
  const fields = suggestion.fields
    .map((field) => `${field.field.name} [terminal: ${field.terminal.map((value) => value.label).join(', ') || 'none'}]`)
    .join('; ');
  return `${suggestion.className} (${relative(root, suggestion.file)}): ${fields}. Declare? [Y/n] `;
};

const confirmEach = (suggestions: readonly LifecycleSuggestion[], io: Io, root: string): Promise<readonly LifecycleSuggestion[]> =>
  suggestions.reduce<Promise<readonly LifecycleSuggestion[]>>(async (accepted, suggestion) => {
    const previous = await accepted;
    return (await io.prompt(describeSuggestion(suggestion, root))) ? [...previous, suggestion] : previous;
  }, Promise.resolve([]));

export const initCommand = async (paths: Paths, options: { readonly yes?: boolean }, io: Io): Promise<number> => {
  if (!options.yes && !io.isInteractive) {
    throw new UsageError('init needs an interactive terminal to confirm suggestions; pass --yes to accept them all.');
  }
  const project = loadProject(paths.tsconfig);
  const existing = project.getFileSystem().fileExistsSync(paths.config) ? configSourceFile(project, paths.config) : undefined;
  const declaration = existing ? readDeclaration(existing) : DEFAULT_DECLARATION;
  const model = lifecycleAnalyzer.extract({ declaration, files: analysedSourceFiles(project, paths.root, existing) });
  if (lifecycleAnalyzer.isEmpty(model)) throw new ProjectError(noAggregatesMessage(declaration));
  const suggestions = lifecycleAnalyzer.suggest(model);
  if (suggestions.length === 0) {
    io.out('All discovered aggregates are already declared.\n');
    return 0;
  }
  const accepted = options.yes ? suggestions : await confirmEach(suggestions, io, paths.root);
  if (accepted.length === 0) {
    io.out('Nothing declared.\n');
    return 0;
  }
  await writeSuggestions(project, paths.config, accepted).save();
  io.out(
    `Declared ${accepted.length} aggregate${accepted.length === 1 ? '' : 's'} in ${relative(io.cwd, paths.config)}. Review the terminal states, then run "domain-integrity check".\n`,
  );
  return 0;
};
```

In `src/cli/run.ts`, add `import { initCommand } from './init';` and register the command inside `buildProgram`, before `return program;`:

```ts
  withCommonOptions(program.command('init').description('suggest and write lifecycle declarations'))
    .option('-y, --yes', 'accept every suggestion without prompting')
    .action(async (options: CommonOptions & { readonly yes?: boolean }) => {
      outcome.exitCode = await initCommand(pathsFrom(options, io), options, io);
    });
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/cli && npm run typecheck && npm run lint`
Expected: PASS. If the regex test fails only on whitespace, check that `lifecycleSource` emits single spaces exactly as written. Do not add formatting.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: add init command that suggests and writes declarations" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 16: Fixture projects and end-to-end tests

**Files:**
- Create: `test/fixtures/{enum-inline,boolean-rule,nullable-timestamp,outside-spec}/{tsconfig.json,domain.config.ts,src/aggregate-root.ts,src/*.ts}`
- Test: `test/e2e/fixtures.test.ts` (snapshots are generated into `test/e2e/__snapshots__/`)

**Interfaces:**
- Consumes: `run` (Task 14), `captureIo` (Task 14), `Finding` (Task 9).

- [ ] **Step 1: Create the shared fixture files**

Each of the four fixture directories gets this `tsconfig.json`:

```json
{
  "compilerOptions": {
    "strict": true,
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "paths": { "domain-integrity": ["../../../src/index.ts"] }
  },
  "include": ["src"]
}
```

Each also gets `src/aggregate-root.ts`:

```ts
export abstract class AggregateRoot<P extends object = object> {
  protected props: P;
  private events: object[] = [];

  constructor(props: P) {
    this.props = props;
  }

  protected addEvent(event: object): void {
    this.events.push(event);
  }
}
```

- [ ] **Step 2: Create `test/fixtures/enum-inline`**

`src/order-status.ts`:

```ts
export enum OrderStatus {
  pending = 'PENDING',
  confirmed = 'CONFIRMED',
  paid = 'PAID',
  placed = 'PLACED',
  cancelled = 'CANCELLED',
}
```

`src/order.ts`:

```ts
import { AggregateRoot } from './aggregate-root';
import { OrderStatus } from './order-status';

type OrderProps = { status: OrderStatus; lines: string[]; note: string };

export class Order extends AggregateRoot<OrderProps> {
  static create(): Order {
    return new Order({ status: OrderStatus.pending, lines: [], note: '' });
  }

  private get isPending(): boolean {
    return this.props.status === OrderStatus.pending;
  }

  addLine(line: string): void {
    if (!this.isPending) throw new Error('Order is not pending');
    this.props.lines.push(line);
  }

  confirm(): void {
    if (!this.isPending) throw new Error('Order is not pending');
    this.props.status = OrderStatus.confirmed;
    this.addEvent({ type: 'OrderConfirmed' });
  }

  place(): void {
    if (this.props.status !== OrderStatus.confirmed) throw new Error('Order is not confirmed');
    this.props.status = OrderStatus.placed;
  }

  cancel(): void {
    if (this.props.status === OrderStatus.cancelled) throw new Error('Order is already cancelled');
    this.props.status = OrderStatus.cancelled;
  }

  annotate(note: string): void {
    this.props.note = note;
  }
}
```

`domain.config.ts`:

```ts
import { defineDomain, lifecycle } from 'domain-integrity';
import { Order } from './src/order';
import { OrderStatus } from './src/order-status';

export default defineDomain({
  lifecycles: [
    lifecycle(Order, {
      states: {
        status: {
          terminal: [OrderStatus.cancelled],
          transitions: {
            confirm: [OrderStatus.pending],
            place: [OrderStatus.paid],
            cancel: [OrderStatus.pending, OrderStatus.confirmed],
          },
        },
      },
    }),
  ],
});
```

- [ ] **Step 3: Create `test/fixtures/boolean-rule`**

`src/todo.ts`:

```ts
import { AggregateRoot } from './aggregate-root';

class TodoRules {
  static notCompleted(completed: boolean): boolean {
    return !completed;
  }
}

export class Todo extends AggregateRoot<{ title: string; completed: boolean }> {
  private deleted = false;

  static create(title: string): Todo {
    return new Todo({ title, completed: false });
  }

  complete(): void {
    if (!TodoRules.notCompleted(this.props.completed)) throw new Error('Already completed');
    this.props.completed = true;
    this.addEvent({ type: 'TodoCompleted' });
  }

  rename(title: string): void {
    if (this.deleted) throw new Error('Deleted');
    this.props.title = title;
  }

  delete(): void {
    this.deleted = true;
    this.addEvent({ type: 'TodoDeleted' });
  }
}
```

`domain.config.ts`:

```ts
import { defineDomain, lifecycle } from 'domain-integrity';
import { Todo } from './src/todo';

export default defineDomain({
  lifecycles: [lifecycle(Todo, { states: { deleted: { terminal: true } } })],
});
```

- [ ] **Step 4: Create `test/fixtures/nullable-timestamp`**

`src/account.ts`:

```ts
import { AggregateRoot } from './aggregate-root';

export class Account extends AggregateRoot<{ balance: number }> {
  private closedAt: Date | null = null;
  private lockedAt: Date | null = null;

  static open(): Account {
    return new Account({ balance: 0 });
  }

  deposit(amount: number): void {
    if (amount < 1) throw new Error('Amount must be positive');
    this.props.balance += amount;
  }

  withdraw(amount: number): void {
    if (this.props.balance < amount) throw new Error('Insufficient funds');
    this.props.balance -= amount;
  }

  lock(): void {
    if (this.lockedAt) throw new Error('Already locked');
    this.lockedAt = new Date();
  }

  close(): void {
    if (this.props.balance > 0) throw new Error('Balance remains');
    this.closedAt = new Date();
  }
}
```

`domain.config.ts`:

```ts
import { defineDomain, lifecycle } from 'domain-integrity';
import { Account } from './src/account';

export default defineDomain({
  lifecycles: [lifecycle(Account, { states: { closedAt: { terminal: 'set' } } })],
});
```

- [ ] **Step 5: Create `test/fixtures/outside-spec`**

`src/invitation.ts`:

```ts
import { AggregateRoot } from './aggregate-root';

export type InvitationStatus = 'pending' | 'accepted' | 'rejected';

export class Invitation extends AggregateRoot<{ email: string }> {
  status: InvitationStatus = 'pending';

  static invite(email: string): Invitation {
    return new Invitation({ email });
  }
}
```

`src/with-status.ts`:

```ts
import { Invitation, InvitationStatus } from './invitation';

export class WithStatus {
  constructor(private readonly status: InvitationStatus) {}

  mutate(invitation: Invitation): void {
    invitation.status = this.status;
  }
}
```

`src/invitation-service.ts`:

```ts
import { Invitation } from './invitation';
import { WithStatus } from './with-status';

export class InvitationService {
  accept(invitation: Invitation): void {
    invitation.status = 'accepted';
  }

  reinvite(invitation: Invitation): void {
    new WithStatus('pending').mutate(invitation);
  }
}
```

`domain.config.ts`:

```ts
import { defineDomain, lifecycle } from 'domain-integrity';
import { Invitation } from './src/invitation';

export default defineDomain({
  lifecycles: [lifecycle(Invitation, { states: { status: { terminal: ['accepted', 'rejected'] } } })],
});
```

- [ ] **Step 6: Write the end-to-end test**

`test/e2e/fixtures.test.ts`:

```ts
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { Finding } from '../../src/analyzer';
import { run } from '../../src/cli/run';
import { captureIo } from '../helpers/disk';

const fixture = (name: string): string => fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url));

const checkJson = async (name: string) => {
  const { io, stdout } = captureIo(fixture(name));
  const code = await run(['check', '--format', 'json'], io);
  const findings = (JSON.parse(stdout()) as { findings: Finding[] }).findings;
  return {
    code,
    findings: findings
      .map((finding) => `${finding.severity} ${finding.checkId} ${finding.aggregate}.${finding.method ?? '-'} ${finding.field} ${finding.subject}`)
      .sort(),
  };
};

const output = async (name: string, argv: string[]): Promise<string> => {
  const { io, stdout } = captureIo(fixture(name));
  await run(argv, io);
  return stdout();
};

describe('fixture projects', () => {
  it('enum-inline: leak, unreachable state and drift', async () => {
    expect(await checkJson('enum-inline')).toEqual({
      code: 1,
      findings: [
        'error terminal-state-leak Order.annotate status CANCELLED',
        'error transition-drift Order.cancel status extra',
        'error transition-drift Order.place status extra',
        'error unreachable-state Order.- status PAID',
        'warning transition-drift Order.place status missing',
      ],
    });
  });

  it('boolean-rule: leaks past a rule-object guard on another field', async () => {
    expect(await checkJson('boolean-rule')).toEqual({
      code: 1,
      findings: [
        'error terminal-state-leak Todo.complete deleted true',
        'error terminal-state-leak Todo.delete deleted true',
      ],
    });
  });

  it('nullable-timestamp: every method still runs after closing', async () => {
    expect(await checkJson('nullable-timestamp')).toEqual({
      code: 1,
      findings: [
        'error terminal-state-leak Account.close closedAt set',
        'error terminal-state-leak Account.deposit closedAt set',
        'error terminal-state-leak Account.lock closedAt set',
        'error terminal-state-leak Account.withdraw closedAt set',
      ],
    });
  });

  it('outside-spec: state changed from a service and a specification', async () => {
    expect(await checkJson('outside-spec')).toEqual({
      code: 1,
      findings: [
        'error outside-mutation Invitation.- status InvitationService.accept',
        'error outside-mutation Invitation.- status WithStatus.mutate',
      ],
    });
  });

  it('enum-inline: text report', async () => {
    expect(await output('enum-inline', ['check'])).toMatchSnapshot();
  });

  it('enum-inline: diagram', async () => {
    expect(await output('enum-inline', ['show'])).toMatchSnapshot();
  });

  it('enum-inline: agent context', async () => {
    expect(await output('enum-inline', ['context'])).toMatchSnapshot();
  });
});
```

- [ ] **Step 7: Run and review snapshots**

Run: `npx vitest run test/e2e`
Expected: the four `checkJson` tests PASS; the three snapshot tests write new snapshots. Open `test/e2e/__snapshots__/fixtures.test.ts.snap` and verify by reading:
- the text report lists the same five findings with paths `src/order.ts:<line>`;
- the diagram contains `status_4 --> status_4 : annotate ⚠ leak` and `status_1 --> status_4 : cancel`, with `status_4` being `cancelled`;
- the context lists `place: paid → placed` and `cancel: pending, confirmed → cancelled`.

If any of these is wrong, fix the code, delete the snapshot file, and rerun.

- [ ] **Step 8: Run the whole suite**

Run: `npm test && npm run typecheck && npm run lint`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "test: add fixture projects and end-to-end checks" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 17: CI, GitHub Action, README, license

**Files:**
- Create: `.github/workflows/ci.yml`, `action.yml`, `README.md`, `LICENSE`

- [ ] **Step 1: Write CI**

`.github/workflows/ci.yml`:

```yaml
name: ci
on:
  push:
    branches: [main]
  pull_request:
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - run: npm ci
      - run: npm run lint
      - run: npm run typecheck
      - run: npm test
      - run: npm run build
      - run: node dist/cli.js --help
```

- [ ] **Step 2: Write the GitHub Action**

`action.yml`:

```yaml
name: domain-integrity
description: Check that aggregate lifecycles match their declared intent.
inputs:
  project:
    description: Path to tsconfig.json
    default: tsconfig.json
  config:
    description: Path to domain.config.ts
    default: domain.config.ts
  baseline:
    description: Optional baseline file
    default: ''
runs:
  using: composite
  steps:
    - id: check
      shell: bash
      run: |
        set +e
        baseline_args=()
        if [ -n "${{ inputs.baseline }}" ]; then baseline_args=(--baseline "${{ inputs.baseline }}"); fi
        npx --yes domain-integrity@0 check --project "${{ inputs.project }}" --config "${{ inputs.config }}" "${baseline_args[@]}" --format sarif > domain-integrity.sarif
        echo "code=$?" >> "$GITHUB_OUTPUT"
    - uses: github/codeql-action/upload-sarif@v3
      if: always()
      with:
        sarif_file: domain-integrity.sarif
        category: domain-integrity
    - shell: bash
      run: exit ${{ steps.check.outputs.code }}
```

- [ ] **Step 3: Write the README**

`README.md` must contain these sections, in this order, with real content taken from the spec and the fixtures:

1. **Title and one-line pitch:** "Your aggregates have lifecycles. Nothing checks them."
2. **The problem, in one example:** the `nullable-timestamp` Account fixture code and the four findings `check` prints for it. Paste the actual `check` output from running `node dist/cli.js check` inside `test/fixtures/nullable-timestamp`.
3. **Diagram:** paste the `show` output for `enum-inline` in a ```mermaid block so GitHub renders the red leak state.
4. **Install and first run:** `npm i -D domain-integrity`, `npx domain-integrity init`, `npx domain-integrity check`.
5. **The declaration:** the `domain.config.ts` example from spec section 4, with every option explained in one line each (`states`, `terminal`, `transitions`, `allowAfterTerminal`, `aggregateBaseClasses`, `auditFields`, `eventMethods`).
6. **Checks:** the table from spec section 5.6.
7. **Existing codebases:** `--update-baseline` then `--baseline`.
8. **CI:** a workflow snippet using `uses: <owner>/domain-integrity@v0` with `permissions: security-events: write`.
9. **Agents:** `npx domain-integrity context --write AGENTS.md`, and why: agents read the lifecycle rules before writing code.
10. **What it does not see:** unsupported guard styles are reported as nothing; state changed by direct database writes; NodeNext users must add `.js` to generated imports; `strictNullChecks` is required for nullable state.
11. **License:** MIT.

- [ ] **Step 4: Write the license**

`LICENSE`: the standard MIT license text with `Copyright (c) 2026 mannkostir`.

- [ ] **Step 5: Verify packaging**

Run: `npm run build && npm pack --dry-run`
Expected: the tarball lists `dist/index.js`, `dist/index.d.ts`, `dist/cli.js`, `package.json`, `README.md`, `LICENSE`, and nothing from `src/` or `test/`.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "docs: add README, license, CI and GitHub Action" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 18: Real-world validation

This task changes code only if validation finds false positives. Its deliverable is a triage record.

**Files:**
- Create: `docs/validation/real-world.md`
- Modify: whatever module a confirmed false positive traces back to, with a new failing unit test first.

- [ ] **Step 1: Prepare the repositories**

```bash
mkdir -p /tmp/di-validation && cd /tmp/di-validation
for r in Sairyss/domain-driven-hexagon stemmlerjs/ddd-forum CodelyTV/typescript-ddd-example bitloops/ddd-hexagonal-cqrs-es-eda kyhsa93/nestjs-rest-cqrs-example undb-io/undb; do
  git clone --depth 1 "https://github.com/$r.git" "$(basename "$r")"
done
```

Then pick two or three more public TypeScript repositories with stateful aggregates (search GitHub for `"extends AggregateRoot" status enum language:TypeScript`) and clone them the same way.

- [ ] **Step 2: Run the tool in each repository**

For each repository, from the directory holding the relevant `tsconfig.json` (for undb: `packages/authz`):

```bash
node ~/Documents/domain-integrity/dist/cli.js init --yes
node ~/Documents/domain-integrity/dist/cli.js check --format json > findings.json
```

If `init` finds no aggregates, set `aggregateBaseClasses` in the generated config to the repository's base class name and rerun. Where the terminal-state suggestion is clearly wrong for the domain, edit it and record the edit.

- [ ] **Step 3: Triage every finding**

Write `docs/validation/real-world.md` with one table per repository, with columns `check | aggregate.method | verdict (real / false positive / intended) | reason`.

The run must reproduce the spike findings:
- the Todo complete-after-delete leak (bitloops);
- the Account withdraw/deposit-after-close leaks (kyhsa93);
- the undb invitation outside mutation (`WithStatus` specification).

Note: the spike's Order and Payment findings came from a private repository and cannot be reproduced here.

- [ ] **Step 4: Fix each false positive test-first**

For each false positive:
1. Reduce it to a minimal class in the matching unit test file.
2. Watch that test fail.
3. Fix the module.
4. Rerun `npm test`.
5. Commit, one commit per false positive, with the message `fix: <what was misread>`.

- [ ] **Step 5: Commit the record**

```bash
git add docs/validation/real-world.md
git commit -m "docs: record real-world validation results" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

## Self-review notes

- **Spec coverage:**

  | Spec section | Task |
  |---|---|
  | §3 architecture | 1–11 |
  | §3.1 contract | 11 |
  | §3.2 engine | 2–3 |
  | §3.3 helpers | 1 |
  | §4 declaration rules | 1, 3, 8 |
  | §5.1 discovery | 4 |
  | §5.2 suggestion | 8 (candidates), 11 (terminal guess) |
  | §5.3 extraction | 6, 8 |
  | §5.4 guards | 5 |
  | §5.5 outside | 7 |
  | §5.6 checks | 9–10 |
  | §5.7 finding format | 9, 13 |
  | §6.1 init | 15 |
  | §6.2 check, baseline | 13–14 |
  | §6.3 show | 12, 14 |
  | §6.4 context | 12, 14 |
  | §7 errors | 2, 3, 13, 14, 15 |
  | §8 testing and validation | every task, plus 16 and 18 |
  | §9 launch | 17 |

- **Type names used across tasks** (defined once in Task 4 or Task 9):
  - `Sources`, `AssignedValues`, `FieldBehaviour`, `MethodModel`, `AggregateModel`, `LifecycleModel`, `StateField`
  - `Finding`, `findingKey`, `RuleDescription`, `Analyzer`, `AnalysisResult`
  - `Io`, `Paths`
  - `LifecycleSuggestion`, `FieldSuggestion`
- **Review Focus coverage:**

  | Review Focus item | Task |
  |---|---|
  | 1 | 4 |
  | 2 | 2 |
  | 3 | 4 |
  | 4 | 15 |
  | 5 | 14 |
