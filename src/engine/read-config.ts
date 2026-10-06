import {
  CallExpression,
  ClassDeclaration,
  Expression,
  Node,
  ObjectLiteralExpression,
  PropertyAssignment,
  SourceFile,
  ts,
} from 'ts-morph';
import { DEFAULT_DECLARATION, DeclaredField, DeclaredLifecycle, DomainDeclaration } from './declaration';
import { ConfigError } from './errors';
import { SET, UNSET, literalToken } from './value-token';

const unsupported = (node: Node, what: string): ConfigError =>
  new ConfigError(
    `domain.config.ts:${node.getStartLineNumber()} ${what}. Use literal objects, arrays and direct references.`,
  );

const assertNoTypeErrors = (file: SourceFile): void => {
  const errors = file
    .getPreEmitDiagnostics()
    .filter(
      (diagnostic) =>
        diagnostic.getCategory() === ts.DiagnosticCategory.Error &&
        diagnostic.getSourceFile()?.getFilePath() === file.getFilePath(),
    );
  if (errors.length === 0) return;
  const lines = errors.map(
    (diagnostic) =>
      `domain.config.ts:${diagnostic.getLineNumber()} ${ts.flattenDiagnosticMessageText(diagnostic.compilerObject.messageText, '\n')}`,
  );
  throw new ConfigError(`Type errors in domain.config.ts:\n${lines.join('\n')}`);
};

const callNamed = (node: Node | undefined, name: string): CallExpression | undefined =>
  Node.isCallExpression(node) && node.getExpression().getText() === name ? node : undefined;

const objectArgument = (call: CallExpression, index: number): ObjectLiteralExpression => {
  const argument = call.getArguments()[index];
  if (!Node.isObjectLiteralExpression(argument)) {
    throw unsupported(call, `argument ${index + 1} of ${call.getExpression().getText()}() must be an object literal`);
  }
  return argument;
};

const propertyName = (property: PropertyAssignment): string => {
  const nameNode = property.getNameNode();
  return Node.isStringLiteral(nameNode) ? nameNode.getLiteralText() : nameNode.getText();
};

const properties = (object: ObjectLiteralExpression): PropertyAssignment[] =>
  object.getProperties().map((property) => {
    if (!Node.isPropertyAssignment(property)) throw unsupported(property, 'only plain "key: value" properties are supported');
    return property;
  });

const valueOf = (object: ObjectLiteralExpression, name: string): Expression | undefined =>
  properties(object)
    .find((property) => propertyName(property) === name)
    ?.getInitializerOrThrow();

const arrayElements = (expression: Expression): Expression[] => {
  if (!Node.isArrayLiteralExpression(expression)) throw unsupported(expression, 'expected an array literal');
  return expression.getElements();
};

const stringList = (expression: Expression | undefined, fallback: readonly string[]): readonly string[] =>
  expression === undefined
    ? fallback
    : arrayElements(expression).map((element) => {
        if (!Node.isStringLiteral(element)) throw unsupported(element, 'expected a string literal');
        return element.getLiteralText();
      });

const valueToken = (expression: Expression): string => {
  if (Node.isStringLiteral(expression) && [SET, UNSET].includes(expression.getLiteralText())) {
    return expression.getLiteralText();
  }
  const token = literalToken(expression.getType());
  if (token === undefined) throw unsupported(expression, `cannot resolve "${expression.getText()}" to a literal state value`);
  return token;
};

const tokens = (expression: Expression): readonly string[] =>
  Node.isArrayLiteralExpression(expression) ? expression.getElements().map(valueToken) : [valueToken(expression)];

const readTransitions = (expression: Expression): ReadonlyMap<string, readonly string[]> => {
  if (!Node.isObjectLiteralExpression(expression)) throw unsupported(expression, '"transitions" must be an object literal');
  return new Map(properties(expression).map((property) => [propertyName(property), tokens(property.getInitializerOrThrow())]));
};

const readField = (field: PropertyAssignment): DeclaredField => {
  const spec = field.getInitializerOrThrow();
  if (!Node.isObjectLiteralExpression(spec)) throw unsupported(spec, 'a state field spec must be an object literal');
  const terminal = valueOf(spec, 'terminal');
  if (terminal === undefined) throw unsupported(spec, `state field "${propertyName(field)}" needs "terminal"`);
  const transitions = valueOf(spec, 'transitions');
  return {
    name: propertyName(field),
    terminal: tokens(terminal),
    transitions: transitions === undefined ? undefined : readTransitions(transitions),
    allowAfterTerminal: stringList(valueOf(spec, 'allowAfterTerminal'), []),
  };
};

const targetClass = (call: CallExpression): ClassDeclaration => {
  const [target] = call.getArguments();
  const declaration = Node.isIdentifier(target)
    ? target.getDefinitionNodes().find((node) => Node.isClassDeclaration(node))
    : undefined;
  if (!Node.isClassDeclaration(declaration)) {
    throw unsupported(call, 'the first argument of lifecycle() must be an imported class');
  }
  return declaration;
};

const readLifecycle = (element: Expression): DeclaredLifecycle => {
  const call = callNamed(element, 'lifecycle');
  if (!call) throw unsupported(element, 'each entry of "lifecycles" must be a lifecycle(...) call');
  const spec = objectArgument(call, 1);
  const states = valueOf(spec, 'states');
  if (!Node.isObjectLiteralExpression(states)) throw unsupported(spec, '"states" must be an object literal');
  return {
    target: targetClass(call),
    fields: properties(states).map(readField),
    allowAfterTerminal: stringList(valueOf(spec, 'allowAfterTerminal'), []),
  };
};

export const readDeclaration = (file: SourceFile): DomainDeclaration => {
  assertNoTypeErrors(file);
  const exported = file.getExportAssignment((assignment) => !assignment.isExportEquals());
  const call = callNamed(exported?.getExpression(), 'defineDomain');
  if (!call) throw new ConfigError('domain.config.ts must "export default defineDomain({...})".');
  const config = objectArgument(call, 0);
  const lifecycles = valueOf(config, 'lifecycles');
  return {
    aggregateBaseClasses: stringList(valueOf(config, 'aggregateBaseClasses'), DEFAULT_DECLARATION.aggregateBaseClasses),
    auditFields: stringList(valueOf(config, 'auditFields'), DEFAULT_DECLARATION.auditFields),
    eventMethods: stringList(valueOf(config, 'eventMethods'), DEFAULT_DECLARATION.eventMethods),
    inertMembers: stringList(valueOf(config, 'inertMembers'), DEFAULT_DECLARATION.inertMembers),
    lifecycles: lifecycles === undefined ? [] : arrayElements(lifecycles).map(readLifecycle),
  };
};
