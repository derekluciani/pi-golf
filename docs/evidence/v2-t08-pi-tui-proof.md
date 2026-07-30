# V2-T08 actual Pi/TUI proof

- Criterion: `AC-REN-003-01`
- UTC: `2026-07-30T01:01:22Z` (interactive) and `2026-07-30T00:59:29Z` (non-TUI)
- Pi / Pi TUI: `0.82.1` / `0.82.1`
- Runtime: Node `v24.18.0`
- CWD: `/Users/derekluciani/repo/pi-golf-v2-t08`
- Terminal: reproducible `expect` pseudo-TTY, `100` columns × `24` rows; `TERM=xterm-256color`, `COLORTERM=truecolor`, `CI` unset, `PI_OFFLINE=1`
- Extension invocation: explicit only, with project discovery disabled:
  `/Users/derekluciani/repo/pi-golf-v2-t08/docs/evidence/v2-t08-overlay-proof.ts`
- Module exercised: the harness imports and invokes the checked-in
  `.pi/extensions/golf/ui/overlay.ts` `openGolfOverlay()`; it is not an
  assertion-only replacement for the overlay.

The explicit evidence extension is outside the product extension discovery
path. It exists only to make the T08 shell observable while T10 owns the game
component that will use that shell.

## Interactive TUI observation

Started a real Pi TUI with:

```text
TERM=xterm-256color COLORTERM=truecolor PI_OFFLINE=1 \
pi --offline --no-session --approve --no-extensions \
  --extension /Users/derekluciani/repo/pi-golf-v2-t08/docs/evidence/v2-t08-overlay-proof.ts
```

The pseudo-TTY was set to 100 × 24 before Pi started. In the running TUI,
performed these exact keystrokes:

```text
/t08-overlay-proof Enter
k
x
r
Ctrl-C
```

Observed terminal output at each interaction:

```text
# immediately after Enter; row 1, columns 21 through 100
T08 OVERLAY | keyboard: waiting for k | x closes                               R

# after k, before closing
T08 OVERLAY | keyboard: received k | x closes                                  R

# after x closes the overlay and r is typed
prior-focus:r
```

The first two 80-column lines started at column 21 and ended with `R` in
column 100. Thus the overlay was visibly at the terminal's top-right edge with
no top/right margin. The harness component renders only that plain line (no
frame glyphs or padding/border); no border was observed around it. `k` changed
only the focused overlay's live line to `keyboard: received k`, demonstrating
keyboard capture. The prior Pi editor was prefilled with `prior-focus:` before
opening the overlay; after `x`, the next `r` appeared as `prior-focus:r`,
demonstrating restored prior focus. The `expect` transcript matched all three
observations and exited `0`.

## Non-TUI rejection

Ran the same explicit extension in Pi print mode:

```text
TERM=dumb COLORTERM= CI= PI_OFFLINE=1 \
pi --offline --print --no-session --approve --no-extensions \
  --extension /Users/derekluciani/repo/pi-golf-v2-t08/docs/evidence/v2-t08-overlay-proof.ts \
  'non-TUI overlay proof'
```

Observed stdout and exit status:

```text
AC-REN-003-01 non-TUI: mode=print; overlay result=undefined; interactive TUI required.
exit=0
```

This is the real Pi `print` context calling `openGolfOverlay()`, which rejects
non-TUI mode before constructing a custom component.
