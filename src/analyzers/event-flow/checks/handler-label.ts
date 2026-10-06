import { EventFlowModel, Registration } from '../model';

export const handlerLabel = (registration: Registration): string | undefined => {
  if (registration.handlerClass === undefined) return registration.handlerMethod;
  return registration.handlerMethod === undefined ? registration.handlerClass : `${registration.handlerClass}.${registration.handlerMethod}`;
};

export const nameOf = (model: EventFlowModel, id: string): string => model.classes.get(id)?.name ?? id;

export const acceptedIds = (model: EventFlowModel, eventId: string): ReadonlySet<string> =>
  new Set([eventId, ...(model.events.get(eventId)?.ancestors ?? [])]);
