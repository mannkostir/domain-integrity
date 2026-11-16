import { ClassDeclaration, ClassExpression, Node, SourceFile, Symbol as MorphSymbol, SyntaxKind, Type } from 'ts-morph';
import { isDefaultLibraryNode, isLibraryNode } from '../../shared/library';
import { SourceIndex } from '../../shared/source-index';
import { outermostWrapper, unwrap } from '../../shared/wrappers';
import { isWritten } from '../../shared/writes';
import { referencedClass, refersTo, resolvedSymbol, simpleParameter } from './identity';
import { MAX_PROJECTION_DEPTH, ScalarProjection } from './model';

type ClassLike = ClassDeclaration | ClassExpression;
type Storage = 'holder' | 'slot';
type Path = { readonly part: 'instance' | Storage; readonly computed: boolean };
type Relation =
  | { readonly kind: 'unrelated' }
  | { readonly kind: 'related'; readonly relation: 'resolved' | 'unresolved-reference'; readonly evidence: Node }
  | { readonly kind: 'limited'; readonly reason: 'heritage-bound' | 'cyclic-heritage'; readonly evidence: Node };

export type DeclarationHazard =
  | {
      readonly kind: 'descendant';
      readonly node: ClassLike;
      readonly relation: 'resolved' | 'unresolved-reference';
      readonly evidence: Node;
      readonly reason: 'observed-descendant' | 'wrapper-referencing-heritage';
    }
  | {
      readonly kind: 'storage-write'; readonly node: Node; readonly storage: Storage;
      readonly reason: 'direct-write' | 'computed-storage-write' | 'reflective-storage-write';
    };

export type DeclarationHazardFacts = {
  readonly scope: 'wrapper-declarations-only';
  readonly files: readonly SourceFile[];
  readonly ancestry: readonly ClassDeclaration[];
  readonly hazards: readonly DeclarationHazard[];
  readonly limitations: readonly { readonly node: Node; readonly reason: string }[];
  readonly remaining: readonly [
    'member-and-factory-replacement', 'prototype-writes', 'opaque-heritage-and-aliases',
    'instance-and-storage-escapes', 'use-site-receiver-and-dispatch',
  ];
};

const MAX_HERITAGE_STEPS = 128;

const classForSymbol = (symbol: MorphSymbol | undefined): ClassLike | undefined => {
  const declarations = symbol?.getDeclarations() ?? [];
  const [only] = declarations;
  if (declarations.length !== 1 || only === undefined) return undefined;
  if (Node.isClassDeclaration(only) || Node.isClassExpression(only)) return only;
  const initializer = Node.isVariableDeclaration(only) ? only.getInitializer() : undefined;
  const value = initializer === undefined ? undefined : unwrap(initializer);
  return Node.isClassExpression(value) ? value : undefined;
};

const declarationSymbol = (expression: Node, depth = 0): MorphSymbol | undefined => {
  if (depth >= MAX_PROJECTION_DEPTH) return undefined;
  const node = unwrap(expression);
  if (Node.isIdentifier(node)) return resolvedSymbol(node);
  if (!Node.isPropertyAccessExpression(node) && !Node.isElementAccessExpression(node)) return undefined;
  const owner = declarationSymbol(node.getExpression(), depth + 1);
  const declarations = owner?.getDeclarations() ?? [];
  if (declarations.length === 0 || !declarations.every(declaration => Node.isSourceFile(declaration) || Node.isModuleDeclaration(declaration))) return undefined;
  const name = Node.isPropertyAccessExpression(node) ? node.getName() : literalKey(node.getArgumentExpression());
  const member = name === undefined ? undefined : owner?.getExports().find(symbol => symbol.getName() === name);
  return member?.getAliasedSymbol() ?? member;
};

const classReference = (expression: Node): ClassLike | undefined => {
  const node = unwrap(expression);
  if (Node.isClassExpression(node)) return isLibraryNode(node) ? undefined : node;
  return classForSymbol(declarationSymbol(node));
};

