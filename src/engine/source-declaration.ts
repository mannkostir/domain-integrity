import { dirname, resolve } from 'node:path';
import { ClassDeclaration, SourceFile } from 'ts-morph';

const mappedFile = (file: SourceFile): string | undefined => {
  const match = /(?:^|\n)\/\/# sourceMappingURL=([^\r\n]+)\s*$/.exec(file.getFullText());
  if (match === null) return undefined;
  try {
    const mapPath = resolve(dirname(file.getFilePath()), match[1]!);
    const data: unknown = JSON.parse(file.getProject().getFileSystem().readFileSync(mapPath));
    if (typeof data !== 'object' || data === null) return undefined;
    const map = data as Record<string, unknown>;
    const sources = map.sources;
    if (map.version !== 3 || !Array.isArray(sources) || sources.length !== 1 || typeof sources[0] !== 'string') return undefined;
    if (map.sourceRoot !== undefined && typeof map.sourceRoot !== 'string') return undefined;
    return resolve(dirname(mapPath), map.sourceRoot ?? '', sources[0]);
  } catch {
    return undefined;
  }
};

export const sourceDeclaration = (
  cls: ClassDeclaration,
  files: readonly SourceFile[],
): ClassDeclaration | undefined => {
  if (files.includes(cls.getSourceFile())) return cls;
  if (!cls.getSourceFile().isDeclarationFile()) return undefined;
  const path = mappedFile(cls.getSourceFile());
  const mapped = path === undefined ? undefined : cls.getProject().getSourceFile(path);
  const file = mapped !== undefined && files.includes(mapped) ? mapped : undefined;
  const candidates = file?.getClasses().filter((candidate) => candidate.getName() === cls.getName()) ?? [];
  return candidates.length === 1 ? candidates[0] : undefined;
};
