import { ArrayLiteralExpression, MethodDeclaration, Node, SourceFile, SyntaxKind } from 'ts-morph';
import { RecognisedSite, RecogniserContext, RegistrationRecogniser, enclosingClass, resolveKeys } from './recogniser';

const returnedArray = (method: MethodDeclaration): ArrayLiteralExpression | undefined => {
  const statements = method.getStatements();
  const [statement] = statements;
  if (statements.length !== 1 || !Node.isReturnStatement(statement)) return undefined;
  const expression = statement.getExpression();
  return Node.isArrayLiteralExpression(expression) ? expression : undefined;
};

const siteOf = (method: MethodDeclaration, context: RecogniserContext): RecognisedSite => {
  const array = returnedArray(method);
  const handler = enclosingClass(method);
  if (array === undefined || handler === undefined) return { kind: 'unresolved', node: method };
  const keys = resolveKeys(array.getElements(), context.isProject);
  if (keys.kind === 'unresolved') return { kind: 'unresolved', node: method };
  return {
    kind: 'resolved',
    node: method,
    libraryKeyed: keys.libraryKeyed,
    registrations: keys.classes.map(({ cls, key }) => ({ event: cls, key, handler, method: undefined, payload: { kind: 'unreadable' }, node: method })),
  };
};

export const subscribedToRecogniser: RegistrationRecogniser = {
  sites: (file: SourceFile, context: RecogniserContext) =>
    file
      .getDescendantsOfKind(SyntaxKind.MethodDeclaration)
      .filter((method) => method.getName() === 'subscribedTo')
      .map((method) => siteOf(method, context)),
};
