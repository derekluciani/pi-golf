# V2-T11 actual Pi/TUI proof

- Criterion: `AC-CMD-001-03` (and playable-Round evidence required by PRD §15)
- UTC: `2026-07-30T13:58:02Z`
- Pi / Pi TUI: `0.82.1` / `0.82.1`
- Runtime: Node `v24.18.0`
- CWD: `/Users/derekluciani/repo/pi-golf-v2-t11`
- Terminal: `expect` pseudo-TTY; `TERM=xterm-256color`, `COLORTERM=truecolor`, `PI_OFFLINE=1`; Pi's default `80 × 24` allocation

Ran the real project-local extension (not a mock):

```text
TERM=xterm-256color COLORTERM=truecolor PI_OFFLINE=1 \
pi --offline --no-session --approve
```

Observed command-by-command in that Pi TUI session:

1. Pi discovered the project-local extension on startup; `/golf` was available.
2. Entered `/golf` then pressed Enter. The focused top-right overlay rendered the Preview Round's two-column Braille Terrain canvas, Flag, and in-canvas HUD: `Hole 1`, `Par 4`, `Hole Score 0`, `Round Score 0`, `Club driver`, `Lie Terrain fairway`, `Shot Direction 0°`, and `Target 50 Course Units`.
3. Pressed Space and Enter after the intro. The overlay consumed those keys for Round input rather than the underlying Pi editor.
4. Returned to aiming, pressed Esc, and waited for the durable close. The Round overlay disappeared and the **prior Pi editor regained focus**. Entered `/reload` and pressed Enter in that restored editor; Pi accepted and completed reload in the same session without a command error or duplicate overlay.
5. Exited with Ctrl-C.

The reproducible pseudo-TTY driver was `/tmp/pi-golf-t11-focus.expect`; its retained terminal transcript was `/tmp/pi-golf-t11-focus.log`. The run exited `0`; the transcript contains the observed Preview HUD labels and ANSI Terrain/Flag frames.
