# Pi Golf Version 1 Requirements Audit and Rewrite Handoff

> [!NOTE]
> **Ported historical audit.** The accepted decisions and still-relevant requirements in this handoff have been consolidated into [`PRD.md`](PRD.md). The PRD is now normative; this file remains only as audit provenance and MUST NOT be used to derive Version 2 tickets.

**Status:** Ported into the Version 2 PRD.  
**Prepared:** 2026-07-26  
**Purpose:** Preserve the requirements/ticket audit and compatibility review that informed the normative rewrite.

## 1. Scope and authority reviewed

The audit covered:

- All active files under `docs/` (deprecated `_ignore/` material was excluded).
- GitHub Project 2 and implementation issues #4–#12, including issue #4 review history and recovery contracts.
- Merged implementation from tickets #1–#3:
  - Ticket #1 through commit `5afc44b`, merged by `215942e`.
  - Ticket #2 through commit `199ddef`, merged by `682e7c5`.
  - Ticket #3 at commit `de620c7`, merged by `13883b9`.
- The current issue #4 branch at `e1be222`, where needed to assess integration.
- Pi `0.82.1` extension, TUI, and session APIs and runtime behavior.

The audit recommended these authority rules, now implemented for Version 2:

1. `docs/CONTEXT.md` is authoritative for domain terminology.
2. `docs/PRD.md` is the sole normative, content-complete product document for behavior and acceptance requirements.
3. ADRs explain architectural rationale.

`docs/design.md` and `docs/version-1-requirements.md` have been superseded by `docs/PRD.md` and are no longer normative authorities.

The unresolved contradictions and omissions recorded below describe the pre-PRD baseline.

## 2. Executive verdict

The project has strong scope definition and nominal requirement-ID coverage, but implementation is not yet reliable enough to dispatch the remaining sequence unchanged.

The highest-priority blockers are:

1. Pi `0.82.1` cannot durably persist custom golf entries when `/golf` is the first action in a fresh session.
2. Roll integration, event splitting, ties, and epsilon rules are not mathematically specified.
3. Persisted entries lack Round identity, revisions, schema versions, and idempotency rules.
4. The documented FSM has nine states while issue #10 requires ten; resize suspension cannot be represented safely.
5. Course input complexity is not bounded.
6. Course validation can accept a Cup that continuous geometry calls Green while its gameplay/raster cell is Fairway or Out of Bounds.
7. Issue #4 remains unapproved with two recorded implementation blockers.
8. Project statuses and dependency gates allow downstream work to appear ready before prerequisites are accepted.

## 3. Classification key

- **Confirmed contradiction:** Two normative statements cannot both be satisfied.
- **Specification gap:** Multiple incompatible implementations can satisfy the current wording.
- **Current implementation blocker:** Existing code demonstrably violates a requirement or required correction.
- **Compatible:** Existing implementation can remain unchanged or be extended without changing its behavior.
- **Additive correction:** Existing implementation is reusable; a new contract/type/test is needed.
- **Breaking correction:** Accepted custom input, exported types, or runtime behavior will change. Because V1 is not complete, these changes should be made before treating schema version 1 as externally stable.

---

# Part I — Required owner decisions

The requirements rewrite should not guess these decisions silently.

## D1. Fresh-session persistence mechanism

Pi `0.82.1` delays creation/flushing of a new session file until an assistant message exists. Extension commands bypass the agent. Therefore `/golf` can append custom Round/Shot entries that remain only in memory if it is the first action in a fresh session.

**Owner decision: 1B — separate durable Round store reconciled with Pi’s active branch.** This preserves immediate start without requiring a Pi API/runtime change. The architecture and reconciliation protocol must be recorded in `design.md`; create an ADR if the final store/reconciliation design involves a hard-to-reverse trade-off.

Options considered:

1. Upgrade/use a Pi API with a durable custom-entry boundary — not selected.
2. Separate Round persistence store reconciled with the active Pi branch — selected.
3. Require an already-flushed Pi session before gameplay — rejected because it weakens immediate start.
4. Change Pi itself to support explicitly flushing extension entries — not selected for Version 1.

The chosen result is architectural and should be recorded in `docs/PRD.md`; add an ADR if it represents a real hard-to-reverse trade-off.

## D2. Gameplay Terrain ownership

**Owner decision: Accepted.**

1. Course Boundary remains continuous geometry.
2. A position outside the continuous boundary is Out of Bounds.
3. A position inside the boundary owns cell `(floor(x), floor(y))`, including negative coordinates.
4. Gameplay Terrain is the rasterized Terrain of that cell.
5. Cell ranges are half-open: `[n, n + 1)`.
6. Tee and Cup validation uses this same lookup.

This avoids rendering, validation, and physics assigning different Terrain to one ball position.

## D3. Exact Roll integration and event precedence

**Owner decision: Accepted with a `1e-9`-second event tie tolerance.** Use analytical constant-deceleration kinematics for each piecewise-constant Terrain segment. Split each fixed `1/120`-second step at Terrain, Boundary, Water, and Cup events; consume any remaining time in the same step after an event; and stop at the exact fractional time when speed reaches zero. Events within `1e-9` seconds are tied and use this precedence:

```text
Out of Bounds > Water > eligible Cup capture > playable-Terrain transition
```

## D4. FSM state count and commit interval

`design.md` defines nine states; issue #10 requires ten.

**Owner decision: 4B — add an explicit `committing` state, making ten authoritative states.** After the meter stops, transition to `committing`, synchronously reject duplicate input, and transition to `playback` only after the append succeeds. Resize remains an orthogonal suspension wrapper carrying the suspended state rather than destroying it.

## D5. Putter Target meaning

**Owner decision: Expected projection.** Use the original/current Terrain formula and remove “truthfully predicts” wherever Terrain transitions can change the result. The simulator, path renderer, camera, and HUD must consume one shared projection result.

## D6. Cup behavior after a fast entry

**Owner decision: Accepted.**

