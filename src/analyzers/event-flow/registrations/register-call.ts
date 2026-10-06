import { CallExpression, MethodDeclaration, Node, SourceFile, SyntaxKind } from 'ts-morph';
import { resolveKey } from '../keys';
import { RawPayload, readPayload } from '../payload';
import { RecognisedSite, RecogniserContext, RegistrationRecogniser, enclosingClass } from './recogniser';

type Callback = { readonly method: string | undefined; readonly payload: RawPayload };

const calledName = (call: CallExpression): string | undefined => {
  const callee = call.getExpression();
  if (Node.isIdentifier(callee)) return callee.getText();
  return Node.isPropertyAccessExpression(callee) ? callee.getName() : undefined;
};

const unbound = (expression: Node): Node => {
  if (!Node.isCallExpression(expression)) return expression;
  const callee = expression.getExpression();
  const [argument] = expression.getArguments();
  const bindsThis = expression.getArguments().length === 1 && argument !== undefined && Node.isThisExpression(argument);
  return Node.isPropertyAccessExpression(callee) && callee.getName() === 'bind' && bindsThis ? callee.getExpression() : expression;
};

const thisMethodName = (expression: Node): string | undefined => {
  const target = unbound(expression);
  return Node.isPropertyAccessExpression(target) && Node.isThisExpression(target.getExpression()) ? target.getName() : undefined;
};

const callbackOf = (expression: Node, call: CallExpression, context: RecogniserContext): Callback | undefined => {
  if (Node.isArrowFunction(expression) || Node.isFunctionExpression(expression)) {
    return { method: undefined, payload: readPayload(expression.getParameters()[0], context.isProject) };
  }
  const name = thisMethodName(expression);
  if (name === undefined) return undefined;
  const method: MethodDeclaration | undefined = enclosingClass(call)?.getMethod(name);
  return { method: name, payload: readPayload(method?.getParameters()[0], context.isProject) };
};

const siteOf = (call: CallExpression, context: RecogniserContext): RecognisedSite | undefined => {
  const [first, key] = call.getArguments();
  if (call.getArguments().length !== 2 || first === undefined || key === undefined) return undefined;
  const callback = callbackOf(first, call, context);
  if (callback === undefined) return undefined;
  const resolution = resolveKey(key, context.isProject);
  if (resolution.kind === 'foreign') return { kind: 'resolved', node: call, registrations: [], libraryKeyed: true };
  if (resolution.kind === 'unresolved') return { kind: 'unresolved', node: call };
  return {
    kind: 'resolved',
    node: call,
    libraryKeyed: false,
    registrations: [{ event: resolution.cls, key, handler: enclosingClass(call), method: callback.method, payload: callback.payload, node: call }],
  };
};

export const registerCallRecogniser: RegistrationRecogniser = {
  sites: (file: SourceFile, context: RecogniserContext) =>
    file
      .getDescendantsOfKind(SyntaxKind.CallExpression)
      .filter((call) => {
        const name = calledName(call);
        return name !== undefined && context.events.registerMethods.includes(name);
      })
      .flatMap((call) => {
        const site = siteOf(call, context);
        return site === undefined ? [] : [site];
      }),
};
