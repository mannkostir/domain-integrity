import { CallExpression, ClassDeclaration, ClassExpression, ElementAccessExpression, MethodDeclaration, Node, PropertyAccessExpression, PropertyDeclaration, Symbol, SyntaxKind, Type, ts } from 'ts-morph';
import { sourceDeclaration } from '../../engine/source-declaration';
import { isDefaultLibraryNode } from './library';
import { SourceIndex } from './source-index';
import { ConditionalCopies } from './conditional-copies';
import { MemberAssignment, destructuringRoot, isWritten, keyNames, memberAssignments } from './writes';
import { outermostWrapper, unwrap } from './wrappers';

type ClassOwner = ClassDeclaration | ClassExpression;
type ProtocolMember = MethodDeclaration | PropertyDeclaration;
export type MutationEvidence = 'none' | 'conditional-copy' | 'unresolved-delegate' | 'other';

export const mergedMutationEvidence = (evidence: readonly MutationEvidence[]): MutationEvidence =>
  evidence.includes('other') ? 'other' : evidence.includes('unresolved-delegate') ? 'unresolved-delegate' : evidence.includes('conditional-copy') ? 'conditional-copy' : 'none';

type Access = PropertyAccessExpression | ElementAccessExpression;

const classesOf = (type: Type): readonly ClassOwner[] =>
  (type.getSymbol()?.getDeclarations() ?? []).filter((node): node is ClassOwner =>
    Node.isClassDeclaration(node) || Node.isClassExpression(node),
  );

const symbolOf = (node: Node): Symbol | undefined => {
  const parent = node.getParent();
  const symbol = Node.isShorthandPropertyAssignment(parent) && parent.getNameNode() === node
    ? node.getProject().getTypeChecker().getShorthandAssignmentValueSymbol(parent) : node.getSymbol();
  return symbol?.isAlias() ? symbol.getAliasedSymbol() : symbol;
};

const sourceOfWrite = (node: Node): Node | undefined => {
  const target = outermostWrapper(node);
  const root = destructuringRoot(target);
  const parent = root.getParent();
  return root === target && Node.isBinaryExpression(parent) && parent.getLeft() === root &&
    parent.getOperatorToken().getKind() === SyntaxKind.EqualsToken ? parent.getRight() : undefined;
};

const mayAssignName = (source: Node, name: string): boolean => {
  const value = unwrap(source);
  if (!Node.isObjectLiteralExpression(value)) return true;
  return value.getProperties().some((property) => {
    if (!Node.isPropertyNamed(property)) return true;
    const key = property.getNameNode();
    if (Node.isIdentifier(key) || Node.isNumericLiteral(key)) return key.getText() === name;
    if (Node.isStringLiteral(key) || Node.isNoSubstitutionTemplateLiteral(key)) return key.getLiteralText() === name;
    const keys = Node.isComputedPropertyName(key) ? keyNames(key.getExpression()) : [];
    return keys.length === 0 || keys.includes(name);
  });
};

const isPlainAttributeDescriptor = (descriptor: Node): boolean => {
  const object = unwrap(descriptor);
  return Node.isObjectLiteralExpression(object) && object.getProperties().every((property) => {
    if (!Node.isPropertyAssignment(property)) return false;
    const key = property.getNameNode();
    const computed = Node.isComputedPropertyName(key) ? unwrap(key.getExpression()) : undefined;
    if (computed !== undefined && !Node.isStringLiteral(computed) && !Node.isNoSubstitutionTemplateLiteral(computed)) return false;
    const keys = Node.isIdentifier(key) ? [key.getText()] : keyNames(computed ?? key);
    const attribute = unwrap(property.getInitializerOrThrow());
    return keys.length > 0 && keys.every((name) => ['enumerable', 'configurable', 'writable'].includes(name)) &&
      (attribute.getKind() === SyntaxKind.TrueKeyword || attribute.getKind() === SyntaxKind.FalseKeyword);
  });
};

const thisOwner = (node: Node): ClassOwner | undefined => {
  for (const ancestor of node.getAncestors()) {
    if (Node.isFunctionDeclaration(ancestor) || Node.isFunctionExpression(ancestor)) return undefined;
    if (Node.isMethodDeclaration(ancestor) || Node.isConstructorDeclaration(ancestor) ||
      Node.isGetAccessorDeclaration(ancestor) || Node.isSetAccessorDeclaration(ancestor)) {
      const parent = ancestor.getParent();
      return Node.isClassDeclaration(parent) || Node.isClassExpression(parent) ? parent : undefined;
    }
    if (Node.isClassDeclaration(ancestor) || Node.isClassExpression(ancestor)) return ancestor;
  }
  return undefined;
};

export class MemberMutations {
  private accesses: readonly Access[] | undefined;
  private assignments: readonly MemberAssignment[] | undefined;
  private reflections: readonly CallExpression[] | undefined;
  private writes: ReadonlyMap<Symbol, readonly (Node | undefined)[]> | undefined;
  private readonly results = new Map<ProtocolMember, MutationEvidence>();
  private readonly canonical = new Map<ClassOwner, ClassOwner>();

