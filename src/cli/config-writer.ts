import {
  ArrayLiteralExpression,
  ImportDeclaration,
  IndentationText,
  Node,
  ObjectLiteralExpression,
  Project,
  QuoteKind,
  SourceFile,
} from 'ts-morph';
import { FieldSuggestion, LifecycleSuggestion } from '../analyzers/lifecycle/suggest';
import { ConfigError } from '../engine/errors';
import { ModuleSpecifiers } from './module-specifier';

const INITIAL_CONFIG = `import { defineDomain, lifecycle } from 'domain-integrity';

export default defineDomain({
  lifecycles: [],
});
`;

const configObject = (file: SourceFile): ObjectLiteralExpression => {
  const call = file.getExportAssignment((assignment) => !assignment.isExportEquals())?.getExpression();
  const config = Node.isCallExpression(call) ? call.getArguments()[0] : undefined;
  if (!Node.isObjectLiteralExpression(config)) {
    throw new ConfigError('domain.config.ts must "export default defineDomain({...})".');
  }
  return config;
};

const lifecyclesArray = (file: SourceFile): ArrayLiteralExpression => {
  const config = configObject(file);
  const property =
    config.getProperty('lifecycles') ?? config.addPropertyAssignment({ name: 'lifecycles', initializer: '[]' });
  const array = Node.isPropertyAssignment(property) ? property.getInitializer() : undefined;
  if (!Node.isArrayLiteralExpression(array)) throw new ConfigError('"lifecycles" in domain.config.ts must be an array literal.');
  return array;
};

const quoted = (name: string): string => `'${name}'`;

const listedNames = (array: ArrayLiteralExpression): readonly string[] =>
  array.getElements().flatMap((element) => (Node.isStringLiteral(element) ? [element.getLiteralValue()] : []));

const uniqueNames = (names: readonly string[]): readonly string[] => names.filter((name, index) => names.indexOf(name) === index);

const appendMissingNames = (array: ArrayLiteralExpression, names: readonly string[]): void => {
  const listed = listedNames(array);
  uniqueNames(names)
    .filter((name) => !listed.includes(name))
    .forEach((name) => array.addElement(quoted(name)));
};

export const recordBaseClasses = (
  file: SourceFile,
  names: readonly string[],
  implicitBaseClasses: readonly string[],
): void => {
  const config = configObject(file);
  const property = config.getProperty('aggregateBaseClasses');
  if (property === undefined) {
    config.insertPropertyAssignment(0, {
      name: 'aggregateBaseClasses',
      initializer: `[${uniqueNames([...implicitBaseClasses, ...names]).map(quoted).join(', ')}]`,
    });
    return;
  }
  const array = Node.isPropertyAssignment(property) ? property.getInitializer() : undefined;
  if (!Node.isArrayLiteralExpression(array)) {
    throw new ConfigError('"aggregateBaseClasses" in domain.config.ts must be an array literal.');
  }
  appendMissingNames(array, names);
};

const bindsName = (declaration: ImportDeclaration, name: string): boolean =>
  declaration.getDefaultImport()?.getText() === name ||
  declaration.getNamespaceImport()?.getText() === name ||
  declaration.getNamedImports().some((specifier) => (specifier.getAliasNode() ?? specifier.getNameNode()).getText() === name);

const bindingOf = (file: SourceFile, name: string): ImportDeclaration | undefined =>
  file.getImportDeclarations().find((declaration) => bindsName(declaration, name));

const addNamedImport = (file: SourceFile, name: string, alias: string | undefined, moduleSpecifier: string): void => {
  const existing = file.getImportDeclaration((declaration) => declaration.getModuleSpecifierValue() === moduleSpecifier);
  const specifier = { name, alias };
  if (existing) existing.addNamedImport(specifier);
  else file.addImportDeclaration({ moduleSpecifier, namedImports: [specifier] });
};

const ensureNamedImport = (file: SourceFile, name: string, moduleSpecifier: string): void => {
  if (bindingOf(file, name) === undefined) addNamedImport(file, name, undefined, moduleSpecifier);
};

const importsExportOf = (declaration: ImportDeclaration, local: string, name: string, target: string): boolean =>
  declaration.getModuleSpecifierSourceFile()?.getFilePath() === target &&
  declaration
    .getNamedImports()
    .some((specifier) => specifier.getName() === name && (specifier.getAliasNode() ?? specifier.getNameNode()).getText() === local);

const candidateLocalName = (name: string, attempt: number): string => (attempt === 1 ? name : `${name}${attempt}`);

const bindExport = (
  file: SourceFile,
  specifierOf: ModuleSpecifiers,
  name: string,
  target: string,
  attempt = 1,
): string => {
  const local = candidateLocalName(name, attempt);
  const binding = bindingOf(file, local);
  if (binding === undefined) {
    addNamedImport(file, name, local === name ? undefined : local, specifierOf(file, target));
    return local;
  }
  return importsExportOf(binding, local, name, target)
    ? local
    : bindExport(file, specifierOf, name, target, attempt + 1);
};

const renamedEnumSource = (source: string, enumName: string, local: string): string =>
  source.startsWith(`${enumName}.`) ? `${local}${source.slice(enumName.length)}` : source;

const terminalSources = (
  file: SourceFile,
  specifierOf: ModuleSpecifiers,
  { field, terminal }: FieldSuggestion,
): readonly string[] => {
  const reference = field.enumReference;
  if (reference === undefined) return terminal.map((value) => value.source);
  const local = bindExport(file, specifierOf, reference.name, reference.file);
  return terminal.map((value) => renamedEnumSource(value.source, reference.name, local));
};

const fieldSource = (file: SourceFile, specifierOf: ModuleSpecifiers, suggestion: FieldSuggestion): string =>
  `${suggestion.field.name}: { terminal: [${terminalSources(file, specifierOf, suggestion).join(', ')}] }`;

const lifecycleSource = (file: SourceFile, specifierOf: ModuleSpecifiers, suggestion: LifecycleSuggestion): string => {
  const target = bindExport(file, specifierOf, suggestion.className, suggestion.file);
  const fields = suggestion.fields.map((field) => fieldSource(file, specifierOf, field)).join(', ');
  return `lifecycle(${target}, { states: { ${fields} } })`;
};

const createConfig = (project: Project, configPath: string): SourceFile => {
  project.manipulationSettings.set({ indentationText: IndentationText.TwoSpaces });
  return project.createSourceFile(configPath, INITIAL_CONFIG);
};

export const openConfig = (project: Project, configPath: string): SourceFile =>
  project.addSourceFileAtPathIfExists(configPath) ?? createConfig(project, configPath);

const useSingleQuotes = (file: SourceFile): void => {
  file.getProject().manipulationSettings.set({ quoteKind: QuoteKind.Single });
};

export const addLifecycles = (
  file: SourceFile,
  specifierOf: ModuleSpecifiers,
  suggestions: readonly LifecycleSuggestion[],
): void => {
  useSingleQuotes(file);
  const lifecycles = lifecyclesArray(file);
  ensureNamedImport(file, 'lifecycle', 'domain-integrity');
  suggestions.forEach((suggestion) => lifecycles.addElement(lifecycleSource(file, specifierOf, suggestion)));
};
