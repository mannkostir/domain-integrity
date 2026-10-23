import { existsSync, mkdirSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const { values } = parseArgs({
  options: {
    out: { type: 'string' },
    aggregates: { type: 'string', default: '50' },
    files: { type: 'string', default: '500' },
    events: { type: 'string', default: '0' },
    'dto-members': { type: 'string', default: '0' },
    sites: { type: 'string', default: '0' },
    tool: { type: 'string', default: resolve(dirname(fileURLToPath(import.meta.url)), '..') },
  },
});

if (values.out === undefined) {
  process.stderr.write('usage: generate.mjs --out <dir> [--aggregates n] [--files n] [--events n --dto-members n --sites n]\n');
  process.exit(2);
}

const out = values.out;
const aggregates = Number(values.aggregates);
const files = Number(values.files);
const events = Number(values.events);
const dtoMembers = Number(values['dto-members']);
const sites = Number(values.sites);

const write = (path, content) => {
  const target = join(out, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content);
};

const range = (count) => Array.from({ length: count }, (_, index) => index);

const aggregateName = (index) => `Order${index}`;

const statusName = (index) => `Order${index}Status`;

const aggregateSource = (index) => `import { AggregateRoot } from '../shared/aggregate-root';
import { Order${index}Activated, Order${index}Closed } from './order${index}.events';

export enum ${statusName(index)} {
  Draft = 'draft',
  Active = 'active',
  Suspended = 'suspended',
  Closed = 'closed',
}

export type Order${index}Kind = 'standard' | 'express' | 'bulk';

export class ${aggregateName(index)} extends AggregateRoot {
  status: ${statusName(index)} = ${statusName(index)}.Draft;
  kind: Order${index}Kind = 'standard';
  private notes: string[] = [];

  activate(): void {
    if (this.status !== ${statusName(index)}.Draft) throw new Error('not draft');
    this.status = ${statusName(index)}.Active;
    this.addEvent(new Order${index}Activated(${index}));
  }

  suspend(): void {
    if (this.status !== ${statusName(index)}.Active) throw new Error('not active');
    this.status = ${statusName(index)}.Suspended;
  }

  resume(): void {
    if (this.status === ${statusName(index)}.Suspended) {
      this.status = ${statusName(index)}.Active;
    }
  }

  close(): void {
    if (this.status === ${statusName(index)}.Closed) return;
    this.status = ${statusName(index)}.Closed;
    this.addEvent(new Order${index}Closed(${index}));
  }

  expedite(): void {
    if (this.kind === 'bulk') throw new Error('bulk');
    this.kind = 'express';
  }

  annotate(note: string): void {
    this.notes = [...this.notes, note];
  }
}
`;

const eventsSource = (index) => `export class Order${index}Activated {
  constructor(readonly order${index}Id: number) {}
}

export class Order${index}Closed {
  constructor(readonly closedOrder${index}Id: number) {}
}
`;

const handlerSource = (index) => `import { OnEvent } from '../shared/decorators';
import { Order${index}Activated, Order${index}Closed } from './order${index}.events';

export class Order${index}Projector {
  @OnEvent(Order${index}Activated)
  onActivated(event: Order${index}Activated): number {
    return event.order${index}Id;
  }

  @OnEvent(Order${index}Closed)
  onClosed(event: Order${index}Closed): number {
    return event.closedOrder${index}Id;
  }
}
`;

const serviceSource = (fileIndex, target) => `import { ${aggregateName(target)}, ${statusName(target)} } from '../order${target}/order${target}';

type Row${fileIndex} = { readonly id: number; readonly label: string; readonly state: string };

const LABELS${fileIndex} = ['draft', 'active', 'pending', 'archived', 'standard'] as const;

export class Service${fileIndex} {
  private readonly cache = new Map<number, Row${fileIndex}>();

  describe(order: ${aggregateName(target)}): string {
    switch (order.status) {
      case ${statusName(target)}.Draft:
        return 'draft';
      case ${statusName(target)}.Active:
        return 'active';
      default:
        return order.kind === 'express' ? 'fast' : 'slow';
    }
  }

  rows(items: readonly ${aggregateName(target)}[]): Row${fileIndex}[] {
    return items.map((item, index) => ({ id: index + ${fileIndex}, label: LABELS${fileIndex}[index % LABELS${fileIndex}.length] ?? 'none', state: String(item.status) }));
  }

  remember(row: Row${fileIndex}): void {
    this.cache.set(row.id, { ...row, label: row.label.toUpperCase() });
  }

  promote(order: ${aggregateName(target)}): void {
    if (order.status === ${statusName(target)}.Active) order.expedite();
    const total = [1, 2, 3].reduce((sum, value) => sum + value * ${fileIndex}, 0);
    this.cache.delete(total);
  }
${fileIndex % 10 === 0 ? `
  shut(order: ${aggregateName(target)}): void {
    order.status = ${statusName(target)}.Closed;
  }
` : ''}}
`;

const dtoSource = () =>
  `${range(dtoMembers)
    .map((index) => `export type Dto${index} = { readonly kind: 'dto${index}'; readonly dto${index}Field: number; readonly dto${index}Name: string };`)
    .join('\n')}

export type AnyDto = ${range(dtoMembers)
    .map((index) => `Dto${index}`)
    .join(' | ')};
`;

const signalSource = () =>
  `${range(events)
    .map((index) => `export class Signal${index} {\n  constructor(readonly signal${index}Value: number) {}\n}`)
    .join('\n\n')}

export const emitAll = (): unknown[] => [${range(events)
    .map((index) => `new Signal${index}(${index})`)
    .join(', ')}];
`;

const listenerSource = (index) => `import { OnEvent } from '../shared/decorators';
import { AnyDto } from './dto';

export class Listener${index} {
  @OnEvent('topic.${index}')
  on(payload: AnyDto): AnyDto {
    return payload;
  }
}
`;

const isDeclared = (index) => index % 4 !== 3;

const configSource = () => {
  const imports = range(aggregates).filter(isDeclared).map((index) => `import { ${aggregateName(index)} } from './src/order${index}/order${index}';`);
  const signalImport = events > 0 ? [`import { ${range(events).map((index) => `Signal${index}`).join(', ')} } from './src/signals/signals';`] : [];
  const lifecycles = range(aggregates).filter(isDeclared).map(
    (index) =>
      `    lifecycle(${aggregateName(index)}, { states: { status: { terminal: ['closed'], transitions: { activate: { from: ['draft'] }, suspend: { from: ['active'] }, resume: { from: ['suspended'] }, close: { from: ['draft', 'active', 'suspended'] } } } } }),`,
  );
  const inProcess = events > 0 ? `, inProcess: [${range(events).map((index) => `Signal${index}`).join(', ')}]` : '';
  return `import { defineDomain, lifecycle } from 'domain-integrity';
${[...imports, ...signalImport].join('\n')}

export default defineDomain({
  events: { raiseMethods: ['addEvent']${inProcess} },
  lifecycles: [
${lifecycles.join('\n')}
  ],
});
`;
};

const MARKER = '.domain-integrity-bench';

const isReplaceable = (directory) =>
  !existsSync(directory) || readdirSync(directory).length === 0 || existsSync(join(directory, MARKER));

if (!isReplaceable(out)) {
  process.stderr.write(`refusing to replace ${out}: it is not empty and was not written by generate.mjs\n`);
  process.exit(2);
}

rmSync(out, { recursive: true, force: true });
write(MARKER, '');

write(
  'tsconfig.json',
  `${JSON.stringify({ compilerOptions: { target: 'ES2022', module: 'ESNext', moduleResolution: 'Bundler', strict: true, experimentalDecorators: true, skipLibCheck: true }, include: ['src'] }, null, 2)}\n`,
);
write(
  'src/shared/aggregate-root.ts',
  `export abstract class AggregateRoot {
  private readonly pending: unknown[] = [];

  protected addEvent(event: unknown): void {
    this.pending.push(event);
  }
}
`,
);
write('src/shared/decorators.ts', 'export const OnEvent = (...keys: unknown[]) => (target: unknown, key: string) => undefined;\n');

range(aggregates).forEach((index) => {
  write(`src/order${index}/order${index}.ts`, aggregateSource(index));
  write(`src/order${index}/order${index}.events.ts`, eventsSource(index));
  write(`src/order${index}/order${index}.handlers.ts`, handlerSource(index));
});

const serviceCount = Math.max(0, files - aggregates * 3 - 2);
range(serviceCount).forEach((index) => write(`src/services/service${index}.ts`, serviceSource(index, index % Math.max(aggregates, 1))));

if (events > 0) write('src/signals/signals.ts', signalSource());
if (dtoMembers > 0) write('src/signals/dto.ts', dtoSource());
range(sites).forEach((index) => write(`src/signals/listener${index}.ts`, listenerSource(index)));

write('domain.config.ts', configSource());
mkdirSync(join(out, 'node_modules'), { recursive: true });
symlinkSync(resolve(values.tool), join(out, 'node_modules', 'domain-integrity'));
