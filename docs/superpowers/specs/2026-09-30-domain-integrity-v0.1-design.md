# domain-integrity v0.1 — Design

Date: 2026-09-30
Status: Draft, awaiting review

## 1. Purpose

A domain integrity checker for TypeScript: it verifies that a domain's actual behaviour matches its intended behaviour.

It extracts behavioural models from code, has a human confirm intent in a small typed declaration, and fails CI when code and intent drift. It renders the models as diagrams and emits them as context for coding agents.

v0.1 ships one analyzer: **aggregate lifecycles**.

### Why

Structural DDD checking (layers, module boundaries) is well served by ArchUnitTS, arch-unit-ts, and eslint-plugin-boundaries. Domain-knowledge delivery to agents is well served by Contextive and glossary skills. Nothing verifies behaviour against intent.

A spike on 2026-09-30 surveyed seven TypeScript DDD repositories (the private reference repo, Sairyss/domain-driven-hexagon, stemmlerjs/ddd-forum, CodelyTV/typescript-ddd-example, bitloops/ddd-hexagonal-cqrs-es-eda, kyhsa93/nestjs-rest-cqrs-example, undb-io/undb):

- About 7 of 23 aggregate classes carry a real lifecycle.
- 5 of the 6 lifecycle aggregates analysed let the object change after reaching a terminal state: orders cancellable after placement, payments resolvable twice, accounts withdrawable after closing, todos completable after deletion, invitations accepted without being pending.
- A throwaway ts-morph extractor recovered in-class lifecycles correctly for the enum, boolean, and nullable-timestamp patterns, and could not see state changed outside the aggregate.

### Goals

- Minimum: a portfolio-grade open-source project.
- Ideal: adopted by TypeScript teams with stateful domains, especially where agents write code.

### Success criteria

- On the spike repositories, `check` reports the hand-found leaks (Order, Payment, Account, Todo) and undb's outside mutation, with near-zero false positives.
- A team gets findings from three declared lines per aggregate.
- `show` output makes a lifecycle bug visible at a glance.

### Non-goals for v0.1

- Event and saga flow analysis (v0.2 candidate, pending its own prior-art spike).
- Glossary / ubiquitous language (covered by Contextive and similar tools).
- Invariant-to-test mapping, ESLint integration, MCP server.
- Detecting state changes performed by direct persistence writes that bypass the aggregate.
- Languages other than TypeScript.

## 2. Technical baseline

- Node 20+, TypeScript 5+ in analysed projects.
- ts-morph for project loading, AST traversal and type checking.
- Single npm package `domain-integrity` (available on npm as of 2026-09-30) exposing the CLI binary `domain-integrity` and the config helpers.
- A GitHub Action wrapping `check`.

## 3. Architecture

```
src/
  engine/          project loading (tsconfig) and static config reading
  analyzer.ts      Analyzer contract
  analyzers/
    lifecycle/
      discover     aggregate class discovery
      extract      state fields and per-method transitions
      guards       guard normalisation into allowed source states
      outside      out-of-class state assignments
      checks/      one module per check
  config/          defineDomain(), lifecycle() typed helpers
  report/          text, json, sarif formatters
  cli/             init, check, show, context
```

### 3.1 Analyzer contract

Every analyzer implements four operations:

| Operation | Input | Output |
|---|---|---|
| `extract` | loaded project | analyzer-specific model |
| `suggest` | model | declaration draft |
| `check` | model, declaration | findings |
| `diagram` | model, declaration | Mermaid source |

The CLI depends only on this contract. A new analyzer is added by registering it; no CLI or engine change is needed.

### 3.2 Engine

- Loads the analysed project once per run from its `tsconfig.json` and shares it across analyzers.
- Reads `domain.config.ts` statically through the type checker. The config is never executed. Enum member references resolve to their values through the type checker.

### 3.3 Config helpers

`defineDomain()` and `lifecycle()` are identity functions whose only purpose is typing, so the config file type-checks in the user's editor and renames propagate or break compilation.

## 4. Declaration

```ts
import { defineDomain, lifecycle } from 'domain-integrity';
import { OrderEntity } from './src/ordering/domain/order.entity';
import { OrderStatus } from './src/ordering/domain/order-status';
import { Account } from './src/accounts/domain/account';

export default defineDomain({
  aggregateBaseClasses: ['AggregateRoot'],
  lifecycles: [
    lifecycle(OrderEntity, {
      states: {
        status: {
          terminal: [OrderStatus.cancelled],
          transitions: {
            confirm: [OrderStatus.pending],
            cancel: [OrderStatus.pending, OrderStatus.confirmed],
          },
        },
      },
      allowAfterTerminal: ['remove'],
    }),
    lifecycle(Account, { states: { closedAt: { terminal: 'set' } } }),
  ],
});
```

Rules:

- A lifecycle declares one or more state fields under `states`. Each field is analysed independently.
- Supported state field types: enum, string-literal union, boolean, nullable (`T | null` or optional). For nullable fields the terminal value is `'set'` (non-null) or `'unset'`.
- `terminal` is required per declared state field. `transitions` is optional.
- `transitions` keys are typed as the class's method names; values are typed as the field's values.
- `allowAfterTerminal` lists methods exempt from `terminal-state-leak`.
- `aggregateBaseClasses` defaults to `['AggregateRoot', 'Entity']`.
- `auditFields` (excluded from suggestions) defaults to `['createdAt', 'updatedAt', 'version']`. Declaring a field in `states` always overrides the exclusion.
- `eventMethods` (calls that count as emitting a domain event) defaults to `['addEvent', 'addDomainEvent', 'apply']`.

## 5. Lifecycle analyzer

### 5.1 Discovery

