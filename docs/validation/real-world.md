# Real-world validation

The v0.1 CLI was run against nine public TypeScript DDD repositories and one private reference repository. Each finding was triaged by reading the code. The tables below reflect the CLI after the fixes listed under [Resolved during validation](#resolved-during-validation).

## Summary

- **Repositories run:** 10: nine public repositories plus the private reference repo, which is counted among the 10. Of those, 9 produced a model and 1 (CodelyTV/typescript-ddd-example) has no state fields, so there was nothing to declare. There were also 2 thin repositories (mguay22/nestjs-ddd, mbrookson/nestjs-ddd). They were cloned, but their aggregates have no state fields and they were dropped.
- **Aggregates:** 47 discovered and 28 declared. Of the declared aggregates, 1 was declared by hand because its class implements an interface instead of extending a base class.
- **Findings:** 34 in total:
  - 27 real;
  - 6 intended;
  - 1 false positive.

  The first run produced 66 findings. 27 of them were false positives from one pattern, private event-sourcing appliers. The leak and drift checks now judge only public methods, which removes all 27. The one remaining false positive, kyhsa93 `close` after `lockedAt`, comes from a tool limitation (open issue 2). The 5 bitloops findings (4 real, 1 intended) are no longer reported (open issue 5).
- **Spike findings:**

  | Spike finding | Result |
  |---|---|
  | bitloops Todo: `complete`/`uncomplete` after delete | Reproduced by the earlier run, with `modifyTitle` and `delete`. The current CLI reports nothing (open issue 5). |
  | kyhsa93 Account: `withdraw`/`deposit` after close or lock | Reproduced for both `deletedAt` and `lockedAt`. |
  | undb invitation: outside mutation through `WithStatus` | Reproduced, plus the same pattern in `WithRole`. |
  | Private reference repo | Two of three reproduced; see its section. |

## Setup

These steps applied to every repository:

- The repository was cloned with `--depth 1`.
- `node_modules/domain-integrity` was symlinked to the local build so that `domain.config.ts` type-checks.
- `init --yes` was run, then `check --format json`.

Per-repository setup:

| Repository | Commit | Setup beyond the default |
|---|---|---|
| kyhsa93/nestjs-rest-cqrs-example | 03408fe | `init` finds nothing, because `AccountImplement implements Account` and extends nothing. The config was written by hand. |
| bitloops/ddd-hexagonal-cqrs-es-eda (`backend/`) | daa3f22 | Ran `npm install --ignore-scripts ddd-tactical-core-boilerplate@^2` in a side directory and symlinked it, so `Domain.Aggregate` resolves. |
| undb-io/undb (`packages/authz`) | 3d2e93b | Bun workspace. Ran `npm install --ignore-scripts zod@^3 oxide.ts@^1` in a side directory and symlinked them at the repo root. A `tsconfig.di.json` extends the package tsconfig with `paths: { "@undb/*": ["../*/src/index.ts"] }` and `include: ["src"]`. |
| Sairyss/domain-driven-hexagon | 5c2d15a | none |
| stemmlerjs/ddd-forum | 24df03e | none. Before the package gained top-level `main` and `types`, `moduleResolution: "node"` could not resolve `domain-integrity`, and a `paths` entry was needed. |
| CodelyTV/typescript-ddd-example | 94717b0 | none |
| Private reference repo | analysed from a local copy | 6 aggregates discovered / 5 declared |
| AdrianLopezGue/daruma-backend | bc610c0 | none |
| emadansari96/Booking-System | 1059141 | none |
| illyanaAvelar/mba-full-cycle-ddd-ticket-sale | 843effa | none |

### Edits to `init` suggestions

| Repository | Aggregate.field | `init` suggested | Declared | Why |
|---|---|---|---|---|
| kyhsa93 | AccountImplement | nothing | `deletedAt: 'set'`, `lockedAt: 'set'` | hand-written; the spike treats close and lock as end states |
| undb | InvitationDo.status | `[]` | `['accepted', 'rejected']` | the class never assigns status, so `init` saw no setters |
| ddd-forum | User.isDeleted | `[]` | `[true]` | deletion is the end of a user |
| daruma | `_isRemoved` on all 7 aggregates | `[]` | `[true]` | the `on*Created` appliers set `false` from any state, so the guess rejects `true` |
| ticket-sale | Order.status | `[]` | `[OrderStatus.PAID, OrderStatus.CANCELLED]` | paid and cancelled orders are finished |
| Private reference repo | n/a | n/a | terminal states were adjusted by hand | n/a |

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
| terminal-state-leak (lockedAt) | AccountImplement.close | false positive (tool limitation: allowAfterTerminal is per aggregate) | closing a locked account is a legitimate exit, but `allowAfterTerminal` cannot exempt it for `lockedAt` alone (open issue 2) |
| terminal-state-leak (deletedAt) | AccountImplement.lock | real | a closed account can be locked |
| terminal-state-leak (deletedAt) | AccountImplement.clearEvents | intended | `_events.length = 0` clears the outbox after persistence; belongs in `allowAfterTerminal` |
| terminal-state-leak (lockedAt) | AccountImplement.clearEvents | intended | same |

`lock()` is not reported for `lockedAt`, because `if (this.lockedAt) throwError(...)` is recognised as a guard.

## bitloops/ddd-hexagonal-cqrs-es-eda

The current CLI reports no findings for this repository. Every judged method uses a member that the library base class declares as a getter or method, such as `this.id` or `this.clearDomainEvents()`. Library code can call back into methods the project overrides, so such a member counts as reading the state field, and the methods' sources are unknown (open issue 5). The earlier run reported these findings:

| check | aggregate.method | verdict | reason |
|---|---|---|---|
| terminal-state-leak | TodoEntity.complete | real | spike finding; only `completed` is checked, never `deleted` |
| terminal-state-leak | TodoEntity.uncomplete | real | spike finding |
| terminal-state-leak | TodoEntity.modifyTitle | real | renaming a deleted todo is allowed |
| terminal-state-leak | TodoEntity.delete | real | deleting twice emits a second `TodoDeletedDomainEvent` |
| terminal-state-leak | TodoEntity.commit | intended | sets the stream version and clears events after persisting; must run after `delete` |

In the earlier run the spike finding survived the conservative rules. `complete()` uses a rule object (`Domain.applyRules([new Rules.TodoAlreadyCompleted(this.props.completed, ...)])`), and it passes field values, not `this`. That makes the `completed` field unknown for the method, but `deleted` is still known and unguarded. Nothing is reported for the `completed` field, which has no terminal value and no transitions.

## undb-io/undb (`packages/authz`)

| check | aggregate.method | verdict | reason |
|---|---|---|---|
| outside-mutation (status) | InvitationDo, in `WithStatus.mutate` | real | spike finding; the specification assigns `t.status` and bypasses the aggregate |
| outside-mutation (role) | InvitationDo, in `WithRole.mutate` | real | same pattern for `role`; `init` suggested `role` as a state field |

`accepted` and `rejected` are never assigned inside the class, but `unreachable-state` stays silent. Both values are mentioned in `new WithStatus("accepted")` and similar calls, and the outside assignment is unresolved.

## Sairyss/domain-driven-hexagon

There were no findings. `UserEntity.role` was the only suggested field. It has no terminal value or transitions to check against. `WalletEntity` has no state field.

## stemmlerjs/ddd-forum

There were no findings. After `User.isDeleted` was declared terminal at `true`, `setAccessToken` and `delete` could have been judged, but both pass `this` to an event constructor (`new UserLoggedIn(this)` and `new UserDeleted(this)`). The escape rule makes their sources unknown. `setAccessToken` after deletion is a real leak that this rule hides (open issue 4). The `type` fields on Post, PostVote and CommentVote are kinds, not lifecycles. They were declared with no terminal value.

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

There were no findings. Booking, Payment and Invoice keep their status in value objects (`BookingStatus.create(...)`, `status.canTransitionTo(...)`), which are not supported state types. The project also sets `strictNullChecks: false`, so its optional timestamps are not nullable state fields. Only the `isActive` booleans on four aggregates were suggested. They have no terminal value.

## illyanaAvelar/mba-full-cycle-ddd-ticket-sale

| check | aggregate.method | verdict | reason |
|---|---|---|---|
| terminal-state-leak | EventSpot.markAsReserved | intended | `EventSpot` is a child entity, matched by the default `Entity` base class; the owning `EventSection.markSpotAsReserved` throws on an already reserved spot |
| terminal-state-leak | EventSpot.changeLocation | intended | `init` guessed `is_reserved: [true]` as terminal; a reserved spot is not a finished spot |
| terminal-state-leak | EventSpot.publish | intended | same |
| terminal-state-leak | EventSpot.unPublish | intended | same |

`Order.pay()` and `Order.cancel()` are unguarded, and declared terminal at `PAID` and `CANCELLED`, but nothing is reported for them. Both read `this.status` in an event payload (`new OrderPaid(this.id, this.status)`). Any read of the field outside a recognised guard makes the method's sources unknown (open issue 1).

## Open issues

These were not fixed, because each needs a design change rather than a correction of an existing rule.

1. **Reading the state field after assigning it silences the method.**
   - **Module:** `src/analyzers/lifecycle/guards.ts`, in `methodSources` and its helper `readsFieldOutside` (the inversion rule).
   - **Current behaviour:** if a method reads field F anywhere outside its recognised guard conditions, the method's allowed sources become unknown. This covers reads inside an assignment's right-hand side. Unknown sources suppress `terminal-state-leak` and `transition-drift` for that method.
   - **Example:** ticket-sale `Order.pay()` is `this.status = OrderStatus.PAID; this.addEvent(new OrderPaid(this.id, this.status));`. The read in the event payload makes `pay` unknown, so a real leak goes unreported. `cancel()` has the same shape.
   - **Proposed change:** a read of F that comes after the method's first top-level statement assigning F cannot gate entry to the method. Exclude such reads from `readsFieldOutside`, as long as no `this` escape or local variable holding F occurs before that assignment. Reads before the assignment keep today's behaviour, because they may be local variables used as guards.
   - **Expected result:** ticket-sale with `status` declared terminal at `[PAID, CANCELLED]` would then report `error terminal-state-leak Order.pay() pay() can run after status is 'paid', 'cancelled'.`, and the same finding for `Order.cancel()`.
2. **`allowAfterTerminal` is per aggregate, not per field.** kyhsa93 `close()` should be allowed after `lockedAt` but not after `deletedAt`. Today the only options are to exempt it for both fields or for neither.
3. **Aggregates that implement an interface are not discovered.** kyhsa93's `AccountImplement implements Account` has no base class. `init` exits 2 with advice to set `aggregateBaseClasses`, which cannot help here. Declaring the class by hand works.
4. **`this` escapes hide real leaks.** ddd-forum `User.setAccessToken` passes `this` to an event constructor, so it is not judged even though it can run on a deleted user. This is the documented conservative rule. It is listed because event constructors taking the aggregate are common.
5. **Library getters and methods silence the methods that use them.** A getter or method declared only in a library, with no body in the project, counts as reading the state field unless it is one of the configured `eventMethods`. This is required for soundness: a library method such as `assertActive()` or a getter such as `stateName` can call an abstract hook that the project implements over the state field, so treating it as inert produces false leaks. Only library data properties whose type cannot hold the field are exempt. bitloops `TodoEntity` reads the library getter `this.id` and calls `this.clearDomainEvents()`, so its 5 earlier findings are gone. Recovering them needs knowledge of what a library member calls, for example a per-library allowlist of members known not to read aggregate state. A `.d.ts` file that declares a getter as a plain property is trusted as written, so such a member is treated as a data property.
6. **Aggregates that leak `this` silence methods that read object fields.** An aggregate leaks `this` when its project class family (its project base classes and project subclasses) lets `this` or `this.props` escape anywhere, or contains an arrow function that references `this` other than a direct callback of `filter`, `map`, `some`, `every`, `find`, `findIndex`, `forEach`, `reduce`, `flatMap` or `sort` called on a built-in array or tuple. Inside static members of the family, a local variable or parameter typed as the aggregate or a class in its family is treated like `this`: it leaks when it escapes or is captured by any closure, except in a plain `return v;`, which is how a factory hands back the instance it built. Two forms that only copy values are not leaks: `Object.assign(this, …)` or `Object.assign(this.props, …)` as a statement whose result is discarded, and a spread of `this` or `this.props` inside an object literal. In a leaking aggregate every project data field whose type is not primitive (string, number, boolean, bigint, symbol, literal, enum, or a built-in TypeScript library type such as `Date` whose type arguments are primitive and which has no index signature) counts as reading the state field. In an aggregate that does not leak, project data fields never count, whatever their type. The leak check sees `this` everywhere in the class family, and inside static members it tracks locals and parameters typed as the aggregate or a class in its family; it does not see every way to wire a back-reference. These shapes are not seen, and a guard through a field wired by them is read as no guard, which can produce a false leak: a factory or service outside the class, for example `agg.policy = new Policy(agg)` or `agg.canEdit = () => agg.isOpen()`; a static-member local typed through an interface the aggregate implements, typed `any`, typed as an intersection, or left untyped (`let o; o = new X()`); the instance held inside another object (`box.o.policy.owner = box.o`); wiring inside an instance-method factory such as `clone()`; and a module-level factory function. None of the validation repositories is affected today.

## Resolved during validation

- **Private event appliers were judged as entry points.** This caused the 27 false positives in daruma-backend. The leak and drift checks now judge only public methods. Fixed in 56c5953.
- **`init` collapsed classes with the same name.** When two suggested aggregate classes in different files shared a name, `init` imported only one of them. It now imports the later one under a distinct local name, for example `Order as Order2`, and does the same for same-named state enums. Fixed in 5692004.
- **Misleading `init` message.** When no discovered aggregate had a candidate field, `init` printed "All discovered aggregates are already declared." and wrote no config. It now says that no state fields were found. Fixed in 96ff2b7.
- **The package did not resolve under `moduleResolution: "node"`.** `package.json` now has top-level `main` and `types`. ddd-forum checks without a `paths` workaround. Fixed in 3f6a1ab.