const relationTo = (
  cls: ClassLike, wrapper: ClassDeclaration, visited: ReadonlySet<ClassLike>, budget: { remaining: number },
): Relation => {
  if (cls === wrapper) return { kind: 'related', relation: 'resolved', evidence: cls };
  if (visited.has(cls)) return { kind: 'limited', reason: 'cyclic-heritage', evidence: cls };
  if (budget.remaining <= 0) return { kind: 'limited', reason: 'heritage-bound', evidence: cls };
  budget.remaining -= 1;
  const heritage = cls.getExtends();
  if (heritage === undefined) return { kind: 'unrelated' };
  const next = new Set([...visited, cls]);
  const base = classReference(heritage.getExpression());
  if (base !== undefined) return relationTo(base, wrapper, next, budget);
  let limited: Relation | undefined;
  for (const reference of [heritage, ...heritage.getDescendants()].filter(node =>
    Node.isIdentifier(node) || Node.isStringLiteral(node) || Node.isNoSubstitutionTemplateLiteral(node),
  )) {
    if (refersTo(reference, wrapper)) return { kind: 'related', relation: 'unresolved-reference', evidence: reference };
    const candidate = classForSymbol(resolvedSymbol(reference));
    if (candidate === undefined || candidate === cls) continue;
    const relation = relationTo(candidate, wrapper, next, budget);
    if (relation.kind === 'related') return { ...relation, relation: 'unresolved-reference' };
    if (relation.kind === 'limited') limited = relation;
  }
  return limited ?? { kind: 'unrelated' };
};

const acceptedAncestry = (projection: ScalarProjection): readonly ClassDeclaration[] => {
  const classes: ClassDeclaration[] = [];
  let current: ClassDeclaration | undefined = projection.wrapper;
  while (current !== undefined && !classes.includes(current) && classes.length < MAX_PROJECTION_DEPTH) {
    classes.push(current);
    const heritage = current.getExtends();
    current = heritage === undefined ? undefined : referencedClass(heritage.getExpression());
  }
  return classes;
};

const inAncestry = (node: Node, ancestry: readonly ClassDeclaration[]): boolean => {
  const owner = node.getFirstAncestor(ancestor => Node.isClassDeclaration(ancestor) || Node.isClassExpression(ancestor));
  return ancestry.some(cls => cls === owner);
};

const selectedInstanceType = (type: Type, projection: ScalarProjection, classes: readonly ClassDeclaration[]): boolean => {
  if (type.getConstructSignatures().length > 0) return false;
  const declarations = type.getSymbol()?.getDeclarations() ?? [];
  const holder = type.getProperty(projection.storage.holder.getName())?.getDeclarations() ?? [];
  return declarations.length === 1 && classes.some(cls => cls === declarations[0]) &&
    holder.length === 1 && holder[0] === projection.storage.holder;
};

const instanceThis = (node: Node, projection: ScalarProjection, ancestry: readonly ClassDeclaration[]): boolean => {
  const binder = node.getFirstAncestor(ancestor =>
    Node.isMethodDeclaration(ancestor) || Node.isConstructorDeclaration(ancestor) ||
    Node.isGetAccessorDeclaration(ancestor) || Node.isSetAccessorDeclaration(ancestor) ||
    Node.isPropertyDeclaration(ancestor) || Node.isFunctionDeclaration(ancestor) || Node.isFunctionExpression(ancestor) ||
    Node.isClassStaticBlockDeclaration(ancestor),
  );
  if (Node.isConstructorDeclaration(binder)) return ancestry.some(cls => cls === binder.getParent());
  if ((!Node.isMethodDeclaration(binder) && !Node.isGetAccessorDeclaration(binder) &&
      !Node.isSetAccessorDeclaration(binder) && !Node.isPropertyDeclaration(binder)) ||
      binder.isStatic() || !ancestry.some(cls => cls === binder.getParent())) return false;
  if (Node.isPropertyDeclaration(binder)) return true;
  const parameter = binder.getParameters().find(parameter => parameter.getName() === 'this');
  if (parameter === undefined) return true;
  const receiver = parameter.getType();
  if (!selectedInstanceType(receiver, projection, ancestry)) return false;
  if (projection.wrapper.getType().isAssignableTo(receiver)) return true;
  const owner = binder.getParent();
  if (receiver.isTypeParameter()) return receiver.getSymbol()?.getDeclarations()[0] === owner;
  const ownerType = owner.getType();
  return ownerType.isAssignableTo(receiver) && receiver.isAssignableTo(ownerType);
};

const instanceReceiver = (node: Node, projection: ScalarProjection, ancestry: readonly ClassDeclaration[]): boolean => {
  if (Node.isThisExpression(node)) return instanceThis(node, projection, ancestry);
  if (!Node.isIdentifier(node)) return false;
  return selectedInstanceType(node.getType(), projection, [projection.wrapper]);
};

const keyMatch = (node: Node, name: string): 'exact' | 'other' | 'possible' => {
  if (Node.isPropertyAccessExpression(node)) return node.getName() === name ? 'exact' : 'other';
  if (!Node.isElementAccessExpression(node)) return 'other';
  const argument = node.getArgumentExpression();
  const key = argument === undefined ? undefined : unwrap(argument);
  if (Node.isStringLiteral(key) || Node.isNoSubstitutionTemplateLiteral(key)) return key.getLiteralText() === name ? 'exact' : 'other';
  if (Node.isNumericLiteral(key)) return key.getText() === name ? 'exact' : 'other';
  return 'possible';
};