- Evaluate speed at the first intersection with the closed Cup capture disk.
- If speed is above the inclusive threshold, the pass does not capture.
- No later capture occurs while the same traversal remains inside the disk; the ball must exit and re-enter.
- Landing inside the disk is tested immediately at landing speed.

## D7. Course source identity

**Owner decision: 7A — path-based physical identity.**

- Existing files are identified by absolute canonical `realpath`.
- Symlink aliases collapse to the same canonical source.
- Hard links remain distinct sources.
- Discovered symlinks escaping the discovery root are rejected.
- Persist and compare the canonical path.
- Case behavior follows filesystem canonicalization rather than display strings.

## D8. Course ID and name policy

**Owner decision: IDs use the proposed policy; names are limited to 30 characters.**

Course and Hole IDs use:

```regex
^[a-z0-9](?:[a-z0-9._-]{0,63})$
```

Names have a maximum length of 30 characters, reject control characters, and reject leading or trailing whitespace rather than silently changing the author’s value.

## D9. Raster equality contract

**Owner decision: Exact typed deep equality.** Repeated rasterization must produce equivalent typed data; the requirements must not describe this as a public byte-for-byte format. Current repeated `JSON.stringify()` tests may remain implementation checks, but are not the compatibility contract.

## D10. Scoring display terminology

**Owner decision: Accepted.** The official scoring model is:

```text
playedStrokes
penaltyStrokes
holeScore = playedStrokes + penaltyStrokes
roundScore = sum(holeScore)
```

Use `Hole Score` for the official per-Hole value. Do not call a penalty-inclusive value “Hole Strokes” when `CONTEXT.md` defines Stroke as a played attempt distinct from a Penalty Stroke.

## D11. Supported Node version

The project advertises Node `>=20`, but `@earendil-works/pi-coding-agent@0.82.1` declares `>=22.19.0`; ESLint 10 also excludes early Node 20 releases.

**Owner decision: Accepted.** Declare and test Node `>=22.19.0`, matching the pinned Pi dependency and ESLint 10 support.

## D12. Direction convention and quantization

**Owner decision: Accepted.**

- `0°` points toward increasing `x`.
- `90°` points toward increasing `y`.
- Bearings increase clockwise in the terminal coordinate system.
- Left/Right changes the discrete direction index by one and wraps at 16.
- Exact halfway quantization chooses the higher clockwise index.
- Persist the discrete direction index/bearing, not a rounded direction vector.

## D13. Geometry containment

**Owner decision: Accepted.**

- Course Boundary, polygons, ellipses, corridors, and Cup disks are closed; points exactly on edges count as inside.
- Corridors are unions of closed-radius segment capsules.
- Region overlaps are valid; later regions override earlier regions.
- Course Boundary must be a valid non-self-intersecting polygon.
- Outside the Boundary always remains Out of Bounds, regardless of regions.

## D14. Numeric predicates

**Owner decision: Accepted.**

- Schema limits use exact/raw comparisons; no implicit epsilon is applied.
- Geometry uses operation-specific robust predicates rather than one global epsilon.
- Roll event ties use the accepted `1e-9`-second tolerance.
- Cup speed uses the exact inclusive comparison `speed <= 1.5`.
- No epsilon is silently added to unrelated comparisons.

## D15. Normalized state

**Owner decision: Accepted.** Normalize canonical simulation checkpoints and results to six decimals. The normalized result becomes the live result before persistence, and the normalized position is reclassified using the authoritative gameplay Terrain lookup before commit. Resume uses exactly that normalized state.

## D16. Carry checkpoints

**Owner decision: Accepted.** Record in-memory checkpoints at `t = 0`, every `n / 120` strictly before the exact Carry duration `T`, and exact `t = T`. Persist compact resolved outcomes rather than animation frames.

## D17. Persisted entry envelope

**Owner decision: Accepted.** Use this versioned envelope:

```ts
interface GolfEntryV1 {
  entryVersion: 1;
  roundId: string;
  revision: number;
  kind:
    | "round-start"
    | "shot"
    | "checkpoint"
    | "round-terminal"
    | "round-replacement";
  payload: unknown;
}
```

Every entry after `round-start` must match the same `roundId` and exactly the prior revision.

## D18. Separate Round-store format

**Owner decision: Accepted.** Use an append-only per-Round log under `.pi/golf/rounds/<roundId>.jsonl`. The store is authoritative for durable Round state; the Pi branch identifies which Round is active and may contain mirrored or reference entries. Revision and `shotId` data provide duplicate protection.

## D19. Persistence failure

**Owner decision: Accepted.** Remain in `committing`, do not advance canonical state or begin playback, show a deterministic error, and permit retrying the same commit with the same `shotId`. Never create a second Shot.

## D20. Pause aiming changes

**Owner decision: Accepted.** Persist a state-only `checkpoint` when Esc saves after Club or Shot Direction changes, so those changes survive reload.

## D21. Hole and Round completion

**Owner decision: Accepted.** Cup completion and Hole advancement use an idempotent protocol. Final Hole completion writes a `round-terminal` entry. `/golf new` writes one replacement record linking the old and new Round. Repeated commands or interruption must not duplicate scores or resurrect the old Round.

## D22. Selection TOCTOU protection

**Owner decision: Accepted.** Linearize selected-file reads with a bounded regular-file read bracketed by pre- and post-read `fstat`. Reject or retry if metadata changes. Parse and validate those exact bytes before persisting settings. Round start performs its own fresh stable read and snapshot.

## D23. Settings durability

**Owner decision: Accepted.** Use a strict bounded settings schema, same-directory UUID temporary files, write/flush/close followed by atomic rename, directory sync where supported, owned-temp cleanup, prior-byte preservation on failure, cross-runtime write serialization, and UI rollback/reconciliation after failed persistence.

## D24. Duplicate JSON keys

**Owner decision: Accepted.** Use a duplicate-aware raw JSON parser for built-in and external files. Retain `parseCourse(unknown)` for already-parsed programmatic input.

