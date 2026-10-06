import { CallExpression, MethodDeclaration, Node, SourceFile, SyntaxKind } from 'ts-morph';
import { KeyResolution, resolveKey } from '../keys';
import { RawPayload, readPayload } from '../payload';
import { RecognisedSite, RecogniserContext, RegistrationRecogniser, enclosingClass } from './recogniser';

type Callback = { readonly method: string | undefined; readonly payload: RawPayload };
type ProjectKey = Extract<KeyResolution, { readonly kind: 'project' }>;
type Argument = { readonly node: Node; readonly resolution: KeyResolution };

const calledName = (call: CallExpression): string | undefined => {
  const callee = call.getExpression();
  if (Node.isIdentifier(callee)) return callee.getText();
  return Node.isPropertyAccessExpression(callee) ? callee.getName() : undefined;
};

const unbound = (expression: Node): Node => {
  if (!Node.isCallExpression(expression)) return expression;
  const callee = expression.getExpression();
  return Node.isPropertyAccessExpression(callee) && callee.getName() === 'bind' ? callee.getExpression() : expression;
};

const thisMethodName = (expression: Node): string | undefined => {
  const target = unbound(expression);
  return Node.isPropertyAccessExpression(target) && Node.isThisExpression(target.getExpression()) ? target.getName() : undefined;
};

const callbackOf = (expression: Node, call: CallExpression, context: RecogniserContext): Callback => {
  if (Node.isArrowFunction(expression) || Node.isFunctionExpression(expression)) {
    return { method: undefined, payload: readPayload(expression.getParameters()[0], context.isProject) };
  }
  const name = thisMethodName(expression);
  const method: MethodDeclaration | undefined = name === undefined ? undefined : enclosingClass(call)?.getMethod(name);
  return { method: name, payload: readPayload(method?.getParameters()[0], context.isProject) };
};

const isProjectKey = (argument: Argument): argument is { readonly node: Node; readonly resolution: ProjectKey } =>
  argument.resolution.kind === 'project';

const resolvedSite = (call: CallExpression, key: Argument & { readonly resolution: ProjectKey }, callbackNode: Node, context: RecogniserContext): RecognisedSite => {
  const callback = callbackOf(callbackNode, call, context);
  return {
    kind: 'resolved',
    registrations: [
      { event: key.resolution.cls, key: key.node, handler: enclosingClass(call), method: callback.method, payload: callback.payload, node: call },
    ],
  };
};

const siteOf = (call: CallExpression, context: RecogniserContext): RecognisedSite | undefined => {
  const unresolved: RecognisedSite = { kind: 'unresolved', node: call };
  const args = call.getArguments().map((node) => ({ node, resolution: resolveKey(node, context.isProject) }));
  if (args.length !== 2) return unresolved;
  const projectKeys = args.filter(isProjectKey);
  const foreignCount = args.filter((argument) => argument.resolution.kind === 'foreign').length;
  if (projectKeys.length === 0 && foreignCount === 1) return undefined;
  const [key] = projectKeys;
  if (projectKeys.length !== 1 || key === undefined) return unresolved;
  const callback = args.find((argument) => argument !== key);
  return callback === undefined ? unresolved : resolvedSite(call, key, callback.node, context);
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
