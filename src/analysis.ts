import { AnalysisInput, AnalysisResult, analyse } from './analyzer';
import { eventFlowAnalyzer } from './analyzers/event-flow/analyzer';
import { lifecycleAnalyzer } from './analyzers/lifecycle/analyzer';

export type AnalyzerRun = (input: AnalysisInput) => AnalysisResult;

export const DEFAULT_ANALYZERS: readonly AnalyzerRun[] = [
  (input) => analyse(lifecycleAnalyzer, input),
  (input) => analyse(eventFlowAnalyzer, input),
];

export const runAnalyzers = (input: AnalysisInput, analyzers: readonly AnalyzerRun[]): readonly AnalysisResult[] =>
  analyzers.map((analyzer) => analyzer(input));
