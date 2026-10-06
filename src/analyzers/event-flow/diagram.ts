import { DiagramOutcome } from '../../analyzer';
import { escapeLabel } from '../mermaid-label';
import { handlerLabel } from './checks/handler-label';
import { ClassRef, EventFlowModel } from './model';

const handledEvents = (model: EventFlowModel): readonly ClassRef[] =>
  [...new Set(model.registrations.map((registration) => registration.event))]
    .sort()
    .flatMap((id) => {
      const ref = model.classes.get(id);
      return ref === undefined ? [] : [ref];
    });

const isNamed = (ref: ClassRef, only: string): boolean => ref.id === only || ref.name === only || ref.qualifiedName === only;

const render = (model: EventFlowModel, events: readonly ClassRef[]): string => {
  if (events.length === 0) return '';
  const edges = events.flatMap((event, eventIndex) =>
    model.registrations.filter((registration) => registration.event === event.id).map((registration) => ({ eventIndex, event, label: handlerLabel(registration) ?? '(inline)' })),
  );
  const lines = edges.map(
    (edge, handlerIndex) => `  event_${edge.eventIndex}["${escapeLabel(edge.event.name)}"] --> handler_${handlerIndex}["${escapeLabel(edge.label)}"]`,
  );
  return ['## Event flows', '', '```mermaid', 'flowchart LR', ...lines, '```'].join('\n');
};

export const eventFlowDiagram = (model: EventFlowModel, only: string | undefined): DiagramOutcome => {
  const events = handledEvents(model);
  if (only === undefined) return { kind: 'diagram', text: render(model, events) };
  const matches = events.filter((event) => isNamed(event, only));
  return matches.length > 1
    ? { kind: 'ambiguous', reference: only, candidates: matches.map((event) => event.qualifiedName) }
    : { kind: 'diagram', text: render(model, matches) };
};
