import { describe, expect, it } from 'vitest';
import { run } from '../../src/cli/run';
import { captureIo, writeTree } from '../helpers/disk';

const helpFor = async (argv: readonly string[], helpWidth = 80) => {
  const { io, stdout, stderr } = captureIo(writeTree({}), [], { helpWidth });
  const code = await run(argv, io);
  return { code, stdout: stdout(), stderr: stderr() };
};

const ROOT_HELP = `Usage: domain-integrity [options] [command]

Check aggregate lifecycles and in-process event flows against their declared
intent.

Options:
  -V, --version          print the version
  -h, --help             display help for command

Commands:
  check [options]        check the code against the config and report findings
  show [options] [name]  print Mermaid diagrams of lifecycles and event flows
  context [options]      print or write the domain summary for coding agents
  init [options]         suggest and write lifecycle declarations to the config
  help [command]         display help for command

Examples:
  domain-integrity init
  domain-integrity check
  domain-integrity check -p packages/orders --format sarif
  domain-integrity show Order
  domain-integrity context --write AGENTS.md

Docs: https://github.com/mannkostir/domain-integrity#readme
`;

const CHECK_HELP = `Usage: domain-integrity check [options]

check the code against the config and report findings

Options:
  -p, --project <path>  path to tsconfig.json, or the directory that contains it
                        (default: "tsconfig.json")
  -c, --config <path>   path to the config file (default: "domain.config.ts")
  --format <format>     report format: text, json or sarif (default: "text")
  --baseline <path>     baseline file whose findings count as known (default:
                        domain-integrity.baseline.json, when it exists)
  --update-baseline     write the current findings to the --baseline file, or to
                        domain-integrity.baseline.json
  --show-known          list findings accepted by the baseline or suppressed in
                        the config in the text output
  -h, --help            display help for command

Docs: https://github.com/mannkostir/domain-integrity#readme
`;

const SHOW_HELP = `Usage: domain-integrity show [options] [name]

print Mermaid diagrams of lifecycles and event flows

Arguments:
  name                  aggregate class, event, or path:Class to show; all when
                        omitted

Options:
  -p, --project <path>  path to tsconfig.json, or the directory that contains it
                        (default: "tsconfig.json")
  -c, --config <path>   path to the config file (default: "domain.config.ts")
  -h, --help            display help for command

Docs: https://github.com/mannkostir/domain-integrity#readme
`;

const NARROW_SHOW_HELP = `Usage: domain-integrity show [options] [name]

print Mermaid diagrams of lifecycles and event flows

Arguments:
  name                  aggregate class, event, or path:Class to
                        show; all when omitted

Options:
  -p, --project <path>  path to tsconfig.json, or the directory
                        that contains it (default:
                        "tsconfig.json")
  -c, --config <path>   path to the config file (default:
                        "domain.config.ts")
  -h, --help            display help for command

Docs: https://github.com/mannkostir/domain-integrity#readme
`;

const CONTEXT_HELP = `Usage: domain-integrity context [options]

print or write the domain summary for coding agents

Options:
  -p, --project <path>  path to tsconfig.json, or the directory that contains it
                        (default: "tsconfig.json")
  -c, --config <path>   path to the config file (default: "domain.config.ts")
  --write <file>        replace the marked domain-integrity section of this
                        file, adding the section when the file has none and
                        creating the file when missing
  -h, --help            display help for command

Docs: https://github.com/mannkostir/domain-integrity#readme
`;

describe('help', () => {
  it('describes the commands and ends with examples and the docs link', async () => {
    const result = await helpFor(['--help']);

    expect(result).toEqual({ code: 0, stdout: ROOT_HELP, stderr: '' });
  });

  it('describes what each check option takes', async () => {
    const result = await helpFor(['check', '--help']);

    expect(result).toEqual({ code: 0, stdout: CHECK_HELP, stderr: '' });
  });

  it('describes the names show accepts', async () => {
    const result = await helpFor(['show', '--help']);

    expect(result).toEqual({ code: 0, stdout: SHOW_HELP, stderr: '' });
  });

  it('wraps the help to a narrower terminal', async () => {
    const result = await helpFor(['show', '--help'], 64);

    expect(result).toEqual({ code: 0, stdout: NARROW_SHOW_HELP, stderr: '' });
  });

  it('describes how context writes into a file', async () => {
    const result = await helpFor(['context', '--help']);

    expect(result).toEqual({ code: 0, stdout: CONTEXT_HELP, stderr: '' });
  });
});
