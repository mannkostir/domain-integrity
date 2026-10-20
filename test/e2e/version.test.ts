import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { EVENT_FLOW_RULES } from '../../src/analyzers/event-flow/checks/rules';
import { LIFECYCLE_RULES } from '../../src/analyzers/lifecycle/checks/rules';
import { run } from '../../src/cli/run';
import { captureIo } from '../helpers/disk';
import { MANIFEST } from '../helpers/manifest';

const OUTSIDE_SPEC = fileURLToPath(new URL('../fixtures/outside-spec', import.meta.url));

const ALL_RULES = [...LIFECYCLE_RULES, ...EVENT_FLOW_RULES];

type SarifRule = { readonly id: string; readonly helpUri?: string };

const runIn = async (argv: readonly string[]) => {
  const { io, stdout } = captureIo(OUTSIDE_SPEC);
  const code = await run(argv, io);
  return { code, stdout: stdout() };
};

describe('tool version', () => {
  it('prints the package version for --version and exits 0', async () => {
    const result = await runIn(['--version']);

    expect(result).toEqual({ code: 0, stdout: `${MANIFEST.version}\n` });
  });

  it('prints the package version for -V and exits 0', async () => {
    const result = await runIn(['-V']);

    expect(result).toEqual({ code: 0, stdout: `${MANIFEST.version}\n` });
  });

  it('lists the version flag in the help', async () => {
    const { stdout } = await runIn(['--help']);

    expect(stdout).toContain('-V, --version');
  });

  it('names the tool and its version in the JSON report', async () => {
    const { stdout } = await runIn(['check', '--format', 'json']);

    expect(JSON.parse(stdout).tool).toEqual({ name: 'domain-integrity', version: MANIFEST.version });
  });

  it('carries the package version in the SARIF driver', async () => {
    const { stdout } = await runIn(['check', '--format', 'sarif']);

    expect(JSON.parse(stdout).runs[0].tool.driver.version).toBe(MANIFEST.version);
  });

  it('carries the package homepage in the SARIF driver', async () => {
    const { stdout } = await runIn(['check', '--format', 'sarif']);

    expect(JSON.parse(stdout).runs[0].tool.driver.informationUri).toBe(MANIFEST.homepage);
  });

  it('links every SARIF rule to its entry in the package rule reference', async () => {
    const { stdout } = await runIn(['check', '--format', 'sarif']);

    const rules: readonly SarifRule[] = JSON.parse(stdout).runs[0].tool.driver.rules;

    expect(rules.map((rule) => ({ id: rule.id, helpUri: rule.helpUri }))).toEqual(
      ALL_RULES.map((rule) => ({ id: rule.id, helpUri: `https://github.com/mannkostir/domain-integrity#${rule.id}` })),
    );
  });
});
