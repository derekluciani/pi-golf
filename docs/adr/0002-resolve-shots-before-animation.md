# Resolve and persist shots before animation

Each committed shot will be resolved by a pure deterministic simulation and its resulting round state persisted atomically before animation begins; the TUI then replays the recorded trajectory as presentation only. This is less direct than mutating live game state on every frame, but it ensures interruption cannot partially apply or duplicate a stroke, makes save/resume deterministic, and lets gameplay tests run without the TUI.
