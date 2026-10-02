import { UsageError } from '../engine/errors';
import { Io, Paths } from './io';
import { openSession } from './session';

export const showCommand = (paths: Paths, aggregate: string | undefined, io: Io): number => {
  const { results } = openSession(paths);
  const output = results
    .map((result) => result.diagram(aggregate))
    .filter((diagram) => diagram.length > 0)
    .join('\n\n');
  if (output.length === 0) {
    throw new UsageError(
      aggregate ? `No declared aggregate named "${aggregate}".` : 'No declared aggregates to show. Run "domain-integrity init" first.',
    );
  }
  io.out(`${output}\n`);
  return 0;
};
