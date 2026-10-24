import {
  ArrayLiteralExpression,
  ImportDeclaration,
  IndentationText,
  NewLineKind,
  Node,
  ObjectLiteralExpression,
  Project,
  QuoteKind,
  SourceFile,
  SyntaxKind,
  ts,
} from 'ts-morph';
import { ValueSource } from '../analyzers/lifecycle/model';
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
    throw new ConfigError(`${file.getBaseName()} must "export default defineDomain({...})".`);
  }
  return config;
};

const INDENTATIONS: readonly IndentationText[] = Object.values(IndentationText);

const lineIndentationOf = (node: Node): string =>
  /^[ \t]*/.exec(node.getSourceFile().getFullText().slice(node.getStartLinePos()))?.[0] ?? '';

const startsLine = (node: Node): boolean => node.getStart() === node.getStartLinePos() + lineIndentationOf(node).length;

const indentationOf = (config: ObjectLiteralExpression): IndentationText => {
  const first = config.getProperties()[0];
  const opening = lineIndentationOf(config);
  const written = first !== undefined && startsLine(first) ? lineIndentationOf(first) : undefined;
  const unit = written?.startsWith(opening) ? written.slice(opening.length) : undefined;
  return INDENTATIONS.find((indentation) => indentation === unit) ?? IndentationText.TwoSpaces;
};

const occurrencesIn = (text: string, part: string): number => text.split(part).length - 1;

const newLineKindOf = (file: SourceFile): NewLineKind => {
  const text = file.getFullText();
  const crlf = occurrencesIn(text, '\r\n');
  const bareLf = occurrencesIn(text, '\n') - crlf;
  return crlf > bareLf ? NewLineKind.CarriageReturnLineFeed : NewLineKind.LineFeed;
};

const importsQuoteKind = (file: SourceFile): QuoteKind | undefined => {
  const kinds = file.getImportDeclarations().map((declaration) => declaration.getModuleSpecifier().getQuoteKind());
  const doubles = kinds.filter((kind) => kind === QuoteKind.Double).length;
  const singles = kinds.length - doubles;
  if (doubles === singles) return undefined;
  return doubles > singles ? QuoteKind.Double : QuoteKind.Single;
};

const quoteKindOf = (file: SourceFile): QuoteKind =>
  importsQuoteKind(file) ?? file.getFirstDescendantByKind(SyntaxKind.StringLiteral)?.getQuoteKind() ?? QuoteKind.Single;

const useLayoutOf = (file: SourceFile): void => {
  file.getProject().manipulationSettings.set({
    indentationText: indentationOf(configObject(file)),
    newLineKind: newLineKindOf(file),
    quoteKind: quoteKindOf(file),
  });
};

const quoteKindIn = (file: SourceFile): QuoteKind => file.getProject().manipulationSettings.getQuoteKind();

const SINGLE_QUOTED_ESCAPES: ReadonlyMap<string, string> = new Map([
  ['\\"', '"'],
  ["'", "\\'"],
]);

const inSingleQuotes = (value: string): string =>
  `'${JSON.stringify(value)
    .slice(1, -1)
    .replace(/\\.|'/g, (written) => SINGLE_QUOTED_ESCAPES.get(written) ?? written)}'`;

const inQuotes = (value: string, quoteKind: QuoteKind): string =>
  quoteKind === QuoteKind.Double ? JSON.stringify(value) : inSingleQuotes(value);

const writtenSource = (source: ValueSource, quoteKind: QuoteKind): string =>
  source.kind === 'string' ? inQuotes(source.value, quoteKind) : source.text;

const listedNames = (array: ArrayLiteralExpression): readonly string[] =>
  array.getElements().flatMap((element) => (Node.isStringLiteral(element) ? [element.getLiteralValue()] : []));

const uniqueNames = (names: readonly string[]): readonly string[] => names.filter((name, index) => names.indexOf(name) === index);

const appendMissingNames = (array: ArrayLiteralExpression, names: readonly string[], quoteKind: QuoteKind): void => {
  const listed = listedNames(array);
  uniqueNames(names)
    .filter((name) => !listed.includes(name))
    .forEach((name) => array.addElement(inQuotes(name, quoteKind)));
};

