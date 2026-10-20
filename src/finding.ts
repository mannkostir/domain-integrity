export type Severity = 'error' | 'warning';

export type AnalyzerId = 'lifecycle' | 'event-flow';

type AggregateTarget = { readonly aggregate: string; readonly aggregateId: string };

type MethodTarget = AggregateTarget & { readonly method: string; readonly field: string };

export type DetailsByRule = {
  readonly 'terminal-state-leak': MethodTarget & { readonly values: readonly string[] };
  readonly 'unreachable-state': AggregateTarget & { readonly field: string; readonly value: string };
  readonly 'outside-mutation': AggregateTarget & { readonly field: string; readonly scope: string };
  readonly 'transition-drift': MethodTarget & { readonly kind: 'extra' | 'undeclared'; readonly values: readonly string[] };
  readonly 'transition-missing': MethodTarget & { readonly values: readonly string[] };
  readonly 'dead-handler': { readonly event: string; readonly eventId: string; readonly handler: string | null };
  readonly 'handler-payload-mismatch': {
    readonly event: string;
    readonly eventId: string;
    readonly handler: string | null;
    readonly declared: readonly string[];
    readonly declaredIds: readonly string[];
  };
  readonly 'unhandled-event': { readonly event: string; readonly eventId: string };
  readonly 'saga-missing-failure-path': {
    readonly saga: string;
    readonly sagaId: string;
    readonly success: string;
    readonly successId: string;
    readonly failure: string;
    readonly failureId: string;
  };
  readonly 'undispatched-events': {
    readonly owner: string;
    readonly ownerId: string;
    readonly buffer: string;
    readonly method: string;
    readonly raisers: readonly string[];
  };
};

export type RuleId = keyof DetailsByRule;

export const RULE_ANALYZERS = {
  'terminal-state-leak': 'lifecycle',
  'unreachable-state': 'lifecycle',
  'outside-mutation': 'lifecycle',
  'transition-drift': 'lifecycle',
  'transition-missing': 'lifecycle',
  'dead-handler': 'event-flow',
  'handler-payload-mismatch': 'event-flow',
  'unhandled-event': 'event-flow',
  'saga-missing-failure-path': 'event-flow',
  'undispatched-events': 'event-flow',
} as const satisfies { readonly [R in RuleId]: AnalyzerId };

export type FindingOf<R extends RuleId> = {
  readonly ruleId: R;
  readonly severity: Severity;
  readonly analyzer: (typeof RULE_ANALYZERS)[R];
  readonly file: string;
  readonly line: number;
  readonly message: string;
  readonly fix: string;
  readonly details: DetailsByRule[R];
};

export type Finding = { readonly [R in RuleId]: FindingOf<R> }[RuleId];

export type LifecycleFinding = Extract<Finding, { readonly analyzer: 'lifecycle' }>;

export type EventFlowFinding = Extract<Finding, { readonly analyzer: 'event-flow' }>;
