import { SourceFile } from 'ts-morph';
import { DomainDeclaration } from './engine/declaration';

export type AnalysisInput = {
  readonly declaration: DomainDeclaration;
  readonly files: readonly SourceFile[];
  readonly root: string;
  readonly configFile?: SourceFile;
};

export type Severity = 'error' | 'warning';

type FindingCore = {
  readonly checkId: string;
  readonly severity: Severity;
  readonly subject: string;
  readonly file: string;
  readonly line: number;
  readonly message: string;
  readonly fix: string;
};

export type LifecycleFinding = FindingCore & {
  readonly analyzer: 'lifecycle';
  readonly aggregate: string;
  readonly aggregateId: string;
  readonly method: string | undefined;
  readonly field: string;
};

export type HandlerCheckId = 'dead-handler' | 'handler-payload-mismatch' | 'unhandled-event' | 'saga-missing-failure-path';

export type HandlerFinding = FindingCore & {
  readonly analyzer: 'event-flow';
  readonly checkId: HandlerCheckId;
  readonly event: string;
  readonly eventId: string;
  readonly handler: string | undefined;
};

export type EventBufferFinding = FindingCore & {
  readonly analyzer: 'event-flow';
  readonly checkId: 'undispatched-events';
  readonly owner: string;
  readonly ownerId: string;
  readonly buffer: string;
  readonly method: string;
  readonly raisers: readonly string[];
};

export type EventFlowFinding = HandlerFinding | EventBufferFinding;

export type Finding = LifecycleFinding | EventFlowFinding;

const eventFlowKey = (finding: EventFlowFinding): string =>
  finding.checkId === 'undispatched-events'
    ? [finding.checkId, finding.ownerId, finding.buffer, finding.subject].join('|')
    : [finding.checkId, finding.eventId, finding.handler ?? '', finding.subject].join('|');

export const findingKey = (finding: Finding): string =>
  finding.analyzer === 'lifecycle'
    ? [finding.checkId, finding.aggregateId, finding.method ?? '', finding.field, finding.subject].join('|')
    : eventFlowKey(finding);

export type AmbiguousReference = { readonly kind: 'ambiguous'; readonly reference: string; readonly candidates: readonly string[] };

export type AnalyzerDiagram = { readonly kind: 'diagram'; readonly text: string } | AmbiguousReference;

export type AnalyzerFailure = { readonly kind: 'failed'; readonly analyzer: string; readonly error: unknown };

export type DiagramOutcome = AnalyzerDiagram | AnalyzerFailure;

export type SummaryOutcome = { readonly kind: 'summary'; readonly text: string } | AnalyzerFailure;

export type RuleDescription = { readonly id: string; readonly description: string };

export type Analyzer<Model, Suggestion, Produced extends Finding = Finding> = {
  readonly id: string;
  readonly rules: readonly RuleDescription[];
  readonly extract: (input: AnalysisInput) => Model;
  readonly problems: (model: Model) => readonly string[];
  readonly suggest: (model: Model) => readonly Suggestion[];
  readonly check: (model: Model) => readonly Produced[];
  readonly diagram: (model: Model, only: string | undefined) => AnalyzerDiagram;
  readonly summarize: (model: Model, root: string) => string;
  readonly isEmpty: (model: Model) => boolean;
};

export type AnalysisResult = {
  readonly rules: readonly RuleDescription[];
  readonly problems: readonly string[];
  readonly findings: readonly Finding[];
  readonly failures: readonly AnalyzerFailure[];
  readonly diagram: (only: string | undefined) => DiagramOutcome;
  readonly summary: (root: string) => SummaryOutcome;
  readonly isEmpty: boolean;
};

const guarded = <T>(analyzer: string, compute: () => T): T | AnalyzerFailure => {
  try {
    return compute();
  } catch (error) {
    return { kind: 'failed', analyzer, error };
  }
};

const failedResult = (rules: readonly RuleDescription[], failure: AnalyzerFailure): AnalysisResult => ({
  rules,
  problems: [],
  findings: [],
  failures: [failure],
  diagram: () => failure,
  summary: () => failure,
  isEmpty: false,
});

type Evaluation<Model> = {
  readonly model: Model;
  readonly problems: readonly string[];
  readonly findings: readonly Finding[];
  readonly isEmpty: boolean;
};

const isFailure = <Model>(value: Evaluation<Model> | AnalyzerFailure): value is AnalyzerFailure => 'kind' in value;

export const analyse = <Model, Suggestion>(
  analyzer: Analyzer<Model, Suggestion>,
  input: AnalysisInput,
): AnalysisResult => {
  const guard = <T>(compute: () => T): T | AnalyzerFailure => guarded(analyzer.id, compute);
  const evaluated = guard((): Evaluation<Model> => {
    const model = analyzer.extract(input);
    return { model, problems: analyzer.problems(model), findings: analyzer.check(model), isEmpty: analyzer.isEmpty(model) };
  });
  if (isFailure(evaluated)) return failedResult(analyzer.rules, evaluated);
  const { model, problems, findings, isEmpty } = evaluated;
  return {
    rules: analyzer.rules,
    problems,
    findings,
    failures: [],
    diagram: (only) => guard(() => analyzer.diagram(model, only)),
    summary: (root) => guard(() => ({ kind: 'summary', text: analyzer.summarize(model, root) })),
    isEmpty,
  };
};