## D25. Discovery

**Owner decision: Accepted.** Traverse recursively up to depth 16, accept case-insensitive `.json` files, cap discovery at 256 files, treat a missing root as non-fatal, continue after unreadable descendants with bounded diagnostics, reject symlinks escaping the discovery root, and collapse in-root symlink aliases by canonical path.

## D26. Narrow-region warnings

**Owner decision: Accepted.** Every valid region affecting no raster cell MUST emit exactly one structured `narrow-region` warning. Warning ordering is deterministic.

## D27. Course immutability

**Owner decision: B.** Keep `parseCourse()` behavior, but require the Round-start snapshot boundary to clone and deeply freeze the validated Course graph before simulation.

## D28. Power Meter timing

**Owner decision: Accepted.** Use a monotonic active-time clock. The fill phase is `0 <= t < 1.5 s`; the empty phase is `1.5 <= t < 3.0 s`; each of ten bins lasts `0.15 s`; fill displays blocks 1 through 10; empty displays blocks 10 through 1; intervals are half-open; exactly `1.5 s` still displays 10; exactly `3.0 s` wraps to 1; and commit samples the block at the key-event timestamp rather than the last rendered frame.

## D29. Key-repeat handling

**Owner decision: Accepted.** Require a release/new press before the same Space or Enter key can stop a newly started meter. Where key-release events are unavailable, ignore repeats until the next distinct press sequence.

## D30. Resize suspension

**Owner decision: Accepted.** An undersized terminal wraps and preserves the current state, freezes all active-time timers, preserves queued actions without applying them, resumes from the same state and active-time offset, and does not alter canonical Round state.

## D31. Abandon confirmation

**Owner decision: Accepted.** `Q` opens confirmation from aiming or metering. `Y` or Enter confirms; `N` or Esc cancels and returns to the prior state. During playback or penalty notice, Q queues the request until that sequence completes. Confirmed abandonment persists terminal status and closes gameplay.

## D32. Single-writer commit protocol

**Owner decision: Accepted.** Use one session-scoped writer. It leaves `metering` synchronously on the first commit input, assigns `shotId` before asynchronous work, rejects further mutation until append succeeds or fails, and retries only that same `shotId` after failure.

## D33. Entry-version handling

**Owner decision: Accepted.** Require `entryVersion: 1` on every Golf entry. A migration registry handles explicitly supported older versions; unsupported versions fail closed. Never silently use an older entry to roll back or resurrect state when the newest entry is unsupported or invalid.

## D34. Branch reconstruction

**Owner decision: Accepted.** Reconstruct from the complete active Pi branch via `getBranch()`, process entries root-to-leaf, validate `roundId` and revisions, apply terminal and replacement statuses, and fail closed for the newest invalid Round rather than reverting to an older state.

## D35. Resolved Shot contract

**Owner decision: Accepted.** Define a shared `ResolvedShot` containing `shotId`, pre-shot Lie and inputs, landing/final/restored position, terminal result, resulting speed, elapsed time, and bounded in-memory playback keyframes. Persist the canonical outcome, never animation frames.

## D36. ANSI and tile-width handling

**Owner decision: Accepted.** Use ANSI-aware `visibleWidth()` for layout and truncation; crop before styling; never split a two-column Terrain tile or ANSI sequence; render Out of Bounds as exactly two unstyled spaces; and replace complete tile content for marker overlays where possible.

## D37. Viewport allocation

**Owner decision: Accepted.** Use the full dimensions passed to `render()`. Below `60 x 20`, suspend via resize handling. Clamp the Course canvas to at most `120 x 60` terminal cells. Each Course unit occupies two terminal columns and one row; odd widths use `floor(width / 2)` complete Course units and leave the extra column unused. HUD panels remain overlays inside the canvas and add no external rows or borders. Layout must be deterministic at minimum, native, odd, and intermediate sizes.

## D38. Camera timing

**Owner decision: Accepted.** Target pan begins after `250 ms` of active aiming time and lasts exactly `1 s` with deterministic smoothstep easing. Tab switches Lie/Target immediately and cancels pending camera timers. Club or direction changes cancel and restart the target-pan delay. Playback follows the ball directly. After rest or restoration, recenter immediately on the current Lie. Resize freezes camera active time and resumes it afterward.

## D39. Out-of-Bounds rendering

**Owner decision: Accepted.** Add explicit Out-of-Bounds snapshots and tests for two terminal-default spaces, no ANSI color bleed, Boundary transitions, and Target/ball rendering outside the Course Boundary.

## D40. Shared Target projection

**Owner decision: Accepted.** One shared projection result feeds the simulator, prediction path, camera, and HUD Target marker/distance. Integration cases cover Fairway, Green, Rough, Bunker, putter, and Out-of-Bounds Target results.

## D41. Structured warning identity and ordering

**Owner decision: Accepted.** Warnings are structured objects, never parsed from display text. Each warning has a stable `code`, canonical `path`, JSON path/details, and relevant Course/Hole/region identity. Deduplicate by structured identity and sort by canonical source path, warning code, JSON path, then Course/Hole/region index. Rendered warning text is presentation-only.

## D42. Normative requirements and acceptance matrix

**Owner decision: Consolidate the normative content of `design.md` and `version-1-requirements.md` into `docs/PRD.md`, which is assumed content-complete and becomes the sole normative product document.** Issue #12 must check in a traceability matrix mapping every PRD acceptance criterion and completion criterion to named automated tests or explicitly approved manual evidence. The retired source documents need not remain separate matrix authorities.

## D43. Pi/TUI evidence

**Owner decision: Accepted.** Actual Pi/TUI evidence is required for focus, overlay placement, keyboard capture, focus restoration, `/reload`, and a playable Round. A waiver must be written by the owner and identify the exact unproven criterion.

## D44. Ticket dependency gates

**Owner decision: Accepted.** `Ready` means all required predecessors are merged/Done. Record actual GitHub dependencies, and keep issues #5–#12 blocked behind relevant prerequisites.

