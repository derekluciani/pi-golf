# V2-T11 actual Pi/TUI proof

- Criterion: `AC-CMD-001-03` (and the playable-Round evidence required by PRD §15)
- UTC: `2026-07-30T13:42:00Z`
- Pi / Pi TUI: `0.82.1` / `0.82.1`
- Runtime: Node `v24.18.0`
- CWD: `/Users/derekluciani/repo/pi-golf-v2-t11`
- Terminal: `expect` pseudo-TTY; `TERM=xterm-256color`, `COLORTERM=truecolor`, `PI_OFFLINE=1`; Pi's default `80 × 24` allocation

Ran the real project-local extension (not a mock) with:

```text
TERM=xterm-256color COLORTERM=truecolor PI_OFFLINE=1 \
pi --offline --no-session --approve
```

In the TUI, sent these keys with pauses to let the one-second intro and presentation update:

```text
/golf Enter
(wait 1.8 seconds)
Space
(wait 0.3 seconds)
Enter
(wait 0.8 seconds)
Esc
/reload Enter
Ctrl-C
```

Observed the actual focused top-right `/golf` overlay render the Preview Round's two-column Braille Terrain canvas, Flag, and the in-canvas corner HUD: `Hole 1`, `Par 4`, `Hole Score 0`, `Round Score 0`, `Club driver`, `Lie Terrain fairway`, `Shot Direction 0°`, and `Target 50 Course Units`. The lower in-canvas controls rendered as `Arrows aim · Space Stroke` and `Tab camera · H HUD · Esc save`. The entered Space/Enter sequence was accepted by the focused overlay, and Esc closed it after its durable checkpoint. `/reload` then completed in the same actual Pi session without duplicate overlays or a command error.

The `expect` run exited `0`. Its terminal transcript was retained during the run at `/tmp/pi-golf-t11.expect.log`; it contained the observed HUD labels and the rendered terrain/Flag ANSI frames.
