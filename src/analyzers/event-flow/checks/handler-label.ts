import { ClassRef, EventFlowModel, Registration } from '../model';

export const handlerLabel = (registration: Registration): string | undefined => {
  if (registration.handlerClass === undefined) return registration.handlerMethod;
  return registration.handlerMethod === undefined ? registration.handlerClass : `${registration.handlerClass}.${registration.handlerMethod}`;
};

export const nameOf = (model: EventFlowModel, id: string): string => model.classes.get(id)?.name ?? id;

export const acceptedIds = (model: EventFlowModel, eventId: string): ReadonlySet<string> =>
  new Set([eventId, ...(model.events.get(eventId)?.ancestors ?? [])]);

export const refOf = (model: EventFlowModel, id: string): ClassRef => {
  const ref = model.classes.get(id);
  if (ref === undefined) throw new Error(`event-flow model has no class "${id}"`);
  return ref;
};