## D45. Meter reset ownership

**Owner decision: Accepted.** Simulation issue #6 returns only the hazard/restoration outcome. FSM issue #10 owns resetting the Power Meter to one block.

## D46. Intro and notice timing

**Owner decision: Accepted with a reusable `display-timer` duration of 2 seconds.** The intro title displays for exactly `1 s`. All notices use the single `display-timer` value of `2 s`. These timers use active time and freeze during resize. Hole and Round summaries wait for input rather than timing out. Reload never resumes intro, notice, or playback.

## D47. Esc and summary behavior

**Owner decision: Accepted.** Esc during `committing` queues pause until persistence succeeds or fails; Esc during playback or a penalty notice queues pause until completion; Esc during a Hole or Round summary saves and closes. Enter/Space advances a Hole summary. The Round summary accepts `R` for a new Round and Esc to close.

## D48. Responsive test matrix

**Owner decision: Accepted.** Test widths `59, 60, 61, 119, 120` and heights `19, 20, 21, 59, 60`, plus representative intermediate dimensions, checking no overflow and correct resize suspension.

---

# Part II — Persistence and session findings

## P1. Critical — Fresh command-only sessions are not durable

**References:** `design.md` Immediate start, Simulation/playback separation, Active Round; V1-PER-001/002; tickets #9–#12; Pi `0.82.1` `SessionManager._persist()`.

A `/golf` command can append custom entries before any assistant message. Pi keeps those entries in memory and does not create/flush the session file. Exiting can lose the entire Round despite “persist before animation.”

**Owner decision:** D1 selects the separate durable Round store. Implement it and add a #9/#12 test where `/golf` is the first action in a fresh session.

## P2. Critical — Persisted entries lack Round-chain identity

“Latest valid golf entry” cannot safely distinguish multiple active, completed, abandoned, or replaced Rounds.

**Owner decision:** D17 defines the versioned envelope. Every non-start entry must match exactly one reachable Round start and the expected prior revision.

## P3. Critical — Atomic append does not provide idempotency

Two individually atomic entries can still commit the same Shot twice. Repeated Space/Enter, two `/golf` invocations, or an overlapping shutdown/new-Round action can race.

**Owner decision:** D32 requires a session-scoped single writer. The first commit input leaves metering synchronously, assigns a `shotId`, and rejects further mutation until append succeeds or fails.

## P4. High — Persisted entries have no application schema version

A future extension update can reinterpret an old structurally similar entry. Silently skipping an invalid newest entry can roll back a committed Stroke or resurrect an older Round.

**Owner decision:** D33 requires versioned Golf entries, explicit migrations only, unsupported-version failure, and fail-closed handling for the newest Round.

## P5. High — Reconstruction source must be the full active branch

Pi compaction changes LLM context but should not remove golf state.

**Owner decision:** D34 requires reconstruction from `ctx.sessionManager.getBranch()`, not `buildContextEntries()`, with root-to-leaf processing, revision validation, and terminal-status handling.

## P6. High — Append failure behavior is unspecified

If persistence throws, requirements do not say whether playback begins, in-memory state advances, input unlocks, or an error is shown.

**Owner decision:** D19 applies. Do not begin playback or advance canonical state until append succeeds; remain in `committing`, expose a deterministic error, and retry the same `shotId` if requested.

## P7. High — Pause does not have a persistence entry

Club/direction can change after the last Shot. Esc says “save,” but the specified Shot entries do not preserve those later aiming changes.

**Owner decision:** D20 applies. Persist a state-only aiming checkpoint so Club and Shot Direction changes made before Esc survive reload.

## P8. High — Hole advancement and Round terminal persistence are incomplete

A Cup Shot can be persisted, but interruption around animation, summary, Enter advancement, or the final scorecard can duplicate completion or restore the wrong Hole.

**Owner decision:** D21 applies. Define idempotent Hole-completion/advancement and Round-terminal entries, with reconstruction targeting aiming, Hole summary, or Round summary as appropriate.

## P9. High — `/golf new` replacement is not interruption-safe

The process can fail after abandoning/superseding the old Round but before starting the new one.

**Owner decision:** D21 applies. Use one replacement record linking the old Round and new Round start, or an equivalent protocol whose intermediate states reconstruct deterministically.

## P10. High — Immutable Course snapshot details must be normative

**Owner decision:** D22 and D27 require a fresh, validated, plain-data Course graph from one stable read, deeply immutable in memory, serialized once in the initial Round entry before the Round becomes active. Source metadata cannot substitute for Course data.

Issue #4’s `captureSelectedCourseSnapshot()` already reparses and deep-freezes a fresh graph; preserve that seam.

---

# Part III — Deterministic simulation findings

## S1. Critical — Roll integration is undefined

Euler, semi-implicit Euler, and analytical kinematics yield different stopping positions, transition speeds, and Cup outcomes.

**Owner decision:** D3 specifies analytical piecewise integration, event splitting, remainder consumption, fractional stop time, and event precedence within a `1/120`-second step.

## S2. Critical — Simultaneous event precedence is undefined

“Earliest event” does not resolve equal or epsilon-close Cup, Water, Terrain, and boundary events.

**Owner decision:** D3 resolves event ties; issue #6 must include pairwise tie tests.

## S3. High — Epsilon scope is undefined

The shared `1e-6` cannot safely apply to schema bounds, Cup speed, event roots, cross products, normalized ellipse equations, and squared corridor distances.

**Owner decision:** D14 is the predicate table:

- Exact/raw comparisons for schema numeric bounds.
- Operation-specific robust geometry predicates.
- `1e-9`-second tolerance for swept-event ties.
- Exact inclusive Cup speed comparison.
- No implicit global `value <= limit + epsilon` behavior.

## S4. High — Direction convention and quantization ties are undefined

The sixteen degree values exist, but zero bearing, rotation direction, terminal Y direction, and exact-halfway ties do not.

