# Durable Round store protocol

T09 owns the authoritative `.pi/golf/rounds/<roundId>.jsonl` store and the narrow
Round-start seam. A `round-start` entry is appended and file-synced before its
caller may activate gameplay. It contains the immutable Course snapshot, compact
canonical Round state, and a session identifier used only for command-only first-session fallback.

Recovery calls `ctx.sessionManager.getBranch()` (never `buildContextEntries()`).
A complete root-to-leaf branch may carry `custom` entries with custom type
`pi-golf-round-v1` and `{ roundId, revision }`; every reference is validated root-to-leaf against the authoritative log at
its referenced revision. The final valid reference, rather than a session ID,
selects the active branch's Round; this preserves fork-before/fork-after-Shot history. A command-only first
session has no reliably flushed custom entry in Pi 0.82.1, so only when the branch has no Golf references recovery falls back
to the durable `round-start.branchId` association. Ambiguous, malformed, or
newest-invalid logs fail closed; recovery never selects an earlier valid state.

The T09 first-action seam calls Pi's `pi.appendEntry("pi-golf-round-v1", { roundId,
revision })` immediately after the authoritative `round-start` append. This is a
branch mirror, not a durability boundary: Pi forks retain the reference prefix and
reconstruction selects that exact JSONL revision. T11 owns all later command
lifecycle, but must preserve this append-before-gameplay ordering and append the
same shaped mirror after its durable mutations.

Replacement is link-first: the predecessor appends a `round-replacement` carrying
the complete successor start, then the successor writes that exact `round-start`.
A recovery follows a successor only when both durable records match. An interruption
between them is a fail-closed dangling link (not an active successor); retrying the
same identities reconciles the link and materializes the one carried successor. A
post-open zero-byte successor artifact is known uncommitted state and is removed only
by that serialized revision-zero retry; non-empty successor data is never removed and
instead validates as the exact committed start or fails closed.
