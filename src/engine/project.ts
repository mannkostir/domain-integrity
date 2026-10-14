import { existsSync } from 'node:fs';
import { Project, SourceFile } from 'ts-morph';
import { ConfigError, ProjectError } from './errors';

export const loadProject = (tsconfigPath: string): Project => {
  if (!existsSync(tsconfigPath)) throw new ProjectError(`tsconfig not found: ${tsconfigPath}`);
  try {
    return new Project({ tsConfigFilePath: tsconfigPath });
  } catch (error) {
    throw new ProjectError(`Cannot load ${tsconfigPath}: ${error instanceof Error ? error.message : String(error)}`);
  }
};

export const configSourceFile = (project: Project, configPath: string): SourceFile => {
  const loaded = project.getSourceFile(configPath);
  if (loaded) return loaded;
  if (!project.getFileSystem().fileExistsSync(configPath)) {
    throw new ConfigError(`${configPath} not found. Run "domain-integrity init" to create it.`);
  }
  return project.addSourceFileAtPath(configPath);
};

export const isProjectSource = (file: SourceFile): boolean => !file.isDeclarationFile() && !file.isInNodeModules();

export const analysedSourceFiles = (project: Project, excluded?: SourceFile): SourceFile[] =>
  project.getSourceFiles().filter((file) => file !== excluded && isProjectSource(file));