**Owner decision:** D12 defines the direction convention and quantization without changing the existing exact degree representation. Persist the discrete bearing/index, never a rounded direction vector used for physics.

## S5. High — Rounded vectors must not drive displacement

A six-decimal vector such as `(0.707107, 0.707107)` is not exactly unit length and can exceed the shared epsilon over a long Carry.

**Owner decision:** D12 requires reconstructing internal unit vectors from the discrete Shot Direction. Round only persisted/presentational vectors, if vectors are persisted at all.

## S6. High — Six-decimal normalization can change resumed Terrain

A final position within `0.0000005` of Water, a cell edge, or the Course Boundary can round to a different classification.

**Owner decision:** D15 requires the normalized persisted result to become the canonical live result and to be reclassified before commit.

## S7. High — Cup speed must be evaluated at a specified instant

A ball may enter above `1.5` and slow below it while still inside the Cup disk.

**Owner decision:** D6 resolves the Cup-entry instant and requires tests below, exactly at, and above the threshold for swept entry and direct landing.

## S8. Medium — Carry endpoint/checkpoint timing is undefined

`T = 3 × sqrt(p)` is generally not divisible by 1/120 second.

**Owner decision:** D16 requires checkpoints at:

1. `t = 0`;
2. every `n / 120` strictly before `T`;
3. exact `t = T`.

Separate complete in-memory simulation checkpoints from persisted compact summaries.

## S9. High — Putter Target “truth” conflicts with Terrain transitions

A homogeneous Green/Fairway distance cannot truthfully predict a putt that crosses into another Terrain.

**Owner decision:** D5 and D40 select expected projection and one shared result across simulator, path, camera, and HUD.

## S10. High — Simulation-facing Terrain lookup is missing

Current public APIs expose integer-only `terrainAtCell()` and continuous shape-based `terrainAtPoint()`, but not a single boundary-aware point-to-raster lookup.

**Owner decision:** D2 requires implementing the boundary-aware gameplay Terrain lookup before #5/#6.

## S11. Medium — Issue #6 incorrectly owns Power Meter reset state

Issue #6 excludes UI but requires resetting the meter to one block.

**Owner decision:** D45 assigns meter-reset behavior and tests to #10’s FSM; #6 returns only the hazard/restoration outcome.

## S12. High — Per-Hole scoring labels conflict with the glossary

**Owner decision:** D10 supplies the scoring terminology; update the PRD and issue #11 wording.

---

# Part IV — Course format, validation, and discovery findings

## C1. Critical — Course complexity is unbounded

Current limits cover Hole count, coordinate magnitude, dimension magnitude, and Boundary extent. They do not cover file bytes, strings, regions, vertices, diagnostics, discovery depth/count, or total work.

Risks include huge reads, quadratic polygon validation, warning floods, and `regionAffectsCell()` scanning every raster cell for every region.

**Owner decision: Accepted with a 30-character Course-name limit.**

- Course JSON: 1 MiB.
- Settings JSON: 16 KiB.
- Discovery depth: 16.
- Discovered files: 256.
- Regions per Hole: 128.
- Points per polygon/corridor: 1,024.
- Course/Hole ID length: 64.
- Course name length: 30 characters.
- Diagnostics/warnings: maximum 256, retaining a truncation diagnostic.
- Total raster cells: maximum 2,000,000 across all Holes.

## C2. Critical — Tee/Cup validation can disagree with raster gameplay

Current `terrainAtPoint()` uses continuous regions, while raster Terrain uses cell centers.

Confirmed probes:

### Sub-cell Green probe

```text
parseCourse()          -> valid with narrow-region warning
terrainAtPoint(cup)    -> green
containing raster cell -> fairway
```

### Boundary Cup probe

```text
parseCourse()          -> valid
terrainAtPoint(cup)    -> green
containing raster cell -> out-of-bounds
```

**Owner decision:** D2 requires implementing the gameplay Terrain lookup and adding both probes as validation regressions.

## C3. High — Containment predicates are incompletely specified

The requirements do not state polygon edge, ellipse equality, corridor cap/join, tee/Cup boundary, or touching-polygon behavior.

Current implementation treats polygons, ellipses, and corridor capsules as closed. Regions are clipped by checking Course Boundary first.

**Owner decision:** D13 retains closed containment, closed-radius corridor capsules, ordered region overlap, and a non-self-intersecting Course Boundary.

## C4. High — Geometry tolerance is dimensionally inconsistent

Current `geometry.ts` compares one absolute epsilon against orientation/cross products, normalized ellipse distance, and squared corridor distance. Effective spatial tolerance changes with scale.

**Owner decision:** D14 requires operation-specific robust predicates and tests at ordinary coordinates and near the approved magnitude limit.

## C5. Compatible — Regions do not paint outside the Course Boundary

Continuous and raster classification both check boundary containment first. Keep this invariant and state it explicitly: outside continuous boundary is always OOB regardless of any overlapping region.

## C6. High — Source identity is not canonical

Relative aliases, `..`, symlinks, and case variants can expose one physical Course as multiple sources.

**Owner decision:** D7 selects canonical path-based physical identity; add alias, hard-link, and escaping-symlink tests.

## C7. High — Selection has an unspecified TOCTOU window

A file or symlink can change between read, validation, settings commit, catalog reconciliation, and Round snapshot.

**Owner decision:** D22 defines selection’s linearization point: one bounded regular-file read with stable pre/post `fstat`, validation of those bytes, then settings commit. Round start performs a fresh stable read and snapshot.

## C8. High — Settings durability rules are not normative

Issue #4 reviews exposed temp-file collisions, independent-runtime overlap, and optimistic UI failures. The docs still mostly say “persist.”

**Owner decision:** D23 defines settings durability: strict bounded schema, same-directory UUID temporary files, write/flush/close and atomic rename, directory sync where supported, owned-temp cleanup, prior-byte preservation on failure, cross-runtime serialization, and UI rollback/reconciliation.

## C9. High — Duplicate JSON members are silently accepted

