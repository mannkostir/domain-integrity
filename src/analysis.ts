import { AnalysisInput, AnalysisResult, analyse } from './analyzer';
import { lifecycleAnalyzer } from './analyzers/lifecycle/analyzer';

export const runAnalyzers = (input: AnalysisInput): readonly AnalysisResult[] => [analyse(lifecycleAnalyzer, input)];
