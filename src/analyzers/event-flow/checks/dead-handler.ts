import { reportedUnder } from '../../../analyzer';
import { FindingOf } from '../../../finding';
import { EventClassModel, EventFlowModel, Registration } from '../model';
import { handlerLabel, nameOf } from './handler-label';
import { DEAD_HANDLER } from './rules';

const isDead = (event: EventClassModel): boolean =>
  event.constructions.length === 0 && !event.abstract && !event.subclassed && !event.escaped;

const toFinding = (model: EventFlowModel, registration: Registration): FindingOf<'dead-handler'> => {
  const event = nameOf(model, registration.event);
  const handler = handlerLabel(model, registration);
  return {
    ...reportedUnder(DEAD_HANDLER),
    analyzer: 'event-flow',
    file: registration.file,
    line: registration.line,
    message: `${handler ?? 'A handler'} handles ${event}, but no production code constructs ${event}.`,
    fix: `Publish ${event} where it happens, or delete the handler.`,
    details: { event, eventId: registration.event, handler: handler ?? null, handlerClassId: registration.handlerClass ?? null, handlerMethod: registration.handlerMethod ?? null },
  };
};

const hasDeadEvent = (model: EventFlowModel, registration: Registration): boolean => {
  const event = model.events.get(registration.event);
  return event !== undefined && isDead(event);
};

export const deadHandler = (model: EventFlowModel): FindingOf<'dead-handler'>[] =>
  model.registrations
    .filter((registration) => !registration.inTest && hasDeadEvent(model, registration))
    .map((registration) => toFinding(model, registration));
