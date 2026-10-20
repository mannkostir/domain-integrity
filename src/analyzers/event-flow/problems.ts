import { ProblemOf } from '../../finding';

export const eventNotAnalysed = (event: string): ProblemOf<'event-not-analysed'> => ({
  code: 'event-not-analysed',
  analyzer: 'event-flow',
  message: `"${event}" is declared in events but is not in the analysed files.`,
  details: { event },
});

export const sagaOutcomeUnhandled = (saga: string, success: string, failure: string): ProblemOf<'saga-outcome-unhandled'> => ({
  code: 'saga-outcome-unhandled',
  analyzer: 'event-flow',
  message: `saga(${saga}) declares the outcome ${success} → ${failure}, but ${saga} handles neither.`,
  details: { saga, success, failure },
});
