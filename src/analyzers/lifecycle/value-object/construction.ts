import { ClassDeclaration, ConstructorDeclaration, EnumDeclaration, Node, ParameterDeclaration, PropertyDeclaration, Statement, SyntaxKind } from 'ts-morph';
import { refersTo, simpleParameter } from './identity';
import { safeEnumValidation } from './validation';

type Selection = { readonly path: readonly string[]; readonly fresh: boolean };
type ConstructorMapping = { readonly declaration: ConstructorDeclaration; readonly parameter: ParameterDeclaration };

const selectedParameter = (node: Node, path: readonly string[], parameter: ParameterDeclaration): Selection | undefined => {
  if (Node.isIdentifier(node) && refersTo(node, parameter)) return { path, fresh: false };
  const [name, ...rest] = path;
  if (!Node.isObjectLiteralExpression(node) || name === undefined || node.getProperties().length !== 1) return undefined;
  const [property] = node.getProperties();
  if ((!Node.isPropertyAssignment(property) && !Node.isShorthandPropertyAssignment(property)) || property.getName() !== name ||
      !Node.isIdentifier(property.getNameNode())) return undefined;
  if (Node.isPropertyAssignment(property) && name === '__proto__') return undefined;
  if (Node.isShorthandPropertyAssignment(property) && property.getObjectAssignmentInitializer() !== undefined) return undefined;
  const value = Node.isPropertyAssignment(property) ? property.getInitializer() : property.getNameNode();
  if (value === undefined) return undefined;
  const selected = Node.isShorthandPropertyAssignment(property)
    ? property.getValueSymbol() === parameter.getSymbol() ? { path: rest, fresh: false } : undefined
    : selectedParameter(value, rest, parameter);
  return selected === undefined ? undefined : { ...selected, fresh: true };
};

const assignedHolder = (statement: Statement, holder: PropertyDeclaration, parameter: ParameterDeclaration): boolean => {
  if (!Node.isExpressionStatement(statement)) return false;
  const assignment = statement.getExpression();
  if (!Node.isBinaryExpression(assignment) || assignment.getOperatorToken().getKind() !== SyntaxKind.EqualsToken) return false;
  const left = assignment.getLeft();
  const right = assignment.getRight();
  return Node.isPropertyAccessExpression(left) && Node.isThisExpression(left.getExpression()) &&
    refersTo(left.getNameNode(), holder) && Node.isIdentifier(right) && refersTo(right, parameter);
};

const superArgument = (statement: Statement): Node | undefined => {
  if (!Node.isExpressionStatement(statement)) return undefined;
  const call = statement.getExpression();
  if (!Node.isCallExpression(call) || call.getExpression().getKind() !== SyntaxKind.SuperKeyword || call.getArguments().length !== 1) return undefined;
  return call.getArguments()[0];
};

export const proveConstruction = (
  chain: readonly ClassDeclaration[], holder: PropertyDeclaration, slot: string, domain: EnumDeclaration,
): ConstructorMapping | undefined => {
  let selection: Selection = { path: [slot], fresh: false };
  let mapping: ConstructorMapping | undefined;
  for (const cls of [...chain].reverse()) {
    const constructors = cls.getConstructors();
    const [declaration] = constructors;
    if (constructors.length !== 1 || declaration === undefined || declaration.getOverloads().length > 0) return undefined;
    const parameter = simpleParameter(declaration.getParameters());
    const body = declaration.getBody();
    if (parameter === undefined || !Node.isBlock(body)) return undefined;
    const statements = body.getStatements();
    const last = statements[statements.length - 1];
    if (last === undefined) return undefined;
    if (cls === holder.getParent()) {
      if (cls.getExtends() !== undefined || statements.length !== 1 || !assignedHolder(last, holder, parameter)) return undefined;
    } else {
      const argument = superArgument(last);
      const selected = argument === undefined ? undefined : selectedParameter(argument, selection.path, parameter);
      if (selected === undefined || !statements.slice(0, -1).every(statement => safeEnumValidation(statement, parameter, domain))) return undefined;
      selection = { path: selected.path, fresh: selection.fresh || selected.fresh };
    }
    mapping = { declaration, parameter };
  }
  return selection.path.length === 0 && selection.fresh ? mapping : undefined;
};
