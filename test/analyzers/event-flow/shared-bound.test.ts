import { describe, expect, it } from 'vitest';
import { extractEventFlows } from '../../../src/analyzers/event-flow/extract';
import { readDeclaration } from '../../../src/engine/read-config';
import { inMemoryProject } from '../../helpers/in-memory';

const EVENTS = `
export class Shipped { constructor(readonly orderId: string) {} }
export class Cancelled { constructor(readonly orderId: string, readonly reason: string) {} }
export class Paid { constructor(readonly amount: number) {} }
export class Tagged { constructor(readonly kind: 'tagged', readonly orderId: string) {} }
`;

const INFRA = 'export const OnEvent = (..._topics: unknown[]) => (..._args: unknown[]): void => undefined;\n';

const SHAPES = "export type OrderRef = { orderId: string };\nexport type Charge = { amount: number };\nexport type Kinded = { kind: 'tagged' | 'other' };\n";

const LISTENER = `
import { OnEvent } from './infra';
import { Charge, Kinded, OrderRef } from './shapes';
export class Listener {
  @OnEvent('a') first(event: OrderRef) {}
  @OnEvent('b') second(event: Charge) {}
  @OnEvent('c') third(event: OrderRef) {}
  @OnEvent('d') fourth(event: Kinded) {}
  @OnEvent('e') fifth(event: Kinded) {}
}
`;

const OTHER_LISTENER = `
import { OnEvent } from './infra';
import { OrderRef } from './shapes';
export class OtherListener { @OnEvent('f') handle(event: OrderRef) {} }
`;

const CONFIG = `
import { defineDomain } from 'domain-integrity';
import { Cancelled, Paid, Shipped, Tagged } from './src/events';
export default defineDomain({ events: { inProcess: [Shipped, Paid, Cancelled, Tagged] } });
`;

const receivedBySites = (): readonly (readonly string[] | 'any')[] => {
  const project = inMemoryProject({
    '/app/src/events.ts': EVENTS,
    '/app/src/infra.ts': INFRA,
    '/app/src/shapes.ts': SHAPES,
    '/app/src/listener.ts': LISTENER,
    '/app/src/other-listener.ts': OTHER_LISTENER,
    '/app/domain.config.ts': CONFIG,
  });
  const config = project.getSourceFileOrThrow('/app/domain.config.ts');
  const files = project.getSourceFiles().filter((file) => file.getFilePath().startsWith('/app/src/'));
  const model = extractEventFlows({ declaration: readDeclaration(config, 'domain.config.ts').declaration, files, projectRoot: '/app', repositoryRoot: '/app' });
  return model.unresolved.map((site) => (site.receives.kind === 'any' ? 'any' : site.receives.events));
};

describe('unresolved sites sharing an annotation type', () => {
  it('each receive the events comparable with their own annotation, in declaration order', () => {
    expect(receivedBySites()).toEqual([
      ['src/events.ts:Shipped', 'src/events.ts:Cancelled', 'src/events.ts:Tagged'],
      ['src/events.ts:Paid'],
      ['src/events.ts:Shipped', 'src/events.ts:Cancelled', 'src/events.ts:Tagged'],
      ['src/events.ts:Tagged'],
      ['src/events.ts:Tagged'],
      ['src/events.ts:Shipped', 'src/events.ts:Cancelled', 'src/events.ts:Tagged'],
    ]);
  });
});
