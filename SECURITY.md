# Security policy

`@groeponline/pi-autoresearch` executes inside a Pi host and can influence repository changes through an experiment loop. Treat it as code with local developer privileges, not as a sandbox boundary.

## Reporting

Report suspected vulnerabilities privately through GitHub Security Advisories for `GroepOnline/autoresearch-skill`, or email `security@chefgroep.nl`. Do not include real credentials in an issue, reproduction, benchmark fixture, or session transcript.

## Runtime boundary

The extension does not operate a hosted control plane, send package-owned telemetry, or make outbound network requests itself. It does:

- read and write experiment state in the target repository;
- invoke local Git commands for isolation and provenance;
- evaluate configured scope, shell, and mutation policy;
- run user-owned benchmark/correctness commands through the local environment.

Those user-owned commands are outside the package's network boundary and may access the network if the repository author configured them to do so.

## Dependency rationale

The published runtime has one third-party dependency: `zod`, used for structured validation. Pi itself is an optional peer and is supplied by the host. Lint, formatting, test, and TypeScript tooling are development-only.

## Safety properties

The experiment loop is bounded by run/time budgets, dirty-tree checks, isolated-branch requirements, path/scope policy, destructive-command checks, correctness gates, noise handling, and explicit stop conditions. These controls reduce accidental mutation; they do not make arbitrary repository code safe to execute.

Before each release, CI must pass the validation suite, dependency audit, and actual npm tarball contract.
