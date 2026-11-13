# Real-world validation

## Plain setter writes: issue #130

The final comparison used all 14 pinned public repositories in Setup against accepted main `4f2be2a` and reviewed implementation `7ba41d4`. Ordinary configurations retain **63 findings**, and the explicitly declared event sets retain **83 findings**. All 28 base/branch comparisons have identical finding objects, exit codes, problem arrays and stderr; no finding was added or lost. The existing Codely configuration failure remains identical. Original configs and pinned source commits were preserved. No private reference repository was accessed; its rerun remains a maintainer validation gate.

Focused regressions and outside-repository CLI probes cover the newly judged plain writes and conservative boundaries: exact instance setter/getter selection, inherited and static collisions, lexical private accessors and helper calls, ordinary string keys, ambiguous private tracked-field brands, compound/update reads, guarded or state-writing setters, and unresolved members. Independent final review found no must-fix issues and verified 23 zero-diagnostic analyzer probes. All 2,491 tests and the coverage, typecheck, lint, build and installed-package checks passed on the frozen reviewed source. Coverage is 98.13% statements, 93.10% branches, 99.13% functions and 99.31% lines. These public counts do not claim the separately tracked replay-applier false findings are fixed.

## Event self-reference and import-order re-run

The issue [#125](https://github.com/mannkostir/domain-integrity/issues/125) re-run compared accepted main `15147959bb608e2b001acfa8006e338ccf7d4ec2` with the fix on `batch-125`, using all fourteen public repositories at the Setup commits and their existing installed dependencies. The harness and repositories were read-only; no dependency, source or shared config changed. The private reference repository was not accessed and still needs a maintainer re-run. The historical counts below retain the setup of each earlier run.

With ordinary configs, without the three `events.inProcess` lists, both builds report the same 63 findings. With the existing declared-event configs they report 76 and 83. Every previous finding is unchanged and none is lost. No new `dead-handler`, saga or lifecycle finding appears. Every stderr and exit code is unchanged except domain-driven-hexagon, which changes from 0 to 1 because of its four new errors. Codely still exits 2 for its recorded missing config; every other public run produces a report without problems.

| Repository | Added `unhandled-event` | Source verification |
|---|---|---|
| domain-driven-hexagon | `UserAddressUpdatedDomainEvent`, `UserDeletedDomainEvent`, `UserRoleChangedDomainEvent`, `WalletCreatedDomainEvent` | Constructed through `addEvent` in `UserEntity.updateAddress`, `delete`, `changeRole` and `WalletEntity.create`, respectively. Their only other source mentions are imports and their own generic constructor parameter types. No handler is registered for them. The existing `UserCreatedDomainEvent` handler remains recognised. |
| Booking-System | `UserRegistered`, `UserEmailChanged`, `UserDeactivated` | Constructed through `addDomainEvent` in `User` at lines 27, 90 and 119. Their only other source mentions are imports and their own matching `eventName` strings. No handler is registered for them. The existing buffer finding and nine notification/OTP findings remain unchanged. |

All seven additions are real. The public declared-event total now contains 20 `unhandled-event` findings: ddd-forum 4, domain-driven-hexagon 4 and Booking-System 12. These resolve the seven silent losses recorded in the event-flow declaration run. Import order alone causes no additional finding in these repositories.

The declared comparisons used the original configs. The ordinary comparison copied only the three configs containing event declarations, removed those lists, made their imports absolute, and used explicit copies of the original tsconfig root-file lists excluding the original config. This avoids analysing the original config's event list as a value escape. The copied tsconfigs extend the originals, retain their project references, and set `rootDir` to `/` solely to allow the external config files; neither source roots nor analysis flags changed. Other ordinary comparisons used the original configs. An initial runner that left the original config in the program or could not resolve the helper package was corrected; its results are not used for these totals.

Seventeen out-of-repository CLI probes cover both directions: plain construction, own generic parameter, own matching string, first/second/aliased/type imports, named re-export, external generic and union parameters, external string topics, external and self value escapes, `new this()`, self construction, `instanceof` and subclasses with handlers. All branch expectations pass. Behavioral tests also exercise `dead-handler`, both saga consumers, local and type re-exports, default-export escapes and self factories; the final 29-case regression spec has seven failures on accepted main and passes on the branch. A separate reference test preserves matching strings in another source file even when their text positions overlap the event declaration.

## Summary

- **Repositories run:** 15: fourteen public repositories plus the private reference repo, which is counted among the 15. Five of them were added by the broadened-set run. Of the first ten, 9 produced a model and 1 (CodelyTV/typescript-ddd-example) has no state fields, so there was nothing to declare. Of the five added, `init` declared aggregates in four, and openlayers needed a hand-written config. There were also 2 thin repositories (mguay22/nestjs-ddd, mbrookson/nestjs-ddd). They were cloned, but their aggregates have no state fields and they were dropped. dyrector-io/dyrectorio was cloned and dropped because its Prisma client could not be generated.
- **Aggregates:** 47 discovered with the default base classes and 28 declared in the first ten. The 28th, kyhsa93 `AccountImplement`, implements an interface instead of extending a base class. It was declared by hand in the v0.1 run; with `'Account'` added to `aggregateBaseClasses` it is discovered, which makes 48. The five added repositories declare 40 more: 34 in schulcloud-server, 3 in SiweAuthMicroservice and 1 each in the others.
- **Lifecycle findings:** 40 in total, with ddd-forum listing `inertEventMethods: ['addDomainEvent']`; 39 without it:
  - 34 real;
  - 5 intended;
  - 1 false positive.

  The 2 kyhsa93 `clearEvents` findings, intended before, are no longer reported since methods that only keep books are not judged as domain commands. The 5 intended findings left go away by configuration: bitloops `commit` with `eventStreamVersion` in `auditFields`, and the 4 ticket-sale `EventSpot` findings with `is_reserved` declared with no terminal value.

  The first run produced 66 findings. 27 of them were false positives from one pattern, private event-sourcing appliers. The leak and drift checks now judge only public methods, which removes all 27. The one remaining false positive, kyhsa93 `close` after `lockedAt`, goes away when `close` is listed in `allowAfterTerminal` inside the `lockedAt` field, which left 41 findings before methods that only keep books stopped being judged. All 5 earlier bitloops findings are reported again once its library members are listed in `inertMembers`.
- **Event-flow findings:** 15 in the first ten repositories, all real: ddd-forum `handler-payload-mismatch` for `AfterPostVotesChanged.onPostVotesChanged`, Booking-System `undispatched-events` for `AggregateRoot._domainEvents`, and 13 `unhandled-event`, 4 in ddd-forum and 9 in Booking-System, with the `events.inProcess` lists of the event-flow declaration re-run. With lifecycle findings, 55 in total with ddd-forum listing `inertEventMethods`, and 54 without it. That run missed 7 declared events that are constructed and have no handler: 4 in domain-driven-hexagon and 3 in Booking-System; the issue #125 re-run above now reports all seven. `saga-missing-failure-path` has not run on a real repository, because none has a saga with a success and a failure outcome; it is marked experimental.
- **Broadened set:** 24 more lifecycle findings and no event-flow finding in the five added repositories:
  - 13 real;
  - 8 intended;
  - 3 false positives, typescript-event-sourcing-sample-app's public `applyJobCreated`, `applyJobUpdated` and `applyJobArchived` after `ARCHIVED`, which go away when they are listed in `allowAfterTerminal`.

  The 15 repositories report 65 findings with the recorded configs, and 78 with the three `events.inProcess` lists of the event-flow declaration re-run.
- **Spike findings:**

  | Spike finding | Result |
  |---|---|
  | bitloops Todo: `complete`/`uncomplete` after delete | Reproduced, with `modifyTitle` and `delete`, once `id` and `clearDomainEvents` are listed in `inertMembers`. |
  | kyhsa93 Account: `withdraw`/`deposit` after close or lock | Reproduced for both `deletedAt` and `lockedAt`. |
  | undb invitation: outside mutation through `WithStatus` | Reproduced, plus the same pattern in `WithRole`. |
  | Private reference repo | Two of three reproduced; see its section. |

## Setup

These steps applied to every repository:

- The repository was cloned with `--depth 1`.
- `node_modules/domain-integrity` was symlinked to the local build so that `domain.config.ts` type-checks.
- npm dependencies were installed with `npm install --ignore-scripts` in every public repository except undb, a Bun workspace, with the extra steps listed per repository below; see the installed-dependencies re-run above.
- `init --yes` was run, then `check --format json`.

Per-repository setup:

| Repository | Commit | Setup beyond the default |
|---|---|---|
| kyhsa93/nestjs-rest-cqrs-example | 03408fe | `AccountImplement implements Account` and extends nothing, so `init` with the default base classes finds nothing. With `aggregateBaseClasses: ['AggregateRoot', 'Entity', 'Account']`, `init --yes` declares it with the same terminal states as the hand-written v0.1 config, and `check` reported the same 13 findings until main 82abee8, which stopped judging methods that only keep books as domain commands; it reports 11 since. |
| bitloops/ddd-hexagonal-cqrs-es-eda (`backend/`) | daa3f22 | Ran `npm install --ignore-scripts ddd-tactical-core-boilerplate@^2` in a side directory and symlinked it, so `Domain.Aggregate` resolves. `domain.config.ts` lists `inertMembers: ['id', 'clearDomainEvents']`; the library implements `id` as a getter over a private field and `clearDomainEvents()` as a splice of a private array, so neither reads aggregate state. |
| undb-io/undb (`packages/authz`) | 3d2e93b | Bun workspace. Ran `npm install --ignore-scripts zod@^3 oxide.ts@^1` in a side directory and symlinked them at the repo root. A `tsconfig.di.json` extends the package tsconfig with `paths: { "@undb/*": ["../*/src/index.ts"] }` and `include: ["src"]`. npm cannot install a Bun workspace, so its dependencies are not installed. |
| Sairyss/domain-driven-hexagon | 5c2d15a | `npm install` needs `--legacy-peer-deps`: there is no lockfile, and `@nestjs/cqrs` has a peer conflict. `domain.config.ts` lists its 5 event classes in `events.inProcess`. |
| stemmlerjs/ddd-forum | 24df03e | `domain.config.ts` lists `inertEventMethods: ['addDomainEvent']`; its `addDomainEvent` pushes the event, registers the aggregate in the static `DomainEvents` registry by `id` and logs its prototype, so it reads no aggregate state. Before the package gained top-level `main` and `types`, `moduleResolution: "node"` could not resolve `domain-integrity`, and a `paths` entry was needed. `domain.config.ts` lists its 9 event classes in `events.inProcess`. |
| CodelyTV/typescript-ddd-example | 94717b0 | none |
| Private reference repo | analysed from a local copy | 6 aggregates discovered / 5 declared |
| AdrianLopezGue/daruma-backend | bc610c0 | none |
| emadansari96/Booking-System | 1059141 | `npx prisma generate` after the install. `domain.config.ts` lists its 45 event classes in `events.inProcess`. |
| illyanaAvelar/mba-full-cycle-ddd-ticket-sale | 843effa | none |
| hpi-schul-cloud/schulcloud-server | a8b06c1 | `npm ci --ignore-scripts`, which also fetches its `ldapjs` fork from GitHub. Checked with `-p apps/server/tsconfig.app.json`, which excludes `*spec.ts` and `testing/`. `init --base-class BaseEntityWithTimestamps --base-class BaseEntity` |
| Giveth/SiweAuthMicroservice | b7d787d | `init --base-class BaseEntity` |
| yerinadler/typescript-event-sourcing-sample-app (`packages/job/`) | 354ab3c | `npm install --ignore-scripts` at the root, which links the workspace packages, then `git checkout -- yarn.lock` and the generated `package-lock.json` deleted. `@cqrs-es/core` was built with `tsc -p packages/core`, because its `typings` point at `dist`. |
| adonisjs/application | 46f746c | `init --base-class Macroable`, run on a config that already listed the base class; see its section |
| openlayers/openlayers | d4851af | `init --base-class Target` finds no state fields, so the config is hand-written |

### Edits to `init` suggestions

| Repository | Aggregate.field | `init` suggested | Declared | Why |
|---|---|---|---|---|
| kyhsa93 | AccountImplement | `deletedAt: ['set']`, `lockedAt: ['set']`, once `'Account'` is in `aggregateBaseClasses` | `deletedAt: 'set'`, `lockedAt: 'set'` | hand-written in the v0.1 run; the spike treats close and lock as end states, and the suggestion now matches |
| undb | InvitationDo.status | `[]` | `['accepted', 'rejected']` | the class never assigns status, so `init` saw no setters |
| ddd-forum | User.isDeleted | `[]` | `[true]` | deletion is the end of a user |
| daruma | `_isRemoved` on all 7 aggregates | `[]` | `[true]` | the `on*Created` appliers set `false` from any state, so the guess rejects `true` |
| ticket-sale | Order.status | `[]` | `[OrderStatus.PAID, OrderStatus.CANCELLED]` | paid and cancelled orders are finished |
| Private reference repo | n/a | n/a | terminal states were adjusted by hand | n/a |
| schulcloud-server | Task.availableDate | `'set'` | `[]` | a publication date, set again by every `publish()`, not an end state |
| schulcloud-server | Task.creator | `'unset'` | `[]` | `removeCreatorId()` anonymises a task when its creator is deleted; the task lives on |
| schulcloud-server | DeletionRequestEntity.status | `[]` | `[StatusModel.SUCCESS]` | a request whose deletion succeeded is finished |
| adonisjs/application | the five `#private` fields | `#importer: …` and so on, unquoted | `'#importer': …` and so on, quoted | `init` writes the private names as bare keys, which do not type-check |
| adonisjs/application | Application.#state | `[]` | `['terminated']` | a terminated application is finished |
| openlayers | Tile.disposed | nothing, no state fields found | `[true]` | `Disposable.dispose()` sets it once and never resets it |

## kyhsa93/nestjs-rest-cqrs-example

| check | aggregate.method | verdict | reason |
|---|---|---|---|
| terminal-state-leak (deletedAt) | AccountImplement.withdraw | real | spike finding; no guard on `deletedAt` |
| terminal-state-leak (lockedAt) | AccountImplement.withdraw | real | spike finding; a locked account can still withdraw |
| terminal-state-leak (deletedAt) | AccountImplement.deposit | real | spike finding |
| terminal-state-leak (lockedAt) | AccountImplement.deposit | real | spike finding |
| terminal-state-leak (deletedAt) | AccountImplement.updatePassword | real | a closed account can change its password |
| terminal-state-leak (lockedAt) | AccountImplement.updatePassword | real | a locked account can change its password |
| terminal-state-leak (deletedAt) | AccountImplement.open | real | emits `AccountOpenedEvent` on a closed account |
| terminal-state-leak (lockedAt) | AccountImplement.open | real | emits `AccountOpenedEvent` on a locked account |
| terminal-state-leak (deletedAt) | AccountImplement.close | real | closing twice re-stamps `deletedAt` and emits a second event |
| terminal-state-leak (lockedAt) | AccountImplement.close | false positive (resolved by configuration) | closing a locked account is a legitimate exit; `lockedAt: { terminal: 'set', allowAfterTerminal: ['close'] }` exempts it for `lockedAt` alone, and `close` after `deletedAt` is still reported |
| terminal-state-leak (deletedAt) | AccountImplement.lock | real | a closed account can be locked |
| terminal-state-leak (deletedAt) | AccountImplement.clearEvents | intended (no longer reported) | `_events.length = 0` clears the outbox after persistence; emptying a proven event array is bookkeeping, so the method is not judged as a domain command |
| terminal-state-leak (lockedAt) | AccountImplement.clearEvents | intended (no longer reported) | same |

`lock()` is not reported for `lockedAt`, because `if (this.lockedAt) throwError(...)` is recognised as a guard.

## bitloops/ddd-hexagonal-cqrs-es-eda

| check | aggregate.method | verdict | reason |
|---|---|---|---|
| terminal-state-leak | TodoEntity.delete | real | deleting twice emits a second `TodoDeletedDomainEvent` |
| terminal-state-leak | TodoEntity.complete | real | spike finding; only `completed` is checked, never `deleted` |
| terminal-state-leak | TodoEntity.uncomplete | real | spike finding |
| terminal-state-leak | TodoEntity.modifyTitle | real | renaming a deleted todo is allowed |
| terminal-state-leak | TodoEntity.commit | intended | sets the stream version and clears events after persisting; must run after `delete`; not reported once `eventStreamVersion` is listed in `auditFields` |

Without `inertMembers`, the library getter `this.id` and method `this.clearDomainEvents()` count as reading `deleted`, and only `delete` is reported.

In the earlier run the spike finding survived the conservative rules. `complete()` uses a rule object (`Domain.applyRules([new Rules.TodoAlreadyCompleted(this.props.completed, ...)])`), and it passes field values, not `this`. That makes the `completed` field unknown for the method, but `deleted` is still known and unguarded. Nothing is reported for the `completed` field, which has no terminal value and no transitions.

## undb-io/undb (`packages/authz`)

| check | aggregate.method | verdict | reason |
|---|---|---|---|
| outside-mutation (status) | InvitationDo, in `WithStatus.mutate` | real | spike finding; the specification assigns `t.status` and bypasses the aggregate |
| outside-mutation (role) | InvitationDo, in `WithRole.mutate` | real | same pattern for `role`; `init` suggested `role` as a state field |

`accepted` and `rejected` are never assigned inside the class, but `unreachable-state` stays silent. Both values are mentioned in `new WithStatus("accepted")` and similar calls, and the outside assignment is unresolved.

## Sairyss/domain-driven-hexagon

There were no findings. `UserEntity.role` was the only suggested field. It has no terminal value or transitions to check against. `WalletEntity` has no state field.

With its 5 event classes declared in `events.inProcess` there are still no findings. Only `UserCreatedDomainEvent` has a handler. The other 4 are constructed and emitted through `EventEmitter2` with no listener, but each event constructor takes `props: DomainEventProps<…>` with its own class as the type argument, which keeps `unhandled-event` silent.

## stemmlerjs/ddd-forum

| check | aggregate.method | verdict | reason |
|---|---|---|---|
| terminal-state-leak (isDeleted) | User.setAccessToken | real | no guard on `isDeleted`; a deleted user can log in, which emits `UserLoggedIn` and stamps a new access token |
| handler-payload-mismatch | AfterPostVotesChanged.onPostVotesChanged | real | registered for `PostVotesChanged` but typed as the unrelated `CommentVotesChanged` |
| unhandled-event | MemberCreated | real | raised in `Member.create` and dispatched by the `Member` hooks; no callback is registered for it |
| unhandled-event | PostCreated | real | raised in `Post.create` and dispatched by the `Post` hooks; no callback is registered for it |
| unhandled-event | UserLoggedIn | real | raised in `User.setAccessToken` and dispatched by the `BaseUser` hooks; no callback is registered for it |
| unhandled-event | UserDeleted | real | raised in `User.delete` and dispatched by the `BaseUser` hooks; no callback is registered for it |

`User.isDeleted` was declared terminal at `true`. Both `setAccessToken` and `delete` call the project-declared `addDomainEvent`, which also passes `this` to the static `DomainEvents` registry and logs through `Reflect.getPrototypeOf(this)`, so it is not push-only. Without configuration that keeps both methods unjudged and reports nothing. With `inertEventMethods: ['addDomainEvent']`, its body is not traced and `new UserLoggedIn(this)` counts as an event handoff, so `setAccessToken` is reported. `delete` is guarded by `if (!this.props.isDeleted)` and stays silent. The `type` fields on Post, PostVote and CommentVote are kinds, not lifecycles. They were declared with no terminal value.

## CodelyTV/typescript-ddd-example

Three aggregates were discovered (BackofficeCourse, Course, CoursesCounter). None has an enum, union, boolean or nullable field, so there was nothing to declare and nothing to check. `init` says that it found no state fields.

## Private reference repo

| check | aggregate.method | verdict | reason |
|---|---|---|---|
| transition-drift | OrderEntity.cancel | real | real: can run from undeclared sources |
| terminal-state-leak | PaymentEntity.attempt | real | real: can run after a terminal state |

An unreachable-state finding from the spike was not reproduced: the mention rule silences it because the value is referenced elsewhere in that codebase.

## AdrianLopezGue/daruma-backend

This repository is event-sourced. Public commands call `this.apply(event)`, and private `on<Event>` appliers assign the fields. `remove()` on every aggregate guards with `if (this._isRemoved) return;`, and that guard is recognised.

The first run also reported the 27 private `on<Event>` appliers: 10 on Bill, 4 each on Group and Member, 3 on RecurringBill, and 2 on each transaction aggregate. These were false positives, because the appliers are reached only through `apply()` or replay, and the guard belongs on the public command. Since the leak and drift checks now judge only public methods, they are no longer reported. The 13 findings below are unchanged.

| check | aggregate.method | verdict | reason |
|---|---|---|---|
| terminal-state-leak | Bill.rename | real | the only guard compares the new name; a removed bill can be renamed |
| terminal-state-leak | Bill.addPayer | real | no guard |
| terminal-state-leak | Bill.addDebtor | real | no guard |
| terminal-state-leak | Bill.removePayer | real | no guard |
| terminal-state-leak | Bill.removeDebtor | real | no guard |
| terminal-state-leak | Bill.changeMoney | real | guard compares money only |
| terminal-state-leak | Bill.changeCurrencyCode | real | the aggregate has no guard; one handler checks `isRemoved` before calling it, so the invariant lives outside the aggregate |
| terminal-state-leak | Bill.changeDate | real | guard compares date only |
| terminal-state-leak | Group.rename | real | no guard on `_isRemoved` |
| terminal-state-leak | Group.changeCurrencyCode | real | no guard on `_isRemoved` |
| terminal-state-leak | Member.setUserId | real | no guard on `_isRemoved` |
| terminal-state-leak | Member.rename | real | no guard on `_isRemoved` |
| terminal-state-leak | RecurringBill.changePeriod | real | no guard on `_isRemoved` |

## emadansari96/Booking-System

There were no lifecycle findings. Booking, Payment and Invoice keep their status in value objects (`BookingStatus.create(...)`, `status.canTransitionTo(...)`), which are not supported state types. The project also sets `strictNullChecks: false`, so its optional timestamps are not nullable state fields. Only the `isActive` booleans on four aggregates were suggested. They have no terminal value.

The original event-flow run reported nothing here either. The `CommissionStrategyUpdated`, `CommissionStrategyActivated` and `CommissionStrategyDeactivated` handlers never run, but their events are constructed and raised with `addDomainEvent` into a buffer that nothing dispatches, which `undispatched-events` now reports as `AggregateRoot._domainEvents`.

With its 45 event classes declared in `events.inProcess`, `unhandled-event` reports 9:

| check | event | verdict | reason |
|---|---|---|---|
| unhandled-event | NotificationCreatedEvent | real | constructed in `NotificationEntity`; the notification module has no event handler and nothing else names the class |
| unhandled-event | NotificationSentEvent | real | same |
| unhandled-event | NotificationDeliveredEvent | real | same |
| unhandled-event | NotificationFailedEvent | real | same |
| unhandled-event | NotificationCancelledEvent | real | same |
| unhandled-event | OtpCreatedEvent | real | constructed in `OtpEntity`; no event handler and nothing else names the class |
| unhandled-event | OtpVerifiedEvent | real | same |
| unhandled-event | OtpUsedEvent | real | same |
| unhandled-event | OtpExpiredEvent | real | same |

`UserRegistered`, `UserEmailChanged` and `UserDeactivated` have no handler either, but each sets `eventName` to its own class name, a string equal to its name, which keeps the rule silent.

## illyanaAvelar/mba-full-cycle-ddd-ticket-sale

| check | aggregate.method | verdict | reason |
|---|---|---|---|
| terminal-state-leak | EventSpot.markAsReserved | intended | `EventSpot` is a child entity, matched by the default `Entity` base class; the owning `EventSection.markSpotAsReserved` throws on an already reserved spot; not reported once `is_reserved` is declared with no terminal value |
| terminal-state-leak | EventSpot.changeLocation | intended | `init` guessed `is_reserved: [true]` as terminal; a reserved spot is not a finished spot; not reported once `is_reserved` is declared with no terminal value |
| terminal-state-leak | EventSpot.publish | intended | same |
| terminal-state-leak | EventSpot.unPublish | intended | same |
| terminal-state-leak | Order.pay | real | no guard; a cancelled order can be paid, and paying twice emits a second `OrderPaid` |
| terminal-state-leak | Order.cancel | real | no guard; a paid order can be cancelled |

`Order.pay()` is `this.status = OrderStatus.PAID; this.addEvent(new OrderPaid(this.id, this.status));`, and `cancel()` has the same shape. The v0.1 CLI reported nothing for them, because the read of `this.status` in the event payload made their sources unknown. That read comes after the method's first assignment of `status`, so it is now ignored.

## hpi-schul-cloud/schulcloud-server

MikroORM entities in a NestJS server with 3,529 non-test TypeScript files under `apps/server/tsconfig.app.json`. `init` took 23 s and declared 34 entities that extend `BaseEntityWithTimestamps` or `BaseEntity`. Most suggested fields are kinds, flags or nullable data with no terminal value. The domain logic of the newer modules lives in domain objects whose MikroORM entity is the storage model and is written by mappers and repositories; those domain objects extend `DomainObject` and were not declared.

| check | aggregate.method or scope | verdict | reason |
|---|---|---|---|
| terminal-state-leak (status) | DeletionRequestEntity.executed | real | no guard; `DeletionRequestRepo` loads the request by id and calls it without checking the status |
| terminal-state-leak (status) | DeletionRequestEntity.failed | real | a succeeded request can be marked failed |
| terminal-state-leak (status) | DeletionRequestEntity.pending | real | a succeeded request can be put back to pending and run again |
| terminal-state-leak (deletedAt) | FileEntity.markForDeletion | real | marking a file again re-stamps `deletedAt`, which postpones its purge; its caller `DeleteUserFilesDataStep.markFilesOwnedByUserForDeletion` loads files through `FilesRepo.findByOwnerUserId`, which does not exclude deleted ones |
| terminal-state-leak (deleted) | FileEntity.markForDeletion | real | same |
| terminal-state-leak (deletedAt) | FileEntity.removePermissionsByRefId | real | the entity has no guard; its only production caller, `DeleteUserFilesDataStep.removeUserPermissionsOrCreatorReferenceToAnyFiles`, loads files through `FilesRepo.findByPermissionRefIdOrCreatorId`, whose query matches only `deleted: false` and `deletedAt: undefined`, so the invariant lives in the repository query, outside the aggregate |
| terminal-state-leak (deleted) | FileEntity.removePermissionsByRefId | real | same |
| terminal-state-leak (deletedAt) | FileEntity.removeCreatorId | real | same |
| terminal-state-leak (deleted) | FileEntity.removeCreatorId | real | same |
| outside-mutation (status) | DeletionBatchEntity, in `DeletionBatchRepo.updateStatus` | real | the repository sets the status itself instead of going through the domain object's `startDeletion()`; no production code calls it |
| outside-mutation (status) | DeletionBatchEntity, in `DeletionBatchDomainMapper.mapDoToEntity` | intended | `Object.assign` fills a new entity from the domain object's props; the domain object owns the lifecycle |
| outside-mutation (targetRefDomain) | DeletionBatchEntity, in `DeletionBatchDomainMapper.mapDoToEntity` | intended | same |
| outside-mutation (color) | RoomEntity, in `RoomDomainMapper.mapDoToEntity` | intended | same |
| outside-mutation (type) | BoardNodeEntity, in `BoardNodeRepo.persist` | intended | the repository sets the discriminator on an entity it has just created with `em.create` |
| outside-mutation (user) | ImportUser, in `UserImportService.matchUsers.matchedImportUsers` | real | the service sets `user` and `matchedBy` directly instead of calling `ImportUser.setMatch(user, matchedBy)` |
| outside-mutation (flagged) | ImportUser, in `UserImportUc.updateFlag` | intended | a free toggle with no lifecycle; `init` suggested the boolean |
| outside-mutation (ldapDn) | User, in `UserImportUc.updateUserAndAccountWithLdap` | intended | an identifier `init` suggested as a nullable field, not lifecycle state |
| outside-mutation (externalId) | User, in `UserImportUc.updateUserAndAccountWithLdap` | intended | same |

With `init`'s suggestions unchanged the run reports 21 findings: the 6 `Task` findings for `publish`, `unpublish` and `removeCreatorId` after the guessed `availableDate: 'set'` and `creator: 'unset'` replace the 3 `DeletionRequestEntity` findings, whose terminal value `init` did not guess. A single `check` takes 14.9 s, the slowest in the set; `init` and `check` both finish without a problem.

## Giveth/SiweAuthMicroservice

TypeORM active-record entities that extend `BaseEntity` and are changed by controllers and repository functions, which then call `save()`.

| check | aggregate, scope | verdict | reason |
|---|---|---|---|
| outside-mutation (isBlacklisted) | AccessToken, in `LogoutController.logOut` | real | the controller blacklists the token itself; the entity has no method for it |
| outside-mutation (active) | MultisigSession, in `findNonExpiredMultisigSessions` | real | the repository function deactivates an expired session itself |
| outside-mutation (role) | Admin, in `addDefaultAdminUser1701273095150.up` | intended | a migration seeds a new admin with a role, which is a kind, not lifecycle state |

The picker's example, `MultisigSession.status`, is typed `string`, although its values come from the `MultisigStatuses` enum, so `init` does not suggest it. Declared by hand with `terminal: [MultisigStatuses.Successful, MultisigStatuses.Failed]`, it type-checks, and `check` prints the problem `MultisigSession.status has unsupported type "string"` and leaves the field out, so `multisigStatus()` is not judged. The recorded config does not declare it.

## yerinadler/typescript-event-sourcing-sample-app (`packages/job/`)

Event sourcing on a project `AggregateRoot` in the workspace package `@cqrs-es/core`, which `packages/job/tsconfig.json` lists in `references`. Commands call `this.applyChange(event)`, and `AggregateRoot.applyEvent` dispatches to `apply<EventName>` by a computed name. `@cqrs-es/core` resolves through the workspace link to its built declaration files, so `applyChange` has no body in the program.

| check | aggregate.method | verdict | reason |
|---|---|---|---|
| terminal-state-leak (status) | Job.applyJobCreated | false positive (resolved by configuration) | an event applier, reached only through `applyChange` and `loadFromHistory`; it is public only because it has no modifier, the shape daruma-backend's private appliers had. Listing the three appliers in `allowAfterTerminal` leaves no finding |
| terminal-state-leak (status) | Job.applyJobUpdated | false positive (resolved by configuration) | same |
| terminal-state-leak (status) | Job.applyJobArchived | false positive (resolved by configuration) | same |

`init` suggested `status: JobStatus.ARCHIVED` and needed no edit. `updateInfo()` has a real leak, an archived job can still be updated, but it stays silent: `applyChange` exists only in a declaration file, so it counts as reading `status`. That silence is right, because `applyChange` runs the appliers, one of which writes `status`. `archive()` is guarded by `if (this.status === JobStatus.ARCHIVED) throw`.

## adonisjs/application

A NodeNext ESM package whose `Application` keeps its lifecycle in the private field `#state: ApplicationStates`, a string-literal union from `'created'` to `'terminated'`. `init` wrote the import as `./src/application.js`, as NodeNext requires. Two `init` problems needed a workaround:

- `init --base-class Macroable` with no config exits 2 with `'lifecycle' is declared but its value is never read.`, because the project's `noUnusedLocals` rejects the starting config, which imports `lifecycle` before any lifecycle is added. Run against a config that already lists `aggregates: { baseClasses: ['Macroable'] }` and imports only `defineDomain`, it declares `Application`.
- It writes the `#private` field names as bare keys, `#state: { terminal: [] }`, which fail to type-check with "Private identifiers are not allowed outside class bodies", so `check` exits 2. Quoted, `'#state'`, they type-check and the fields are modelled.

There are no findings. Every method that writes a declared field is "guard not analysed" for every field: `setEnvironment` and `setMode` return `this` for chaining, and `init`, `boot`, `warmUp`, `start` and `terminate` pass `this` to hook runners and callbacks, such as `this.#hooks.runner('booting').run(this)`. Each of them guards `#state` first, for example `if (this.#state !== 'booted') return`, so no leak is lost here.

## openlayers/openlayers

An `allowJs` ESM project with `"module": "node16"`, 374 JavaScript files under `src/ol`. Its classes assign their fields in the constructor under a JSDoc `@type`, so `init --base-class Target` says that it found no state fields and writes no config. The picker's example, `Tile.state`, is typed `number`, which is not a supported state type. The config is hand-written: `Tile` with `disposed: { terminal: [true] }`, which the project base class `Disposable` sets once in `dispose()`.

There are no findings. Every `Tile` method that writes a field is "guard not analysed": each touches a field assigned only in a constructor, such as `state`, `key` or `transitionStarts_`, directly or through a method it calls, and the base class `Target` also hands `this` to listeners (`evt.target = this.eventTarget_ || this`). Out-of-repo probes show how far the analysis sees `allowJs` code. In a `.js` class with `closed` and `label` assigned in the constructor, `init` suggests nothing; declared by hand, an unguarded `close()` that writes `closed` is reported, but an unguarded `rename()` that writes `label` is not, and neither is one that reads or writes `label` before it writes `closed`. Declared as class fields, `closed = false;` and `label = '';`, `init` suggests `closed: true` and both methods are reported, as in TypeScript.

## Seeded transitions

The transition-seeding run used this branch's build on the same 15 repositories and commits. With the recorded configs, `check` reports the same 78 findings with the same exit codes and stderr in every repository, since only `init` changed.

To seed, each repository's recorded config was copied to a new file outside the repository, with `lifecycles` emptied and every other option kept: base classes, inert members, inert event methods and `events`. `init --yes` was then run against that file, and `check --format json` with the seeded config on the unchanged code. codely has no recorded config, so its seed started from an empty `defineDomain({ lifecycles: [] })`. The private reference repo's config was written outside it too. Three seeded configs needed hand edits before `check` would read them, all for `init` faults that are older than seeding and are listed under [Open issues](#open-issues):

- daruma (9 lines) and schulcloud-server (57 lines) had symbol-keyed fields, such as `__@IS_AUTO_COMMIT_ENABLED@2676`, written as bare keys; those lines were dropped. None of them had transitions.
- adonisjs had its five `#private` fields written as bare keys; they were quoted, as in the recorded config.
- daruma had a `Foo` class from a spec file, which the file does not export, declared as an aggregate; its entry was dropped.

| Repository | Fields declared | Seeded | `from` entries | Withheld | No public writer | Transition findings | Problems |
|---|---|---|---|---|---|---|---|
| kyhsa93 | 2 | 2 | 2 | 0 | 0 | 0 | 0 |
| bitloops | 2 | 1 | 1 | 1 | 0 | 0 | 0 |
| undb | 3 | 0 | 0 | 0 | 3 | 0 | 0 |
| Sairyss | 2 | 0 | 0 | 0 | 2 | 0 | 0 |
| ddd-forum | 7 | 0 | 0 | 1 | 6 | 0 | 0 |
| codely | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| Private reference repo | 7 | 2 | 4 | 0 | 5 | 0 | 0 |
| daruma | 15 | 0 | 0 | 0 | 15 | 0 | 0 |
| Booking-System | 5 | 3 | 6 | 0 | 2 | 0 | 0 |
| ticket-sale | 5 | 5 | 9 | 0 | 0 | 0 | 0 |
| schulcloud-server | 97 | 9 | 15 | 2 | 86 | 0 | 0 |
| SiweAuthMicroservice | 4 | 0 | 0 | 0 | 4 | 0 | 0 |
| typescript-event-sourcing-sample-app | 1 | 1 | 1 | 0 | 0 | 0 | 0 |
| adonisjs/application | 7 | 0 | 0 | 4 | 3 | 0 | 0 |
| openlayers | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| **Total** | **157** | **23** | **38** | **8** | **126** | **0** | **0** |

"No public writer" counts fields that only private or protected methods, constructors or factories write, or that nothing in the class writes, such as daruma's `_isRemoved`, which only the `on*` appliers set. `init` seeds nothing for them, and `check` judges no method for them, so they cannot drift. Every withheld field has a public writer whose guard `init` cannot follow:

| Repository | Field | Withheld method | Guard shape |
|---|---|---|---|
| bitloops | `TodoEntity.completed` | `complete()`, `uncomplete()` | a rule object passed to `Domain.applyRules` |
| ddd-forum | `User.isDeleted` | `delete()` | a wrapping `if (!this.props.isDeleted)` whose block raises an event built from `this` |
| schulcloud-server | `FileEntity._creatorId` | `removeCreatorId()` | a comparison of a parameter with `this._creatorId?.toHexString()` |
| schulcloud-server | `Submission.student` | `removeStudentById()` | the same shape, a parameter compared with a value read from the field |
| adonisjs/application | `#terminating`, `#environment`, `#mode`, `#state` | `terminate()`, `setEnvironment()`, `setMode()`, and `init()`, `boot()`, `warmUp()`, `start()`, `terminate()` | guards `init` cannot follow |

So, as intended, the 23 seeded fields add no `transition-drift` or `transition-missing` on the code they were seeded from, and no problem.

Probes outside the repository show both rules firing once a seeded declaration exists. The probe is an `Order` with an enum `status`. `confirm()` is guarded to run from `Pending`, `ship()` from `Confirmed`, and `cancel()` from anything but `Shipped` and `Cancelled`. `init --yes` seeds `confirm: { from: [Pending] }`, `ship: { from: [Confirmed] }` and `cancel: { from: [Pending, Confirmed] }`, and `check` is clean. Then:

- Removing `ship()`'s guard reports `transition-drift` (`extra`: `Pending`, `Shipped`, `Cancelled`), as well as `terminal-state-leak`.
- Loosening `confirm()`'s guard to exclude only the terminal states reports `transition-drift` (`extra`: `Confirmed`) and nothing else, a change that `terminal-state-leak` cannot see.
- Tightening `cancel()`'s guard to `Pending` only reports the `transition-missing` warning for `Confirmed`, and `check` exits `0`.

### unreachable-state

A diagnostic run over the recorded configs listed every value of a declared enum or union field that no read assignment sets, and what keeps `unreachable-state` quiet about it:

| Repository | Enum or union fields | Values | Not assigned | Silenced by a write that cannot be resolved | Silenced by a mention |
|---|---|---|---|---|---|
| undb | 2 | 6 | 5 | 5 | 0 |
| Sairyss | 1 | 3 | 3 | 3 | 0 |
| ddd-forum | 3 | 6 | 2 | 2 | 0 |
| Private reference repo | 2 | 8 | 1 | 0 | 1 |
| ticket-sale | 1 | 3 | 0 | 0 | 0 |
| schulcloud-server | 26 | 178 | 166 | 154 | 12 |
| SiweAuthMicroservice | 1 | 3 | 2 | 2 | 0 |
| typescript-event-sourcing-sample-app | 1 | 2 | 0 | 0 | 0 |
| adonisjs/application | 3 | 14 | 7 | 7 | 0 |
| **Total** | **40** | **223** | **186** | **173** | **13** |

The other repositories declare no enum or union field. Most unassigned values belong to fields that a constructor or factory writes from a parameter, such as `this.role = props.role`, so the field might hold any value. 12 of the 13 mentioned values are discriminators of schulcloud-server's news and board-element subclasses. Each subclass's constructor sets only its own value, and its siblings' values are mentioned in the siblings' `@Entity` decorators and constructors. The 13th is an order status in the private reference repo, mentioned outside a comparison. The mention rule stays as it is: a mention may be the code that sets the value, and unknown never produces a finding.

A re-run with tsconfigs that include only each repository's `domain` directories reports no `unreachable-state` where it runs, because every remaining value is either assigned or silenced by a write that cannot be resolved. Where the include pattern leaves out a declared class, the run exits `2`. A probe outside the repository shows the documented way to make the rule fire. A `Post` whose `Archived` value is only compared reports `unreachable-state`. An `api/post.dto.ts` holding `Object.values(PostStatus)`, or the string `'archived'`, silences it. `check -p` with a tsconfig that includes only `src/domain` reports it again.

## Open issues

The first was not fixed, because it needs a design change rather than a correction of an existing rule. Issues 2 to 4 were found by the broadened-set run, and 5 and 6 by the seeded-transitions run; neither run changes the analyzer.

1. **Aggregates that leak `this` silence methods that read object fields.** An aggregate leaks `this` when its project class family (its project base classes and project subclasses) lets `this` or `this.props` escape anywhere, or contains an arrow function that references `this` other than a direct callback of `filter`, `map`, `some`, `every`, `find`, `findIndex`, `forEach`, `reduce`, `flatMap` or `sort` called on a built-in array or tuple. Factory members are static members and any member that calls `new` on a class in the family, such as `clone()`, including constructors, property initializers and accessors. Inside a factory member, a variable or parameter is treated like `this` when it is typed as the aggregate, initialized with `new` on a class in the family, or assigned one with `=`, `??=`, `||=` or `&&=`, whatever its declared type. It leaks when it escapes or is captured by any function other than a direct array callback, except in a bare `return v;`, which is how a factory hands back the instance it built; `return Result.ok(v)` is an escape. Two forms that only copy values are not leaks: `Object.assign(this, …)` or `Object.assign(this.props, …)` as a statement whose result is discarded, and a spread of `this` or `this.props` inside an object literal. In a leaking aggregate every project data field whose type is not primitive (string, number, boolean, bigint, symbol, literal, enum, or a built-in TypeScript library type such as `Date` whose type arguments are primitive and which has no index signature) counts as reading the state field. In an aggregate that does not leak, project data fields never count, whatever their type. The leak check does not see every way to wire a back-reference. These shapes are not seen, and a guard through a field wired by them is read as no guard, which can produce a false leak: a factory or service outside the class, for example `agg.policy = new Policy(agg)` or `agg.canEdit = () => agg.isOpen()`; the instance held inside another object (`box.o.policy.owner = box.o`); and a module-level factory function. None of the validation repositories is affected by the unseen shapes today.
2. **Public event-sourcing appliers are judged as commands.** typescript-event-sourcing-sample-app's `applyJobCreated`, `applyJobUpdated` and `applyJobArchived` are public because they have no modifier, and are reached only through `applyChange` and `loadFromHistory`, which dispatch to `apply<EventName>` by a computed name. They are reported as `terminal-state-leak` after `ARCHIVED`, as daruma-backend's appliers were before they became private. Listing them in `allowAfterTerminal` resolves it by configuration.
3. **`allowJs` fields assigned in a constructor are barely seen.** `init` suggests none of them, so openlayers gets no config, and a method that reads or writes one before it writes the declared state field is skipped as unknown, so an unguarded method that writes only such fields is never reported. The same class with class fields is analysed as in TypeScript.
4. **`init` and `#private` fields or `noUnusedLocals`.** `init` writes `#private` field names as bare object keys, which do not type-check, so the config it writes makes `check` exit 2. With no existing config, `init --base-class` exits 2 in a project with `noUnusedLocals`, because its starting config imports `lifecycle` before any lifecycle is added.
5. **`init` and symbol-keyed fields.** A field keyed by a `unique symbol`, such as one a library base class declares, is suggested under its internal name, for example `__@IS_AUTO_COMMIT_ENABLED@2676`, and written as a bare key, which is a syntax error. The seeded-transitions run met it in daruma and schulcloud-server.
6. **`init` and classes a module does not export.** daruma's `Foo`, a class in a spec file that the file does not export, is discovered and declared, so the written import does not type-check and `check` exits 2.

## Resolved during validation

- **Infrastructure methods were judged as domain commands.** Any write to `this` made a method a mutator, so kyhsa93 `clearEvents()`, which empties the outbox after persistence, and bitloops `commit()`, which stamps the stream version, were reported after the terminal state. A method whose only writes stamp an `auditFields` field or empty a proven private event array is no longer judged as a domain command; pushing an event still is ([issue #61](https://github.com/mannkostir/domain-integrity/issues/61)). kyhsa93 `clearEvents` is no longer reported, and bitloops `commit` is not once `eventStreamVersion` is listed in `auditFields`.
- **Project-declared event methods that register `this` hid real leaks.** ddd-forum's `addDomainEvent` pushes the event, passes `this` to the static `DomainEvents.markAggregateForDispatch` registry and logs through `Reflect.getPrototypeOf(this)`, so it is not push-only and its callers, including `User.setAccessToken`, stayed unjudged. Resolved by configuration ([issue #33](https://github.com/mannkostir/domain-integrity/issues/33)): a project lists event methods known not to read aggregate state in `inertEventMethods`, and with `inertEventMethods: ['addDomainEvent']` ddd-forum reports `setAccessToken` after `isDeleted`. The assertion is switched off when the name is declared or written as anything other than a method, or when a class in the aggregate's family is decorated or calls `Object.assign(this, …)`.
- **`allowAfterTerminal` was per aggregate, not per field.** kyhsa93 `close()` should be allowed after `lockedAt` but not after `deletedAt`, and the only options were to exempt it for both fields or for neither. A state field now takes its own `allowAfterTerminal`, which combines with the aggregate-level list, so `close` can be exempted for `lockedAt` alone. Fixed in #38.
- **Private event appliers were judged as entry points.** This caused the 27 false positives in daruma-backend. The leak and drift checks now judge only public methods. Fixed in 56c5953.
- **`init` collapsed classes with the same name.** When two suggested aggregate classes in different files shared a name, `init` imported only one of them. It now imports the later one under a distinct local name, for example `Order as Order2`, and does the same for same-named state enums. Fixed in 5692004.
- **Misleading `init` message.** When no discovered aggregate had a candidate field, `init` printed "All discovered aggregates are already declared." and wrote no config. It now says that no state fields were found. Fixed in 96ff2b7.
- **The package did not resolve under `moduleResolution: "node"`.** `package.json` now has top-level `main` and `types`. ddd-forum checks without a `paths` workaround. Fixed in 3f6a1ab.
- **Reading the state field after assigning it silenced the method.** A read of the field anywhere outside a recognised guard made the method's sources unknown, including a read in an event payload right after the assignment. Reads after the method's first top-level plain assignment of the field are now ignored, because they cannot gate entry to the method; reads before it, including the assignment's right-hand side, still count. ticket-sale `Order.pay` and `Order.cancel` and bitloops `TodoEntity.delete` are now reported. Fixed in 6387552.
- **Aggregates that implement an interface were not discovered.** kyhsa93's `AccountImplement implements Account` has no base class, and `aggregateBaseClasses` matched only base classes. It now also matches interfaces a class implements, directly or through its base classes and the interfaces they extend. With `'Account'` in `aggregateBaseClasses`, `init` discovers and declares `AccountImplement`. Fixed in bdbf805.
- **`this`-leak tracking missed instances built with `new` and instance-method factories.** Inside static members only locals typed as the aggregate were tracked, and members such as `clone()` were not checked. Factory members now include any member that calls `new` on a class in the family, and a variable initialized or assigned with such a `new` is tracked whatever its declared type. This only adds silence; no validation finding changed. Fixed in 231babf.
- **Library getters and methods silenced the methods that use them.** A getter or method declared only in a library, with no body in the project, counts as reading the state field unless it is one of the configured `eventMethods`. This is required for soundness: a library method such as `assertActive()` or a getter such as `stateName` can call an abstract hook that the project implements over the state field, so treating it as inert produces false leaks. Only library data properties whose type cannot hold the field are exempt, and reads after the method's first assignment of the field are ignored. bitloops `TodoEntity` reads the library getter `this.id` and calls `this.clearDomainEvents()`, so without configuration 4 of its 5 earlier findings stay silent and only `delete()`, which reads `this.id` after assigning `deleted`, is reported. Resolved by configuration: a project lists library members known not to read aggregate state in `inertMembers`, and with `inertMembers: ['id', 'clearDomainEvents']` bitloops reports all 5 again. A member the project declares, such as an override, is still traced. A `.d.ts` file that declares a getter as a plain property is trusted as written, so such a member is treated as a data property.
