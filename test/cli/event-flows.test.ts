import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { run } from '../../src/cli/run';
import { EVENT_FLOW_PROJECT, EVENT_FLOW_SOURCES, TICKET_PROJECT, captureIo, writeProject } from '../helpers/disk';

describe('event flows in the CLI', () => {
  it('checks a project with handlers but no aggregates', async () => {
    const { io, stdout } = captureIo(writeProject(EVENT_FLOW_PROJECT));

    expect({ code: await run(['check'], io), dead: stdout().includes('dead-handler  Refunded → RefundHandler.handle') }).toEqual({ code: 1, dead: true });
  });

  it('shows the event-flow diagram and a named event', async () => {
    const all = captureIo(writeProject(EVENT_FLOW_PROJECT));
    const named = captureIo(writeProject(EVENT_FLOW_PROJECT));

    expect({
      all: [await run(['show'], all.io), all.stdout().includes('flowchart LR')],
      named: [await run(['show', 'Paid'], named.io), named.stdout().includes('RefundHandler')],
    }).toEqual({ all: [0, true], named: [0, false] });
  });

  it('adds an event-flow section to the context', async () => {
    const { io, stdout } = captureIo(writeProject(EVENT_FLOW_PROJECT));
    await run(['context'], io);

    expect(stdout()).toContain(['## Event flows', '', '- Paid (src/events.ts) → PaidHandler.handle', '- Refunded (src/events.ts) → RefundHandler.handle', ''].join('\n'));
  });

  it('adds no trailing blank line to the context of a project without event flows', async () => {
    const { io, stdout } = captureIo(writeProject(TICKET_PROJECT));
    await run(['context'], io);

    expect(stdout().endsWith('\n\n')).toBe(false);
  });

  it('still exits 2 when there are neither aggregates nor event flows', async () => {
    const { io, stderr } = captureIo(writeProject({ 'src/empty.ts': 'export const nothing = 1;\n', 'domain.config.ts': EVENT_FLOW_PROJECT['domain.config.ts']! }));

    expect({ code: await run(['check'], io), message: stderr().includes('No event handlers were found either') }).toEqual({ code: 2, message: true });
  });

  it('writes event-flow baseline keys and treats them as known', async () => {
    const dir = writeProject(EVENT_FLOW_PROJECT);
    await run(['check', '--update-baseline', '--baseline', 'baseline.json'], captureIo(dir).io);
    const { io } = captureIo(dir);

    expect({
      keys: JSON.parse(readFileSync(join(dir, 'baseline.json'), 'utf8')).findings,
      code: await run(['check', '--baseline', 'baseline.json'], io),
    }).toEqual({ keys: ['dead-handler|Refunded|RefundHandler.handle|'], code: 0 });
  });

  it('exits 2 for a saga outcome that repeats one class', async () => {
    const { io, stderr } = captureIo(
      writeProject({
        ...EVENT_FLOW_SOURCES,
        'src/saga.ts': 'export class RefundSaga {}\n',
        'domain.config.ts': "import { defineDomain, saga } from 'domain-integrity';\nimport { Paid } from './src/events';\nimport { RefundSaga } from './src/saga';\nexport default defineDomain({ events: { sagas: [saga(RefundSaga, { outcomes: [[Paid, Paid]] })] } });\n",
      }),
    );

    expect({ code: await run(['check'], io), message: stderr().includes('both success and failure') }).toEqual({ code: 2, message: true });
  });
});
