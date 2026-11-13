import { ClassDeclaration, GetAccessorDeclaration, Node, Type } from 'ts-morph';
import { isLibraryNode } from '../../shared/library';
import { enumDomain } from './enum-domain';
import { proveConstruction } from './construction';
import { MAX_PROJECTION_DEPTH, ProjectionProof, ScalarProjection } from './model';
import { referencedClass } from './identity';

const unsupported = (reason: string): ProjectionProof => ({ kind: 'unsupported', reason });

const classChain = (cls: ClassDeclaration): readonly ClassDeclaration[] | undefined => {
  const chain: ClassDeclaration[] = [];
  let current: ClassDeclaration | undefined = cls;
  while (current !== undefined) {
    if (chain.length >= MAX_PROJECTION_DEPTH || chain.includes(current) || isLibraryNode(current)) return undefined;
    chain.push(current);
    const base = current.getExtends();
    if (base === undefined) return chain;
    current = referencedClass(base.getExpression());
    if (current === undefined) return undefined;
  }
  return chain;
};

const hasDecoratedParameters = (member: Node): boolean =>
  (Node.isConstructorDeclaration(member) || Node.isMethodDeclaration(member) ||
    Node.isGetAccessorDeclaration(member) || Node.isSetAccessorDeclaration(member)) &&
  member.getParameters().some(parameter => parameter.getDecorators().length > 0);

const inertConstructionMembers = (chain: readonly ClassDeclaration[]): boolean => chain.every(cls =>
  cls.getDecorators().length === 0 && cls.getMembers().every(member => {
    if (Node.isClassStaticBlockDeclaration(member) || Node.isIndexSignatureDeclaration(member) || hasDecoratedParameters(member)) return false;
    if (Node.isConstructorDeclaration(member)) return true;
    return Node.isIdentifier(member.getNameNode()) && member.getDecorators().length === 0 &&
      (!Node.isPropertyDeclaration(member) || member.getInitializer() === undefined);
  }),
);

const scalarGetters = (type: Type, wrapper: ClassDeclaration): readonly GetAccessorDeclaration[] => type.getProperties().flatMap(property => {
  const getters = property.getDeclarations().filter(Node.isGetAccessorDeclaration);
  return getters.length > 0 && enumDomain(property.getTypeAtLocation(wrapper)) !== undefined ? getters : [];
});

const getterStorage = (getter: GetAccessorDeclaration, wrapper: ClassDeclaration, chain: readonly ClassDeclaration[]): ScalarProjection['storage'] | undefined => {
  const body = getter.getBody();
  const statements = Node.isBlock(body) ? body.getStatements() : [];
  const [only] = statements;
  if (statements.length !== 1 || !Node.isReturnStatement(only)) return undefined;
  const scalar = only.getExpression();
  if (!Node.isPropertyAccessExpression(scalar) || scalar.hasQuestionDotToken()) return undefined;
  const record = scalar.getExpression();
  if (!Node.isPropertyAccessExpression(record) || record.hasQuestionDotToken() || !Node.isThisExpression(record.getExpression())) return undefined;
  const holderSymbol = record.getNameNode().getSymbol();
  const holderDeclarations = holderSymbol?.getDeclarations() ?? [];
  const [holder] = holderDeclarations;
  if (holderDeclarations.length !== 1 || !Node.isPropertyDeclaration(holder) || holder.isStatic() ||
      !chain.includes(holder.getParent() as ClassDeclaration) || holder.getInitializer() !== undefined || holder.getName() === '__proto__') return undefined;
  const concrete = wrapper.getType().getProperty(holder.getName());
  const concreteDeclarations = concrete?.getDeclarations() ?? [];
  if (concreteDeclarations.length !== 1 || concreteDeclarations[0] !== holder) return undefined;
  const slot = scalar.getNameNode().getSymbol();
  const declarations = slot?.getDeclarations() ?? [];
  if (slot === undefined || declarations.length !== 1 || declarations.some(isLibraryNode) ||
      !declarations.every(node => Node.isPropertySignature(node) || Node.isPropertyDeclaration(node))) return undefined;
  const scalarDomain = enumDomain(scalar.getType());
  const getterType = wrapper.getType().getProperty(getter.getName())?.getTypeAtLocation(wrapper);
  const getterDomain = getterType === undefined ? undefined : enumDomain(getterType);
  return scalarDomain !== undefined && scalarDomain.declaration === getterDomain?.declaration
    ? { holder, slot, slotName: scalar.getName() } : undefined;
};

export const proveScalarProjection = (type: Type): ProjectionProof => {
  if (type.isUnion() || type.isIntersection() || !type.isObject()) return unsupported('not a concrete project class');
  const declarations = type.getSymbol()?.getDeclarations() ?? [];
  const [wrapper] = declarations;
  if (declarations.length !== 1 || !Node.isClassDeclaration(wrapper) || wrapper.isAbstract()) return unsupported('not a concrete project class');
  const chain = classChain(wrapper);
  if (chain === undefined || !inertConstructionMembers(chain)) return unsupported('unproved class construction');
  const getters = scalarGetters(type, wrapper);
  const [getter] = getters;
  if (getters.length !== 1 || getter === undefined || !chain.includes(getter.getParent() as ClassDeclaration) ||
      getter.getParameters().length > 0 || chain.some(cls => cls.getSetAccessor(getter.getName()) !== undefined) ||
      chain.filter(cls => cls.getGetAccessor(getter.getName()) !== undefined).length !== 1) return unsupported('no unique finite enum getter');
  const getterType = type.getProperty(getter.getName())?.getTypeAtLocation(wrapper);
  const domain = getterType === undefined ? undefined : enumDomain(getterType);
  const storage = getterStorage(getter, wrapper, chain);
  if (domain === undefined || storage === undefined) return unsupported('unproved scalar getter storage');
  const construction = proveConstruction(chain, storage.holder, storage.slotName, domain.declaration);
  if (construction === undefined || enumDomain(construction.parameter.getType())?.declaration !== domain.declaration) {
    return unsupported('unproved fresh scalar constructor mapping');
  }
  return {
    kind: 'proven',
    projection: {
      scope: 'local-construction-and-getter',
      requires: ['observable-mutation-and-escape-analysis', 'dispatch-invalidation'],
      wrapper, getter, storage, enumDeclaration: domain.declaration, values: domain.values, construction,
    },
  };
};
