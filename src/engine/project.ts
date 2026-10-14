import { existsSync } from 'node:fs';
import { Project, SourceFile, ts } from 'ts-morph';
import { ConfigError, ProjectError } from './errors';
import { readReferencesFromDisk, referencedTsconfigs } from './references';

export const isProjectSource = (file: SourceFile): boolean => !file.isDeclarationFile() && !file.isInNodeModules();

const emptyProgramMessage = (tsconfigPath: string, references: readonly string[]): string =>
  references.length === 0
    ? `${tsconfigPath} includes no source files. Pass -p with a tsconfig that includes your code, or add "references" to the tsconfigs that do.`
    : `${tsconfigPath} and the tsconfigs it references include no source files.`;

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

export const loadProject = (tsconfigPath: string): Project => {
  if (!existsSync(tsconfigPath)) throw new ProjectError(`tsconfig not found: ${tsconfigPath}`);
  const references = referencedTsconfigs(tsconfigPath, readReferencesFromDisk);
  const project = projectFrom(tsconfigPath, references);
  if (!project.getSourceFiles().some(isProjectSource)) throw new ProjectError(emptyProgramMessage(tsconfigPath, references));
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

export const analysedSourceFiles = (project: Project, excluded?: SourceFile): SourceFile[] =>
  project.getSourceFiles().filter((file) => file !== excluded && isProjectSource(file));
