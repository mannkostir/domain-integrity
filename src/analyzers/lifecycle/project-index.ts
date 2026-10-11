import { SourceFile } from 'ts-morph';
import { SourceIndex } from '../shared/source-index';
import { BracketWrites } from '../shared/writes';
import { EnumReferences } from './enum-references';
import { Subclasses } from './subclasses';

export type ProjectIndex = {
  readonly sources: SourceIndex;
  readonly bracketWrites: BracketWrites;
  readonly enumReferences: EnumReferences;
  readonly subclasses: Subclasses;
};

export const projectIndex = (files: readonly SourceFile[]): ProjectIndex => {
  const sources = new SourceIndex(files);
  return {
    sources,
    bracketWrites: new BracketWrites(sources),
    enumReferences: new EnumReferences(sources),
    subclasses: new Subclasses(sources),
  };
};
