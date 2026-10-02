import { Finding } from '../../src/analyzer';
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

export const assigned = (...tokens: string[]): AssignedValues => ({ tokens: new Set(tokens), unresolved: false, mayWrite: false });

export const unresolvedValue: AssignedValues = { tokens: new Set(), unresolved: true, mayWrite: false };

export const mayWriteValue: AssignedValues = { tokens: new Set(), unresolved: false, mayWrite: true };

export const method = (
  name: string,
  mutates: boolean,
  fields: Record<string, FieldBehaviour>,
  visibility: Visibility = 'public',
): MethodModel => ({
  name,
  file: '/app/src/order.ts',
  line: 10,
  visibility,
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
  mentioned: new Map(),
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
