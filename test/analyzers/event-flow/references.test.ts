import { Node, SyntaxKind } from 'ts-morph';
import { describe, expect, it } from 'vitest';
import { ReferenceFacts, referenceFacts } from '../../../src/analyzers/event-flow/references';
import { inMemoryProject } from '../../helpers/in-memory';

const factsOf = (sources: Readonly<Record<string, string>>, keyText?: string): ReferenceFacts => {
  const project = inMemoryProject({ '/app/src/events.ts': 'export class Paid {}', ...sources });
  const analysed = new Set(project.getSourceFiles().filter((file) => file.getFilePath().startsWith('/app/')));
  const keys = new Set<Node>(
    keyText === undefined
      ? []
      : [...analysed].flatMap((file) => file.getDescendantsOfKind(SyntaxKind.CallExpression)).flatMap((call) => call.getArguments().filter((argument) => argument.getText() === keyText)),
  );
  const paid = project.getSourceFileOrThrow('/app/src/events.ts').getClassOrThrow('Paid');
  return referenceFacts(paid, { analysed, isTest: (file) => file.getFilePath().endsWith('.spec.ts'), keys });
};

const QUIET: ReferenceFacts = { constructions: [], subclassed: false, escaped: false, instanceofChecked: false, typedParameter: false, namedInString: false };

describe('referenceFacts', () => {
  it('records production constructions and ignores test ones', () => {
    expect(factsOf({
      '/app/src/pay.ts': "import { Paid } from './events';\nexport const pay = () => new Paid();",
      '/app/src/pay.spec.ts': "import { Paid } from './events';\nexport const fake = () => new Paid();",
    })).toEqual({ ...QUIET, constructions: [{ file: '/app/src/pay.ts', line: 2 }] });
  });

  it('treats registration keys, imports and plain type positions as quiet', () => {
    expect(factsOf({
      '/app/src/handler.ts': "import { Paid } from './events';\ndeclare const register: (...args: unknown[]) => void;\nregister(Paid.name);\nexport type Alias = Paid;",
    }, 'Paid.name')).toEqual(QUIET);
  });

  it('records a subclass, an instanceof check, a typed parameter and a string with the class name', () => {
    expect(factsOf({
      '/app/src/more.ts': "import { Paid } from './events';\nexport class Refined extends Paid {}\nexport const is = (value: unknown) => value instanceof Paid;\nexport const handle = (event: Paid | string) => event;\nexport const topic = 'Paid';",
    })).toEqual({ ...QUIET, subclassed: true, instanceofChecked: true, typedParameter: true, namedInString: true });
  });

  it('records any other value use as an escape', () => {
    expect([
      factsOf({ '/app/src/map.ts': "import { Paid } from './events';\nexport const factories = { Paid };" }).escaped,
      factsOf({ '/app/src/pass.ts': "import { Paid } from './events';\ndeclare const build: (type: unknown) => unknown;\nexport const built = build(Paid);" }).escaped,
      factsOf({ '/app/src/proto.ts': "import { Paid } from './events';\nexport const proto = Object.create(Paid.prototype);" }).escaped,
      factsOf({ '/app/src/mixin.ts': "import { Paid } from './events';\ndeclare const Mixin: <T>(base: T) => T;\nexport class Mixed extends Mixin(Paid) {}" }).escaped,
    ]).toEqual([true, true, true, true]);
  });

  it('records new this() inside the class as an escape', () => {
    const project = inMemoryProject({ '/app/src/events.ts': 'export class Paid { static make() { return new this(); } }' });
    const paid = project.getSourceFileOrThrow('/app/src/events.ts').getClassOrThrow('Paid');

    const facts = referenceFacts(paid, { analysed: new Set(project.getSourceFiles()), isTest: () => false, keys: new Set() });

    expect([facts.escaped, facts.constructions]).toEqual([true, []]);
  });

  it('records instantiation expressions as escapes', () => {
    const generic = '/app/src/events.ts';
    const source = 'export class Paid<T = unknown> {}';
    expect([
      factsOf({ [generic]: source, '/app/src/inst.ts': "import { Paid } from './events';\nexport const F = Paid<string>;" }).escaped,
      factsOf({ [generic]: source, '/app/src/inst.ts': "import { Paid } from './events';\ndeclare const build: (t: unknown) => unknown;\nexport const b = build(Paid<string>);" }).escaped,
    ]).toEqual([true, true]);
  });

  it('treats an interface extending the class as a quiet type position', () => {
    expect(factsOf({ '/app/src/shape.ts': "import { Paid } from './events';\nexport interface Shape extends Paid {}" })).toEqual(QUIET);
  });

  it('ignores references outside the analysed files', () => {
    expect(factsOf({ '/elsewhere/use.ts': "import { Paid } from '../app/src/events';\nexport const factories = { Paid };" })).toEqual(QUIET);
  });
});
