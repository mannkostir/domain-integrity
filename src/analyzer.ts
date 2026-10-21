import { SourceFile } from 'ts-morph';
import { DomainDeclaration } from './engine/declaration';
import { DomainIntegrityError } from './engine/errors';
import { Finding, Problem, Severity } from './finding';

export type AnalysisInput = {
  readonly declaration: DomainDeclaration;
  readonly files: readonly SourceFile[];
  readonly projectRoot: string;
  readonly repositoryRoot: string;
  readonly configFile?: SourceFile;
};

export type AmbiguousReference = { readonly kind: 'ambiguous'; readonly reference: string; readonly candidates: readonly string[] };

export type AnalyzerDiagram = { readonly kind: 'diagram'; readonly text: string } | AmbiguousReference;

export type AnalyzerFailure = { readonly kind: 'failed'; readonly analyzer: string; readonly error: unknown };

export type DiagramOutcome = AnalyzerDiagram | AnalyzerFailure;

export type SummaryOutcome = { readonly kind: 'summary'; readonly text: string } | AnalyzerFailure;

export type RuleDescription<Id extends string = string> = {
  readonly id: Id;
  readonly severity: Severity;
  readonly description: string;
  readonly explanation: string;
  readonly remedy: string;
};

export type ReportedRule<Id extends string> = { readonly ruleId: Id; readonly severity: Severity };

export const reportedUnder = <Id extends string>(rule: RuleDescription<Id>): ReportedRule<Id> => ({ ruleId: rule.id, severity: rule.severity });

export type CheckScope = 'nothing-found' | 'nothing-declared' | 'checkable';

export type Analyzer<Model, Suggestion, Produced extends Finding = Finding> = {
  readonly id: string;
  readonly rules: readonly RuleDescription<Produced['ruleId']>[];
  readonly extract: (input: AnalysisInput) => Model;
  readonly problems: (model: Model) => readonly Problem[];
  readonly suggest: (model: Model) => readonly Suggestion[];
  readonly check: (model: Model) => readonly Produced[];
  readonly diagram: (model: Model, only: string | undefined) => AnalyzerDiagram;
  readonly summarize: (model: Model, root: string) => string;
  readonly scope: (model: Model) => CheckScope;
};

export type AnalysisResult = {
  readonly rules: readonly RuleDescription[];
  readonly problems: readonly Problem[];
  readonly findings: readonly Finding[];
  readonly failures: readonly AnalyzerFailure[];
  readonly diagram: (only: string | undefined) => DiagramOutcome;
  readonly summary: (root: string) => SummaryOutcome;
  readonly scope: CheckScope;
};

const guarded = <T>(analyzer: string, compute: () => T): T | AnalyzerFailure => {
  try {
    return compute();
  } catch (error) {
    if (error instanceof DomainIntegrityError) throw error;
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
  scope: 'checkable',
});

type Evaluation<Model> = {
  readonly model: Model;
  readonly problems: readonly Problem[];
  readonly findings: readonly Finding[];
  readonly scope: CheckScope;
};

const isFailure = <Model>(value: Evaluation<Model> | AnalyzerFailure): value is AnalyzerFailure => 'kind' in value;

export const analyse = <Model, Suggestion>(
  analyzer: Analyzer<Model, Suggestion>,
  input: AnalysisInput,
): AnalysisResult => {
  const guard = <T>(compute: () => T): T | AnalyzerFailure => guarded(analyzer.id, compute);
  const evaluated = guard((): Evaluation<Model> => {
    const model = analyzer.extract(input);
    return { model, problems: analyzer.problems(model), findings: analyzer.check(model), scope: analyzer.scope(model) };
  });
  if (isFailure(evaluated)) return failedResult(analyzer.rules, evaluated);
  const { model, problems, findings, scope } = evaluated;
  return {
    rules: analyzer.rules,
    problems,
    findings,
    failures: [],
    diagram: (only) => guard(() => analyzer.diagram(model, only)),
    summary: (root) => guard(() => ({ kind: 'summary', text: analyzer.summarize(model, root) })),
    scope,
  };
};
