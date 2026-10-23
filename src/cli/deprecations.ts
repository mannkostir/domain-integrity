import { Deprecation } from '../engine/declaration';
import { Io } from './io';

export const deprecationWarning = (configLabel: string, { line, old, replacement }: Deprecation): string =>
  `warning: ${configLabel}:${line} "${old}" is deprecated; use "${replacement}". Old names stop working in 1.0.\n`;

export const reportDeprecations = (deprecations: readonly Deprecation[], configLabel: string, io: Io): void =>
  deprecations.forEach((deprecation) => io.err(deprecationWarning(configLabel, deprecation)));
