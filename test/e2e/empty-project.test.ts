import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { run } from '../../src/cli/run';
import { TICKET_SOURCES, captureIo, writeProject } from '../helpers/disk';

const EMPTY_CONFIG = "import { defineDomain } from 'domain-integrity';\nexport default defineDomain({});\n";

const NOTHING_DECLARED_CONFIG = "import { defineDomain } from 'domain-integrity';\nexport default defineDomain({ lifecycles: [] });\n";

const OUTSIDE_EVENT_CONFIG = "import { defineDomain } from 'domain-integrity';\nimport { Paid } from './events/paid';\nexport default defineDomain({ events: { inProcess: [Paid] } });\n";

const OUTSIDE_EVENT_PROBLEM = 'problem: "Paid" is declared in events but is not in the analysed files.';

const PROJECTS = {
  'no source files': () => writeProject({ 'domain.config.ts': EMPTY_CONFIG }),
  'no aggregates and no event handlers': () => writeProject({ 'src/empty.ts': 'export const nothing = 1;\n', 'domain.config.ts': EMPTY_CONFIG }),
  'nothing declared': () => writeProject({ ...TICKET_SOURCES, 'domain.config.ts': NOTHING_DECLARED_CONFIG }),
  'an event declared outside the analysed files': () =>
    writeProject({ 'src/empty.ts': 'export const nothing = 1;\n', 'events/paid.ts': 'export class Paid {}\n', 'domain.config.ts': OUTSIDE_EVENT_CONFIG }),
} satisfies Readonly<Record<string, () => string>>;

type ProjectName = keyof typeof PROJECTS;

type ExitCase = readonly [ProjectName, string, number];

const projectFor = (name: ProjectName): string => PROJECTS[name]();

