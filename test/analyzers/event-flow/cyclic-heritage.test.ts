import { describe, expect, it } from 'vitest';
import { analyse } from '../../../src/analyzer';
import { eventFlowAnalyzer } from '../../../src/analyzers/event-flow/analyzer';
import { readDeclaration } from '../../../src/engine/read-config';
import { inMemoryProject } from '../../helpers/in-memory';

const LINEAR_EVENTS =
  'export abstract class BaseEvent {}\nexport class Paid extends BaseEvent {}\nexport class Failed extends BaseEvent {}\nexport class Refunded extends BaseEvent {}';
const LOOPING_EVENTS =
  'export class Echo extends Paid {}\nexport class Paid extends Echo {}\nexport class Failed extends Echo {}\nexport class Refunded extends Echo {}';
const SELF_IMPORTED_LOOPING_EVENTS =
  "import * as self from './events';\nexport class Echo extends self.Paid {}\nexport class Paid extends self.Echo {}\nexport class Failed extends self.Echo {}\nexport class Refunded extends self.Echo {}";

const ruleIds = (events: string): readonly string[] => {
  const project = inMemoryProject({
    '/app/src/decorators.ts': 'export const EventsHandler = (...events: unknown[]) => (target: unknown) => target;',
    '/app/src/events.ts': events,
    '/app/src/emit.ts': "import { Failed, Paid } from './events';\nexport const fail = () => new Failed();\nexport const pay = () => new Paid();",
    '/app/src/handlers.ts': "import { EventsHandler } from './decorators';\nimport { Paid, Refunded } from './events';\n@EventsHandler(Paid) export class PaidHandler { handle(event: Refunded) {} }",
    '/app/domain.config.ts': "import { defineDomain } from 'domain-integrity';\nimport { Failed } from './src/events';\nexport default defineDomain({ events: { inProcess: [Failed] } });",
  });
  const config = project.getSourceFileOrThrow('/app/domain.config.ts');
  const files = project.getSourceFiles().filter((file) => file.getFilePath().startsWith('/app/src/'));
  const result = analyse(eventFlowAnalyzer, { declaration: readDeclaration(config, 'domain.config.ts').declaration, files, projectRoot: '/app', repositoryRoot: '/app' });
  return result.findings.map((finding) => finding.ruleId);
};

describe('event-flow on looping event heritage', () => {
  it('reports the unhandled event and the payload mismatch when the heritage is linear', () => {
    const found = ruleIds(LINEAR_EVENTS);

    expect(found).toEqual(['unhandled-event', 'handler-payload-mismatch']);
  });

  it('reports neither when the event heritage loops', () => {
    const found = ruleIds(LOOPING_EVENTS);

    expect(found).toEqual([]);
  });

  it('reports neither when the event heritage loops through a namespace self-import', () => {
    const found = ruleIds(SELF_IMPORTED_LOOPING_EVENTS);

    expect(found).toEqual([]);
  });
});
