import { AnalysisInput, AnalysisResult, analyse } from './analyzer';
import { eventFlowAnalyzer } from './analyzers/event-flow/analyzer';
import { lifecycleAnalyzer } from './analyzers/lifecycle/analyzer';

export const runAnalyzers = (input: AnalysisInput): readonly AnalysisResult[] => [
  analyse(lifecycleAnalyzer, input),
  analyse(eventFlowAnalyzer, input),
];
