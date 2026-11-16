import { SyntaxKind } from 'ts-morph';
import { isPlainDataPathFromThis, isTrackedDataDestination } from '../../../src/analyzers/lifecycle/state-assignment';
import { describe, expect, it } from 'vitest';
import { lifecycleAnalyzer } from '../../../src/analyzers/lifecycle/analyzer';
import { DEFAULT_DECLARATION } from '../../../src/engine/declaration';
import { defaultScope, describeAssigned, describeSources } from '../../helpers/describe';
import { inMemoryProject } from '../../helpers/in-memory';

const modelOf = (body: string, options: { inherited?: boolean; bracket?: boolean; declared?: boolean; initial?: string; baseInitial?: string; setter?: string; runtime?: string; typescript?: boolean } = {}) => {
  const access = options.bracket ? "['closed']" : '.closed';
  const initial = options.initial ?? 'false';
  const base = options.inherited
    ? `class Base { ${options.typescript ? 'closed: boolean; label: string;' : ''} constructor(closed = false, label = '') { this${access} = ${options.baseInitial ?? 'false'}; this.label = label; } }`
    : 'class Base {}';
  const source = `${base}
    export class Order extends Base {
      ${options.typescript && !options.inherited ? 'closed: boolean; label: string;' : ''}
      constructor(closed = false, label = '') { ${options.inherited ? 'super(closed, label);' : 'super();'} ${options.inherited && options.initial === undefined ? '' : `this${access} = ${initial};`} ${options.inherited ? '' : 'this.label = label;'} }
      ${options.setter === undefined ? '' : `get state() { return this.closed; } set state(value${options.typescript ? ': boolean' : ''}) { ${options.setter} }`}
      close() { this${access} = true; }
      rename(label = '') { ${body} }
    }`;
  const path = options.typescript ? '/src/order.ts' : '/src/order.js';
  const project = inMemoryProject({ [path]: source, ...(options.runtime ? { '/src/runtime.js': options.runtime } : {}) }, { allowJs: true, checkJs: true, noEmit: true });
  const diagnostics = project.getPreEmitDiagnostics();
  if (diagnostics.length > 0) throw new Error(project.formatDiagnosticsWithColorAndContext(diagnostics));
  const cls = project.getSourceFileOrThrow(path).getClassOrThrow('Order');
  return lifecycleAnalyzer.extract({
    declaration: { ...DEFAULT_DECLARATION, aggregateBaseClasses: ['Base'], lifecycles: options.declared === false ? [] : [{ target: cls, fields: [{ name: 'closed', terminal: ['true'], transitions: new Map(), allowAfterTerminal: [] }], allowAfterTerminal: [] }] },
    files: project.getSourceFiles().filter(file => file.getFilePath().startsWith('/src/')),
    projectRoot: '/', repositoryRoot: '/',
  });
};

const renameSources = (model: ReturnType<typeof modelOf>) => describeSources(model.aggregates[0]!.methods.find(method => method.name === 'rename')!.fields.get('closed')!.sources);
const leaks = (model: ReturnType<typeof modelOf>) => lifecycleAnalyzer.check(model).filter(finding => finding.ruleId === 'terminal-state-leak').map(finding => finding.details.method);

describe('JavaScript constructor data integration', () => {
  for (const inherited of [false, true]) {
    for (const bracket of [false, true]) {
      for (const preceding of ['', 'const previous = this.label;', "this.label = 'before';"]) {
        for (const guarded of [false, true]) {
          const body = `${preceding} ${guarded ? 'if (this.closed) return;' : ''} this.label = label;`;
          const options = { inherited, bracket };
          it(`matches TypeScript sources for ${JSON.stringify({ ...options, preceding, guarded })}`, () => {
            const model = modelOf(body, options);
            const twin = modelOf(body, { ...options, typescript: true });

            expect(renameSources(model)).toEqual(renameSources(twin));
          });
          it(`matches TypeScript findings for ${JSON.stringify({ ...options, preceding, guarded })}`, () => {
            const model = modelOf(body, options);
            const twin = modelOf(body, { ...options, typescript: true });

            expect(leaks(model)).toEqual(leaks(twin));
          });
        }
      }
      it(`discovers constructor state for ${JSON.stringify({ inherited, bracket })}`, () => {
        const model = modelOf('if (this.closed) return; this.label = label;', { inherited, bracket, declared: false });

        expect(model.aggregates[0]!.fields.map(field => field.name)).toEqual(['closed']);
      });
      it(`retains false construction evidence for ${JSON.stringify({ inherited, bracket })}`, () => {
        const model = modelOf('this.label = label;', { inherited, bracket });

        expect(describeAssigned(model.aggregates[0]!.initial.get('closed')!)).toEqual({ tokens: ['false'], unresolved: false, mayWrite: false });
      });
    }
  }

  it('does not replace a supplied Boolean parameter with its false default', () => {
    const model = modelOf('this.label = label;', { initial: 'closed' });

    expect(describeAssigned(model.aggregates[0]!.initial.get('closed')!)).toEqual({ tokens: [], unresolved: true, mayWrite: false });
  });

  it('retains unresolved inherited stores before a derived literal store', () => {
    const model = modelOf('this.label = label;', { inherited: true, baseInitial: 'closed', initial: 'false' });

    expect(describeAssigned(model.aggregates[0]!.initial.get('closed')!)).toEqual({ tokens: ['false'], unresolved: true, mayWrite: false });
  });

  it('retains unknown inherited initialization when runtime interference blocks descriptor proof', () => {
    const model = modelOf('this.label = label;', { inherited: true, baseInitial: 'closed', initial: 'false', runtime: 'export const reflect = Reflect;' });

    expect(describeAssigned(model.aggregates[0]!.initial.get('closed')!)).toEqual({ tokens: ['false'], unresolved: true, mayWrite: false });
  });

  for (const [name, body, expected] of [
    ['guard before overwrite', 'if (this.closed) return; this.closed = true;', ['false']],
    ['guard after overwrite', 'this.closed = true; if (this.closed) return;', ['false', 'true']],
    ['read before overwrite', 'const before = this.closed; this.closed = true;', 'unknown'],
    ['compound write', 'this.closed &&= true; this.label = label;', 'unknown'],
  ] as const) {
    it(`preserves ${name}`, () => {
      const model = modelOf(body);

      expect(renameSources(model)).toEqual(expected);
    });
  }

  for (const [name, setter, expected] of [
    ['transparent', 'this.closed = value;', ['false']],
    ['effectful', "this.label = ''; this.closed = value;", 'unknown'],
  ] as const) {
    it(`retains ${name} setter entry sources`, () => {
      const model = modelOf('if (this.closed) return; this.state = true;', { setter });

      expect(renameSources(model)).toEqual(expected);
    });
  }

  it('maps a transparent setter argument to the backing field', () => {
    const model = modelOf('if (this.closed) return; this.state = true;', { setter: 'this.closed = value;' });

    expect(describeAssigned(model.aggregates[0]!.methods.find(method => method.name === 'rename')!.fields.get('closed')!.sets)).toEqual({ tokens: ['true'], unresolved: false, mayWrite: false });
  });

  for (const runtime of ['export const reflect = Reflect;', "import { Order } from './order.js'; export const escape = [Order];"]) {
    it(`keeps runtime interference unknown: ${runtime}`, () => {
      const model = modelOf('this.label = label;', { runtime });

      expect(renameSources(model)).toEqual('unknown');
    });
  }
});

