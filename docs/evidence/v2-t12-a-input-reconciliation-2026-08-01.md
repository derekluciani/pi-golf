# V2-T12-A actual-Pi input reconciliation — 2026-08-01

## Environment

- Pi `0.82.1`; Pi TUI `0.82.1`
- Node `v24.18.0`
- Expect `5.45`, PTY with `TERM=xterm-256color` and `COLORTERM=truecolor`
- Pi invocation: project-local `node_modules/.bin/pi --offline --no-session --approve --no-extensions --extension .pi/extensions/golf/index.ts`

## Reproduction

From `/Users/derekluciani/repo/pi-golf-v2-t12-a`, run:

```sh
scripts/v2-t12-pi-harness.expect "$PWD" \
  "$PWD/docs/evidence/raw/v2-t12-a-two-stroke-reconciliation-2026-08-01.pty" \
  preview-readiness
```

The harness continuously drained the real Pi PTY, selected meter states only after an exact complete ANSI-colored meter transition, and required durable JSONL entries rather than inferring commits from rendering.

## Result

Exit code was `0`. The newly selected Round log was
`.pi/golf/rounds/738261e7-e5d8-43dc-a3f0-4a28d018502e.jsonl`. It contains, in order:

1. `4i`, direction index `0` (east), power `0.9`
2. `4i`, direction index `0` (east), power `1`

The minimal reproducible sequence is therefore the known-good sequence: launch `/golf`; select `4i`; commit east/90%; wait for fresh post-commit aiming HUD, one-second PTY quiescence, and matching durable Shot 1; probe `5i` then restore `4i`; observe a non-stale exact ten-block meter transition; commit; require matching durable Shot 2 and `Hole Score 2`.

The contradictory Driver observation did not establish a product defect: it changed the known-good second club while testing a route, and rendering its meter did not prove a durable commit. This bounded reconciliation makes no Preview-completion or hazard acceptance claim.

Raw successful gzip-compressed PTY artifact SHA-256: `f7dac382a5eace5bc233ebe95b09336bf128b2b629958c44496bf9e2915886cb`.
