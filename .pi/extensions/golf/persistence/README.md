# Durable Round store protocol

T09 owns the authoritative `.pi/golf/rounds/<roundId>.jsonl` store and the narrow
Round-start seam. A `round-start` entry is appended and file-synced before its
caller may activate gameplay. It contains the immutable Course snapshot, compact
canonical Round state, and the Pi session/branch identifier.

Recovery calls `ctx.sessionManager.getBranch()` (never `buildContextEntries()`).
A complete root-to-leaf branch may carry `custom` entries with custom type
`pi-golf-round-v1` and `{ roundId, revision }`; each reference must exactly match
the authoritative log revision and branch association. A command-only first
session has no reliably flushed custom entry in Pi 0.82.1, so recovery falls back
to the durable `round-start.branchId` association. Ambiguous, malformed, or
newest-invalid logs fail closed; recovery never selects an earlier valid state.

T11 owns command lifecycle and must consume this seam. It may append a branch
reference after the durable start, but must not treat that mirror as a persistence
boundary or change the append-before-gameplay ordering.
