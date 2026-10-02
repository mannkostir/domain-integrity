import { ArrayLiteralExpression, ImportDeclaration, Node, Project, QuoteKind, SourceFile } from 'ts-morph';
import { FieldSuggestion, LifecycleSuggestion } from '../analyzers/lifecycle/suggest';
import { ConfigError } from '../engine/errors';

const INITIAL_CONFIG = `import { defineDomain, lifecycle } from 'domain-integrity';

export default defineDomain({
  lifecycles: [],
});
`;

const lifecyclesArray = (file: SourceFile): ArrayLiteralExpression => {
  const call = file.getExportAssignment((assignment) => !assignment.isExportEquals())?.getExpression();
  const config = Node.isCallExpression(call) ? call.getArguments()[0] : undefined;
  if (!Node.isObjectLiteralExpression(config)) {
    throw new ConfigError('domain.config.ts must "export default defineDomain({...})".');
  }
  const property =
    config.getProperty('lifecycles') ?? config.addPropertyAssignment({ name: 'lifecycles', initializer: '[]' });
  const array = Node.isPropertyAssignment(property) ? property.getInitializer() : undefined;
  if (!Node.isArrayLiteralExpression(array)) throw new ConfigError('"lifecycles" in domain.config.ts must be an array literal.');
  return array;
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

const bindExport = (file: SourceFile, name: string, target: string, attempt = 1): string => {
  const local = candidateLocalName(name, attempt);
  const binding = bindingOf(file, local);
  if (binding === undefined) {
    addNamedImport(file, name, local === name ? undefined : local, file.getRelativePathAsModuleSpecifierTo(target));
    return local;
  }
  return importsExportOf(binding, local, name, target) ? local : bindExport(file, name, target, attempt + 1);
};

const renamedEnumSource = (source: string, enumName: string, local: string): string =>
  source.startsWith(`${enumName}.`) ? `${local}${source.slice(enumName.length)}` : source;

const terminalSources = (file: SourceFile, { field, terminal }: FieldSuggestion): readonly string[] => {
  const reference = field.enumReference;
  if (reference === undefined) return terminal.map((value) => value.source);
  const local = bindExport(file, reference.name, reference.file);
  return terminal.map((value) => renamedEnumSource(value.source, reference.name, local));
};

const fieldSource = (file: SourceFile, suggestion: FieldSuggestion): string =>
  `${suggestion.field.name}: { terminal: [${terminalSources(file, suggestion).join(', ')}] }`;

const lifecycleSource = (file: SourceFile, suggestion: LifecycleSuggestion): string => {
  const target = bindExport(file, suggestion.className, suggestion.file);
  const fields = suggestion.fields.map((field) => fieldSource(file, field)).join(', ');
  return `lifecycle(${target}, { states: { ${fields} } })`;
};

export const writeSuggestions = (
  project: Project,
  configPath: string,
  suggestions: readonly LifecycleSuggestion[],
): SourceFile => {
  project.manipulationSettings.set({ quoteKind: QuoteKind.Single });
  const file = project.getSourceFile(configPath) ?? project.createSourceFile(configPath, INITIAL_CONFIG);
  const lifecycles = lifecyclesArray(file);
  ensureNamedImport(file, 'lifecycle', 'domain-integrity');
  suggestions.forEach((suggestion) => lifecycles.addElement(lifecycleSource(file, suggestion)));
  return file;
};