An aggregate is a class extending one of `aggregateBaseClasses` (directly or transitively), or any class referenced by a `lifecycle()` declaration.

### 5.2 State field suggestion (used by `init`)

A field is suggested when its type is an enum, string-literal union, or boolean, or when it is nullable and either appears in a guard condition or is assigned a non-null value by at least one method. Fields in `auditFields` are excluded. Suggestions are always confirmed by a human or accepted explicitly with `--yes`.

### 5.3 Transition extraction

For each non-static method, per declared state field:

- **Mutates**: the method assigns any field of `this` (directly or via `this.props`), mutates a field-held collection (`push`, `splice`, element assignment), or calls one of `eventMethods`.
- **Sets**: the values assigned to the state field.
- **Allowed sources**: the set of state values from which the method can run, derived from its guards.

### 5.4 Guard normalisation

Supported guard styles:

- early-exit `if` whose branch returns, throws, returns a failed result (`Result.fail`, `fail(...)`), or calls a function whose name starts with `throw`;
- an `if` wrapping the entire method body;
- getters whose return expression is a state check, expanded before evaluation;
- `&&`, `||`, `!` combinations of the above;
- comparisons `===`, `!==`, truthiness checks for booleans and nullable fields.

Evaluation:

- A guard on field F restricts F's allowed sources to the values satisfying it.
- A method with no guard on F allows every value of F.
- Any guard referencing F in an unsupported form makes F's allowed sources **unknown**.

**Unknown never produces a finding.** This is the primary false-positive defence.

### 5.5 Outside mutation detection

Every assignment in the project whose target's type (resolved by the type checker) is a declared aggregate and whose property is a declared state field is recorded as an outside mutation, unless it occurs inside the aggregate class itself. Detection covers assignments through parameters and variables of the aggregate type, including within specification or mapper classes.

### 5.6 Checks

| Id | Requires | Reports | Severity |
|---|---|---|---|
| `terminal-state-leak` | `terminal` | A method that mutates and whose allowed sources for F include a terminal value of F, unless listed in `allowAfterTerminal` | error |
| `unreachable-state` | enum or union state field | A value of F that is never assigned anywhere (inside or outside the class) and is not the initial value set by a static factory or constructor | error |
| `outside-mutation` | state field | Any outside mutation of F | error |
| `transition-drift` | `transitions` | Code allows a source not declared | error |
| | | Code allows fewer sources than declared | warning |
| | | A method sets F but has no entry in F's declared `transitions` | error |

Findings for a field whose allowed sources are unknown are suppressed for that method.

### 5.7 Finding format

Each finding carries: check id, severity, aggregate, method, state field, file, line, a one-line message, and a fix hint.

```
error terminal-state-leak  PaymentEntity.attempt()  src/payment/domain/payment.entity.ts:24
  attempt() can run after status is 'fulfilled'.
  Fix: guard it with status === 'pending', or list it in allowAfterTerminal if intended.
```

## 6. CLI

### 6.1 `init`

- Discovers aggregates, extracts lifecycles, and proposes state fields and terminal values.
- Interactive confirmation per aggregate in a TTY; `--yes` accepts all suggestions for non-interactive use.
- Writes `domain.config.ts` via ts-morph with real imports. On an existing config, it only adds undeclared aggregates and never modifies existing declarations.

### 6.2 `check`

- Runs all analyzers.
- Exit codes: `0` no error-level findings, `1` error-level findings present, `2` configuration or project error.
- `--format text|json|sarif`.
- `--baseline <file>`: findings present in the baseline are reported as known and do not affect the exit code. `--update-baseline` writes the current findings. Findings are keyed by check id, aggregate, method and field, not line numbers.

### 6.3 `show [Aggregate]`

Prints a Mermaid `stateDiagram-v2` per aggregate, merging extracted and declared transitions. Drifted transitions and terminal-state leaks are styled distinctly.

### 6.4 `context`

- Prints a compact Markdown summary per aggregate: states, terminal values, allowed transitions.
- `--write <file>` replaces a delimited section in the target file (for example `AGENTS.md`) and never touches content outside it.

## 7. Error handling

- Type errors in `domain.config.ts`: reported with file and line, exit code `2`.
- A declared state field that does not exist or has an unsupported type: reported per aggregate; other aggregates are still checked; exit code `2`.
- No aggregates discovered: exit code `2` with the base class names searched and a configuration example.
- Missing or invalid `tsconfig.json`: exit code `2` with the path tried.

## 8. Testing and validation

- Unit tests per module (`discover`, `extract`, `guards`, `outside`, each check) using in-memory TypeScript sources through ts-morph.
- `guards`: table-driven tests for every supported style and a set of unsupported styles asserting no finding.
- Fixture projects, clean-room reconstructions of the spike patterns, each with known expected findings:
  - enum state with inline guards and getter guards;
  - boolean state with rule-object guards;
  - nullable timestamp state;
  - state mutated from a specification class.
- End-to-end snapshot tests of `check`, `show` and `context` output on the fixtures.
- Real-world validation before release: run on the spike repositories plus two or three more with stateful domains; triage every finding as real or false positive; tune until false positives are near zero.
- CI: GitHub Actions running lint, unit tests, and fixture snapshots.

## 9. Launch

- npm package and GitHub Action.
- README headline: a `show` diagram with a highlighted terminal-state leak and its one-line fix.

## 10. Roadmap after v0.1

1. Prior-art spike on in-process event and saga flow analysis.
2. Event/saga flow analyzer, if the spike holds: unhandled events, handlers for never-published events, sagas without failure paths, message payload mismatches.
3. ESLint rule and MCP server as thin layers over the core.
4. Invariant-to-test mapping.
