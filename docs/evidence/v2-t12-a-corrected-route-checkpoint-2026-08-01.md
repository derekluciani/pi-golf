# V2-T12-A corrected route checkpoint — 2026-08-01

This is a truthful investigation checkpoint, not acceptance evidence for the four owned ACs.

## Environment

- Pi: `@earendil-works/pi-coding-agent` 0.82.1
- Pi TUI: `@earendil-works/pi-tui` 0.82.1
- Node: v24.18.0
- Runtime: actual project-local Pi, `--offline --no-session --approve --no-extensions --extension .pi/extensions/golf/index.ts`
- PTY/terminal: Expect PTY, `TERM=xterm-256color`, truecolor, 80 columns

## Corrected observation

The harness sent actual Pi input, continuously drained the PTY, matched the exact ANSI-colored Power Meter span, and checked the append-only JSONL after fresh/quiescent HUD boundaries. It reproduced:

1. 4i, east (direction index 0), 90%: durable revision 1, Lie `(47.266667, 20)`.
2. 4i, east (direction index 0), 100%: durable revision 2, Lie `(90.896297, 20)`.

Raw PTY: `docs/evidence/raw/v2-t12-a-corrected-4i-readiness-2026-08-01.pty.gz`

JSONL proof: `docs/evidence/raw/v2-t12-a-corrected-preview-revisions-1-2-2026-08-01.jsonl`

## Simulator-derived continuation

Using the Preview Course artifact and production `resolveShot` from the exact revision-2 Lie, the bounded planner derived:

- 7i, east, 80% -> rest at `(113.69487, 20)`;
- putter, direction index 7 (157.5°), 10% -> Cup at `(113.312011, 20.158586)`.

Named deterministic check: `AC-E2E-001-01 derives Cup-capturing Preview routes from the actual simulator` in `.pi/extensions/golf/v2-t12-a-route-planner.test.ts`.

A subsequent actual-Pi continuation attempt retained durable revisions 1 and 2 but timed out before the 7i meter commit while using unsynchronized repeated Club input. Raw diagnostic: `docs/evidence/raw/v2-t12-a-corrected-preview-route-2-2026-08-01.pty.gz`. The harness checkpoint now establishes each Club transition from rendered output before proceeding. A complete actual Preview Round and Water/OOB/interruption observations remain unproven; therefore AC-E2E-001-01, AC-E2E-001-02, AC-E2E-002-01, and AC-E2E-002-02 are not claimed.