describe('a project with nothing to check', () => {
  it.each<ExitCase>([
    ['no source files', 'check', 2],
    ['no source files', 'show', 2],
    ['no source files', 'context', 2],
    ['no aggregates and no event handlers', 'check', 2],
    ['no aggregates and no event handlers', 'show', 2],
    ['no aggregates and no event handlers', 'context', 2],
    ['nothing declared', 'check', 0],
    ['nothing declared', 'show', 0],
    ['nothing declared', 'context', 0],
  ])('with %s, %s exits %s', async (project, command, expected) => {
    const { io } = captureIo(projectFor(project));

    expect(await run([command], io)).toBe(expected);
  });

  it('says a tsconfig includes no source files', async () => {
    const { io, stderr } = captureIo(projectFor('no source files'));
    await run(['check'], io);

    expect(stderr()).toBe(
      'Loaded 0 source files.\ntsconfig.json includes no source files.\nPass -p with a tsconfig that includes your code, or add "references" to the tsconfigs that do.\n',
    );
  });

  it('says what it searched for when it finds neither aggregates nor event handlers', async () => {
    const { io, stderr } = captureIo(projectFor('no aggregates and no event handlers'));
    await run(['check'], io);

    expect(stderr()).toBe(
      [
        'Loaded 1 source file.',
        'No aggregates found.',
        'Searched for classes extending or implementing: AggregateRoot, Entity.',
        `Set "aggregates.baseClasses" in domain.config.ts to the base class or interface your aggregates extend or implement, for example: export default defineDomain({ aggregates: { baseClasses: ['MyAggregateBase'] } })`,
        'No event handlers were found either.',
        'Recognised handlers use the decorators EventsHandler, OnEvent, HandleEvent (set "events.handlerDecorators" for your own), the methods register (set "events.registerMethods"), subscribedTo(), or @Saga() with ofType().',
        '',
      ].join('\n'),
    );
  });

  it('names the problems of the analysers when it finds nothing', async () => {
    const { io, stderr } = captureIo(projectFor('an event declared outside the analysed files'));
    await run(['check'], io);

    expect(stderr()).toBe(
      [
        'Loaded 1 source file.',
        OUTSIDE_EVENT_PROBLEM,
        'No aggregates found.',
        'Searched for classes extending or implementing: AggregateRoot, Entity.',
        `Set "aggregates.baseClasses" in domain.config.ts to the base class or interface your aggregates extend or implement, for example: export default defineDomain({ aggregates: { baseClasses: ['MyAggregateBase'] } })`,
        'No event handlers were found either.',
        'Recognised handlers use the decorators EventsHandler, OnEvent, HandleEvent (set "events.handlerDecorators" for your own), the methods register (set "events.registerMethods"), subscribedTo(), or @Saga() with ofType().',
        '',
      ].join('\n'),
    );
  });

  it.each(['check', 'show', 'context'])('exits 2 for %s when it finds nothing but an analyser problem', async (command) => {
    const { io } = captureIo(projectFor('an event declared outside the analysed files'));

    expect(await run([command], io)).toBe(2);
  });

  it.each(['check', 'show', 'context'])('names the analyser problem for %s when it finds nothing', async (command) => {
    const { io, stderr } = captureIo(projectFor('an event declared outside the analysed files'));
    await run([command], io);

    expect(stderr()).toContain(OUTSIDE_EVENT_PROBLEM);
  });

  it('notices that the config declares nothing to check', async () => {
    const dir = projectFor('nothing declared');
    const { io, stderr } = captureIo(dir);
    await run(['check'], io);

    expect(stderr()).toBe(
      [
        'Loaded 2 source files.',
        'Nothing to check: domain.config.ts declares no lifecycles, and no event handlers or event flows were found.',
        'Run "domain-integrity init" to declare the lifecycles of the aggregates it finds.',
        '',
      ].join('\n'),
    );
  });

  it('names the config passed with -c in the notice that it declares nothing', async () => {
    const { io, stderr } = captureIo(writeProject({ ...TICKET_SOURCES, 'configs/my.config.ts': NOTHING_DECLARED_CONFIG }));
    await run(['check', '-c', 'configs/my.config.ts'], io);

    expect(stderr()).toContain('Nothing to check: configs/my.config.ts declares no lifecycles');
  });

  it('names the config passed with -c in the hint to set the base classes', async () => {
    const { io, stderr } = captureIo(writeProject({ 'src/empty.ts': 'export const nothing = 1;\n', 'configs/my.config.ts': EMPTY_CONFIG }));
    await run(['check', '-c', 'configs/my.config.ts'], io);

    expect(stderr()).toContain('Set "aggregates.baseClasses" in configs/my.config.ts to the base class');
  });

  it('prints a JSON report without findings when nothing is declared', async () => {
    const { io, stdout } = captureIo(projectFor('nothing declared'));
    await run(['check', '--format', 'json'], io);

    expect(JSON.parse(stdout()).findings).toEqual([]);
  });

  it('shows nothing on stdout when nothing is declared', async () => {
    const { io, stdout } = captureIo(projectFor('nothing declared'));
    await run(['show'], io);

    expect(stdout()).toBe('');
  });

  it('exits 0 for show with a name when nothing is declared', async () => {
    const { io } = captureIo(projectFor('nothing declared'));

    expect(await run(['show', 'Ticket'], io)).toBe(0);
  });

  it('says there is nothing to show for the given name when nothing is declared', async () => {
    const dir = projectFor('nothing declared');
    const { io, stderr } = captureIo(dir);
    await run(['show', 'Ticket'], io);

    expect(stderr()).toBe(
      [
        'Loaded 2 source files.',
        'Nothing to check: domain.config.ts declares no lifecycles, and no event handlers or event flows were found.',
        'Run "domain-integrity init" to declare the lifecycles of the aggregates it finds.',
        'Nothing to show for "Ticket".',
        '',
      ].join('\n'),
    );
  });

  it('prints only the notice for show without a name when nothing is declared', async () => {
    const dir = projectFor('nothing declared');
    const { io, stderr } = captureIo(dir);
    await run(['show'], io);

    expect(stderr()).toBe(
      [
        'Loaded 2 source files.',
        'Nothing to check: domain.config.ts declares no lifecycles, and no event handlers or event flows were found.',
        'Run "domain-integrity init" to declare the lifecycles of the aggregates it finds.',
        '',
      ].join('\n'),
    );
  });

  it('prints the notice for context when nothing is declared', async () => {
    const { io, stderr } = captureIo(projectFor('nothing declared'));
    await run(['context'], io);

    expect(stderr()).toContain('Nothing to check: ');
  });

  it('prints no context when nothing is declared', async () => {
    const { io, stdout } = captureIo(projectFor('nothing declared'));
    await run(['context'], io);

    expect(stdout()).toBe('');
  });

  it('writes an empty context section when nothing is declared', async () => {
    const dir = projectFor('nothing declared');
    await run(['context', '--write', 'AGENTS.md'], captureIo(dir).io);

    expect(readFileSync(join(dir, 'AGENTS.md'), 'utf8')).toBe('<!-- domain-integrity:start -->\n\n<!-- domain-integrity:end -->\n');
  });
});
