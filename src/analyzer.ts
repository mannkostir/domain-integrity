import { SourceFile } from 'ts-morph';
import { DomainDeclaration } from './engine/declaration';

export type AnalysisInput = {
  readonly declaration: DomainDeclaration;
  readonly files: readonly SourceFile[];
  readonly root: string;
};

export type Severity = 'error' | 'warning';

export type Finding = {
  readonly checkId: string;
  readonly severity: Severity;
  readonly aggregate: string;
  readonly aggregateId: string;
  readonly method: string | undefined;
  readonly field: string;
  readonly subject: string;
  readonly file: string;
  readonly line: number;
  readonly message: string;
  readonly fix: string;
};

export const findingKey = (finding: Finding): string =>
  [finding.checkId, finding.aggregateId, finding.method ?? '', finding.field, finding.subject].join('|');

export type AmbiguousReference = { readonly kind: 'ambiguous'; readonly reference: string; readonly candidates: readonly string[] };

export type DiagramOutcome = { readonly kind: 'diagram'; readonly text: string } | AmbiguousReference;

export type RuleDescription = { readonly id: string; readonly description: string };

export type Analyzer<Model, Suggestion> = {
  readonly id: string;
  readonly rules: readonly RuleDescription[];
  readonly extract: (input: AnalysisInput) => Model;
  readonly problems: (model: Model) => readonly string[];
  readonly suggest: (model: Model) => readonly Suggestion[];
  readonly check: (model: Model) => readonly Finding[];
  readonly diagram: (model: Model, only: string | undefined) => DiagramOutcome;
  readonly summarize: (model: Model, root: string) => string;
  readonly isEmpty: (model: Model) => boolean;
};

export type AnalysisResult = {
  readonly rules: readonly RuleDescription[];
  readonly problems: readonly string[];
  readonly findings: readonly Finding[];
  readonly diagram: (only: string | undefined) => DiagramOutcome;
  readonly summary: (root: string) => string;
  readonly isEmpty: boolean;
};

export const analyse = <Model, Suggestion>(
  analyzer: Analyzer<Model, Suggestion>,
  input: AnalysisInput,
): AnalysisResult => {
  const model = analyzer.extract(input);
  return {
    rules: analyzer.rules,
    problems: analyzer.problems(model),
    findings: analyzer.check(model),
    diagram: (only) => analyzer.diagram(model, only),
    summary: (root) => analyzer.summarize(model, root),
    isEmpty: analyzer.isEmpty(model),
  };
};
