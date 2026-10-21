import { toPosixRelative } from '../engine/path';
import { Finding, FindingOf, RuleId } from '../finding';

export type IdentityValue = string | null | readonly string[];

export type IdentityFieldKind = 'string' | 'nullable' | 'strings';

export type IdentityByRule = {
  readonly 'terminal-state-leak': { readonly aggregate: string; readonly method: string; readonly field: string; readonly values: readonly string[] };
  readonly 'unreachable-state': { readonly aggregate: string; readonly field: string; readonly value: string };
  readonly 'outside-mutation': { readonly aggregate: string; readonly field: string; readonly file: string; readonly scope: string };
  readonly 'transition-drift': { readonly aggregate: string; readonly method: string; readonly field: string; readonly kind: string };
  readonly 'transition-missing': { readonly aggregate: string; readonly method: string; readonly field: string };
  readonly 'dead-handler': { readonly event: string; readonly handlerClass: string | null; readonly handlerMethod: string | null };
  readonly 'handler-payload-mismatch': {
    readonly event: string;
    readonly handlerClass: string | null;
    readonly handlerMethod: string | null;
    readonly declared: readonly string[];
  };
  readonly 'unhandled-event': { readonly event: string };
  readonly 'saga-missing-failure-path': { readonly saga: string; readonly success: string; readonly failure: string };
  readonly 'undispatched-events': { readonly owner: string; readonly buffer: string };
};

export type IdentityOf<R extends RuleId> = { readonly rule: R } & IdentityByRule[R];

export type Identity = { readonly [R in RuleId]: IdentityOf<R> }[RuleId];

export const IDENTITY_FIELD_KINDS = {
  'terminal-state-leak': { aggregate: 'string', method: 'string', field: 'string', values: 'strings' },
  'unreachable-state': { aggregate: 'string', field: 'string', value: 'string' },
  'outside-mutation': { aggregate: 'string', field: 'string', file: 'string', scope: 'string' },
  'transition-drift': { aggregate: 'string', method: 'string', field: 'string', kind: 'string' },
  'transition-missing': { aggregate: 'string', method: 'string', field: 'string' },
  'dead-handler': { event: 'string', handlerClass: 'nullable', handlerMethod: 'nullable' },
  'handler-payload-mismatch': { event: 'string', handlerClass: 'nullable', handlerMethod: 'nullable', declared: 'strings' },
  'unhandled-event': { event: 'string' },
  'saga-missing-failure-path': { saga: 'string', success: 'string', failure: 'string' },
  'undispatched-events': { owner: 'string', buffer: 'string' },
} as const satisfies { readonly [R in RuleId]: { readonly [F in keyof IdentityByRule[R]]: IdentityFieldKind } };

type FieldsOf<R extends RuleId> = readonly (keyof IdentityByRule[R] & string)[];

export const IDENTITY_FIELDS: { readonly [R in RuleId]: FieldsOf<R> } = {
  'terminal-state-leak': ['aggregate', 'method', 'field', 'values'],
  'unreachable-state': ['aggregate', 'field', 'value'],
  'outside-mutation': ['aggregate', 'field', 'file', 'scope'],
  'transition-drift': ['aggregate', 'method', 'field', 'kind'],
  'transition-missing': ['aggregate', 'method', 'field'],
  'dead-handler': ['event', 'handlerClass', 'handlerMethod'],
  'handler-payload-mismatch': ['event', 'handlerClass', 'handlerMethod', 'declared'],
  'unhandled-event': ['event'],
  'saga-missing-failure-path': ['saga', 'success', 'failure'],
  'undispatched-events': ['owner', 'buffer'],
};

const sorted = (values: readonly string[]): readonly string[] => [...values].sort();

const IDENTITIES: { readonly [R in RuleId]: (finding: FindingOf<R>, root: string) => IdentityOf<R> } = {
  'terminal-state-leak': ({ ruleId, details: d }) => ({ rule: ruleId, aggregate: d.aggregateId, method: d.method, field: d.field, values: sorted(d.values) }),
  'unreachable-state': ({ ruleId, details: d }) => ({ rule: ruleId, aggregate: d.aggregateId, field: d.field, value: d.value }),
  'outside-mutation': ({ ruleId, file, details: d }, root) => ({ rule: ruleId, aggregate: d.aggregateId, field: d.field, file: toPosixRelative(root, file), scope: d.scope }),
  'transition-drift': ({ ruleId, details: d }) => ({ rule: ruleId, aggregate: d.aggregateId, method: d.method, field: d.field, kind: d.kind }),
  'transition-missing': ({ ruleId, details: d }) => ({ rule: ruleId, aggregate: d.aggregateId, method: d.method, field: d.field }),
  'dead-handler': ({ ruleId, details: d }) => ({ rule: ruleId, event: d.eventId, handlerClass: d.handlerClassId, handlerMethod: d.handlerMethod }),
  'handler-payload-mismatch': ({ ruleId, details: d }) => ({
    rule: ruleId,
    event: d.eventId,
    handlerClass: d.handlerClassId,
    handlerMethod: d.handlerMethod,
    declared: sorted(d.declaredIds),
  }),
  'unhandled-event': ({ ruleId, details: d }) => ({ rule: ruleId, event: d.eventId }),
  'saga-missing-failure-path': ({ ruleId, details: d }) => ({ rule: ruleId, saga: d.sagaId, success: d.successId, failure: d.failureId }),
  'undispatched-events': ({ ruleId, details: d }) => ({ rule: ruleId, owner: d.ownerId, buffer: d.buffer }),
};

const identityOfRule = <R extends RuleId>(finding: FindingOf<R>, root: string): IdentityOf<R> => IDENTITIES[finding.ruleId](finding, root);

export const identityOf = (finding: Finding, repositoryRoot: string): Identity => identityOfRule(finding, repositoryRoot) as Identity;

const valuesOfRule = <R extends RuleId>(identity: IdentityOf<R>): readonly IdentityValue[] =>
  IDENTITY_FIELDS[identity.rule].map((field) => identity[field] as IdentityValue);

export const identityValues = (identity: Identity): readonly IdentityValue[] => valuesOfRule(identity);

export const serializeIdentity = (identity: Identity): string => JSON.stringify([identity.rule, ...identityValues(identity)]);

const rendered = (value: IdentityValue): string => {
  if (value === null) return '-';
  return typeof value === 'string' ? value : value.join(',');
};

const namedValues = (identity: Identity): readonly (readonly [string, IdentityValue])[] =>
  IDENTITY_FIELDS[identity.rule].map((field, index): readonly [string, IdentityValue] => [field, identityValues(identity)[index] ?? null]);

export const describeIdentity = (identity: Identity): string =>
  [identity.rule, ...namedValues(identity).map(([field, value]) => `${field}=${rendered(value)}`)].join(' ');
