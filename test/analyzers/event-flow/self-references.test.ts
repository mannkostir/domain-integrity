import { describe, expect, it } from 'vitest';
import { deadHandler } from '../../../src/analyzers/event-flow/checks/dead-handler';
import { sagaMissingFailurePath, sagaProblems } from '../../../src/analyzers/event-flow/checks/saga-missing-failure-path';
import { unhandledEvent } from '../../../src/analyzers/event-flow/checks/unhandled-event';
import { extractEventFlows } from '../../../src/analyzers/event-flow/extract';
import { readDeclaration } from '../../../src/engine/read-config';
import { inMemoryProject } from '../../helpers/in-memory';

const modelOf = (eventBody = '', usage = '', importNames = 'Packed', construction = 'new Packed();', registered = false) => {
  const project = inMemoryProject({
    '/app/src/events.ts': `export type Props<T> = { value: T }; export const VERSION = 1; export class Packed { ${eventBody} } export class Success {}`,
    '/app/src/use.ts': `import { ${importNames} } from './events'; ${construction} ${usage}`,
    '/app/src/handlers.ts': `import { Success, Packed } from './events'; declare const EventsHandler: (...events: unknown[]) => ClassDecorator; @EventsHandler(Success) export class OrderSaga {} ${registered ? '@EventsHandler(Packed) export class PackedHandler {}' : ''}`,
    '/app/domain.config.ts': `import { defineDomain, saga } from 'domain-integrity'; import { Packed, Success } from './src/events'; import { OrderSaga } from './src/handlers'; export default defineDomain({ events: { inProcess: [Packed], sagas: [saga(OrderSaga, { outcomes: [[Success, Packed]] })] } });`,
  });
  const declaration = readDeclaration(project.getSourceFileOrThrow('/app/domain.config.ts'), 'domain.config.ts').declaration;
  return extractEventFlows({ declaration, files: project.getSourceFiles().filter((file) => file.getFilePath().startsWith('/app/src/')), projectRoot: '/app', repositoryRoot: '/app' });
};

describe('event handling references', () => {
  it('reports an unhandled event whose constructor mentions its own generic type', () => {
    const model = modelOf('constructor(props: Props<Packed>) {}', '', 'Packed', 'new Packed({ value: undefined! });');

    expect(unhandledEvent(model).map((finding) => finding.details.event)).toEqual(['Packed']);
  });

  it('reports an unhandled event whose own string matches its class name', () => {
    const model = modelOf("readonly eventName = 'Packed';");

    expect(unhandledEvent(model).map((finding) => finding.details.event)).toEqual(['Packed']);
  });

  it.each(['Packed, VERSION', 'VERSION, Packed', 'Packed as Parcel, VERSION', 'type Packed, VERSION'])('reports an unhandled event imported through %s', (names) => {
    const construction = names.includes('type Packed') ? '' : names.includes('Parcel') ? 'new Parcel();' : 'new Packed();';
    const model = modelOf('static make() { return new Packed(); }', '', names, construction);

    expect(unhandledEvent(model).map((finding) => finding.details.event)).toEqual(['Packed']);
  });

  it.each(["export { Packed, VERSION } from './events';", "export { VERSION, Packed as Parcel } from './events';", "export type { Packed } from './events';", 'export { Packed, VERSION };'])('keeps re-export syntax quiet: %s', (usage) => {
    const model = modelOf('', usage);

    expect(unhandledEvent(model).map((finding) => finding.details.event)).toEqual(['Packed']);
  });

  it.each(['Packed', 'Props<Packed>', 'Packed | string'])('preserves external parameter handling through %s', (type) => {
    const model = modelOf('', `export const handle = (event: ${type}) => event;`, 'type Props, Packed');

    expect(unhandledEvent(model)).toEqual([]);
  });

  it('preserves matching strings outside the event class', () => {
    const model = modelOf('', "export const topic = 'Packed';");

    expect(unhandledEvent(model)).toEqual([]);
  });

  it.each(['static factory = Packed;', 'static make() { return new this(); }', 'static make() { const Self = Packed; return new Self(); }'])('preserves genuine self factory escapes: %s', (body) => {
    const model = modelOf(body);

    expect(unhandledEvent(model)).toEqual([]);
  });

  it('preserves external value escapes', () => {
    const model = modelOf('', 'export const factories = { Packed };');

    expect(unhandledEvent(model)).toEqual([]);
  });

  it('keeps a handler live when its event constructs itself', () => {
    const model = modelOf('static make() { return new Packed(); }', '', 'Packed', '', true);

    expect(deadHandler(model).filter((finding) => finding.details.event === 'Packed')).toEqual([]);
  });

  it('keeps a handler live when its event constructs through this', () => {
    const model = modelOf('static make() { return new this(); }', '', 'Packed', '', true);

    expect(deadHandler(model).filter((finding) => finding.details.event === 'Packed')).toEqual([]);
  });

  it('keeps a handler live when its event is subclassed', () => {
    const model = modelOf('', 'export class Special extends Packed {}', 'Packed', '', true);

    expect(deadHandler(model).filter((finding) => finding.details.event === 'Packed')).toEqual([]);
  });

  it('reports a dead handler despite a multi-name import', () => {
    const model = modelOf('', '', 'Packed, VERSION', '', true);

    expect(deadHandler(model).filter((finding) => finding.details.event === 'Packed')).toHaveLength(1);
  });

  it.each(['constructor(props?: Props<Packed>) {}', "readonly eventName = 'Packed';"])('reports a missing saga failure path despite self mention: %s', (body) => {
    const model = modelOf(body);

    expect(sagaMissingFailurePath(model).map((finding) => finding.details.failure)).toEqual(['Packed']);
  });

  it('preserves a default export as a genuine value escape', () => {
    const model = modelOf('', 'export default Packed;');

    expect(unhandledEvent(model)).toEqual([]);
  });

  it('reports an unhandled saga outcome despite self type mentions', () => {
    const model = { ...modelOf('constructor(props?: Props<Packed>) {}'), registrations: [] };

    expect(sagaProblems(model)).toHaveLength(1);
  });

  it.each(["export const topic = 'Packed';", 'export const factory = Packed;'])('preserves unseen saga failure handling: %s', (usage) => {
    const model = modelOf('', usage);

    expect(sagaMissingFailurePath(model)).toEqual([]);
  });

  it('preserves external handling of saga failure events', () => {
    const model = modelOf('', 'export const handle = (event: Packed | string) => event;');

    expect(sagaMissingFailurePath(model)).toEqual([]);
  });
});
