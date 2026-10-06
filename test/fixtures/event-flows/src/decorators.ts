export const EventsHandler = (...events: unknown[]) => (target: unknown) => target;
export const Saga = () => (target: unknown, key: string) => undefined;
export const ofType = (...types: unknown[]) => types;
export type Stream = { pipe: (...operators: unknown[]) => unknown };
