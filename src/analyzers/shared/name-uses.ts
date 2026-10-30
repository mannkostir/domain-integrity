import { BindingElement, ElementAccessExpression, Node, PropertyAccessExpression, SyntaxKind } from 'ts-morph';
import { groupedBy } from './grouping';
import { SourceIndex } from './source-index';
import { isWritten, keyNames } from './writes';
import { outermostWrapper } from './wrappers';

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

export type MemberAccess = PropertyAccessExpression | ElementAccessExpression;

export class NameUses {
  private elementAccesses: ReadonlyMap<string, readonly ElementAccessExpression[]> | undefined;
  private destructured: ReadonlySet<string> | undefined;
  private written: ReadonlyMap<string, readonly MemberAccess[]> | undefined;

  constructor(private readonly sources: SourceIndex) {}

  isOnlyCalled(name: string): boolean {
    return (
      this.sources.propertyAccessesNamed(name).every(isCallee) &&
      this.elementAccessesKeyedFor(name).every(isCallee) &&
      !this.destructuredNames().has(name)
    );
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
