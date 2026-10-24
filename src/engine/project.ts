import { existsSync } from 'node:fs';
import { Project, SourceFile, ts } from 'ts-morph';
import { ConfigError, ProjectError } from './errors';
import { toNativePath } from './path';
import { readReferencesFromDisk, referencedTsconfigs } from './references';

const isProjectSource = (file: SourceFile): boolean => !file.isDeclarationFile() && !file.isInNodeModules();

export const loadedSourceFiles = (count: number): string => `Loaded ${count} ${count === 1 ? 'source file' : 'source files'}.`;

const includesClause = (tsconfigPath: string, references: readonly string[]): string =>
  references.length === 0 ? `${tsconfigPath} includes` : `${tsconfigPath} and the tsconfigs it references include`;

const noSourcesSentence = (includes: string, configFile: SourceFile | undefined): string =>
  configFile === undefined ? `${includes} no source files.` : `${includes} no source files other than ${toNativePath(configFile.getFilePath())}.`;

const emptyProgramMessage = (tsconfigPath: string, references: readonly string[], configFile: SourceFile | undefined): string =>
  [
    loadedSourceFiles(0),
    noSourcesSentence(includesClause(tsconfigPath, references), configFile),
    ...(references.length === 0 ? ['Pass -p with a tsconfig that includes your code, or add "references" to the tsconfigs that do.'] : []),
  ].join('\n');

const loadFailure = (tsconfigPath: string, error: unknown): ProjectError =>
  new ProjectError(`Cannot load ${tsconfigPath}: ${error instanceof Error ? error.message : String(error)}`);

const TYPESCRIPT_EXTENSIONS: readonly string[] = [ts.Extension.Ts, ts.Extension.Tsx, ts.Extension.Mts, ts.Extension.Cts];

const JAVASCRIPT_EXTENSIONS: readonly string[] = [ts.Extension.Js, ts.Extension.Jsx, ts.Extension.Mjs, ts.Extension.Cjs];

const allowsJavaScript = (options: ts.CompilerOptions): boolean => options.allowJs ?? options.checkJs ?? false;

const supportedExtensions = (options: ts.CompilerOptions): readonly string[] =>
  allowsJavaScript(options) ? [...TYPESCRIPT_EXTENSIONS, ...JAVASCRIPT_EXTENSIONS] : TYPESCRIPT_EXTENSIONS;

const hasSupportedExtension = (path: string, extensions: readonly string[]): boolean =>
  extensions.some((extension) => path.endsWith(extension));

const addSupportedFilesOf = (project: Project, reference: string): void => {
  const extensions = supportedExtensions(project.getCompilerOptions());
  project
    .addSourceFilesFromTsConfig(reference)
    .filter((file) => !hasSupportedExtension(file.getFilePath(), extensions))
    .forEach((file) => project.removeSourceFile(file));
};

const projectFrom = (tsconfigPath: string, references: readonly string[]): Project => {
  try {
    const project = new Project({ tsConfigFilePath: tsconfigPath });
    references.forEach((reference) => addSupportedFilesOf(project, reference));
    project.resolveSourceFileDependencies();
    return project;
  } catch (error) {
    throw loadFailure(tsconfigPath, error);
  }
};

export const analysedSourceFiles = (project: Project, excluded?: SourceFile): SourceFile[] =>
  project.getSourceFiles().filter((file) => file !== excluded && isProjectSource(file));

export const loadProject = (tsconfigPath: string, configPath: string): Project => {
  if (!existsSync(tsconfigPath)) throw new ProjectError(`tsconfig not found: ${tsconfigPath}`);
  const references = referencedTsconfigs(tsconfigPath, readReferencesFromDisk);
  const project = projectFrom(tsconfigPath, references);
  const configFile = project.getSourceFile(configPath);
  if (analysedSourceFiles(project, configFile).length === 0) {
    throw new ProjectError(emptyProgramMessage(tsconfigPath, references, configFile));
  }
  return project;
};

export const configSourceFile = (project: Project, configPath: string): SourceFile => {
  const loaded = project.getSourceFile(configPath);
  if (loaded) return loaded;
  if (!project.getFileSystem().fileExistsSync(configPath)) {
    throw new ConfigError(`${configPath} not found. Run "domain-integrity init" to create it.`);
  }
  return project.addSourceFileAtPath(configPath);
};
