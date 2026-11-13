import { EnumDeclaration, Node, ParameterDeclaration, Statement, SyntaxKind } from 'ts-morph';
import { isDefaultLibraryNode } from '../../shared/library';
import { isDeclarationReference, refersTo, resolvedSymbol } from './identity';

const builtIn = (node: Node): boolean => {
  const declarations = resolvedSymbol(node)?.getDeclarations() ?? [];
  return declarations.length > 0 && declarations.every(isDefaultLibraryNode);
};

const parameterRead = (node: Node, parameter: ParameterDeclaration): boolean => Node.isIdentifier(node) && refersTo(node, parameter);

const safeMessage = (node: Node, parameter: ParameterDeclaration): boolean =>
  Node.isStringLiteral(node) || Node.isNoSubstitutionTemplateLiteral(node) ||
  (Node.isTemplateExpression(node) && node.getTemplateSpans().every(span => parameterRead(span.getExpression(), parameter)));

const errorOnly = (statement: Statement, parameter: ParameterDeclaration): boolean => {
  const statements = Node.isBlock(statement) ? statement.getStatements() : [statement];
  const [only] = statements;
  if (statements.length !== 1 || !Node.isThrowStatement(only)) return false;
  const error = only.getExpression();
  if (!Node.isNewExpression(error)) return false;
  const callee = error.getExpression();
  const [message] = error.getArguments();
  return Node.isIdentifier(callee) && callee.getText() === 'Error' && builtIn(callee) &&
    error.getArguments().length === 1 && message !== undefined && safeMessage(message, parameter);
};

export const safeEnumValidation = (statement: Statement, parameter: ParameterDeclaration, domain: EnumDeclaration): boolean => {
  if (!Node.isIfStatement(statement) || statement.getElseStatement() !== undefined) return false;
  const condition = statement.getExpression();
  if (!Node.isPrefixUnaryExpression(condition) || condition.getOperatorToken() !== SyntaxKind.ExclamationToken) return false;
  const includes = condition.getOperand();
  if (!Node.isCallExpression(includes) || includes.hasQuestionDotToken()) return false;
  const member = includes.getExpression();
  const [searched] = includes.getArguments();
  if (!Node.isPropertyAccessExpression(member) || member.hasQuestionDotToken() || member.getName() !== 'includes' ||
      !builtIn(member.getNameNode()) || includes.getArguments().length !== 1 || searched === undefined ||
      !parameterRead(searched, parameter)) return false;
  const values = member.getExpression();
  if (!Node.isCallExpression(values) || values.hasQuestionDotToken()) return false;
  const valuesMember = values.getExpression();
  const [enumeration] = values.getArguments();
  if (!Node.isPropertyAccessExpression(valuesMember) || valuesMember.hasQuestionDotToken() || valuesMember.getName() !== 'values' ||
      !builtIn(valuesMember.getNameNode()) || values.getArguments().length !== 1 || enumeration === undefined ||
      !isDeclarationReference(enumeration) || !refersTo(enumeration, domain)) return false;
  const object = valuesMember.getExpression();
  return Node.isIdentifier(object) && object.getText() === 'Object' && builtIn(object) &&
    errorOnly(statement.getThenStatement(), parameter);
};
