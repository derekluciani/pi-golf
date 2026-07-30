# V2-T04 actual Pi/TUI proof

- UTC: `2026-07-30T00:02:06Z`
- Criteria: `AC-CRS-010-04`, `AC-CMD-003-03`
- Pi: `0.82.1`; Pi TUI: `0.82.1` (project-pinned package)
- Runtime: Node `v24.18.0`; interactive pseudo-TTY via `expect`
- Environment: `TERM=xterm-256color`, `COLORTERM=truecolor`, `CI` unset, `PI_OFFLINE=1`
- CWD: `/Users/derekluciani/repo/pi-golf-v2-t04`
- Extension: `/Users/derekluciani/repo/pi-golf-v2-t04/.pi/extensions/golf/index.ts`
- Session/mode: fresh `--no-session`, offline, explicit extension only (`--no-extensions --extension …`)

## Commands and observation

Started:

```text
pi --offline --no-session --approve --no-extensions --extension /Users/derekluciani/repo/pi-golf-v2-t04/.pi/extensions/golf/index.ts
```

The startup TUI listed exactly the explicit `golf` extension. In that actual Pi TUI, entered:

```text
/golf course /Users/derekluciani/repo/pi-golf-v2-t04/docs/examples/minimal-course.json
/golf proof-minimal-course
```

Observed output (the terminal wrapped the final line):

```text
Minimal Course selected for the next new Round.
Minimal Course proof play completed (200 raster cells); returned to Preview Course.
```

This proves explicit selection of the unchanged minimal artifact, real public command/API proof play, and the return to Preview Course without a network-backed session.
