import { relative, resolve } from 'node:path';
import { DomainDeclaration } from '../engine/declaration';
import { Paths } from './io';
import { noAggregatesFound } from './session';

const DEFAULT_TSCONFIG = 'tsconfig.json';
const DEFAULT_CONFIG = 'domain.config.ts';

const pathOption = (flag: string, path: string, defaultPath: string, cwd: string): readonly string[] =>
  path === resolve(cwd, defaultPath) ? [] : [flag, relative(cwd, path)];

export const initRetryCommand = (paths: Paths, cwd: string, yes: boolean): string =>
  [
    'npx domain-integrity init --base-class <Name>',
    ...pathOption('-p', paths.tsconfig, DEFAULT_TSCONFIG, cwd),
    ...pathOption('-c', paths.config, DEFAULT_CONFIG, cwd),
    ...(yes ? ['--yes'] : []),
  ].join(' ');

export const noAggregatesForInitMessage = (declaration: DomainDeclaration, retryCommand: string): string =>
  `${noAggregatesFound(declaration)} Run it again with the base class or interface your aggregates extend or implement, repeating --base-class for each one: ${retryCommand}`;
