# Benchmarks

Synthetic projects for timing `domain-integrity check`. Nothing here is published: `package.json` `files` lists only `dist`.

```bash
npm run build
node bench/generate.mjs --out /tmp/bench/a50-f500 --aggregates 50 --files 500
node bench/generate.mjs --out /tmp/bench/a200-f2000 --aggregates 200 --files 2000
node bench/generate.mjs --out /tmp/bench/unresolved-120 --aggregates 1 --files 10 --events 200 --dto-members 150 --sites 120
node bench/time.mjs --runs 3 /tmp/bench/a50-f500 /tmp/bench/a200-f2000 /tmp/bench/unresolved-120
```

`generate.mjs` writes aggregates with an enum status and a union kind (every fourth one undeclared), their events and
handlers, and services that read, compare and sometimes assign the status from outside. `--events`, `--dto-members` and
`--sites` add in-process events and unresolved handler registrations typed with one DTO union. `--out` is replaced on every run, but only when it is missing, empty, or was written by `generate.mjs` before. `--tool` sets the
`node_modules/domain-integrity` link the generated config imports (default: this checkout).

`time.mjs` runs `check --format json` on each project, prints the median of `--runs` runs, every run, the exit codes
and the load average before and after. `--cli` times another build.
