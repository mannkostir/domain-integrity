import { describe, expect, it } from 'vitest';
import { extractEventFlows } from '../../../src/analyzers/event-flow/extract';
import { readDeclaration } from '../../../src/engine/read-config';
import { inMemoryProject } from '../../helpers/in-memory';

const SOURCES = {
  '/app/src/decorators.ts': 'export const EventsHandler = (...events: unknown[]) => (target: unknown) => target;\nexport const Saga = () => (target: unknown, key: string) => undefined;\nexport const ofType = (...types: unknown[]) => types;\nexport type Stream = { pipe: (...operators: unknown[]) => unknown };',
  '/app/src/events.ts': 'export abstract class BaseEvent {}\nexport class Paid extends BaseEvent {}\nexport class Failed extends BaseEvent {}',
  '/app/src/pay.ts': "import { Paid } from './events';\nexport const pay = () => new Paid();",
  '/app/src/handlers.ts': "import { EventsHandler, Saga, ofType, Stream } from './decorators';\nimport { Paid, Failed } from './events';\n@EventsHandler(Paid) export class PaidHandler { handle(event: Failed) {} }\nexport class OrderSaga { @Saga() paid = (events$: Stream) => events$.pipe(ofType(Paid)); }",
};

const CONFIG = `
import { defineDomain, saga } from 'domain-integrity';
import { Failed, Paid } from './src/events';
import { OrderSaga } from './src/handlers';
export default defineDomain({ events: { inProcess: [Failed], sagas: [saga(OrderSaga, { outcomes: [[Paid, Failed]] })] } });
`;

const extract = (analysedPrefix = '/app/src/', extra: Readonly<Record<string, string>> = {}) => {
  const project = inMemoryProject({ ...SOURCES, ...extra, '/app/domain.config.ts': CONFIG });
  const config = project.getSourceFileOrThrow('/app/domain.config.ts');
  const files = project.getSourceFiles().filter((file) => file.getFilePath().startsWith(analysedPrefix));
  return extractEventFlows({ declaration: readDeclaration(config), files, root: '/app' });
};

describe('extractEventFlows', () => {
  it('builds registrations, event facts, in-process ids and sagas', () => {
    const model = extract();

    expect({
      registrations: model.registrations.map((registration) => [registration.event, registration.handlerClass, registration.handlerMethod, registration.payload.kind === 'classes' ? registration.payload.classes : '?', registration.line]),
      paid: model.events.get('Paid'),
      failed: { constructions: model.events.get('Failed')?.constructions, ancestors: model.events.get('Failed')?.ancestors },
      inProcess: model.inProcess,
      sagas: model.sagas,
      unresolved: model.unresolved,
      problems: model.problems,
      saga: model.classes.get('OrderSaga')?.qualifiedName,
    }).toEqual({
      registrations: [
        ['Paid', 'PaidHandler', 'handle', ['Failed'], 3],
        ['Paid', 'OrderSaga', 'paid', '?', 4],
      ],
      paid: {
        id: 'Paid',
        abstract: false,
        ancestors: ['BaseEvent'],
        constructions: [{ file: '/app/src/pay.ts', line: 2 }],
        subclassed: false,
        escaped: false,
        instanceofChecked: false,
        typedHandling: false,
        namedInString: false,
        opaque: false,
        extendsLibrary: false,
      },
      failed: { constructions: [], ancestors: ['BaseEvent'] },
      inProcess: ['Failed'],
      sagas: [{ id: 'OrderSaga', ancestors: [], extendsForeign: false, outcomes: [['Paid', 'Failed']] }],
      unresolved: [],
      problems: [],
      saga: 'src/handlers.ts:OrderSaga',
    });
  });

  it('reports declared classes outside the analysed files and leaves them out', () => {
    const model = extract('/app/src/handlers.ts');

    expect({ problems: model.problems, inProcess: model.inProcess, sagas: model.sagas }).toEqual({
      problems: [
        '"Failed" is declared in events but is not in the analysed files.',
        '"Paid" is declared in events but is not in the analysed files.',
      ],
      inProcess: [],
      sagas: [],
    });
  });

  it('marks registrations in test files', () => {
    const model = extract('/app/src/', {
      '/app/src/handlers.spec.ts': "import { EventsHandler } from './decorators';\nimport { Paid } from './events';\n@EventsHandler(Paid) export class SpecHandler { handle(event: Paid) {} }",
    });

    expect(model.registrations.map((registration) => [registration.handlerClass, registration.inTest])).toEqual([
      ['SpecHandler', true],
      ['PaidHandler', false],
      ['OrderSaga', false],
    ]);
  });

  it('records opaque and library-based event hierarchies and the owners of library-keyed sites', () => {
    const model = extract('/app/src/', {
      '/app/lib/external.ts': 'export class LibraryEvent {}',
      '/app/src/more.ts': "import { EventsHandler } from './decorators';\nimport { Paid } from './events';\nimport { LibraryEvent } from '../lib/external';\ndeclare const Mixin: <T>(base: T) => T;\nexport class Mixed extends Mixin(Paid) {}\nexport class Wrapped extends LibraryEvent {}\n@EventsHandler(Mixed, Wrapped, LibraryEvent) export class MoreHandler { handle(event: unknown) {} }",
    });

    expect({
      mixed: [model.events.get('Mixed')?.opaque, model.events.get('Mixed')?.extendsLibrary],
      wrapped: [model.events.get('Wrapped')?.opaque, model.events.get('Wrapped')?.extendsLibrary],
      paid: [model.events.get('Paid')?.opaque, model.events.get('Paid')?.extendsLibrary],
      libraryKeyed: model.libraryKeyed,
    }).toEqual({ mixed: [true, false], wrapped: [false, true], paid: [false, false], libraryKeyed: ['MoreHandler'] });
  });
});
