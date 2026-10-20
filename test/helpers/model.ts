import { DetailsByRule, Finding, FindingOf, LifecycleFinding } from '../../src/finding';
import {
  AggregateModel,
  AssignedValues,
  FieldBehaviour,
  FieldDeclaration,
  MethodModel,
  Sources,
  StateField,
  StateFieldKind,
  Visibility,
  WrittenAlongside,
} from '../../src/analyzers/lifecycle/model';
import { ToolIdentity } from '../../src/report/tool';

export const stateField = (name: string, kind: StateFieldKind, tokens: readonly string[]): StateField => ({
  name,
  kind,
  values: tokens.map((token) => ({ token, label: token.toLowerCase(), source: `'${token}'` })),
  enumReference: undefined,
  unsetForms: [],
  setMayBeFalsy: false,
});

export const STATUS = stateField('status', 'enum', ['PENDING', 'CONFIRMED', 'CANCELLED']);

export const known = (...values: string[]): Sources => ({ kind: 'known', values: new Set(values) });

export const unknownSources: Sources = { kind: 'unknown' };

export const assigned = (...tokens: string[]): AssignedValues => ({ tokens: new Set(tokens), unresolved: false, mayWrite: false });

export const unresolvedValue: AssignedValues = { tokens: new Set(), unresolved: true, mayWrite: false };

export const mayWriteValue: AssignedValues = { tokens: new Set(), unresolved: false, mayWrite: true };

export const method = (
  name: string,
  mutates: boolean,
  fields: Record<string, FieldBehaviour>,
  visibility: Visibility = 'public',
  writtenAlongside: WrittenAlongside = new Map(),
): MethodModel => ({
  name,
  file: '/app/src/order.ts',
  line: 10,
  visibility,
  mutates,
  fields: new Map(Object.entries(fields)),
  writtenAlongside,
});

export const alongside = (
  field: string,
  other: string,
  ...tokens: string[]
): WrittenAlongside => new Map([[field, new Map([[other, new Set(tokens)]])]]);

export const declared = (
  terminal: string[],
  transitions?: Record<string, string[]>,
  allowAfterTerminal: string[] = [],
): FieldDeclaration => ({
  terminal: new Set(terminal),
  allowAfterTerminal: new Set(allowAfterTerminal),
  transitions:
    transitions && new Map(Object.entries(transitions).map(([name, sources]) => [name, new Set(sources)])),
});

export const aggregate = (overrides: Partial<AggregateModel>): AggregateModel => ({
  id: 'Order',
  name: 'Order',
  qualifiedName: 'src/order.ts:Order',
  file: '/app/src/order.ts',
  line: 3,
  declared: true,
  fields: [STATUS],
  declarations: new Map([['status', declared(['CANCELLED'])]]),
  allowAfterTerminal: new Set(),
  methods: [],
  initial: new Map([['status', assigned('PENDING')]]),
  outside: [],
  mentioned: new Map(),
  uncertainlyWritten: new Set(),
  ...overrides,
});

export const DECLARED_ORDER = aggregate({
  fields: [STATUS],
  declarations: new Map([['status', declared(['CANCELLED'], { confirm: ['PENDING'], cancel: ['PENDING'] })]]),
  initial: new Map([['status', assigned('PENDING')]]),
  methods: [
    method('confirm', true, { status: { sources: known('PENDING'), sets: assigned('CONFIRMED') } }),
    method('cancel', true, { status: { sources: known('PENDING', 'CONFIRMED', 'CANCELLED'), sets: assigned('CANCELLED') } }),
  ],
});

export const finding = (overrides: Partial<FindingOf<'terminal-state-leak'>> = {}): FindingOf<'terminal-state-leak'> => ({
  ruleId: 'terminal-state-leak',
  severity: 'error',
  analyzer: 'lifecycle',
  file: '/app/src/order.ts',
  line: 10,
  message: 'M1',
  fix: 'F1',
  details: { aggregate: 'Order', aggregateId: 'Order', method: 'annotate', field: 'status', values: ['CANCELLED'] },
  ...overrides,
});

export const flowFinding = (overrides: Partial<FindingOf<'dead-handler'>> = {}): FindingOf<'dead-handler'> => ({
  ruleId: 'dead-handler',
  severity: 'error',
  analyzer: 'event-flow',
  file: '/app/src/handlers.ts',
  line: 4,
  message: 'M3',
  fix: 'F3',
  details: { event: 'RefundIssued', eventId: 'RefundIssued', handler: 'RefundHandler.handle' },
  ...overrides,
});

export const bufferFinding = (overrides: Partial<FindingOf<'undispatched-events'>> = {}): FindingOf<'undispatched-events'> => ({
  ruleId: 'undispatched-events',
  severity: 'error',
  analyzer: 'event-flow',
  file: '/app/src/aggregate-root.ts',
  line: 3,
  message: 'M4',
  fix: 'F4',
  details: { owner: 'AggregateRoot', ownerId: 'AggregateRoot', buffer: '_domainEvents', method: 'addDomainEvent', raisers: ['Booking', 'Payment'] },
  ...overrides,
});

export const leakWith = (details: Partial<DetailsByRule['terminal-state-leak']>, overrides: Partial<FindingOf<'terminal-state-leak'>> = {}): FindingOf<'terminal-state-leak'> =>
  finding({ ...overrides, details: { ...finding().details, ...details } });

export const unreachableFinding = (): FindingOf<'unreachable-state'> => ({
  ruleId: 'unreachable-state',
  severity: 'error',
  analyzer: 'lifecycle',
  file: '/app/src/order.ts',
  line: 3,
  message: 'M2',
  fix: 'F2',
  details: { aggregate: 'Order', aggregateId: 'Order', field: 'status', value: 'CANCELLED' },
});

export const missingFinding = (): FindingOf<'transition-missing'> => ({
  ruleId: 'transition-missing',
  severity: 'warning',
  analyzer: 'lifecycle',
  file: '/app/src/order.ts',
  line: 10,
  message: 'M1',
  fix: 'F1',
  details: { aggregate: 'Order', aggregateId: 'Order', method: 'annotate', field: 'status', values: ['PAID'] },
});

export const unhandledFinding = (): FindingOf<'unhandled-event'> => ({
  ruleId: 'unhandled-event',
  severity: 'error',
  analyzer: 'event-flow',
  file: '/app/src/handlers.ts',
  line: 4,
  message: 'M3',
  fix: 'F3',
  details: { event: 'RefundIssued', eventId: 'RefundIssued' },
});

export const mismatchFinding = (): FindingOf<'handler-payload-mismatch'> => ({
  ruleId: 'handler-payload-mismatch',
  severity: 'error',
  analyzer: 'event-flow',
  file: '/app/src/handlers.ts',
  line: 4,
  message: 'M3',
  fix: 'F3',
  details: { event: 'RefundIssued', eventId: 'RefundIssued', handler: 'RefundHandler.handle', declared: ['PaymentCaptured'], declaredIds: ['PaymentCaptured'] },
});

export const lifecycleFindings = (findings: readonly Finding[]): LifecycleFinding[] =>
  findings.filter((candidate): candidate is LifecycleFinding => candidate.analyzer === 'lifecycle');

export const methodOf = (finding: LifecycleFinding): string | undefined => ('method' in finding.details ? finding.details.method : undefined);

export const TOOL: ToolIdentity = { name: 'domain-integrity', version: '1.2.3', informationUri: 'https://example.test' };