`JSON.parse()` uses the final duplicate member. Schema validation cannot recover discarded keys.

**Owner decision:** D24 requires `parseCourseJson(text)` or an equivalent duplicate-aware raw parser for built-in and external files; retain `parseCourse(unknown)` for already-parsed programmatic input.

## C10. Medium — Discovery rules are established mostly by review history

Recursive traversal, case-insensitive `.json`, missing-root behavior, unreadable descendants, and symlink policy are not all normative.

**Owner decision:** D25 promotes recursive traversal, extension matching, missing-root behavior, unreadable-descendant handling, and symlink policy into V1-CRS-005 and issue #4.

## C11. Confirmed contradiction — Narrow warnings are optional and mandatory

`design.md` and `course-format.md` require a warning; V1-CRS-002 says regions “may” emit warnings. Current code emits one for every valid no-cell region.

**Owner decision:** D26 changes V1-CRS-002 to require exactly one structured `narrow-region` warning per affected region with deterministic ordering.

## C12. Medium — Raster bytes are not defined

Current `RasterizedHole` does define row-major cells from `(minX, minY)`, and code uses mathematically derived bounds. Tests compare repeated `JSON.stringify()` output.

**Owner decision:** D9 selects typed deep equality; remove public “byte-for-byte” wording from requirements.

## C13. Medium — Course/Hole IDs and names are too permissive

Current schema only requires one non-whitespace character.

**Owner decision:** D8 selects the lowercase ASCII ID policy and 30-character name limit; existing shipped IDs satisfy the ID policy.

## C14. Medium — Warning/catalog byte determinism lacks a public format

Determinism requirements do not fully define warning codes, text, path normalization, source labels, or ordering.

**Owner decision:** D41 defines structured warning identity and deterministic ordering; consumers render structured warnings rather than parse message text.

## C15. Medium — Validated Course objects are not intrinsically immutable

`parseCourse()` returns the original input object under a readonly TypeScript type. A caller retaining the original reference can mutate it after validation.

**Owner decision:** D27 preserves the fresh deep-frozen Round snapshot seam; only that immutable snapshot may supply Course data to simulation.

## C16. Compatible — Existing raster algorithm is reusable

The following are sound and should remain:

- Bounded row/column offset loops.
- Exact accepted coordinate magnitude limit.
- Center sampling.
- Rough initialization.
- Ordered region overrides.
- Separate boundary segments.
- Row-major cells.
- Deterministic diagnostic merge by `(path, code)`.
- Ajv structural authority with semantic validation layered separately.

---

# Part V — Rendering, UI, and game-flow findings

## U1. Confirmed contradiction — Nine FSM states versus ten

`design.md` and `domain/index.ts` contain nine states. `domain/index.test.ts` locks `UI_STATES` length to nine. Issue #10 requires ten.

**Owner decision:** D4 adds the explicit `committing` state; update the PRD, domain constant/test, and issue #10 together.

## U2. High — `resize-paused` cannot safely be mutually exclusive

Resize can occur during intro, metering, playback, penalty notice, or confirmation. Replacing the state loses timers and queued actions.

**Owner decision:** D30 represents resize as a suspension wrapper carrying the prior state and active-time offsets, freezing all active-time timers.

## U3. High — Meter timing is not deterministic

“1→10 in 1.5 seconds” does not define dwell bins, exact endpoint ownership, wrap behavior, or whether input samples event time or last rendered state.

**Owner decision:** D28 defines the closed-form block function, monotonic active-time clock, key-event sampling, boundary ownership, and wrap behavior.

## U4. High — Key repeat can immediately stop a newly started meter

Held/repeated Space or Enter can be interpreted as both start and stop.

**Owner decision:** D29 requires release/new-press repeat suppression, using Pi TUI key-release events where available and distinct-press suppression otherwise.

## U5. High — Pause, abandon, and confirmation transitions are incomplete

Undefined details include valid Q source states, confirmation keys/text, cancel destination, whether timers pause, whether confirmed abandon closes, and behavior during playback/notice.

**Owner decision:** D31 defines abandon confirmation; the final state/event/effect table must also include D19 persistence failure, D30 resize suspension, shutdown, and every key.

## U6. High — Playback data contract is missing

Issue #9 can persist too little for #10, or persist every 120 Hz point and violate compactness.

**Owner decision:** D35 requires `ResolvedShot` with the canonical persisted outcome and bounded in-memory playback keyframes. Persist no animation frames; on reload, skip playback and resume the resolved state.

## U7. Medium — ANSI and Unicode width policy is incomplete

JavaScript length is not terminal width. Truncating a styled string can split ANSI sequences or a two-character Terrain tile.

**Owner decision:** D36 requires Pi TUI `visibleWidth()`/ANSI-aware truncation, crop-before-styling at complete tile boundaries, and marker-width tests.

## U8. Medium — Viewport/HUD geometry is not computable

The requirements do not completely define available height, overlay sizing options, odd widths, HUD rectangles, warning clipping, or marker collision priority.

**Owner decision:** D37 defines viewport allocation and requires golden layouts at minimum, native, odd, and intermediate dimensions.

## U9. Medium — Camera timing is vague

“Brief delay,” “smoothly,” and “about one second” cannot support deterministic tests. Timers can race with Tab, Club changes, resize, playback, or restoration.

**Owner decision:** D38 defines camera modes, precedence, durations, easing, timer cancellation, and active-time behavior using an injected clock.

## U10. Medium — OOB rendering is not explicit in issue #7

OOB must render as two spaces with terminal-default styling, but OOB is not one of the five Terrain values and issue #7 says only “every Terrain.”

**Owner decision:** D39 requires explicit OOB snapshots and Boundary-transition reset tests in #7.

## U11. High — Target behavior has no cross-layer owner

Issues #5–#8 divide Target projection, path, camera, and HUD without one acceptance test proving consistency.

**Owner decision:** D40 requires a shared projection interface and cross-layer tests for Fairway, Green, Rough, Bunker, putter, and OOB Target cases.

