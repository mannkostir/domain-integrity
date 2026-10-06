import { ClassDeclaration, Decorator, MethodDeclaration, Node, SourceFile, SyntaxKind } from 'ts-morph';
import { readPayload } from '../payload';
import { decoratorName } from './decorator-name';
import { RawRegistration, RecognisedSite, RecogniserContext, RegistrationRecogniser, enclosingClass, resolveKeys } from './recogniser';

type Target = { readonly handler: ClassDeclaration | undefined; readonly method: MethodDeclaration | undefined; readonly methodName: string | undefined };

const handleMethodOf = (cls: ClassDeclaration): MethodDeclaration | undefined => {
  const handles = cls.getMethods().filter((method) => method.getName() === 'handle');
  return handles.length === 1 ? handles[0] : undefined;
};

const targetOf = (decorator: Decorator): Target | undefined => {
  const parent = decorator.getParent();
  if (Node.isClassDeclaration(parent)) {
    const handle = handleMethodOf(parent);
    return { handler: parent, method: handle, methodName: handle?.getName() };
  }
  if (Node.isMethodDeclaration(parent)) return { handler: enclosingClass(parent), method: parent, methodName: parent.getName() };
  return undefined;
};

const siteOf = (decorator: Decorator, context: RecogniserContext): RecognisedSite => {
  const target = targetOf(decorator);
  const keys = resolveKeys(
    decorator.getArguments().filter((argument) => !Node.isObjectLiteralExpression(argument)),
    context.isProject,
  );
  if (target === undefined || keys.kind === 'unresolved') return { kind: 'unresolved', node: decorator };
  const payload = readPayload(target.method?.getParameters()[0], context.isProject);
  const registrations: RawRegistration[] = keys.classes.map(({ cls, key }) => ({
    event: cls,
    key,
    handler: target.handler,
    method: target.methodName,
    payload,
    node: decorator,
  }));
  return { kind: 'resolved', node: decorator, registrations, libraryKeyed: keys.libraryKeyed };
};

export const decoratorRecogniser: RegistrationRecogniser = {
  sites: (file: SourceFile, context: RecogniserContext) =>
    file
      .getDescendantsOfKind(SyntaxKind.Decorator)
      .filter((decorator) => {
        const name = decoratorName(decorator);
        return name !== undefined && context.events.handlerDecorators.includes(name);
      })
      .map((decorator) => siteOf(decorator, context)),
};
