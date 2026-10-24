import { resolve } from 'node:path';
import { DomainDeclaration } from '../engine/declaration';
import { toPosixRelative } from '../engine/path';
import { DEFAULT_CONFIG, DEFAULT_TSCONFIG, Paths } from './io';
import { noAggregatesFound } from './session';

const SHELL_SAFE = /^[\w@%+=:,./-]+$/;

const shellQuoted = (argument: string): string =>
  SHELL_SAFE.test(argument) ? argument : `'${argument.replaceAll("'", "'\\''")}'`;

const pathOption = (flag: string, path: string, defaultPath: string, cwd: string): readonly string[] =>
  path === resolve(cwd, defaultPath) ? [] : [flag, shellQuoted(toPosixRelative(cwd, path))];

export const initRetryCommand = (paths: Paths, cwd: string, yes: boolean): string =>
  [
    'npx domain-integrity init --base-class <Name>',
    ...pathOption('-p', paths.tsconfig, DEFAULT_TSCONFIG, cwd),
    ...pathOption('-c', paths.config, DEFAULT_CONFIG, cwd),
    ...(yes ? ['--yes'] : []),
  ].join(' ');

export const noAggregatesForInitMessage = (declaration: DomainDeclaration, retryCommand: string): string =>
  `${noAggregatesFound(declaration)} Run init again naming the base class or interface your aggregates extend or implement, repeating --base-class for each one: ${retryCommand}`;
