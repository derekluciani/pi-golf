# Keep Round state in a separate durable store

Pi 0.82.1 does not durably flush custom extension entries when `/golf` is the first action in a fresh session, so each Round's authoritative state will use an append-only log under `.pi/golf/rounds/<roundId>.jsonl` and reconcile that log with the complete active Pi branch. This preserves immediate start and interruption safety without requiring an assistant message or a Pi runtime fork, at the cost of a versioned revision protocol and explicit branch/store reconciliation.