const arrayInitializer = (property: Node | undefined, option: string): ArrayLiteralExpression | undefined => {
  if (property === undefined) return undefined;
  const array = Node.isPropertyAssignment(property) ? property.getInitializer() : undefined;
  if (!Node.isArrayLiteralExpression(array)) throw new ConfigError(`"${option}" in ${property.getSourceFile().getBaseName()} must be an array literal.`);
  return array;
};

const propertyNamed = (object: ObjectLiteralExpression, name: string): Node | undefined =>
  object.getProperties().find((property) => {
    const nameNode = Node.isPropertyAssignment(property) ? property.getNameNode() : undefined;
    return Node.isStringLiteral(nameNode) ? nameNode.getLiteralText() === name : nameNode?.getText() === name;
  });

const lifecyclesArray = (file: SourceFile): ArrayLiteralExpression => {
  const config = configObject(file);
  const property =
    propertyNamed(config, 'lifecycles') ?? config.addPropertyAssignment({ name: 'lifecycles', initializer: '[]' });
  const array = Node.isPropertyAssignment(property) ? property.getInitializer() : undefined;
  if (!Node.isArrayLiteralExpression(array)) throw new ConfigError(`"lifecycles" in ${file.getBaseName()} must be an array literal.`);
  return array;
};

const aggregatesGroup = (config: ObjectLiteralExpression): ObjectLiteralExpression | undefined => {
  const property = propertyNamed(config, 'aggregates');
  if (property === undefined) return undefined;
  const group = Node.isPropertyAssignment(property) ? property.getInitializer() : undefined;
  if (!Node.isObjectLiteralExpression(group)) throw new ConfigError(`"aggregates" in ${config.getSourceFile().getBaseName()} must be an object literal.`);
  return group;
};

export const recordBaseClasses = (
  file: SourceFile,
  names: readonly string[],
  implicitBaseClasses: readonly string[],
): void => {
  useLayoutOf(file);
  const quoteKind = quoteKindIn(file);
  const config = configObject(file);
  const group = aggregatesGroup(config);
  const listed =
    arrayInitializer(group === undefined ? undefined : propertyNamed(group, 'baseClasses'), 'aggregates.baseClasses') ??
    arrayInitializer(propertyNamed(config, 'aggregateBaseClasses'), 'aggregateBaseClasses');
  if (listed !== undefined) {
    appendMissingNames(listed, names, quoteKind);
    return;
  }
  const baseClasses = `[${uniqueNames([...implicitBaseClasses, ...names])
    .map((name) => inQuotes(name, quoteKind))
    .join(', ')}]`;
  if (group !== undefined) group.insertPropertyAssignment(0, { name: 'baseClasses', initializer: baseClasses });
  else config.insertPropertyAssignment(0, { name: 'aggregates', initializer: `{ baseClasses: ${baseClasses} }` });
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
  const written = terminal.map((value) => writtenSource(value.source, quoteKindIn(file)));
  if (reference === undefined || written.length === 0) return written;
  const local = bindExport(file, specifierOf, reference.name, reference.file);
  return written.map((source) => renamedEnumSource(source, reference.name, local));
};

type Lines = readonly string[];

const indented = (unit: string, lines: Lines): Lines => lines.map((line) => `${unit}${line}`);

const terminalSource = (sources: readonly string[]): string => {
  const [only, ...rest] = sources;
  return only !== undefined && rest.length === 0 ? only : `[${sources.join(', ')}]`;
};

const fieldSource = (file: SourceFile, specifierOf: ModuleSpecifiers, suggestion: FieldSuggestion): string =>
  `${suggestion.field.name}: { terminal: ${terminalSource(terminalSources(file, specifierOf, suggestion))} },`;

const lifecycleLines = (
  file: SourceFile,
  specifierOf: ModuleSpecifiers,
  suggestion: LifecycleSuggestion,
  unit: string,
): Lines => {
  const target = bindExport(file, specifierOf, suggestion.className, suggestion.file);
  const fields = suggestion.fields.map((field) => fieldSource(file, specifierOf, field));
  return [`lifecycle(${target}, {`, ...indented(unit, ['states: {', ...indented(unit, fields), '},']), '}),'];
};