---

# Part VI — Ticket-plan and acceptance findings

## T1. Critical — Project status does not enforce dependencies

Project 2 shows issue #4 In progress and issues #5–#12 Ready. Issue #4’s escalation history says #5 will not start until #4 is approved, but #5 does not declare #4 as a dependency.

**Owner decision:** D44 reserves `Ready` for tickets whose required predecessors are merged/Done, with actual dependencies/sub-issues encoded and blocked work moved out of `Ready`.

## T2. Critical — Issue #10’s state count must be corrected

Update it only after D4 is resolved. Enumerate the authoritative states rather than using a count alone.

## T3. Critical — Issue #12 cannot prove all completion criteria as written

“All required tests remain green” proves execution, not coverage.

**Owner decision:** D42 requires a checked-in acceptance matrix mapping every PRD acceptance criterion and completion criterion to named automated tests or explicitly approved manual evidence.

## T4. High — Actual Pi/TUI evidence has a waiver loophole

Mocked tests do not prove actual overlay focus, placement, keyboard capture, focus restoration, `/reload`, or a playable Round. Merely documenting missing evidence should not count as passing.

**Owner decision:** D43 requires dated Pi/version/terminal evidence or an explicit owner waiver naming the unproven criterion.

## T5. High — Issue #4 remains a known failing prerequisite

Latest recorded review at `e1be222` reports:

1. An ID-changed selected source inside discovery falls back to Preview but is reintroduced as an option under its new ID.
2. Exported `selectLoadedCourse()` can persist an external `preview-course` record.

**Recommendation:** add explicit regressions, keep descendants blocked, and require fresh approval.

## T6. High — Hole-completion persistence is not explicitly accepted by issue #9

**Recommendation:** add tests for interruption before/after Cup summary, next-Hole advancement, and final Round status without duplicate score.

## T7. High — Parallel tickets lack shared-file ownership

Simulation, rendering, persistence, and commands can all modify domain constants, package exports, `package.json`, and the extension entrypoint.

**Recommendation:** freeze shared APIs or assign one owner for each shared file/module and final integration merge.

## T8. High — Target integration lacks dependency ownership

Issue #8 does not depend on #5, although camera/HUD behavior consumes Target projection.

**Recommendation:** make #8 consume a specified interface and add a cross-layer test in #10 or #12.

## T9. Medium — Cup landing regression is absent from issue #6

**Recommendation:** explicitly test landing inside the Cup radius below, exactly at, and above `1.5`.

## T10. Medium — Intermediate responsive sizes are weakly covered

Endpoint tests at 60×20 and 120×60 can miss odd/intermediate overflow.

**Owner decision:** D48 requires a property/matrix across the specified widths and heights, including 59, 60, 61, 119, and 120.

---

# Part VII — Compatibility review of completed tickets #1–#3

## Ticket #1 — Foundation and domain model

### Compatible implementation

- Exact discrete Shot Direction bearings avoid persisted rounded-vector drift.
- Played and Penalty Strokes are already separate fields.
- Shared constants remain authoritative and reusable.
- `PersistedRoundState` can be wrapped in a versioned entry envelope.
- Rendering and meter constants can remain unchanged.

### Additive corrections

1. Define the Shot Direction coordinate convention and quantization tie rule.
2. Add a persistence envelope rather than silently changing old entry payloads.
3. Replace flat `TransientUiState` with a discriminated state model capable of resize suspension.
4. Apply branded `HoleId`/`HoleNumber` types to validated Course boundaries. Current `CourseHole` falls back to raw `string`/`number`.
5. Add predicate-specific numeric rules instead of relying on one global epsilon.
6. Add OOB rendering constants/tests separately from the five Terrain render specs.

### Breaking/blocking corrections

1. Resolve the pinned Pi `0.82.1` fresh-session persistence problem before issue #9.
2. Correct the Node support declaration or change dependencies.
3. Resolve nine versus ten FSM states; the existing test explicitly locks nine.

## Ticket #2 — Course core

### Compatible implementation

- Ajv is the sole structural authority.
- Static schema equality is checked.
- Structural and semantic diagnostics aggregate deterministically.
- Sparse/partial invalid data does not suppress independent errors.
- Coordinates are bounded to ±1,000,000.
- Raster loops terminate at large accepted offsets.
- Rasterization is center-sampled, row-major, ordered, and boundary-separated.
- Regions are clipped by Course Boundary classification.
- Narrow warnings are deterministic.

### Breaking/blocking corrections

1. Adopt one gameplay Terrain lookup; current continuous and raster results can disagree.
2. Require tee/Cup owning cells to be playable and Cup-Green.
3. Add Course complexity/resource limits.
4. Replace dimensionally inconsistent geometry epsilon use.
5. Tighten ID/name schemas.
6. Add duplicate-aware raw JSON parsing at the file boundary.

### Additive corrections

1. Publish typed deep equality or canonical raster serialization.
2. Add a simulation-facing boundary-aware `terrainAtPosition()` API.
3. Add sub-cell Green and boundary-Cup regressions.
4. Ensure only immutable validated snapshots reach simulation.

## Ticket #3 — Preview Course and authoring artifacts

### Compatible implementation

- `preview-course.json` is already the sole exact content representation.
- Built-in content uses public parser/rasterizer APIs.
- Preview and minimal artifacts satisfy both continuous and raster tee/Cup checks.
- Existing artifacts fit reasonable future resource limits.
- Existing IDs fit a strict lowercase ASCII ID policy.
- No-ground-route validation remains absent as intended.

### Measured artifact sizes

| Artifact | Bytes | Holes | Max regions/Hole | Max boundary points | Max shape points |
|---|---:|---:|---:|---:|---:|
| Preview Course | 4,553 | 3 | 5 | 12 | 4 |
| Minimal Course | 925 | 1 | 2 | 4 | 2 |

### Geometry compatibility probe

Comparing current epsilon-based containment with exact closed containment produced:

