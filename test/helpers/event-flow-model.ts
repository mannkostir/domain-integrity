import { ClassRef, EventClassModel, EventFlowModel, Registration } from '../../src/analyzers/event-flow/model';

export const classRef = (id: string): ClassRef => ({ id, name: id, qualifiedName: `src/${id}.ts:${id}`, file: `/app/src/${id}.ts`, line: 1 });

export const eventClass = (id: string, overrides: Partial<EventClassModel> = {}): EventClassModel => ({
  id,
  abstract: false,
  ancestors: [],
  constructions: [{ file: '/app/src/emit.ts', line: 7 }],
  subclassed: false,
  escaped: false,
  instanceofChecked: false,
  typedHandling: false,
  namedInString: false,
  opaque: false,
  extendsLibrary: false,
  ...overrides,
});

export const registration = (overrides: Partial<Registration> = {}): Registration => ({
  event: 'Paid',
  handlerClass: 'PaidHandler',
  handlerMethod: 'handle',
  payload: { kind: 'unreadable' },
  inTest: false,
  file: '/app/src/handlers.ts',
  line: 4,
  ...overrides,
});

export const flowModel = (overrides: Partial<EventFlowModel> = {}): EventFlowModel => ({
  classes: new Map(['Paid', 'Failed', 'Base', 'PaidHandler', 'OrderSaga'].map((id) => [id, classRef(id)])),
  events: new Map([['Paid', eventClass('Paid')]]),
  registrations: [registration()],
  unresolved: [],
  libraryKeyed: [],
  inProcess: [],
  sagas: [],
  problems: [],
  ...overrides,
});