const asText = (lines: Lines): string => lines.map((line) => `${line}\n`).join('');

const isSingleLine = (array: ArrayLiteralExpression): boolean => array.getStartLineNumber() === array.getEndLineNumber();

const closingBracketPosition = (array: ArrayLiteralExpression): number => array.getEnd() - 1;

const scannerOf = (text: string): ts.Scanner =>
  ts.createScanner(ts.ScriptTarget.Latest, true, ts.LanguageVariant.Standard, text);

const separatorOffsetIn = (trivia: string): number | undefined => {
  const scanner = scannerOf(trivia);
  return scanner.scan() === ts.SyntaxKind.CommaToken ? scanner.getTokenStart() : undefined;
};

const separatorPositions = (array: ArrayLiteralExpression): readonly number[] => {
  const text = array.getSourceFile().getFullText();
  const elements = array.getElements();
  const gapEnds = [...elements.slice(1).map((element) => element.getStart()), closingBracketPosition(array)];
  return elements.flatMap((element, index) => {
    const offset = separatorOffsetIn(text.slice(element.getEnd(), gapEnds[index]));
    return offset === undefined ? [] : [element.getEnd() + offset];
  });
};

const separatedPieces = (array: ArrayLiteralExpression): readonly string[] => {
  const text = array.getSourceFile().getFullText();
  const separators = separatorPositions(array);
  const starts = [array.getStart() + 1, ...separators.map((position) => position + 1)];
  const ends = [...separators, closingBracketPosition(array)];
  return starts.map((start, index) => text.slice(start, ends[index]).trim());
};

const existingLinesOf = (array: ArrayLiteralExpression): Lines => {
  const elementCount = array.getElements().length;
  const pieces = separatedPieces(array);
  const trailing = pieces.slice(elementCount).filter((piece) => piece !== '');
  return [...pieces.slice(0, elementCount).map((piece) => `${piece},`), ...trailing];
};

const spreadOverLines = (array: ArrayLiteralExpression, added: Lines, elementIndent: string, closingIndent: string): void => {
  const lines = asText(indented(elementIndent, [...existingLinesOf(array), ...added]));
  array.getSourceFile().replaceText([array.getStart(), array.getEnd()], `[\n${lines}${closingIndent}]`);
};

const appendBeforeClosingBracket = (array: ArrayLiteralExpression, added: Lines, elementIndent: string, closingIndent: string): void => {
  const file = array.getSourceFile();
  const text = file.getFullText();
  const last = array.getElements().at(-1);
  const afterLast = last?.getEnd() ?? array.getStart() + 1;
  const closingBracket = closingBracketPosition(array);
  const contentEnd = afterLast + text.slice(afterLast, closingBracket).trimEnd().length;
  const needsSeparator = last !== undefined && !array.compilerNode.elements.hasTrailingComma;
  file.replaceText([contentEnd, closingBracket], `\n${asText(indented(elementIndent, added))}${closingIndent}`);
  if (needsSeparator) file.insertText(afterLast, ',');
};

const appendElements = (array: ArrayLiteralExpression, added: Lines, unit: string): void => {
  const closingIndent = lineIndentationOf(array.getParentOrThrow());
  const elementIndent = `${closingIndent}${unit}`;
  const append = isSingleLine(array) ? spreadOverLines : appendBeforeClosingBracket;
  append(array, added, elementIndent, closingIndent);
};

const createConfig = (project: Project, configPath: string): SourceFile => project.createSourceFile(configPath, INITIAL_CONFIG);

export const openConfig = (project: Project, configPath: string): SourceFile =>
  project.addSourceFileAtPathIfExists(configPath) ?? createConfig(project, configPath);

export const addLifecycles = (
  file: SourceFile,
  specifierOf: ModuleSpecifiers,
  suggestions: readonly LifecycleSuggestion[],
): void => {
  useLayoutOf(file);
  const lifecycles = lifecyclesArray(file);
  ensureNamedImport(file, 'lifecycle', 'domain-integrity');
  const unit = file.getProject().manipulationSettings.getIndentationText();
  const added = suggestions.flatMap((suggestion) => lifecycleLines(file, specifierOf, suggestion, unit));
  appendElements(lifecycles, added, unit);
};