const destinationOf = (implementation: string) => {
  const project = inMemoryProject({ '/slot.js': `class Base { constructor() { this.closed = false; } }
    class Order extends Base { ${implementation} }` }, { allowJs: true, noEmit: true });
  const cls = project.getSourceFileOrThrow('/slot.js').getClassOrThrow('Order');
  const scope = defaultScope(cls);
  const assignment = cls.getDescendantsOfKind(SyntaxKind.BinaryExpression)[0]!;
  return { cls, scope, target: assignment.getLeft() };
};

describe('JavaScript destination identity', () => {
  for (const key of ['.closed', "['closed']"]) {
    it(`admits the actual inherited this slot ${key}`, () => {
      const { cls, scope, target } = destinationOf(`write() { this${key} = true; }`);

      expect(isTrackedDataDestination(target, 'closed', cls, scope.javascriptData)).toBe(true);
    });
  }

  for (const implementation of [
    'static write() { this.closed = true; }',
    'write() { function foreign() { this.closed = true; } }',
    'write() { super.closed = true; }',
    'write() { this.props.closed = true; }',
    'write() { other.closed = true; }',
    'write() { this.#closed = true; }',
  ]) {
    it(`withholds JS destination permission from ${implementation}`, () => {
      const { cls, scope, target } = destinationOf(implementation);

      expect(isTrackedDataDestination(target, 'closed', cls, scope.javascriptData)).toBe(false);
    });
  }

  it('does not admit a nested path through the proven direct slot', () => {
    const { cls, scope, target } = destinationOf('write() { this.closed.value = true; }');

    expect(isPlainDataPathFromThis(target, cls, scope.javascriptData)).toBe(false);
  });

  it('keeps a Boolean update unknown even when JavaScript checking is disabled', () => {
    const project = inMemoryProject({ '/slot.js': `class Base {} class Order extends Base {
      constructor() { super(); this.closed = false; this.label = ''; }
      rename() { this.closed++; this.label = ''; }
    }` }, { allowJs: true, checkJs: false, noEmit: true });
    const file = project.getSourceFileOrThrow('/slot.js');
    const cls = file.getClassOrThrow('Order');
    const model = lifecycleAnalyzer.extract({ files: [file], declaration: { ...DEFAULT_DECLARATION, lifecycles: [{ target: cls, fields: [{ name: 'closed', terminal: ['true'], transitions: new Map(), allowAfterTerminal: [] }], allowAfterTerminal: [] }] }, projectRoot: '/', repositoryRoot: '/' });

    expect(renameSources(model)).toBe('unknown');
  });
});

describe('JavaScript data is not callback purity', () => {
  for (const invocation of [
    'this.callback()', "this['callback']()", '(this.callback)()', 'this.callback`value`',
    'new this.callback()', 'this.callback.call()', 'const value = this.callback.value', 'this.callback.run()',
    "'' + this.callback", '+this.callback', '`${this.callback}`', 'if (this.callback == true) return',
  ]) {
    it(`keeps supplied callback invocation unknown: ${invocation}`, () => {
      const project = inMemoryProject({ '/callback.js': `class Base {} class Order extends Base {
        constructor(callback) { super(); this.closed = false; this.callback = callback; }
        rename() { ${invocation}; }
      }` }, { allowJs: true, checkJs: true, noImplicitAny: false, noEmit: true });
      const file = project.getSourceFileOrThrow('/callback.js');
      const cls = file.getClassOrThrow('Order');
      const diagnostics = project.getPreEmitDiagnostics();
      if (diagnostics.length > 0) throw new Error(project.formatDiagnosticsWithColorAndContext(diagnostics));
      const model = lifecycleAnalyzer.extract({ files: [file], declaration: { ...DEFAULT_DECLARATION, lifecycles: [{ target: cls, fields: [{ name: 'closed', terminal: ['true'], transitions: new Map(), allowAfterTerminal: [] }], allowAfterTerminal: [] }] }, projectRoot: '/', repositoryRoot: '/' });

      expect(renameSources(model)).toBe('unknown');
    });
  }
});
