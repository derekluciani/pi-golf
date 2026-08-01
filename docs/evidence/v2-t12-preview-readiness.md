# V2-T12 Preview sequential-Stroke readiness evidence

- Date: 2026-08-01 UTC
- Acceptance coverage: partial AC-E2E-001-01 and AC-E2E-001-02 (bounded dispatch; not the complete Preview journey)
- Pi / Pi TUI: 0.82.1 / 0.82.1
- Runtime: Node v24.18.0
- Terminal/mode: `xterm-256color`, Expect pseudo-TTY, `--offline --no-session`, real project-local extension
- Command: `./scripts/v2-t12-pi-harness.expect "$PWD" "$PWD/docs/evidence/raw/v2-t12-preview-readiness.pty.log" preview-readiness`
- Result: exit 0. The harness consumed the exact ANSI Power Meter frame immediately before each commit, continuously drained playback, required a newly emitted aiming HUD (`Club 4i`, `Shot Direction 0°`) after durable revision 1, and proved keyboard readiness through newly rendered 5i then 4i Club changes before the second Stroke.
- Durable observation: the new Round JSONL contained revision 1 `{club:"4i", directionIndex:0, power:0.9}` and revision 2 `{club:"4i", directionIndex:0, power:1}`. No durable state was injected or edited.
- Raw PTY transcript: `docs/evidence/raw/v2-t12-preview-readiness.pty.log`
