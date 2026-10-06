import { CallExpression, Decorator, Node, SourceFile, SyntaxKind } from 'ts-morph';
import { RecognisedSite, RecogniserContext, RegistrationRecogniser, enclosingClass, resolveKeys } from './recogniser';

const ofTypeCalls = (node: Node): readonly CallExpression[] =>
  node.getDescendantsOfKind(SyntaxKind.CallExpression).filter((call) => call.getExpression().getText() === 'ofType');

const siteOf = (decorator: Decorator, context: RecogniserContext): RecognisedSite | undefined => {
  const unresolved: RecognisedSite = { kind: 'unresolved', node: decorator };
  const property = decorator.getParent();
  const handler = enclosingClass(decorator);
  if (!Node.isPropertyDeclaration(property) || handler === undefined) return unresolved;
  const initializer = property.getInitializer();
  const calls = initializer === undefined ? [] : ofTypeCalls(initializer);
  if (calls.length === 0) return unresolved;
  const keys = resolveKeys(calls.flatMap((call) => call.getArguments()), context.isProject);
  if (keys.kind === 'unresolved') return unresolved;
  if (keys.classes.length === 0) return undefined;
  return {
    kind: 'resolved',
    registrations: keys.classes.map(({ cls, key }) => ({
      event: cls,
      key,
      handler,
      method: property.getName(),
      payload: { kind: 'unreadable' },
      node: decorator,
    })),
  };
};

export const sagaStreamRecogniser: RegistrationRecogniser = {
  sites: (file: SourceFile, context: RecogniserContext) =>
    file
      .getDescendantsOfKind(SyntaxKind.Decorator)
      .filter((decorator) => decorator.getName() === 'Saga')
      .flatMap((decorator) => {
        const site = siteOf(decorator, context);
        return site === undefined ? [] : [site];
      }),
};
