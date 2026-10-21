import { describe, expect, it } from 'vitest';
import { eventFlowAnalyzer } from '../../../src/analyzers/event-flow/analyzer';
import { DEFAULT_DECLARATION } from '../../../src/engine/declaration';
import { inMemoryProject } from '../../helpers/in-memory';

const scopeOf = (sources: Readonly<Record<string, string>>) => {
  const project = inMemoryProject(sources);
  return eventFlowAnalyzer.scope(eventFlowAnalyzer.extract({ declaration: DEFAULT_DECLARATION, files: project.getSourceFiles(), projectRoot: '/', repositoryRoot: '/' }));
};

describe('eventFlowAnalyzer scope', () => {
  it('finds nothing in a project without event handlers or event flows', () => {
    expect(scopeOf({ '/src/util.ts': 'export const add = (a: number, b: number): number => a + b;' })).toBe('nothing-found');
  });

  it('is checkable when an event handler is found', () => {
    expect(
      scopeOf({
        '/src/decorators.ts': 'export const EventsHandler = (...events: unknown[]) => (target: unknown) => target;',
        '/src/events.ts': 'export class Paid {}\nexport const pay = () => new Paid();',
        '/src/handler.ts': "import { EventsHandler } from './decorators';\nimport { Paid } from './events';\n@EventsHandler(Paid) export class PaidHandler { handle(event: Paid) {} }",
      }),
    ).toBe('checkable');
  });
});
