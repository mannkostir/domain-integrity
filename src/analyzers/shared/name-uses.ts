import { BindingElement, ElementAccessExpression, Node, PropertyAccessExpression, SyntaxKind, Type } from 'ts-morph';
import { groupedBy } from './grouping';
import { SourceIndex } from './source-index';
import { assignedSources, isWritten, keyNames } from './writes';
import { outermostWrapper, unwrap } from './wrappers';

const isCallee = (access: Node): boolean => {
  const callee = outermostWrapper(access);
  const call = callee.getParent();
  return Node.isCallExpression(call) && call.getExpression() === callee;
};

const propertyNameKeys = (name: Node | undefined): readonly string[] => {
  if (Node.isIdentifier(name) || Node.isPrivateIdentifier(name) || Node.isNumericLiteral(name)) return [name.getText()];
  if (Node.isStringLiteral(name) || Node.isNoSubstitutionTemplateLiteral(name)) return [name.getLiteralText()];
  return Node.isComputedPropertyName(name) ? keyNames(name.getExpression()) : [];
};

const bindingKeys = (element: BindingElement): readonly string[] =>
  Node.isObjectBindingPattern(element.getParent()) && element.getDotDotDotToken() === undefined
    ? propertyNameKeys(element.getPropertyNameNode() ?? element.getNameNode())
    : [];

const isWrittenAccess = (access: Node): boolean => isWritten(outermostWrapper(access));

const destructuringAssignmentKeys = (property: Node): readonly string[] =>
  (Node.isPropertyAssignment(property) || Node.isShorthandPropertyAssignment(property)) && isWritten(property)
    ? propertyNameKeys(property.getNameNode())
    : [];

const mayAssignMember = (source: Node, name: string): boolean => {
  const value = unwrap(source);
  if (!Node.isObjectLiteralExpression(value)) return true;
  return value.getProperties().some((property) => {
    if (!Node.isPropertyNamed(property)) return true;
    const keys = propertyNameKeys(property.getNameNode());
    return keys.length === 0 || keys.includes(name);
  });
};

const declaresMember = (type: Type, name: string): boolean =>
  type.isAny() || type.isUnknown() || type.isTypeParameter() || type.getProperty(name) !== undefined ||
  type.getUnionTypes().some((member) => declaresMember(member, name));

const mayReceiveMember = (receiver: Node, name: string, seen: ReadonlySet<Node>): boolean => {
  const value = unwrap(receiver);
  if (Node.isThisExpression(value) || Node.isSuperExpression(value) || declaresMember(value.getType(), name)) return true;
  const declarations = value.getSymbol()?.getDeclarations() ?? [];
  return declarations.some((declaration) => {
    if (seen.has(declaration)) return true;
    const initializer = Node.isVariableDeclaration(declaration) || Node.isPropertyAssignment(declaration) ||
      Node.isPropertyDeclaration(declaration) ? declaration.getInitializer() : undefined;
    return initializer !== undefined && mayReceiveMember(initializer, name, new Set([...seen, declaration]));
  });
};

export type MemberAccess = PropertyAccessExpression | ElementAccessExpression;

export class NameUses {
  private uncertainComputedWrites: readonly ElementAccessExpression[] | undefined;
  private assignmentSources: readonly Node[] | undefined;
  private elementAccesses: ReadonlyMap<string, readonly ElementAccessExpression[]> | undefined;
  private destructured: ReadonlySet<string> | undefined;
  private written: ReadonlyMap<string, readonly MemberAccess[]> | undefined;

  constructor(private readonly sources: SourceIndex) {}

  isReferenced(name: string): boolean {
    return this.sources.propertyAccessesNamed(name).length > 0 ||
      this.elementAccessesKeyedFor(name).length > 0 || this.destructuredNames().has(name);
  }

  isOnlyCalled(name: string): boolean {
    return (
      this.sources.propertyAccessesNamed(name).every(isCallee) &&
      this.elementAccessesKeyedFor(name).every(isCallee) &&
      !this.destructuredNames().has(name)
    );
  }

  mayBeWritten(name: string): boolean {
    this.assignmentSources ??= this.sources.ofKind(SyntaxKind.CallExpression).flatMap(assignedSources);
    this.uncertainComputedWrites ??= this.sources.ofKind(SyntaxKind.ElementAccessExpression).filter((access) =>
      isWrittenAccess(access) && keyNames(access.getArgumentExpression()).length === 0,
    );
    return this.uncertainComputedWrites.some((access) => mayReceiveMember(access.getExpression(), name, new Set())) ||
      this.writtenAccessesNamed(name).length > 0 ||
      this.assignmentSources.some((source) => mayAssignMember(source, name));
  }

  writtenAccessesNamed(name: string): readonly MemberAccess[] {
    this.written ??= groupedBy<string, MemberAccess>(
      [
        ...this.sources.ofKind(SyntaxKind.PropertyAccessExpression).filter(isWrittenAccess),
        ...this.sources.ofKind(SyntaxKind.ElementAccessExpression).filter(isWrittenAccess),
      ],
      (access) => (Node.isPropertyAccessExpression(access) ? [access.getName()] : keyNames(access.getArgumentExpression())),
    );
    return this.written.get(name) ?? [];
  }

  private elementAccessesKeyedFor(name: string): readonly ElementAccessExpression[] {
    this.elementAccesses ??= groupedBy(this.sources.ofKind(SyntaxKind.ElementAccessExpression), (access) =>
      keyNames(access.getArgumentExpression()),
    );
    return this.elementAccesses.get(name) ?? [];
  }

  private destructuredNames(): ReadonlySet<string> {
    this.destructured ??= new Set([
      ...this.sources.ofKind(SyntaxKind.BindingElement).flatMap(bindingKeys),
      ...this.sources.ofKind(SyntaxKind.PropertyAssignment).flatMap(destructuringAssignmentKeys),
      ...this.sources.ofKind(SyntaxKind.ShorthandPropertyAssignment).flatMap(destructuringAssignmentKeys),
    ]);
    return this.destructured;
  }
}
