import {
  CallExpression,
  ClassDeclaration,
  Diagnostic,
  Expression,
  ImportDeclaration,
  Node,
  ObjectLiteralExpression,
  PropertyAssignment,
  SourceFile,
  ts,
} from 'ts-morph';
import {
  ConfigReading,
  DEFAULT_DECLARATION,
  DeclaredEvents,
  DeclaredField,
  DeclaredLifecycle,
  DeclaredSaga,
  DeclaredSuppression,
  Deprecation,
} from './declaration';
import { ConfigError } from './errors';
import { RULE_ANALYZERS, RuleId, RuleLevel } from '../finding';
import { OptionPath, RENAMED_OPTIONS, RenamedOption, optionPath } from './renamed-options';
import { SET, UNSET, literalToken } from './value-token';

class ConfigLineError extends Error {
  constructor(
    readonly line: number,
    readonly detail: string,
  ) {
    super(`Line ${line}: ${detail}`);
  }
}

class RenamedOptionConflictError extends Error {
  constructor(
    readonly option: RenamedOption,
    readonly oldLine: number,
    readonly currentLine: number,
  ) {
    super(`"${optionPath(option.old)}" at line ${oldLine} conflicts with "${optionPath(option.current)}" at line ${currentLine}`);
  }
}

const unsupported = (node: Node, what: string): ConfigLineError =>
  new ConfigLineError(node.getStartLineNumber(), `${what}. Use literal objects, arrays and direct references.`);

const FILE_NOT_LISTED_IN_PROJECT_CODE = 6307;

const HELPERS_MODULE = 'domain-integrity';

const diagnosticText = (diagnostic: Diagnostic): string =>
  ts.flattenDiagnosticMessageText(diagnostic.compilerObject.messageText, '\n');

const assertNoSyntaxErrors = (file: SourceFile, configName: string): void => {
  const [first] = file.getProject().getProgram().getSyntacticDiagnostics(file);
  if (first === undefined) return;
  throw new ConfigError(`Syntax error at ${configName}:${first.getLineNumber()}: ${diagnosticText(first)}`);
};

const isUnresolvedHelpersImport = (declaration: ImportDeclaration): boolean =>
  declaration.getModuleSpecifierValue() === HELPERS_MODULE && declaration.getModuleSpecifierSourceFile() === undefined;

const assertHelpersResolve = (file: SourceFile, configName: string): void => {
  const unresolved = file.getImportDeclarations().find(isUnresolvedHelpersImport);
  if (unresolved === undefined) return;
  throw new ConfigError(
    `${configName}:${unresolved.getStartLineNumber()} cannot import "${HELPERS_MODULE}". Install it as a dev dependency: npm install --save-dev ${HELPERS_MODULE}`,
  );
};

const isConfigTypeError = (diagnostic: Diagnostic, file: SourceFile): boolean =>
  diagnostic.getCategory() === ts.DiagnosticCategory.Error &&
  diagnostic.getCode() !== FILE_NOT_LISTED_IN_PROJECT_CODE &&
  diagnostic.getSourceFile()?.getFilePath() === file.getFilePath();

