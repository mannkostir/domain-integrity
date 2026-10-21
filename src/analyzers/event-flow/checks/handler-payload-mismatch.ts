import { reportedUnder } from '../../../analyzer';
import { FindingOf } from '../../../finding';
import { EventFlowModel, Registration } from '../model';
import { acceptedIds, handlerLabel, nameOf } from './handler-label';
import { HANDLER_PAYLOAD_MISMATCH } from './rules';

export const handlerPayloadMismatch = (model: EventFlowModel): FindingOf<'handler-payload-mismatch'>[] =>
  model.registrations.flatMap((registration: Registration): FindingOf<'handler-payload-mismatch'>[] => {
    const payload = registration.payload;
    if (registration.inTest || payload.kind !== 'classes' || model.events.get(registration.event)?.opaque === true) return [];
    const accepted = acceptedIds(model, registration.event);
    if (payload.classes.some((id) => accepted.has(id))) return [];
    const event = nameOf(model, registration.event);
    const declared = payload.classes.map((id) => nameOf(model, id));
    const handler = handlerLabel(model, registration);
    return [
      {
        ...reportedUnder(HANDLER_PAYLOAD_MISMATCH),
        analyzer: 'event-flow',
        file: payload.file,
        line: payload.line,
        message: `${handler ?? 'A handler'} is registered for ${event} but declares its event as ${declared.join(' | ')}.`,
        fix: `Type the parameter as ${event}, or register the handler for ${declared.join(' | ')}.`,
        details: { event, eventId: registration.event, handler: handler ?? null, handlerClassId: registration.handlerClass ?? null, handlerMethod: registration.handlerMethod ?? null, declared, declaredIds: payload.classes },
      },
    ];
  });
