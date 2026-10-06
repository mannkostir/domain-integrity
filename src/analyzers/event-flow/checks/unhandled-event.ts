import { EventFlowFinding } from '../../../analyzer';
import { EventClassModel, EventFlowModel, Location } from '../model';
import { acceptedIds, nameOf } from './handler-label';

const byPosition = (a: Location, b: Location): number => a.file.localeCompare(b.file) || a.line - b.line;

const mightBeHandledUnseen = (model: EventFlowModel, event: EventClassModel): boolean =>
  event.escaped ||
  event.instanceofChecked ||
  event.namedInString ||
  event.typedHandling ||
  event.opaque ||
  (event.extendsLibrary && model.libraryKeyed.length > 0);

const isHandled = (model: EventFlowModel, event: EventClassModel): boolean => {
  const accepted = acceptedIds(model, event.id);
  return model.registrations.some((registration) => accepted.has(registration.event));
};

export const unhandledEvent = (model: EventFlowModel): EventFlowFinding[] => {
  if (model.unresolved.length > 0) return [];
  return model.inProcess.flatMap((id): EventFlowFinding[] => {
    const event = model.events.get(id);
    const [first] = [...(event?.constructions ?? [])].sort(byPosition);
    if (event === undefined || first === undefined || mightBeHandledUnseen(model, event) || isHandled(model, event)) return [];
    const name = nameOf(model, id);
    return [
      {
        analyzer: 'event-flow',
        checkId: 'unhandled-event',
        severity: 'error',
        event: name,
        eventId: id,
        handler: undefined,
        subject: '',
        file: first.file,
        line: first.line,
        message: `${name} is declared in-process and constructed, but no handler is registered for it.`,
        fix: `Add a handler, or remove ${name} from events.inProcess if it is consumed elsewhere.`,
      },
    ];
  });
};
