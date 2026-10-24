# Security policy

## Reporting a vulnerability

Report vulnerabilities privately through GitHub private vulnerability reporting: open the repository's **Security** tab and choose **Report a vulnerability**, or go straight to [the new advisory form](https://github.com/mannkostir/domain-integrity/security/advisories/new).

Please do not open a public issue, pull request or discussion for a vulnerability.

## Supported versions

The package is in 0.x. Only the latest minor release line receives security fixes; upgrade to it to get them.

## What to include

- the `domain-integrity` version, as shown by `npm ls domain-integrity`, and your Node.js version;
- the command or GitHub Action configuration you ran;
- a minimal project, `tsconfig.json` and `domain.config.ts` that reproduce the problem, or the steps to build them;
- what happened, what you expected, and the impact you see.

We aim to acknowledge reports and to keep you informed in the advisory while a fix is prepared.

## Scope

`domain-integrity` analyses a project statically. It reads the project's sources and `domain.config.ts` with the TypeScript compiler and never executes them. Relevant reports include:

- anything that makes the CLI execute code from the analysed project or its `domain.config.ts`;
- anything that makes the CLI write files other than the ones it documents, which are `domain.config.ts` from `init`, the file passed to `context --write`, and the baseline file;
- the GitHub Action in `action.yml`, including how it handles its inputs and the SARIF upload;
- the supply chain of the published npm package. Releases are built and published from the `release` workflow in GitHub Actions with npm provenance, so a published version that lacks provenance or whose provenance does not point to this repository is worth reporting.

Findings that are wrong, such as a false positive or a missed finding, are bugs rather than vulnerabilities; report them through the issue tracker.
