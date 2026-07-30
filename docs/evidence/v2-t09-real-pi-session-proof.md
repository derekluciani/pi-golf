# V2-T09 real Pi session persistence proof

- Date: 2026-07-30T17:56:21Z
- Criteria: `AC-PER-001-01`, `AC-PER-001-04`
- Pi: `0.82.1`
- Pi TUI: `0.82.1`
- Node: `v24.18.0`
- Environment: macOS pseudo-terminal, `TERM=xterm-256color`, 100 columns × 30 rows, interactive TUI mode, offline startup
- Code under observation: PR #47 retry branch `agent/v2-t09-durable-round-store`

## Reproducible procedure

1. Remove the test-only `.pi/golf` directory and create an empty external session directory.
2. In this checkout, start the real project-local Pi executable with extension discovery enabled:

   ```text
   PI_OFFLINE=1 TERM=xterm-256color COLUMNS=100 LINES=30 \
     ./node_modules/.bin/pi --offline --approve \
     --session-dir /tmp/v2-t09-real-pi/sessions \
     --session-id 29000000-0000-4000-8000-000000000009
   ```

3. Make `/golf` the first and only command. As soon as the newline-terminated
   `.pi/golf/rounds/<roundId>.jsonl` appears, send `SIGKILL`. Do not enter or submit an
   assistant message.
4. Verify that the external Pi session directory still has no session JSONL/custom Golf reference,
   while the Round log has one complete `round-start` line whose durable `branchId` equals the
   requested Pi session ID.
5. Restart the same real Pi command with the same session ID, enter `/golf`, and observe the TUI.
6. Verify that recovery renders the aiming overlay, that no second Round file or line was created,
   and that the authoritative Round bytes are unchanged. Press Esc to close the recovered overlay.

A Python `pty` driver performed these steps with argument arrays, polled only for the durable file
and visible TUI text, and made no product network request. Its assertions checked the criteria named
above; it was an observation driver, not a persistence mock or direct mutation harness.

## Observed authoritative reconciliation

The interrupted command created Round `bd7aecd8-cfc0-4092-866b-15dfcaf8f88f` with exactly one
newline-terminated `round-start` entry. At interruption there were **zero** Pi session files and thus
no durable mirrored `pi-golf-round-v1` custom entry. The durable start's `branchId` was
`29000000-0000-4000-8000-000000000009`.

On the second real Pi TUI process, `ctx.sessionManager.getBranch()` therefore supplied no mirrored
Golf reference. Reconciliation used the command-only fallback association in the authoritative
Round store, selected the same Round, and rendered `Arrows aim` and `Hole Score 0`. After recovery:

- Round files: one before, one after;
- authoritative lines: one before, one after; and
- authoritative bytes: identical before and after.

This directly demonstrates `AC-PER-001-01`: a command-only fresh-session Round survives interruption
before any assistant message. It also exercises the `AC-PER-001-04` protocol against pinned real Pi:
the complete active branch is preferred when it has a Golf reference; when Pi `0.82.1` has not
flushed any session/custom entry, the store's durable session association recovers the Round without
inventing a Shot or creating another Round. The per-Round log remains authoritative in either case.