const storagePath = (expression: Node, projection: ScalarProjection, ancestry: readonly ClassDeclaration[]): Path | undefined => {
  const node = unwrap(expression);
  if (instanceReceiver(node, projection, ancestry)) return { part: 'instance', computed: false };
  if (!Node.isPropertyAccessExpression(node) && !Node.isElementAccessExpression(node)) return undefined;
  const receiver = unwrap(node.getExpression());
  if (instanceReceiver(receiver, projection, ancestry)) {
    const match = keyMatch(node, projection.storage.holder.getName());
    return match === 'other' ? undefined : { part: 'holder', computed: match === 'possible' };
  }
  if (!Node.isPropertyAccessExpression(receiver) && !Node.isElementAccessExpression(receiver)) return undefined;
  if (!instanceReceiver(unwrap(receiver.getExpression()), projection, ancestry)) return undefined;
  const holder = keyMatch(receiver, projection.storage.holder.getName());
  const slot = keyMatch(node, projection.storage.slotName);
  return holder === 'other' || slot === 'other' ? undefined : { part: 'slot', computed: holder === 'possible' || slot === 'possible' };
};

const writtenStoragePath = (node: Node, projection: ScalarProjection, ancestry: readonly ClassDeclaration[]): Path | undefined => {
  const path = storagePath(node, projection, ancestry);
  if (path !== undefined) return path;
  if (!Node.isPropertyAccessExpression(node) && !Node.isElementAccessExpression(node)) return undefined;
  const receiver = unwrap(node.getExpression());
  if (!Node.isSuperExpression(receiver) || !instanceThis(receiver, projection, ancestry)) return undefined;
  if (Node.isDeleteExpression(outermostWrapper(node).getParent())) return undefined;
  const match = keyMatch(node, projection.storage.holder.getName());
  return match === 'other' ? undefined : { part: 'holder', computed: match === 'possible' };
};

const provenInitialization = (projection: ScalarProjection): Node | undefined => {
  const owner = projection.storage.holder.getParent();
  if (!Node.isClassDeclaration(owner) || owner.getExtends() !== undefined) return undefined;
  const constructors = owner.getConstructors();
  const [constructor] = constructors;
  if (constructors.length !== 1 || constructor === undefined) return undefined;
  const parameter = simpleParameter(constructor.getParameters());
  const body = constructor.getBody();
  const statements = Node.isBlock(body) ? body.getStatements() : [];
  const [statement] = statements;
  if (parameter === undefined || statements.length !== 1 || !Node.isExpressionStatement(statement)) return undefined;
  const assignment = statement.getExpression();
  if (!Node.isBinaryExpression(assignment) || assignment.getOperatorToken().getKind() !== SyntaxKind.EqualsToken) return undefined;
  const left = assignment.getLeft();
  const right = assignment.getRight();
  return Node.isPropertyAccessExpression(left) && Node.isThisExpression(left.getExpression()) &&
    refersTo(left.getNameNode(), projection.storage.holder) && Node.isIdentifier(right) && refersTo(right, parameter) ? left : undefined;
};

const literalName = (node: Node): string | undefined =>
  Node.isIdentifier(node) ? node.getText() : Node.isStringLiteral(node) || Node.isNoSubstitutionTemplateLiteral(node) ? node.getLiteralText() : undefined;

const literalKey = (node: Node | undefined): string | undefined => {
  const key = node === undefined ? undefined : unwrap(node);
  return Node.isStringLiteral(key) || Node.isNoSubstitutionTemplateLiteral(key) ? key.getLiteralText()
    : Node.isNumericLiteral(key) ? key.getText() : undefined;
};

const mayCarryKey = (node: Node | undefined, name: string): boolean => {
  if (node === undefined) return true;
  const record = unwrap(node);
  if (!Node.isObjectLiteralExpression(record)) return true;
  return record.getProperties().some(property => {
    if (Node.isSpreadAssignment(property)) return true;
    const key = literalName(property.getNameNode());
    return key === undefined || key === name;
  });
};

