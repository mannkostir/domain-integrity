import { describe, expect, it } from 'vitest';
import { sagaStreamRecogniser } from '../../../src/analyzers/event-flow/registrations/saga-stream';
import { recognise } from './recognise';

const run = (body: string) =>
  recognise(sagaStreamRecogniser, {
    '/src/events.ts': 'export class Paid {}\nexport class Failed {}\nexport const Saga = () => (target: unknown, key: string) => undefined;\nexport const ofType = (...types: unknown[]) => types;\nexport type Stream = { pipe: (...operators: unknown[]) => unknown };',
    '/src/saga.ts': `import { Paid, Failed, Saga, ofType, Stream } from './events';\ndeclare const dynamicType: unknown; declare const deco: ((target: unknown, key: string) => undefined)[]; declare const curry: () => () => (target: unknown, key: string) => undefined;\n${body}`,
  });

describe('sagaStreamRecogniser', () => {
  it('reads every ofType argument of a saga property', () => {
    expect(run('export class OrderSaga { @Saga() captured = (events$: Stream) => events$.pipe(ofType(Paid, Failed)); }')).toEqual([
      'Paid -> OrderSaga.captured (?), Failed -> OrderSaga.captured (?)',
    ]);
  });

  it('marks a saga without ofType, with an unresolvable ofType argument, or on a method unresolved', () => {
    expect(
      run(
        'export class A { @Saga() all = (events$: Stream) => events$.pipe(); }\nexport class B { @Saga() some = (events$: Stream) => events$.pipe(ofType(dynamicType)); }\nexport class C { @Saga() method(events$: Stream) { return events$.pipe(ofType(Paid)); } }',
      ),
    ).toEqual(['unresolved@3', 'unresolved@4', 'unresolved@5']);
  });

  it('reads no site from a decorator whose name cannot be read, without crashing', () => {
    expect(
      run('export class A { @(deco[0]!) all = (events$: Stream) => events$.pipe(ofType(Paid)); }\nexport class B { @curry()() some = (events$: Stream) => events$.pipe(ofType(Paid)); }'),
    ).toEqual([]);
  });
});
