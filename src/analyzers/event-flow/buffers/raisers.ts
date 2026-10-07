import { CallExpression, ClassDeclaration, MethodDeclaration, Node, SourceFile } from 'ts-morph';
import { ProjectClasses } from '../keys';
import { BufferCandidate } from './drains';

const invokingCall = (reference: Node): CallExpression | undefined => {
  const access = reference.getParent();
  if (!Node.isPropertyAccessExpression(access) || access.getNameNode() !== reference) return undefined;
  const call = access.getParent();
  return Node.isCallExpression(call) && call.getExpression() === access ? call : undefined;
};

const callsOnlyPushers = (reference: Node, pushers: readonly MethodDeclaration[]): boolean => {
  const declarations = reference.getSymbol()?.getDeclarations() ?? [];
  return declarations.length > 0 && declarations.every((declaration) => pushers.some((pusher) => pusher === declaration));
};

const receiverClass = (call: CallExpression, isProject: ProjectClasses): ClassDeclaration | undefined => {
  const access = call.getExpression();
  if (!Node.isPropertyAccessExpression(access)) return undefined;
  const receiver = access.getExpression();
  if (Node.isThisExpression(receiver) || Node.isSuperExpression(receiver)) return undefined;
  return (receiver.getType().getSymbol()?.getDeclarations() ?? []).filter(Node.isClassDeclaration).find(isProject);
};

const raiserOf = (call: CallExpression, isProject: ProjectClasses): ClassDeclaration | undefined =>
  receiverClass(call, isProject) ?? call.getFirstAncestor(Node.isClassDeclaration);

const raisingCalls = (pusher: MethodDeclaration, candidate: BufferCandidate, production: ReadonlySet<SourceFile>): readonly CallExpression[] =>
  pusher
    .findReferencesAsNodes()
    .filter((reference) => production.has(reference.getSourceFile()) && callsOnlyPushers(reference, candidate.pushers))
    .flatMap((reference) => invokingCall(reference) ?? []);

export const raisingClasses = (
  candidate: BufferCandidate,
  production: readonly SourceFile[],
  isProject: ProjectClasses,
): readonly ClassDeclaration[] => {
  const files: ReadonlySet<SourceFile> = new Set(production);
  const classes = candidate.pushers
    .flatMap((pusher) => raisingCalls(pusher, candidate, files))
    .flatMap((call) => raiserOf(call, isProject) ?? [])
    .filter(isProject);
  return [...new Set(classes)];
};
