import { ClassRef, EventFlowModel, Registration } from '../model';

export const nameOf = (model: EventFlowModel, id: string): string => model.classes.get(id)?.name ?? id;

export const handlerLabel = (model: EventFlowModel, registration: Registration): string | undefined => {
  if (registration.handlerClass === undefined) return registration.handlerMethod;
  const name = nameOf(model, registration.handlerClass);
  return registration.handlerMethod === undefined ? name : `${name}.${registration.handlerMethod}`;
};

export const acceptedIds = (model: EventFlowModel, eventId: string): ReadonlySet<string> =>
  new Set([eventId, ...(model.events.get(eventId)?.ancestors ?? [])]);

export const refOf = (model: EventFlowModel, id: string): ClassRef => {
  const ref = model.classes.get(id);
  if (ref === undefined) throw new Error(`event-flow model has no class "${id}"`);
  return ref;
};