  private readonly copies: ConditionalCopies;

  constructor(private readonly sources: SourceIndex) { this.copies = new ConditionalCopies(sources); }

  mayWrite(member: ProtocolMember): boolean {
    return this.evidenceOf(member) !== 'none';
  }

  evidenceOf(member: ProtocolMember): MutationEvidence {
    const cached = this.results.get(member);
    if (cached !== undefined) return cached;
    const owner = member.getParent();
    if (!Node.isClassDeclaration(owner) && !Node.isClassExpression(owner)) return 'other';
    this.accesses ??= [
      ...this.sources.ofKind(SyntaxKind.PropertyAccessExpression),
      ...this.sources.ofKind(SyntaxKind.ElementAccessExpression),
    ].filter((access) => isWritten(outermostWrapper(access)));
    this.assignments ??= this.sources.ofKind(SyntaxKind.CallExpression).flatMap(memberAssignments);
    this.reflections ??= this.sources.ofKind(SyntaxKind.CallExpression).filter((call) => {
      const expression = unwrap(call.getExpression());
      if (!Node.isPropertyAccessExpression(expression) || expression.getName() !== 'defineProperty') return false;
      const receiver = unwrap(expression.getExpression());
      if (!Node.isIdentifier(receiver) || !['Object', 'Reflect'].includes(receiver.getText())) return false;
      const declarations = receiver.getSymbol()?.getDeclarations() ?? [];
      return declarations.length > 0 && declarations.every(isDefaultLibraryNode);
    });
    const name = member.getName();
    const result = mergedMutationEvidence([
      ...this.accesses.map((access): MutationEvidence => {
        const keys = Node.isPropertyAccessExpression(access) ? [access.getName()] : keyNames(access.getArgumentExpression());
        return keys.length === 0 || keys.includes(name) ? this.receiverEvidence(access.getExpression(), owner, new Set()) : 'none';
      }),
      ...this.reflections.map((call): MutationEvidence => {
        const [target, key, descriptor] = call.getArguments();
        if (Node.isPrivateIdentifier(member.getNameNode()) || target === undefined || !keyNames(key).includes(name) || descriptor === undefined) return 'none';
        if (!this.descriptorMayReplace(descriptor)) return 'none';
        return this.receiverEvidence(target, owner, new Set(), Node.isPropertyDeclaration(member) && member.getInitializer() !== undefined);
      }),
      ...this.assignments.map((assignment): MutationEvidence =>
        !assignment.sources.some((source) => mayAssignName(source, name)) ? 'none' :
          assignment.target === undefined ? 'other' : this.receiverEvidence(assignment.target, owner, new Set()),
      ),
    ]);
    this.results.set(member, result);
    return result;
  }

  private descriptorMayReplace(descriptor: Node): boolean {
    const value = unwrap(descriptor);
    return Node.isObjectLiteralExpression(value) ? !isPlainAttributeDescriptor(value) : !this.isIsolatedAttributeDescriptor(value);
  }

  private isIsolatedAttributeDescriptor(value: Node): boolean {
    if (!Node.isIdentifier(value)) return false;
    const symbol = symbolOf(value);
    if (symbol === undefined || this.bindingWrites().has(symbol)) return false;
    const declarations = symbol.getDeclarations();
    const declaration = declarations.length === 1 ? declarations[0] : undefined;
    if (!Node.isVariableDeclaration(declaration) || declaration.getVariableStatement()?.isExported()) return false;
    const initializer = declaration.getInitializer();
    if (initializer === undefined) return false;
    if (!isPlainAttributeDescriptor(initializer)) return false;
    return this.sources.ofKind(SyntaxKind.Identifier).every((reference) => {
      if (symbolOf(reference) !== symbol || reference === declaration.getNameNode()) return true;
      const argument = outermostWrapper(reference);
      const call = argument.getParent();
      return Node.isCallExpression(call) && this.reflections?.includes(call) === true &&
        call.getArguments().length === 3 && call.getArguments()[2] === argument;
    });
  }

  private prototypeReceiver(receiver: Node, seen = new Set<Node>()): boolean {
    const value = unwrap(receiver);
    if (seen.has(value) || seen.size >= 12) return false;
    if ((Node.isPropertyAccessExpression(value) && value.getName() === 'prototype' ||
      Node.isElementAccessExpression(value) && keyNames(value.getArgumentExpression()).includes('prototype')) &&
      (Node.isPropertyAccessExpression(value) || Node.isElementAccessExpression(value)) &&
      value.getExpression().getType().getConstructSignatures().length > 0) return true;
    const symbol = symbolOf(value);
    if (symbol !== undefined && this.bindingWrites().has(symbol)) return false;
    const declarations = symbol?.getDeclarations() ?? [];
    return declarations.length === 1 && declarations.some((declaration) => {
      const initial = Node.isVariableDeclaration(declaration) ? declaration.getInitializer() : undefined;
      return initial !== undefined && this.prototypeReceiver(initial, new Set([...seen, value]));
    });
  }