```text
Preview raster cell differences: 0
Minimal raster cell differences: 0
```

Therefore the proposed containment/tolerance correction should not require shipped content changes.

### Additive corrections

1. Declare Preview JSON authoritative for exact coordinates; make `design.md` prose a behavioral summary.
2. Update `course-format.md` for duplicate-aware raw parsing and gameplay point-to-cell ownership.
3. Add representative Preview raster assertions after Terrain semantics are finalized.
4. Add simulator integration proving:
   - the first full driver stops before Hole 4 Water;
   - a later legal Carry can clear it;
   - the Course remains completable.
5. Use `docs/examples/minimal-course.json` unchanged in the final explicit-selection/play/return-to-Preview E2E.

### Existing test overstatement

`preview-course.test.ts` names a test “validates the mandatory airborne Water crossing,” but the checked-in test only validates the Course and repeated raster determinism. It does not prove no ground route or any Shot behavior.

---

# Part VIII — Required ticket changes

## Issue #4

- Keep blocked until the two latest recorded defects pass.
- Add source canonicalization/symlink policy.
- Add bounded file/discovery input.
- Add duplicate-aware parsing.
- Promote settings durability and traversal behavior into normative requirements.

## Issue #5

- Define bearing convention and direction-vector reconstruction.
- Consume the authoritative Terrain lookup.
- Define exact Carry checkpoint timestamps.
- Clarify Target projection output.

## Issue #6

- Specify analytical Roll/event algorithm.
- Specify ties and epsilon predicates.
- Add Cup fast-entry/re-entry and landing tests.
- Resolve putter Target semantics.
- Remove transient meter-reset ownership.

## Issue #7

- Add OOB rendering and ANSI-visible-width acceptance.
- Test marker glyph width assumptions.

## Issue #8

- Define meter block function and key-repeat handling.
- Define resize suspension and HUD allocation.
- Define exact camera timing.
- Consume the shared Target projection interface.

## Issue #9

- Resolve Pi fresh-session durability.
- Define versioned Round/Shot entry envelopes, revisions, and idempotency.
- Add append-failure behavior.
- Add pause, Hole advancement, terminal state, and branch reconstruction tests.

## Issue #10

- Correct the FSM state set/count.
- Add commit guard or `committing` state.
- Define every key/timer/resize/persistence transition.
- Add duplicate-input and append-failure tests.

## Issue #11

- Define official per-Hole Score terminology.
- Define interruption-safe new-Round replacement.
- Persist aiming changes and Hole advancement.
- Define concurrent/repeated command handling.

## Issue #12

- Require the full traceability/evidence matrix.
- Test `/golf` as the first action in a fresh session.
- Require actual Pi/TUI evidence unless explicitly waived by the owner.
- Add Preview behavior, hazard, save/reload, responsive matrix, and unchanged minimal-Course journeys.

---

# Part IX — Suggested requirements rewrite map

## `docs/CONTEXT.md`

Keep it implementation-free. Add or sharpen only domain terms:

- **Played Strokes** if needed to distinguish counted attempts from penalties.
- **Hole Score** as played plus Penalty Strokes for one Hole.
- Clarify whether **Terrain at a position** means the owning raster cell, if that is considered domain language rather than implementation detail.

## `docs/PRD.md`

Because `docs/PRD.md` is the sole normative, content-complete product document, incorporate:

1. Direction coordinate convention and quantization.
2. Gameplay Terrain ownership and Course Boundary precedence.
3. Geometry edge/containment rules.
4. Exact Roll integration and event precedence.
5. Predicate-specific numeric/epsilon policy.
6. Canonical normalized state behavior.
7. Cup first-entry/re-entry behavior.
8. Putter Target semantics.
9. Versioned/idempotent persistence protocol.
10. Fresh-session durability solution.
11. Complete FSM and resize suspension.
12. Meter timing function and key-repeat behavior.
13. Camera/intro/notice active-time rules.
14. Viewport/HUD allocation and ANSI width.
15. Course resource limits and source canonicalization.
16. Exact Preview content authority.
17. Structured warning identity and deterministic ordering.
18. Traceability evidence requirements for #12.

Retire or archive the former `design.md` and `version-1-requirements.md` after their normative content has been incorporated into the PRD.

## `docs/course-format.md`

- Publish bounded ID/name and complexity rules.
- Publish exact shape edge behavior.
- Explain boundary-first then owning-cell Terrain.
- Explain why tee/Cup owning cells must be playable/Green.
- Replace direct `JSON.parse()` workflow with duplicate-aware raw parsing.
- Document canonical source/symlink policy where relevant to discovery.

## ADRs

Consider an ADR only if the owner makes a hard-to-reverse trade-off for:

- Persistence outside/alongside Pi custom session entries.
- Physical versus lexical Course source identity.
- Canonical raster byte format, if bytes become a public compatibility artifact.

---

# Part X — Verification evidence from this audit

The current branch passed:

```text
npm run lint
npm run typecheck
npm test                 # 98 tests
npm audit --omit=dev     # 0 vulnerabilities
npm pack --dry-run
git diff --check
```

Additional confirmed facts:

- Project engine: Node `>=20`.
- Pinned Pi engine: Node `>=22.19.0`.
- Current `UI_STATES` length: 9.
- Current Course validator accepts a sub-cell Green Cup whose raster cell is Fairway.
- Current Course validator accepts a boundary Cup whose raster cell is Out of Bounds.
- Preview and minimal Courses remain raster-identical under an exact closed-containment probe.
- No product files were edited as part of the audit before creation of this handoff document.

## Final recommendation

Before dispatching issue #5, create and complete a focused **Course semantics and requirements hardening** gate that resolves Terrain ownership, geometry predicates, resource limits, raw JSON parsing, IDs, and exact authoring rules. In parallel, resolve the Pi persistence architecture before issue #9. Update issue #10’s FSM contract before UI implementation begins. Ticket #3 content does not need to be reopened; its documentation and integration tests can be amended after the core semantics are settled.
