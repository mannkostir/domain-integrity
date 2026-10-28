# Changelog

All notable changes to this project are documented here; the format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- `HandleEvent` joins the default `events.handlerDecorators`, so `@HandleEvent(X.name)` handlers are recognised without configuration. (#PR)

## [0.3.0] - 2026-10-27

### Added

- `--version`, or `-V`, prints the version and exits `0`. The JSON report carries the tool `name` and `version` in `tool`, and the SARIF report carries them in `tool.driver.version` and `tool.driver.informationUri`. (#94)
- `rules` in `domain.config.ts` sets each rule to `'off'`, `'warning'` or `'error'`. `check` exits `1` only for new findings whose configured level is `error`, and each SARIF result's `level` is the configured level. (#104)
- `suppressions` with the new `suppress(Class, { rule, member?, reason })` helper accept the findings of one rule on one class or member, with a required reason. A suppressed finding never fails the run and never enters a baseline; it is counted in the summary line, listed by `--show-known`, reported in the JSON `suppressed` array and uploaded to SARIF with an `external` suppression. A suppression that matches no finding is listed as stale in the text report. Rules and suppressions affect `check` only. (#104)
- `check --show-known` lists the known and suppressed findings in the text output, each marked `(baseline)` or `(suppressed: <reason>)`. (#98, #104)
- The text output lists stale baseline entries, entries that no longer match a finding, before the summary line. They never change the exit code. (#98, #101)
- A JSON Schema for the report ships as `schema/report.schema.json` and is exported as `domain-integrity/schema/report.json`. (#100)
- SARIF rules carry a full description, the remedy as help text, a `helpUri` to the rule's entry in the README rule reference, and their default level. SARIF results carry `ruleIndex`, the fix in `properties.fix`, and a `domainIntegrity/v2` partial fingerprint holding the finding's identity. (#97, #101)
- When aggregates are found but `domain.config.ts` declares no lifecycles and there are no event handlers or event flows, `check`, `show` and `context` print a notice on stderr pointing to `init` and exit `0`; `check --format json` or `--format sarif` still prints a valid report on stdout. (#99)
- `init` lets you edit a suggestion: answer `e` to type each field's terminal values, comma-separated, from the field's known values, or `-` for none. `Y` or Enter still declares the suggestion and `n` skips it. (#108)
- `-p` takes a directory and then uses the `tsconfig.json` inside it. (#109)
- `--help`, or `-h`, on the tool or on any command prints what each option takes and its default, followed by a link to the README; the tool's help also lists examples. (#109)
- `require('domain-integrity')` loads the config helpers from CommonJS on Node 22.12 or later, through a `module-sync` export condition. The README documents the module format: the package is ESM-only, CommonJS code on earlier Node versions uses `import()`, and `domain-integrity/schema/report.json` resolves only through `exports`. (#122)
- More guard shapes are followed: `[A, B].includes(this.status)` on an array literal, negated or not, counts like the equivalent strict comparisons, and an `if`/`else` whose one branch is an early return or throw counts like that early exit followed by the other branch, including `else if` chains; a `switch (this.status)` whose cases only return, throw or break excludes the states whose cases return or throw, and a `switch` whose cases do work counts, only as the method's only statement, like a wrapping `if` over the states of those cases; and a statement such as `this.assertOpen();` counts like the guards in that helper's body when the helper is a plain project method whose body holds only guards that throw. (#124)
- Enum and literal-union state fields that may be unset, `S | null`, `S | undefined` or optional `s?: S`, are supported: `check` resolves them with their members plus `'unset'`, follows `null` and `undefined` comparisons and truthiness on them, and never reports `'unset'` as unreachable, and `init` suggests them. (#124)

### Changed

- **Breaking:** a method that can no longer run from a state declared for it is reported under the new rule `transition-missing`, a warning, instead of as `transition-drift` with the subject `missing`. (#96)
- **Breaking:** the JSON report has a fixed shape with format `version` `2`: top-level `version`, `tool`, `summary`, `findings`, `known`, `suppressed` and `problems`. Each finding has `ruleId` (was `checkId`), `severity`, `analyzer`, `identity`, `location` with `file` and `line`, `message`, `fix` and `details`, every key always present. Rule-specific fields moved under `details`, the `...Id` fields and `subject` were removed, and problems are objects with `code`, `analyzer`, `message` and `details`. (#100, #101, #104)
- **Breaking:** baseline files use format version `2`: each entry is a finding's identity object plus a `count`, instead of a `|`-separated key. Version 1 baselines are no longer read: `check` exits `2` and tells you to regenerate the file with `check --update-baseline`, which also migrates it. A baseline that is not valid, or repeats an entry, exits `2` with a message naming the file. When a run finds more findings with one identity than the entry's `count`, all of them are reported as new. (#101)
- **Breaking:** paths are relative to the repository root, the nearest directory at or above the tsconfig that contains a `.git` entry, or the tsconfig directory when there is none, instead of the tsconfig directory. This covers JSON `location.file`, the SARIF `uri` (now with `uriBaseId` `%SRCROOT%`), the paths in finding identities, the `path:Class` argument of `show`, and the `context` summary. Aggregates, events and sagas are always identified as `path:Class` in identities, so moving a file or renaming a class turns its known findings into new ones. (#101)
- **Breaking:** a plain `check`, and the GitHub Action without its `baseline` input, now loads `domain-integrity.baseline.json` from the current working directory when it exists, so findings it lists no longer fail the run. `--baseline <path>` still wins. In the text output, known findings collapse into the summary line, which names the baseline. (#98)
- **Breaking:** the SARIF `message.text` no longer ends in `Fix: …`; the fix is in `properties.fix`. Known findings from a baseline, and findings suppressed in the config, are included as results with an `external` suppression instead of being left out, so code scanning does not close their alerts as fixed. They never fail the job. (#97, #98, #104)
- Assignments in test files, `*.spec.*`, `*.test.*` and anything under `__tests__/`, `test/` or `tests/`, are no longer reported as `outside-mutation`. They still count as assigned for `unreachable-state`. Set `rules: { 'outside-mutation': { testFiles: true } }` to report them again. (#95, #104)
- Config options are grouped: `aggregates.baseClasses`, `aggregates.auditFields`, `events.raiseMethods`, `inert.decorators`, `inert.raiseMethods` and `inert.members`, and a transition is written `transitions.<method>: { from: [...] }`. `init --base-class` writes `aggregates.baseClasses`. (#103)
- A method whose only writes stamp an `aggregates.auditFields` field, or empty a private event array, is no longer judged as a domain command, so `terminal-state-leak` does not report it. Pushing an event still counts as a domain write. (#102)
- The messages for a project with nothing to check start with the number of source files loaded, and "No aggregates found" is preceded by a `problem:` line for each problem an analyzer met. A tsconfig whose only source file is `domain.config.ts` exits `2` like one with no source files. (#99)
- `--update-baseline` reports the number of entries it wrote rather than findings. (#98, #101)
- `init` writes each lifecycle over several lines, follows the existing config's indentation, line endings and quote style, and writes a single terminal value without brackets. (#108)
- `init` without an interactive terminal and without `--yes` exits `0` when there is nothing to declare, and exits `2` only when there are suggestions to confirm. If the input ends before every suggestion is answered, it exits `2` and writes nothing. (#108)
- `show` with a name that matches no declared aggregate or handled event lists the names it accepts. (#109)
- Error messages show paths relative to the current directory, name the config file that was passed, say why a file could not be read or written, such as a missing directory or denied permission, and report config errors at the line they come from. (#109)
- `publishConfig.provenance` is set, so every publish carries npm provenance, and a publish from a machine that cannot produce provenance fails instead of publishing without it. (#122)
- `saga-missing-failure-path` is marked experimental: it is labelled so in the README and tagged `experimental` in its SARIF rule's `properties.tags`. (#121)

### Deprecated

- The 0.2 config keys `aggregateBaseClasses`, `auditFields`, `eventMethods`, `inertDecorators`, `inertEventMethods` and `inertMembers`, and the array form `transitions.<method>: [...]`. They still work, print a `warning:` line on stderr naming the replacement, and stop working in 1.0. Setting an old key together with its new one exits `2`. See the README section "Migrating from 0.2". (#103)

### Fixed

- A plain read of the state field, directly or through a getter that only reads it, inside the `return` or `throw` that a guard exits with, such as ``throw new Error(`cannot close from ${this.status}`)`` or `return err(new StatusRejected(this.status))`, no longer makes the method's sources unknown, in an early exit, an `if`/`else` guard, a `switch` case or an assertion helper. Such a method was skipped, which hid its `terminal-state-leak` and `transition-drift` findings. (#105)
- Writing a member through a setter that reads or writes the state field, such as `this.label = Status.open` with `set label(value: Status) { this.status = value; }`, counts as a read of the field, so the method's sources are unknown. It used to count as no read, which could report a false `transition-missing` for a method whose early exit transitions through the setter, such as `if (this.status === Status.paid) return (this.label = Status.refunded);`. (#105)
- On Windows, the tsconfig and its project references are read correctly, and the paths the CLI prints use forward slashes, as on other systems. (#111)
- A guard that follows a conditional assignment to the state field, such as `if (flag) this.status = Status.open; if (this.status !== Status.open) throw …`, no longer narrows the states a method can run from, and inside an `if` that wraps the whole method, guards after a plain assignment to the field are ignored as they are at the top level. Both used to narrow the method's sources to the assigned value, or to none, which could report a false `transition-missing` and hide `terminal-state-leak` and `transition-drift` findings; such a method's sources are now unknown, or limited by the guards before the assignment. (#124)
- A strict `=== null` or `=== undefined` with a value the field's type cannot hold, such as `this.pausedAt === undefined` on a `Date | null` field, and likewise such a `case` label or `includes` element, now matches nothing. It used to match the field's unset value, so an early exit on it hid `unset` from the method's sources and could report a false `transition-missing`. (#124)
- Calling a method whose parameter default reads the state field, such as `this.assertOpen()` with `assertOpen(status = this.status)`, counts as a read of the field, so the calling method's sources are unknown. It used to count as no read, which could report a false `terminal-state-leak` or `transition-drift`. (#124)

## [0.2.1] - 2026-10-14

### Added

- `init --base-class <name>`, repeatable, discovers aggregates that extend or implement another base class or interface and records the names in `aggregateBaseClasses`. (#86)
- `inertDecorators` lists class decorators you assert neither install nor rewrite instance members. Common `typeorm` and `@mikro-orm/*` class decorators are inert by default when their import resolves to the installed package, so they no longer keep the event-array and event-method rules silent. (#90)
- Monorepos with project references: the analysis follows the `references` of the tsconfig recursively and includes imported files outside the tsconfig directory. (#91)

### Changed

- **Breaking:** Node 22 or later is required (`engines: >=22`). (#83)
- With `node16` or `nodenext` module resolution, `init` writes imports with runtime extensions: `.js`, or `.mjs` and `.cjs`. (#84)
- `init` leaves a nullable field's terminal list empty when every method that sets it also sets a status field to one of its suggested terminal values. (#88)
- A handler registration that cannot be resolved silences `unhandled-event` only for the events that handler could receive, instead of for the whole project. (#87)
- Analysis is faster on large projects. (#89)
- A tsconfig that includes no source files, directly or through its references, exits `2` with a message saying so and pointing to `-p` or `references`, instead of "No aggregates found". (#91)

### Fixed

- An analyzer that crashes prints `internal error in <analyzer>, please report` with a short stack trace, the other analyzer's results are still printed, and the command exits `2`. `--update-baseline` and `context --write` then write nothing, and the GitHub Action skips the SARIF upload. (#85)
- A class whose `extends` chain loops, which TypeScript rejects, is not analysed instead of crashing the run. (#85)

## [0.2.0] - 2026-10-07

### Added

- Event-flow analyzer with four rules: `dead-handler`, a handler registered for an event class that production code never constructs; `handler-payload-mismatch`, a handler registered for one event class that declares an unrelated class as its event; `unhandled-event`, an event class declared in `events.inProcess` that is constructed but has no handler; and `saga-missing-failure-path`, a saga declared with `saga()` that handles the success event of an outcome but not its failure event. Handlers are recognised through `@EventsHandler` and `@OnEvent` decorators, `register` calls, `subscribedTo()` and `@Saga()` streams, and the `events` block in `domain.config.ts` configures them. (#42)
- `undispatched-events` reports an aggregate's event buffer that an event method fills but that production code never reads or drains. It stays silent whenever the buffer may be read in a way the analysis cannot follow. (#43)
- Per-field `allowAfterTerminal`: a state field can list the methods that may still run after it reaches a terminal state. (#38)
- `inertEventMethods` lists event methods you assert never read aggregate state, so methods that hand `this` to them are still judged. (#40)
- Event methods declared in mixins are traced. (#37)

### Changed

- **Breaking:** the new event-flow rules can report error findings, so a project that passed before may now exit `1`. Run `check --update-baseline` to accept the existing ones. (#42, #43)
- **Breaking:** aggregates that share a class name are identified as `path:Class`, which changes their baseline keys. Keys for unique class names are unchanged, and `show path:Class` selects one aggregate among several with the same name. (#39)
- **Breaking:** JSON findings carry an `analyzer` field, `lifecycle` or `event-flow`. Lifecycle findings gain `aggregateId`; event-flow findings carry `event`, `eventId` and `handler`, or for `undispatched-events`, `owner`, `ownerId`, `buffer`, `method` and `raisers`. (#39, #42, #43)

## [0.1.1] - 2026-10-06

### Added

- `inertMembers` lists library getters, methods and properties that never read aggregate state, such as `id` or `clearDomainEvents`, so methods that use them are judged. (#29)
- `aggregateBaseClasses` may name interfaces: a class that implements one, directly or through its base classes, is an aggregate. (#24)
- A method that hands `this` to a plain event passed straight to a library event method, such as `this.apply(new OrderPaid(this))`, is judged. (#32)
- A method that hands `this` to a project event method that only pushes its parameters onto a private event array is judged. (#34)
- Releases are published with npm provenance. (#20)

### Changed

- Reads and guards of a state field after the method's first plain assignment to it are ignored, so more methods are judged. (#22)

### Fixed

- A write through a setter that the aggregate or one of its project base classes declares is no longer reported as `outside-mutation`. (#21)
- An aggregate that wires itself into a new instance inside a non-static factory member, such as `clone()`, or through a variable typed as `any` or an interface, is recognised as leaking `this`, which removes false findings. (#23)
- For a field typed with both `null` and `undefined`, a strict `=== null` or `=== undefined` check no longer counts as covering both. A guard must cover both, for example with `== null`, a truthiness check or both strict checks, or the method is not judged. (#25)
- Guards built with `==` and `!=` are recognised like `===` and `!==`. (#25)
- A falsy check on a nullable field whose set values may be falsy, such as `0` or `''`, no longer counts as excluding `set`. (#28)

## [0.1.0] - 2026-10-02

### Added

- First release: a CLI that checks TypeScript aggregate lifecycles against a typed `domain.config.ts`, which is read statically and never executed.
- Rules: `terminal-state-leak`, a public method that can change an aggregate after it reached a terminal state; `unreachable-state`, a declared state value that is never assigned; `outside-mutation`, aggregate state assigned outside the aggregate; and `transition-drift`, a method whose allowed source states differ from its declared transition.
- Commands: `init` suggests and writes declarations; `check` reports findings as text, JSON or SARIF, with an optional baseline, and exits `0` when clean, `1` for findings and `2` for a config, project or usage error; `show` prints Mermaid state diagrams; `context` writes a lifecycle summary into `AGENTS.md` or `CLAUDE.md`.
- GitHub Action: `uses: mannkostir/domain-integrity@v0`.
- The analysis is conservative: when it cannot interpret something, it reports nothing. The README lists those cases.

[Unreleased]: https://github.com/mannkostir/domain-integrity/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/mannkostir/domain-integrity/compare/v0.2.1...v0.3.0
[0.2.1]: https://github.com/mannkostir/domain-integrity/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/mannkostir/domain-integrity/compare/v0.1.1...v0.2.0
[0.1.1]: https://github.com/mannkostir/domain-integrity/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/mannkostir/domain-integrity/releases/tag/v0.1.0
