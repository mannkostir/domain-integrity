import { HandlerFinding } from '../../../analyzer';
import { EventClassModel, EventFlowModel, Registration } from '../model';
import { handlerLabel, nameOf } from './handler-label';

const isDead = (event: EventClassModel): boolean =>
  event.constructions.length === 0 && !event.abstract && !event.subclassed && !event.escaped;

const toFinding = (model: EventFlowModel, registration: Registration): HandlerFinding => {
  const event = nameOf(model, registration.event);
  const handler = handlerLabel(registration);
  return {
    analyzer: 'event-flow',
    checkId: 'dead-handler',
    severity: 'error',
    event,
    eventId: registration.event,
    handler,
    subject: '',
    file: registration.file,
    line: registration.line,
    message: `${handler ?? 'A handler'} handles ${event}, but no production code constructs ${event}.`,
    fix: `Publish ${event} where it happens, or delete the handler.`,
  };
};

const hasDeadEvent = (model: EventFlowModel, registration: Registration): boolean => {
  const event = model.events.get(registration.event);
  return event !== undefined && isDead(event);
};

export const deadHandler = (model: EventFlowModel): HandlerFinding[] =>
  model.registrations
    .filter((registration) => !registration.inTest && hasDeadEvent(model, registration))
    .map((registration) => toFinding(model, registration));
