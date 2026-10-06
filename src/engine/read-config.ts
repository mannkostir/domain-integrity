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
import {
  DEFAULT_DECLARATION,
  DeclaredEvents,
  DeclaredField,
  DeclaredLifecycle,
  DeclaredSaga,
  DomainDeclaration,
} from './declaration';
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

const subsetOf = (names: readonly string[], allowed: readonly string[], option: string, within: string): readonly string[] => {
  const outside = names.find((name) => !allowed.includes(name));
  if (outside !== undefined) throw new ConfigError(`"${option}" lists "${outside}", which is not in "${within}".`);
  return names;
};

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

const projectClass = (expression: Node, what: string): ClassDeclaration => {
  const declaration = Node.isIdentifier(expression)
    ? expression.getDefinitionNodes().find((node) => Node.isClassDeclaration(node))
    : undefined;
  if (!Node.isClassDeclaration(declaration)) throw unsupported(expression, `${what} must be a class reference`);
  const file = declaration.getSourceFile();
  if (file.isDeclarationFile() || file.isInNodeModules()) {
    throw unsupported(expression, `${what} must be a class declared in the project`);
  }
  return declaration;
};

const readOutcome = (sagaName: string) => (element: Expression): readonly [ClassDeclaration, ClassDeclaration] => {
  if (!Node.isArrayLiteralExpression(element) || element.getElements().length !== 2) {
    throw unsupported(element, 'each outcome must be a [success, failure] array literal');
  }
  const [success, failure] = element.getElements().map((item) => projectClass(item, 'an outcome element'));
  if (success === undefined || failure === undefined) throw unsupported(element, 'each outcome must be a [success, failure] array literal');
  if (success === failure) {
    throw new ConfigError(
      `domain.config.ts:${element.getStartLineNumber()} an outcome of saga(${sagaName}) lists ${success.getName() ?? 'a class'} as both success and failure.`,
    );
  }
  return [success, failure];
};

const readSaga = (element: Expression): DeclaredSaga => {
  const call = callNamed(element, 'saga');
  if (!call) throw unsupported(element, 'each entry of "events.sagas" must be a saga(...) call');
  const [targetArgument] = call.getArguments();
  if (targetArgument === undefined) throw unsupported(call, 'saga() needs a class');
  const target = projectClass(targetArgument, 'the first argument of saga()');
  const outcomes = valueOf(objectArgument(call, 1), 'outcomes');
  if (outcomes === undefined) throw unsupported(call, 'saga() needs "outcomes"');
  return { target, outcomes: arrayElements(outcomes).map(readOutcome(target.getName() ?? 'anonymous')) };
};

const readEvents = (expression: Expression | undefined): DeclaredEvents => {
  const defaults = DEFAULT_DECLARATION.events;
  if (expression === undefined) return defaults;
  if (!Node.isObjectLiteralExpression(expression)) throw unsupported(expression, '"events" must be an object literal');
  const inProcess = valueOf(expression, 'inProcess');
  const sagas = valueOf(expression, 'sagas');
  return {
    handlerDecorators: stringList(valueOf(expression, 'handlerDecorators'), defaults.handlerDecorators),
    registerMethods: stringList(valueOf(expression, 'registerMethods'), defaults.registerMethods),
    inProcess: inProcess === undefined ? [] : arrayElements(inProcess).map((element) => projectClass(element, 'each entry of "events.inProcess"')),
    sagas: sagas === undefined ? [] : arrayElements(sagas).map(readSaga),
  };
};

export const readDeclaration = (file: SourceFile): DomainDeclaration => {
  assertNoTypeErrors(file);
  const exported = file.getExportAssignment((assignment) => !assignment.isExportEquals());
  const call = callNamed(exported?.getExpression(), 'defineDomain');
  if (!call) throw new ConfigError('domain.config.ts must "export default defineDomain({...})".');
  const config = objectArgument(call, 0);
  const lifecycles = valueOf(config, 'lifecycles');
  const eventMethods = stringList(valueOf(config, 'eventMethods'), DEFAULT_DECLARATION.eventMethods);
  return {
    aggregateBaseClasses: stringList(valueOf(config, 'aggregateBaseClasses'), DEFAULT_DECLARATION.aggregateBaseClasses),
    auditFields: stringList(valueOf(config, 'auditFields'), DEFAULT_DECLARATION.auditFields),
    eventMethods,
    inertEventMethods: subsetOf(
      stringList(valueOf(config, 'inertEventMethods'), DEFAULT_DECLARATION.inertEventMethods),
      eventMethods,
      'inertEventMethods',
      'eventMethods',
    ),
    inertMembers: stringList(valueOf(config, 'inertMembers'), DEFAULT_DECLARATION.inertMembers),
    lifecycles: lifecycles === undefined ? [] : arrayElements(lifecycles).map(readLifecycle),
    events: readEvents(valueOf(config, 'events')),
  };
};
