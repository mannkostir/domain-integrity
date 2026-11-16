import { SourceFile } from 'ts-morph';
import { NameUses } from '../shared/name-uses';
import { SourceIndex } from '../shared/source-index';
import { BracketWrites } from '../shared/writes';
import { JavaScriptDataProperties } from './javascript-data';
import { EnumReferences } from './enum-references';
import { UnrelatedParameterOrigins } from './scalar-argument-origin';
import { Subclasses } from './subclasses';

export type ProjectIndex = {
  readonly sources: SourceIndex;
  readonly parameterOrigins: UnrelatedParameterOrigins;
  readonly javascriptData: JavaScriptDataProperties;
  readonly bracketWrites: BracketWrites;
  readonly nameUses: NameUses;
  readonly enumReferences: EnumReferences;
  readonly subclasses: Subclasses;
};

export const projectIndex = (files: readonly SourceFile[]): ProjectIndex => {
  const sources = new SourceIndex(files);
  return {
    sources,
    parameterOrigins: new UnrelatedParameterOrigins(sources),
    javascriptData: new JavaScriptDataProperties(sources),
    bracketWrites: new BracketWrites(sources),
    nameUses: new NameUses(sources),
    enumReferences: new EnumReferences(sources),
    subclasses: new Subclasses(sources),
  };
};