const reflectiveOperation = (node: Node): { readonly owner: string; readonly name: string } | undefined => {
  if (!Node.isPropertyAccessExpression(node) && !Node.isElementAccessExpression(node)) return undefined;
  const owner = unwrap(node.getExpression());
  if (!Node.isIdentifier(owner) || !['Object', 'Reflect'].includes(owner.getText())) return undefined;
  const ownerDeclarations = resolvedSymbol(owner)?.getDeclarations() ?? [];
  if (ownerDeclarations.length === 0 || !ownerDeclarations.every(isDefaultLibraryNode)) return undefined;
  const name = Node.isPropertyAccessExpression(node) ? node.getName() : literalKey(node.getArgumentExpression());
  const declarations = name === undefined ? [] : owner.getType().getProperty(name)?.getDeclarations() ?? [];
  return name !== undefined && declarations.length > 0 && declarations.every(isDefaultLibraryNode)
    ? { owner: owner.getText(), name } : undefined;
};

const reflectiveWrites = (node: Node, projection: ScalarProjection, ancestry: readonly ClassDeclaration[]): readonly DeclarationHazard[] => {
  if (!Node.isCallExpression(node)) return [];
  const operation = reflectiveOperation(unwrap(node.getExpression()));
  if (operation === undefined) return [];
  const args = node.getArguments();
  const targets = operation.owner === 'Reflect' && operation.name === 'set' ? [args[0], args[3]] : [args[0]];
  const result: DeclarationHazard[] = [];
  for (const target of targets) {
    if (target === undefined) continue;
    const path = storagePath(target, projection, ancestry);
    if (path === undefined || path.part === 'slot') continue;
    const storage = path.part === 'instance' ? 'holder' : 'slot';
    const name = storage === 'holder' ? projection.storage.holder.getName() : projection.storage.slotName;
    let attributable = false;
    if (operation.owner === 'Object' && operation.name === 'assign') attributable = args.slice(1).some(source => mayCarryKey(source, name));
    if (operation.owner === 'Object' && operation.name === 'defineProperties') attributable = mayCarryKey(args[1], name);
    if ((operation.owner === 'Object' && operation.name === 'defineProperty') ||
        (operation.owner === 'Reflect' && ['set', 'deleteProperty', 'defineProperty'].includes(operation.name))) {
      const key = literalKey(args[1]);
      attributable = key === undefined || key === name;
    }
    if (attributable && !result.some(hazard => hazard.kind === 'storage-write' && hazard.storage === storage)) {
      result.push({ kind: 'storage-write', node, storage, reason: 'reflective-storage-write' });
    }
  }
  return result;
};

export const declarationHazards = (projection: ScalarProjection, sources: SourceIndex): DeclarationHazardFacts => {
  const ancestry = acceptedAncestry(projection);
  const hazards: DeclarationHazard[] = [];
  const limitations: { readonly node: Node; readonly reason: string }[] = [];
  if (!ancestry.some(cls => cls === projection.storage.holder.getParent())) {
    limitations.push({ node: projection.wrapper, reason: 'accepted-ancestry-unavailable' });
  }
  const classes = [...sources.ofKind(SyntaxKind.ClassDeclaration), ...sources.ofKind(SyntaxKind.ClassExpression)];
  for (const cls of classes) {
    if (cls === projection.wrapper || isLibraryNode(cls)) continue;
    const relation = relationTo(cls, projection.wrapper, new Set(), { remaining: MAX_HERITAGE_STEPS });
    if (relation.kind === 'related') hazards.push({
      kind: 'descendant', node: cls, relation: relation.relation, evidence: relation.evidence,
      reason: relation.relation === 'resolved' ? 'observed-descendant' : 'wrapper-referencing-heritage',
    });
    if (relation.kind === 'limited') limitations.push({ node: cls, reason: relation.reason });
  }
  const initialization = provenInitialization(projection);
  const inspected = new Set<Node>();
  for (const cls of ancestry) {
    for (const node of cls.getDescendants()) {
      if (inspected.has(node)) continue;
      inspected.add(node);
      if (!inAncestry(node, ancestry)) continue;
      if ((Node.isPropertyAccessExpression(node) || Node.isElementAccessExpression(node)) && node !== initialization && isWritten(outermostWrapper(node))) {
        const path = writtenStoragePath(node, projection, ancestry);
        if (path !== undefined && path.part !== 'instance') hazards.push({
          kind: 'storage-write', node, storage: path.part,
          reason: path.computed ? 'computed-storage-write' : 'direct-write',
        });
      }
      hazards.push(...reflectiveWrites(node, projection, ancestry));
    }
  }
  return {
    scope: 'wrapper-declarations-only', files: sources.files, ancestry, hazards, limitations,
    remaining: ['member-and-factory-replacement', 'prototype-writes', 'opaque-heritage-and-aliases', 'instance-and-storage-escapes', 'use-site-receiver-and-dispatch'],
  };
};
