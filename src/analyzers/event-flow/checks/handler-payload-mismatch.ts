import { EventFlowFinding } from '../../../analyzer';
import { EventFlowModel, Registration } from '../model';
import { acceptedIds, handlerLabel, nameOf } from './handler-label';

export const handlerPayloadMismatch = (model: EventFlowModel): EventFlowFinding[] =>
  model.registrations.flatMap((registration: Registration): EventFlowFinding[] => {
    const payload = registration.payload;
    if (registration.inTest || payload.kind !== 'classes' || model.events.get(registration.event)?.opaque === true) return [];
    const accepted = acceptedIds(model, registration.event);
    if (payload.classes.some((id) => accepted.has(id))) return [];
    const event = nameOf(model, registration.event);
    const declared = payload.classes.map((id) => nameOf(model, id)).join(' | ');
    const handler = handlerLabel(registration);
    return [
      {
        analyzer: 'event-flow',
        checkId: 'handler-payload-mismatch',
        severity: 'error',
        event,
        eventId: registration.event,
        handler,
        subject: payload.classes.join(','),
        file: payload.file,
        line: payload.line,
        message: `${handler ?? 'A handler'} is registered for ${event} but declares its event as ${declared}.`,
        fix: `Type the parameter as ${event}, or register the handler for ${declared}.`,
      },
    ];
  });