  private canonicalClass(owner: ClassOwner): ClassOwner {
    const cached = this.canonical.get(owner);
    if (cached !== undefined) return cached;
    const canonical = Node.isClassDeclaration(owner) ? sourceDeclaration(owner, this.sources.files) ?? owner : owner;
    this.canonical.set(owner, canonical);
    return canonical;
  }

  private descendsFrom(actual: ClassOwner, expected: ClassOwner, seen = new Set<ClassOwner>()): boolean {
    const canonical = this.canonicalClass(actual);
    if (canonical === this.canonicalClass(expected)) return true;
    if (seen.has(canonical)) return false;
    const base = canonical.getBaseClass();
    if (base === undefined) return canonical.getExtends() !== undefined;
    return this.descendsFrom(base, expected, new Set([...seen, canonical]));
  }

  private relatedClass(actual: ClassOwner, expected: ClassOwner): boolean {
    return this.descendsFrom(actual, expected) || this.descendsFrom(expected, actual);
  }

  private bindingWrites(): ReadonlyMap<Symbol, readonly (Node | undefined)[]> {
    if (this.writes !== undefined) return this.writes;
    const writes = new Map<Symbol, (Node | undefined)[]>();
    const references: readonly Node[] = [
      ...this.sources.ofKind(SyntaxKind.Identifier),
      ...this.sources.ofKind(SyntaxKind.PropertyAccessExpression),
      ...this.sources.ofKind(SyntaxKind.ElementAccessExpression),
    ];
    for (const reference of references) {
      if (!isWritten(outermostWrapper(reference))) continue;
      const symbol = symbolOf(reference);
      if (symbol === undefined) continue;
      const origins = writes.get(symbol) ?? [];
      origins.push(sourceOfWrite(reference));
      writes.set(symbol, origins);
    }
    this.writes = writes;
    return writes;
  }

  private typeMayOwn(type: Type, owner: ClassOwner, depth = 0): boolean {
    if (depth > 8 || type.isAny() || type.isUnknown() || (type.getFlags() & ts.TypeFlags.NonPrimitive) !== 0) return true;
    if (type.getConstructSignatures().length > 0) return false;
    if (type.isUnion()) return type.getUnionTypes().some((part) => this.typeMayOwn(part, owner, depth + 1));
    if (type.isIntersection()) return type.getIntersectionTypes().some((part) => this.typeMayOwn(part, owner, depth + 1));
    const classes = classesOf(type);
    if (classes.length > 0) return classes.some((actual) => this.relatedClass(actual, owner)) || owner.getType().isAssignableTo(type);
    if (type.isTypeParameter()) {
      const bound = type.getConstraint();
      return bound === undefined || bound === type || this.typeMayOwn(bound, owner, depth + 1);
    }
    return owner.getType().isAssignableTo(type);
  }

  private receiverEvidence(receiver: Node, owner: ClassOwner, seen: ReadonlySet<Node>, ignorePrototype = false): MutationEvidence {
    if (ignorePrototype && this.prototypeReceiver(receiver)) return 'none';
    if (seen.size > 12) return 'other';
    const value = unwrap(receiver);
    if (Node.isObjectLiteralExpression(value) || Node.isArrayLiteralExpression(value)) return 'none';
    if (Node.isThisExpression(value) || Node.isSuperExpression(value)) {
      if (value.getType().getConstructSignatures().length > 0) return 'none';
      const actual = thisOwner(value);
      return actual === undefined || this.relatedClass(actual, owner) ? 'other' : 'none';
    }
    if (Node.isNewExpression(value)) {
      const classes = classesOf(value.getType());
      if (classes.length > 0) return classes.some((actual) => this.relatedClass(actual, owner)) ? 'other' : 'none';
    }
    if (Node.isCallExpression(value)) {
      const authority = this.copies.authorityOf(value);
      if (authority !== 'other') return authority;
    }
    const symbol = symbolOf(value);
    const declarations = symbol?.getDeclarations() ?? [];
    const writes = symbol === undefined ? [] : this.bindingWrites().get(symbol) ?? [];
    const origins: (Node | undefined)[] = [...writes];
    for (const declaration of declarations) {
      if (seen.has(declaration)) return 'other';
      if (Node.isParameterDeclaration(declaration) && this.typeMayOwn(value.getType(), owner)) return 'other';
      if (Node.isVariableDeclaration(declaration) || Node.isPropertyDeclaration(declaration) ||
        Node.isPropertyAssignment(declaration) || Node.isParameterDeclaration(declaration)) {
        const initializer = declaration.getInitializer();
        if (initializer !== undefined) origins.push(initializer);
      }
    }
    if (origins.length > 0) return mergedMutationEvidence(origins.map((origin) => origin === undefined ? 'other' :
      this.receiverEvidence(origin, owner, new Set([...seen, ...declarations]), ignorePrototype),
    ));
    return this.typeMayOwn(value.getType(), owner) ? 'other' : 'none';
  }
}
