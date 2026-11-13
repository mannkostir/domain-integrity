import { ClassDeclaration, ClassExpression, ElementAccessExpression, MethodDeclaration, Node, PropertyAccessExpression, PropertyDeclaration, Symbol, SyntaxKind, Type, ts } from 'ts-morph';
import { sourceDeclaration } from '../../engine/source-declaration';
import { SourceIndex } from './source-index';
import { MemberAssignment, destructuringRoot, isWritten, keyNames, memberAssignments } from './writes';
import { outermostWrapper, unwrap } from './wrappers';

type ClassOwner = ClassDeclaration | ClassExpression;
type ProtocolMember = MethodDeclaration | PropertyDeclaration;
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
  private writes: ReadonlyMap<Symbol, readonly (Node | undefined)[]> | undefined;
  private readonly results = new Map<ProtocolMember, boolean>();
  private readonly canonical = new Map<ClassOwner, ClassOwner>();

  constructor(private readonly sources: SourceIndex) {}

  mayWrite(member: ProtocolMember): boolean {
    const cached = this.results.get(member);
    if (cached !== undefined) return cached;
    const owner = member.getParent();
    if (!Node.isClassDeclaration(owner) && !Node.isClassExpression(owner)) return true;
    this.accesses ??= [
      ...this.sources.ofKind(SyntaxKind.PropertyAccessExpression),
      ...this.sources.ofKind(SyntaxKind.ElementAccessExpression),
    ].filter((access) => isWritten(outermostWrapper(access)));
    this.assignments ??= this.sources.ofKind(SyntaxKind.CallExpression).flatMap(memberAssignments);
    const name = member.getName();
    const result = this.accesses.some((access) => {
      const keys = Node.isPropertyAccessExpression(access) ? [access.getName()] : keyNames(access.getArgumentExpression());
      return (keys.length === 0 || keys.includes(name)) && this.receiverMayOwn(access.getExpression(), owner, new Set());
    }) || this.assignments.some((assignment) =>
      assignment.sources.some((source) => mayAssignName(source, name)) &&
      (assignment.target === undefined || this.receiverMayOwn(assignment.target, owner, new Set())),
    );
    this.results.set(member, result);
    return result;
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

  private receiverMayOwn(receiver: Node, owner: ClassOwner, seen: ReadonlySet<Node>): boolean {
    if (seen.size > 12) return true;
    const value = unwrap(receiver);
    if (Node.isObjectLiteralExpression(value) || Node.isArrayLiteralExpression(value)) return false;
    if (Node.isThisExpression(value) || Node.isSuperExpression(value)) {
      if (value.getType().getConstructSignatures().length > 0) return false;
      const actual = thisOwner(value);
      return actual === undefined || this.relatedClass(actual, owner);
    }
    if (Node.isNewExpression(value)) {
      const classes = classesOf(value.getType());
      if (classes.length > 0) return classes.some((actual) => this.relatedClass(actual, owner));
    }
    const symbol = symbolOf(value);
    const declarations = symbol?.getDeclarations() ?? [];
    const writes = symbol === undefined ? [] : this.bindingWrites().get(symbol) ?? [];
    const origins: (Node | undefined)[] = [...writes];
    for (const declaration of declarations) {
      if (seen.has(declaration)) return true;
      if (Node.isParameterDeclaration(declaration) && this.typeMayOwn(value.getType(), owner)) return true;
      if (Node.isVariableDeclaration(declaration) || Node.isPropertyDeclaration(declaration) ||
        Node.isPropertyAssignment(declaration) || Node.isParameterDeclaration(declaration)) {
        const initializer = declaration.getInitializer();
        if (initializer !== undefined) origins.push(initializer);
      }
    }
    if (origins.length > 0) return origins.some((origin) => origin === undefined ||
      this.receiverMayOwn(origin, owner, new Set([...seen, ...declarations])),
    );
    return this.typeMayOwn(value.getType(), owner);
  }
}