const assertNoTypeErrors = (file: SourceFile, configName: string): void => {
  const errors = file.getPreEmitDiagnostics().filter((diagnostic) => isConfigTypeError(diagnostic, file));
  if (errors.length === 0) return;
  const lines = errors.map((diagnostic) => `${configName}:${diagnostic.getLineNumber()} ${diagnosticText(diagnostic)}`);
  throw new ConfigError(`Type errors in ${configName}:\n${lines.join('\n')}`);
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

const booleanLiteral = (expression: Expression | undefined, option: string, fallback: boolean): boolean => {
  if (expression === undefined) return fallback;
  if (Node.isTrueLiteral(expression)) return true;
  if (Node.isFalseLiteral(expression)) return false;
  throw unsupported(expression, `"${option}" must be true or false`);
};

const subsetOf = (names: readonly string[], allowed: readonly string[], option: string, within: string): readonly string[] => {
  const outside = names.find((name) => !allowed.includes(name));
  if (outside !== undefined) throw new ConfigError(`"${option}" lists "${outside}", which is not in "${within}".`);
  return names;
};

type Read<T> = { readonly value: T; readonly deprecations: readonly Deprecation[] };

type Located = { readonly expression: Expression | undefined; readonly deprecations: readonly Deprecation[] };

const valueAt = (object: ObjectLiteralExpression, [name, ...rest]: OptionPath, parent: OptionPath = []): Expression | undefined => {
  if (name === undefined) return undefined;
  const value = valueOf(object, name);
  if (value === undefined || rest.length === 0) return value;
  if (Node.isStringLiteral(value)) return undefined;
  const path = [...parent, name];
  if (!Node.isObjectLiteralExpression(value)) throw unsupported(value, `"${optionPath(path)}" must be an object literal`);
  return valueAt(value, rest, path);
};

const propertyLine = (value: Expression): number => value.getParentOrThrow().getStartLineNumber();

const renamedValue = (config: ObjectLiteralExpression, option: RenamedOption): Located => {
  const current = valueAt(config, option.current);
  const old = valueAt(config, option.old);
  if (old === undefined) return { expression: current, deprecations: [] };
  if (current !== undefined) throw new RenamedOptionConflictError(option, propertyLine(old), propertyLine(current));
  return {
    expression: old,
    deprecations: [{ line: propertyLine(old), old: optionPath(option.old), replacement: optionPath(option.current) }],
  };
};

type ListOption = Exclude<keyof typeof RENAMED_OPTIONS, 'reportTestFileMutations'>;

const listOption = (config: ObjectLiteralExpression, name: ListOption): Read<readonly string[]> => {
  const { expression, deprecations } = renamedValue(config, RENAMED_OPTIONS[name]);
  return { value: stringList(expression, DEFAULT_DECLARATION[name]), deprecations };
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

const transitionSources = (method: PropertyAssignment): Read<readonly string[]> => {
  const spec = method.getInitializerOrThrow();
  const name = propertyName(method);
  if (!Node.isObjectLiteralExpression(spec)) {
    return {
      value: tokens(spec),
      deprecations: [
        { line: method.getStartLineNumber(), old: `transitions.${name}: [...]`, replacement: `transitions.${name}: { from: [...] }` },
      ],
    };
  }
  const from = valueOf(spec, 'from');
  if (from === undefined) throw unsupported(spec, `transitions.${name} needs "from"`);
  return { value: tokens(from), deprecations: [] };
};

const readTransitions = (expression: Expression): Read<ReadonlyMap<string, readonly string[]>> => {
  if (!Node.isObjectLiteralExpression(expression)) throw unsupported(expression, '"transitions" must be an object literal');
  const methods = properties(expression).map((property) => ({ name: propertyName(property), sources: transitionSources(property) }));
  return {
    value: new Map(methods.map(({ name, sources }) => [name, sources.value])),
    deprecations: methods.flatMap(({ sources }) => sources.deprecations),
  };
};

const readField = (field: PropertyAssignment): Read<DeclaredField> => {
  const spec = field.getInitializerOrThrow();
  if (!Node.isObjectLiteralExpression(spec)) throw unsupported(spec, 'a state field spec must be an object literal');
  const terminal = valueOf(spec, 'terminal');
  if (terminal === undefined) throw unsupported(spec, `state field "${propertyName(field)}" needs "terminal"`);
  const transitions = valueOf(spec, 'transitions');
  const read = transitions === undefined ? undefined : readTransitions(transitions);
  return {
    value: {
      name: propertyName(field),
      terminal: tokens(terminal),
      transitions: read?.value,
      allowAfterTerminal: stringList(valueOf(spec, 'allowAfterTerminal'), []),
    },
    deprecations: read?.deprecations ?? [],
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

const readLifecycle = (element: Expression): Read<DeclaredLifecycle> => {
  const call = callNamed(element, 'lifecycle');
  if (!call) throw unsupported(element, 'each entry of "lifecycles" must be a lifecycle(...) call');
  const spec = objectArgument(call, 1);
  const states = valueOf(spec, 'states');
  if (!Node.isObjectLiteralExpression(states)) throw unsupported(spec, '"states" must be an object literal');
  const fields = properties(states).map(readField);
  return {
    value: {
      target: targetClass(call),
      fields: fields.map((field) => field.value),
      allowAfterTerminal: stringList(valueOf(spec, 'allowAfterTerminal'), []),
    },
    deprecations: fields.flatMap((field) => field.deprecations),
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
    throw new ConfigLineError(
      element.getStartLineNumber(),
      `an outcome of saga(${sagaName}) lists ${success.getName() ?? 'a class'} as both success and failure.`,
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

const readEvents = (config: ObjectLiteralExpression): DeclaredEvents => {
  const defaults = DEFAULT_DECLARATION.events;
  const inProcess = valueAt(config, ['events', 'inProcess']);
  const sagas = valueAt(config, ['events', 'sagas']);
  return {
    handlerDecorators: stringList(valueAt(config, ['events', 'handlerDecorators']), defaults.handlerDecorators),
    registerMethods: stringList(valueAt(config, ['events', 'registerMethods']), defaults.registerMethods),
    inProcess: inProcess === undefined ? [] : arrayElements(inProcess).map((element) => projectClass(element, 'each entry of "events.inProcess"')),
    sagas: sagas === undefined ? [] : arrayElements(sagas).map(readSaga),
  };
};

const isRuleId = (name: string): name is RuleId => Object.hasOwn(RULE_ANALYZERS, name);

const LEVELS: readonly RuleLevel[] = ['off', 'warning', 'error'];

const levelLiteral = (expression: Expression): RuleLevel => {
  const level = Node.isStringLiteral(expression) ? LEVELS.find((candidate) => candidate === expression.getLiteralText()) : undefined;
  if (level === undefined) throw unsupported(expression, 'a rule level must be "off", "warning" or "error"');
  return level;
};

const ruleLevel = (setting: Expression): RuleLevel | undefined => {
  if (!Node.isObjectLiteralExpression(setting)) return levelLiteral(setting);
  const level = valueOf(setting, 'level');
  return level === undefined ? undefined : levelLiteral(level);
};

const ruleEntry = (property: PropertyAssignment): readonly (readonly [RuleId, RuleLevel])[] => {
  const name = propertyName(property);
  if (!isRuleId(name)) {
    throw new ConfigLineError(property.getStartLineNumber(), `"rules" names the unknown rule "${name}".`);
  }
  const level = ruleLevel(property.getInitializerOrThrow());
  return level === undefined ? [] : [[name, level]];
};

const readRuleLevels = (config: ObjectLiteralExpression): ReadonlyMap<RuleId, RuleLevel> => {
  const rules = valueOf(config, 'rules');
  if (rules === undefined) return new Map();
  if (!Node.isObjectLiteralExpression(rules)) throw unsupported(rules, '"rules" must be an object literal');
  return new Map(properties(rules).flatMap(ruleEntry));
};

const stringLiteralText = (expression: Expression | undefined, call: CallExpression, what: string): string => {
  if (!Node.isStringLiteral(expression)) throw unsupported(expression ?? call, `${what} must be a string literal`);
  return expression.getLiteralText();
};

const readSuppression = (element: Expression): DeclaredSuppression => {
  const call = callNamed(element, 'suppress');
  if (!call) throw unsupported(element, 'each entry of "suppressions" must be a suppress(...) call');
  const [targetArgument] = call.getArguments();
  if (targetArgument === undefined) throw unsupported(call, 'suppress() needs a class');
  const target = projectClass(targetArgument, 'the first argument of suppress()');
  const spec = objectArgument(call, 1);
  const rule = stringLiteralText(valueOf(spec, 'rule'), call, '"rule" of suppress()');
  if (!isRuleId(rule)) {
    throw new ConfigLineError(call.getStartLineNumber(), `suppress() names the unknown rule "${rule}".`);
  }
  const member = valueOf(spec, 'member');
  const reason = stringLiteralText(valueOf(spec, 'reason'), call, '"reason" of suppress()');
  if (reason.trim() === '') {
    throw new ConfigLineError(call.getStartLineNumber(), `suppress(${target.getName() ?? 'anonymous'}) needs a non-empty "reason".`);
  }
  return {
    rule,
    target,
    member: member === undefined ? undefined : stringLiteralText(member, call, '"member" of suppress()'),
    reason,
    line: call.getStartLineNumber(),
  };
};

const byLine = (left: Deprecation, right: Deprecation): number => left.line - right.line;

const defineDomainCall = (file: SourceFile): CallExpression | undefined =>
  callNamed(file.getExportAssignment((assignment) => !assignment.isExportEquals())?.getExpression(), 'defineDomain');

const readDefineDomain = (call: CallExpression): ConfigReading => {
  const config = objectArgument(call, 0);
  const lifecycles = valueOf(config, 'lifecycles');
  const declaredLifecycles = lifecycles === undefined ? [] : arrayElements(lifecycles).map(readLifecycle);
  const aggregateBaseClasses = listOption(config, 'aggregateBaseClasses');
  const auditFields = listOption(config, 'auditFields');
  const eventMethods = listOption(config, 'eventMethods');
  const inertDecorators = listOption(config, 'inertDecorators');
  const inertEventMethods = listOption(config, 'inertEventMethods');
  const inertMembers = listOption(config, 'inertMembers');
  const testFileOption = RENAMED_OPTIONS.reportTestFileMutations;
  const testFiles = renamedValue(config, testFileOption);
  const testFilesName = optionPath(testFiles.deprecations.length === 0 ? testFileOption.current : testFileOption.old);
  const suppressions = valueOf(config, 'suppressions');
  const reads = [
    aggregateBaseClasses,
    auditFields,
    eventMethods,
    inertDecorators,
    inertEventMethods,
    inertMembers,
    testFiles,
    ...declaredLifecycles,
  ];
  return {
    declaration: {
      aggregateBaseClasses: aggregateBaseClasses.value,
      auditFields: auditFields.value,
      eventMethods: eventMethods.value,
      inertDecorators: inertDecorators.value,
      inertEventMethods: subsetOf(
        inertEventMethods.value,
        eventMethods.value,
        optionPath(RENAMED_OPTIONS.inertEventMethods.current),
        optionPath(RENAMED_OPTIONS.eventMethods.current),
      ),
      inertMembers: inertMembers.value,
      lifecycles: declaredLifecycles.map((read) => read.value),
      reportTestFileMutations: booleanLiteral(testFiles.expression, testFilesName, DEFAULT_DECLARATION.reportTestFileMutations),
      events: readEvents(config),
      rules: readRuleLevels(config),
      suppressions: suppressions === undefined ? [] : arrayElements(suppressions).map(readSuppression),
    },
    deprecations: reads.flatMap((read) => read.deprecations).sort(byLine),
  };
};

const conflictMessage = ({ option, oldLine, currentLine }: RenamedOptionConflictError, configName: string): string =>
  `${configName}:${oldLine} sets "${optionPath(option.old)}" and ${configName}:${currentLine} sets "${optionPath(option.current)}". Keep only "${optionPath(option.current)}".`;

const namedIn = (configName: string, error: unknown): unknown => {
  if (error instanceof ConfigLineError) return new ConfigError(`${configName}:${error.line} ${error.detail}`);
  if (error instanceof RenamedOptionConflictError) return new ConfigError(conflictMessage(error, configName));
  return error;
};

export const readDeclaration = (file: SourceFile, configName: string): ConfigReading => {
  assertNoSyntaxErrors(file, configName);
  assertHelpersResolve(file, configName);
  assertNoTypeErrors(file, configName);
  const call = defineDomainCall(file);
  if (!call) throw new ConfigError(`${configName} must "export default defineDomain({...})".`);
  try {
    return readDefineDomain(call);
  } catch (error) {
    throw namedIn(configName, error);
  }
};
