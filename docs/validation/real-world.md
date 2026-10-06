# Real-world validation

The v0.1 CLI was run against nine public TypeScript DDD repositories and one private reference repository. Each finding was triaged by reading the code. The tables below reflect the v0.1.1 CLI (09ab249), after the fixes listed under [Resolved during validation](#resolved-during-validation).

The v0.1.1 re-run used the same commits and configs as the v0.1 run. It reports 37 findings, 3 more than v0.1: ticket-sale `Order.pay` and `Order.cancel`, and bitloops `TodoEntity.delete`. All three come from ignoring reads after the method's first assignment of the field. Every other finding is unchanged, and none was lost. The build before the change that tracks `new` instances of the class family and instance-method factories reports the same 37, so that change silences nothing here.

The `inertMembers` re-run used the same commits and configs, except that bitloops lists `inertMembers: ['id', 'clearDomainEvents']`. With every other config unchanged, the findings are identical. bitloops gains 4 findings, `TodoEntity.complete`, `uncomplete`, `modifyTitle` and `commit`, for 41 in total.

The event-constructor re-run used the same commits and configs as the `inertMembers` re-run. The findings are identical in every repository. ddd-forum is the only repository that passes `this` to an event constructor. Its `User.setAccessToken` stays unjudged because its own `addDomainEvent` passes `this` to `DomainEvents.markAggregateForDispatch` (open issue 1).

The push-only event method re-run used the same commits and configs as the event-constructor re-run. main (8ac6389) and the branch both report 41 findings, and every repository's findings and exit codes are identical. Booking-System, domain-driven-hexagon and typescript-ddd-example have push-only project event methods, but none of their declared aggregates was left unjudged by them: the suggested fields in Booking-System and domain-driven-hexagon have no terminal value, and typescript-ddd-example has no state fields. The private reference repo's event method checks for a duplicate with `.some(…)` before pushing, undb reassigns its `#domainEvents` from `filter` and through a setter, ticket-sale stores events in a `Set`, and ddd-forum registers `this` in a static registry. None of these qualifies. Out-of-repo probes of the issue's shape and of Booking-, hexagon- and codely-shaped event methods in leaking aggregates report the expected leaks. The ddd-forum-, private-reference-repo-, undb- and ticket-sale-shaped negatives, `Object.assign(this, props)`, and an event held in a variable stay silent.

The per-field `allowAfterTerminal` re-run used the same commits and configs as the push-only event method re-run. main (53e7c36) and the branch both report 41 findings, and every repository's findings and exit codes are identical. It was then repeated with the kyhsa93 config changed to `lockedAt: { terminal: 'set', allowAfterTerminal: ['close'] }`; the recorded config had no aggregate-level exemption to drop. kyhsa93 reports 12 findings instead of 13: `close` after `lockedAt` is gone, and `close` after `deletedAt` is still reported, as are the other 11. With that config the total is 40, with no false positive left. An unknown method name in the field-level list is a type error and exits 2. Out-of-repo probes of an account with two nullable terminal fields report each field-level exemption only for its own field, and the aggregate-level list together with a field list as their union.

The mixin event method re-run used the same commits and configs as the push-only event method re-run. main (53e7c36) and the branch both report 41 findings, and every repository's findings and exit codes are identical. Booking-System, ddd-forum, domain-driven-hexagon, ticket-sale, undb and the private reference repo declare their event methods with a body on a project base class that the aggregate extends by name, so those bodies were already traced. No repository adds an event method through a mixin. Out-of-repo probes show the issue's mixin shape no longer reports `Todo.rename`, while a leaking `rename` behind an event method declared only in a `.d.ts`, behind an unresolved base class, or behind a push-only project base-class method is still reported. The library-only rule now counts a `super.` call's declarations from above the class that makes it, for both `eventMethods` and `inertMembers`. Rebuilt with that change, the branch still reports the same 41 findings and exit codes in every repository; no repository overrides an event method or an `inertMembers` entry and calls the library version through `super`. Out-of-repo probes: an override `addEvent(e) { super.addEvent(e); }` over a `.d.ts`-only declaration still lets a leaking caller be reported, as on main. An override `clearDomainEvents() { super.clearDomainEvents(); }` with `clearDomainEvents` listed in `inertMembers` now lets a leaking caller be reported where main stayed silent; unlisted, it stays silent.

## Summary

- **Repositories run:** 10: nine public repositories plus the private reference repo, which is counted among the 10. Of those, 9 produced a model and 1 (CodelyTV/typescript-ddd-example) has no state fields, so there was nothing to declare. There were also 2 thin repositories (mguay22/nestjs-ddd, mbrookson/nestjs-ddd). They were cloned, but their aggregates have no state fields and they were dropped.
- **Aggregates:** 47 discovered with the default base classes and 28 declared. The 28th, kyhsa93 `AccountImplement`, implements an interface instead of extending a base class. It was declared by hand in the v0.1 run; with `'Account'` added to `aggregateBaseClasses` it is discovered, which makes 48.
- **Findings:** 41 in total:
  - 33 real;
  - 7 intended;
  - 1 false positive.

  The first run produced 66 findings. 27 of them were false positives from one pattern, private event-sourcing appliers. The leak and drift checks now judge only public methods, which removes all 27. The one remaining false positive, kyhsa93 `close` after `lockedAt`, goes away when `close` is listed in `allowAfterTerminal` inside the `lockedAt` field, which leaves 40 findings. All 5 earlier bitloops findings are reported again once its library members are listed in `inertMembers`.
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
- `init --yes` was run, then `check --format json`.

Per-repository setup:

| Repository | Commit | Setup beyond the default |
|---|---|---|
| kyhsa93/nestjs-rest-cqrs-example | 03408fe | `AccountImplement implements Account` and extends nothing, so `init` with the default base classes finds nothing. With `aggregateBaseClasses: ['AggregateRoot', 'Entity', 'Account']`, `init --yes` declares it with the same terminal states as the hand-written v0.1 config, and `check` reports the same 13 findings. |
| bitloops/ddd-hexagonal-cqrs-es-eda (`backend/`) | daa3f22 | Ran `npm install --ignore-scripts ddd-tactical-core-boilerplate@^2` in a side directory and symlinked it, so `Domain.Aggregate` resolves. `domain.config.ts` lists `inertMembers: ['id', 'clearDomainEvents']`; the library implements `id` as a getter over a private field and `clearDomainEvents()` as a splice of a private array, so neither reads aggregate state. |
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
| kyhsa93 | AccountImplement | `deletedAt: ['set']`, `lockedAt: ['set']`, once `'Account'` is in `aggregateBaseClasses` | `deletedAt: 'set'`, `lockedAt: 'set'` | hand-written in the v0.1 run; the spike treats close and lock as end states, and the suggestion now matches |
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
| terminal-state-leak (lockedAt) | AccountImplement.close | false positive (resolved by configuration) | closing a locked account is a legitimate exit; `lockedAt: { terminal: 'set', allowAfterTerminal: ['close'] }` exempts it for `lockedAt` alone, and `close` after `deletedAt` is still reported |
| terminal-state-leak (deletedAt) | AccountImplement.lock | real | a closed account can be locked |
| terminal-state-leak (deletedAt) | AccountImplement.clearEvents | intended | `_events.length = 0` clears the outbox after persistence; belongs in `allowAfterTerminal` |
| terminal-state-leak (lockedAt) | AccountImplement.clearEvents | intended | same |

`lock()` is not reported for `lockedAt`, because `if (this.lockedAt) throwError(...)` is recognised as a guard.

## bitloops/ddd-hexagonal-cqrs-es-eda

| check | aggregate.method | verdict | reason |
|---|---|---|---|
| terminal-state-leak | TodoEntity.delete | real | deleting twice emits a second `TodoDeletedDomainEvent` |
| terminal-state-leak | TodoEntity.complete | real | spike finding; only `completed` is checked, never `deleted` |
| terminal-state-leak | TodoEntity.uncomplete | real | spike finding |
| terminal-state-leak | TodoEntity.modifyTitle | real | renaming a deleted todo is allowed |
| terminal-state-leak | TodoEntity.commit | intended | sets the stream version and clears events after persisting; must run after `delete` |

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

## stemmlerjs/ddd-forum

There were no findings. After `User.isDeleted` was declared terminal at `true`, `setAccessToken` and `delete` could have been judged, but both call the project-declared `addDomainEvent`. It passes `this` to the static `DomainEvents` registry, which keeps their sources unknown. Handing `this` to a plain event constructor (`new UserLoggedIn(this)` and `new UserDeleted(this)`) is no longer the obstacle. A project event method that only pushes its parameters onto private arrays that are only ever `[]` is now trusted, but ddd-forum's `addDomainEvent` also registers `this` in `DomainEvents` and logs through `Reflect.getPrototypeOf(this)`. `setAccessToken` and `delete` therefore stay unjudged, and `setAccessToken` after deletion is a real leak that this hides (open issue 1). The `type` fields on Post, PostVote and CommentVote are kinds, not lifecycles. They were declared with no terminal value.

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
| terminal-state-leak | Order.pay | real | no guard; a cancelled order can be paid, and paying twice emits a second `OrderPaid` |
| terminal-state-leak | Order.cancel | real | no guard; a paid order can be cancelled |

`Order.pay()` is `this.status = OrderStatus.PAID; this.addEvent(new OrderPaid(this.id, this.status));`, and `cancel()` has the same shape. The v0.1 CLI reported nothing for them, because the read of `this.status` in the event payload made their sources unknown. That read comes after the method's first assignment of `status`, so it is now ignored.

## Open issues

These were not fixed, because each needs a design change rather than a correction of an existing rule.

1. **Project-declared event methods that register `this` hide real leaks.** Project event methods that only push their parameters onto private arrays that are only ever `[]` are now trusted ([issue #31](https://github.com/mannkostir/domain-integrity/issues/31)), and `this` handed to a transparent event constructor or straight to a library event method is judged. ddd-forum `User.setAccessToken` is still not judged, because its project `addDomainEvent` also passes `this` to the static `DomainEvents.markAggregateForDispatch` registry. A build that also trusted that method reported the leak. The remaining static registry shape is tracked in [issue #33](https://github.com/mannkostir/domain-integrity/issues/33).
2. **Aggregates that leak `this` silence methods that read object fields.** An aggregate leaks `this` when its project class family (its project base classes and project subclasses) lets `this` or `this.props` escape anywhere, or contains an arrow function that references `this` other than a direct callback of `filter`, `map`, `some`, `every`, `find`, `findIndex`, `forEach`, `reduce`, `flatMap` or `sort` called on a built-in array or tuple. Factory members are static members and any member that calls `new` on a class in the family, such as `clone()`, including constructors, property initializers and accessors. Inside a factory member, a variable or parameter is treated like `this` when it is typed as the aggregate, initialized with `new` on a class in the family, or assigned one with `=`, `??=`, `||=` or `&&=`, whatever its declared type. It leaks when it escapes or is captured by any function other than a direct array callback, except in a bare `return v;`, which is how a factory hands back the instance it built; `return Result.ok(v)` is an escape. Two forms that only copy values are not leaks: `Object.assign(this, …)` or `Object.assign(this.props, …)` as a statement whose result is discarded, and a spread of `this` or `this.props` inside an object literal. In a leaking aggregate every project data field whose type is not primitive (string, number, boolean, bigint, symbol, literal, enum, or a built-in TypeScript library type such as `Date` whose type arguments are primitive and which has no index signature) counts as reading the state field. In an aggregate that does not leak, project data fields never count, whatever their type. The leak check does not see every way to wire a back-reference. These shapes are not seen, and a guard through a field wired by them is read as no guard, which can produce a false leak: a factory or service outside the class, for example `agg.policy = new Policy(agg)` or `agg.canEdit = () => agg.isOpen()`; the instance held inside another object (`box.o.policy.owner = box.o`); and a module-level factory function. None of the validation repositories is affected by the unseen shapes today.

## Resolved during validation

- **`allowAfterTerminal` was per aggregate, not per field.** kyhsa93 `close()` should be allowed after `lockedAt` but not after `deletedAt`, and the only options were to exempt it for both fields or for neither. A state field now takes its own `allowAfterTerminal`, which combines with the aggregate-level list, so `close` can be exempted for `lockedAt` alone. Fixed in #38.
- **Private event appliers were judged as entry points.** This caused the 27 false positives in daruma-backend. The leak and drift checks now judge only public methods. Fixed in 56c5953.
- **`init` collapsed classes with the same name.** When two suggested aggregate classes in different files shared a name, `init` imported only one of them. It now imports the later one under a distinct local name, for example `Order as Order2`, and does the same for same-named state enums. Fixed in 5692004.
- **Misleading `init` message.** When no discovered aggregate had a candidate field, `init` printed "All discovered aggregates are already declared." and wrote no config. It now says that no state fields were found. Fixed in 96ff2b7.
- **The package did not resolve under `moduleResolution: "node"`.** `package.json` now has top-level `main` and `types`. ddd-forum checks without a `paths` workaround. Fixed in 3f6a1ab.
- **Reading the state field after assigning it silenced the method.** A read of the field anywhere outside a recognised guard made the method's sources unknown, including a read in an event payload right after the assignment. Reads after the method's first top-level plain assignment of the field are now ignored, because they cannot gate entry to the method; reads before it, including the assignment's right-hand side, still count. ticket-sale `Order.pay` and `Order.cancel` and bitloops `TodoEntity.delete` are now reported. Fixed in 6387552.
- **Aggregates that implement an interface were not discovered.** kyhsa93's `AccountImplement implements Account` has no base class, and `aggregateBaseClasses` matched only base classes. It now also matches interfaces a class implements, directly or through its base classes and the interfaces they extend. With `'Account'` in `aggregateBaseClasses`, `init` discovers and declares `AccountImplement`. Fixed in bdbf805.
- **`this`-leak tracking missed instances built with `new` and instance-method factories.** Inside static members only locals typed as the aggregate were tracked, and members such as `clone()` were not checked. Factory members now include any member that calls `new` on a class in the family, and a variable initialized or assigned with such a `new` is tracked whatever its declared type. This only adds silence; no validation finding changed. Fixed in 231babf.
- **Library getters and methods silenced the methods that use them.** A getter or method declared only in a library, with no body in the project, counts as reading the state field unless it is one of the configured `eventMethods`. This is required for soundness: a library method such as `assertActive()` or a getter such as `stateName` can call an abstract hook that the project implements over the state field, so treating it as inert produces false leaks. Only library data properties whose type cannot hold the field are exempt, and reads after the method's first assignment of the field are ignored. bitloops `TodoEntity` reads the library getter `this.id` and calls `this.clearDomainEvents()`, so without configuration 4 of its 5 earlier findings stay silent and only `delete()`, which reads `this.id` after assigning `deleted`, is reported. Resolved by configuration: a project lists library members known not to read aggregate state in `inertMembers`, and with `inertMembers: ['id', 'clearDomainEvents']` bitloops reports all 5 again. A member the project declares, such as an override, is still traced. A `.d.ts` file that declares a getter as a plain property is trusted as written, so such a member is treated as a data property.
