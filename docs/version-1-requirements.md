# Pi Golf — Version 1 Requirement Catalog

## Purpose

This catalog is a handoff aid for an orchestrator that will turn version-1 scope into coding tickets with acceptance criteria. [`design.md`](design.md) remains the normative specification; this file supplies stable requirement IDs, dependencies, and observable acceptance outcomes.

Tickets may combine or subdivide these requirements, but acceptance criteria must retain traceability to the IDs below.

## Dependency shape

```text
Domain types and constants
├── Course schema/validation/rasterization
│   ├── Preview Course content
│   ├── Course settings and authoring artifacts
│   └── Course loader commands
├── Pure shot simulator
│   └── Persistence and branch reconstruction
└── Rendering primitives
    └── Game component and finite-state machine
        └── Command integration and end-to-end Round
```

The Course pipeline, simulator, and rendering primitives can be developed in parallel once shared domain types and constants exist. Gameplay integration depends on all three. Tests should ship with the capability they verify rather than being deferred to one final ticket.

## Foundation

### V1-FND-001 — Project-local extension structure

The implementation is a multi-file project-local Pi extension under `.pi/extensions/golf/` and runs without a production build step.

Acceptance:

- Pi discovers the extension from the project-local path.
- `/reload` reloads it without runtime errors.
- Source modules follow the boundaries in `design.md` or an equivalent separation.
- A headless test/type-check command is documented and runnable.

### V1-FND-002 — Shared domain types and constants

One authoritative module defines game-state types and every numeric/mechanical constant from `design.md`.

Acceptance:

- Club order, distances, retention values, Terrain constants, Power levels, Cup constants, frame rates, and numeric epsilon are not duplicated across simulator and UI.
- Hole numbers are distinct from array positions and IDs.
- Transient UI state is type-distinct from persisted Round state.

## Course pipeline

### V1-CRS-001 — Versioned Course schema

Implement the version-1 JSON Course schema shared by built-in and custom Courses.

Acceptance:

- Schema accepts 1–18 ordered Holes.
- Course requires `schemaVersion`, ID, name, and Holes.
- Hole requires ID, number, par, boundary, tee, Cup, and ordered regions.
- Hole has no display name or declared Length.
- Shapes include polygon, ellipse, and corridor.
- Terrain includes Rough, Fairway, Green, Bunker, and Water.
- A machine-readable JSON schema is available to Course authors.

### V1-CRS-002 — Complete path-aware validation

Validate Course structure and geometry before selection or play.

Acceptance:

- Every blocking validation rule in `design.md` has a test.
- Validation returns all discovered errors with JSON paths rather than stopping at the first.
- Invalid input is never silently repaired.
- Geometry coordinates outside inclusive `[-1_000_000, 1_000_000]` reject at their exact JSON paths.
- Ellipse radii and corridor widths must be greater than zero and at most `1_000_000`.
- Ground connectivity is not a blocking rule.
- Isolated land and sub-cell regions may emit warnings.
- Bounding boxes larger than 512 × 512 are rejected.

### V1-CRS-003 — Deterministic Terrain rasterization

Rasterize validated continuous geometry into integer Terrain cells.

Acceptance:

- Cell classification uses `(x + 0.5, y + 0.5)`.
- Interior starts as Rough and regions override in array order.
- Boundary rendering remains separate from Terrain classification.
- Repeated rasterization of identical input is byte-for-byte equivalent.
- Region precedence and narrow-region warnings are tested.

### V1-CRS-004 — Preview Course content

Ship Preview Course through the same JSON and loader path as custom Courses.

Acceptance:

- Contains exactly Hole IDs `hole-1`, `hole-2`, and `hole-4` in that order.
- Displays Hole numbers 1, 2, and 4.
- Pars are 4, 3, and 5; total par is 12.
- Calculated Lengths are 105, 55, and 160.
- Geometry and region ordering match `design.md`.
- Tee resolves to playable Terrain and Cup resolves to Green on every Hole.
- Hole 4 permits mandatory airborne crossing without a ground-route validation failure.

### V1-CRS-005 — Course discovery and project selection

Discover and persist custom Course selection.

Acceptance:

- Discover custom files under `.pi/golf/courses/`.
- Persist selected Course ID and source path in `.pi/golf/settings.json`.
- A valid explicit path may be outside the discovery directory.
- Missing, unreadable, malformed, validator-invalid, reserved-ID, and ID-changed selected sources warn and fall back to Preview Course before catalog reconciliation for new Rounds.
- Preview Course exclusively owns `preview-course`; external use is invalid and nonselectable.
- One pure reconciliation boundary produces a Preview-first catalog with globally unique Course IDs and source paths, one exact current option, deterministic ordering, and warnings that are never values.
- Exact source duplicates collapse first. A freshly validated effective selected external source wins its nonreserved ID inside or outside discovery; every discovered same-ID loser is excluded with a deterministic source-aware warning and the winner never warns against itself.
- Without a selected winner, every source in a duplicate discovered-ID group is excluded with deterministic source-aware warnings.
- Distinct IDs with equal display names remain selectable through deterministic source-qualified labels.
- Discovery changes cannot silently replace a valid selected source; explicitly selecting another valid nonreserved conflicting source makes it the next winner.
- Discovery retains all independently valid candidates and validation issues for the catalog reconciler rather than resolving cross-source identity during traversal.
- Selection changes never mutate an active Round's Course snapshot.

### V1-CRS-006 — Course authoring documentation

Ship authoring aids described in `design.md`.

Acceptance:

- `docs/course-format.md` documents coordinates, Length calculation, layer ordering, every shape, and validation.
- A minimal valid one-Hole example is included.
- Preview Course JSON is editable and validates.
- Static JSON schema and runtime validation cannot drift unnoticed; generation or an equality test enforces this.

## Simulation

### V1-SIM-001 — Discrete Shot inputs

Represent and validate legal Club, direction, and Power inputs.

Acceptance:

- Direction is one of sixteen 22.5-degree bearings.
- Power is one of ten values from 10% through 100%.
- Club order and wrap behavior match `design.md`.
- Every Club is legal from every playable Terrain.

### V1-SIM-002 — Non-putter Carry

Implement Carry distance, duration, curve, and landing-speed retention exactly as specified.

Acceptance:

- `L`, `T`, `f(u)`, and `v(u)` match `design.md` for every Club and Power level.
- Rough applies 70% and Bunker 40% actual Carry while Target remains nominal.
- Terrain crossed airborne has no effect.
- Carry landing in Water or Out of Bounds triggers the correct outcome.
- Golden tests cover start, midpoint, landing, and retained speed.

### V1-SIM-003 — Putter behavior

Implement putter-only Roll and Terrain-adjusted expected distance.

Acceptance:

- Full-Power Green initial speed is `sqrt(26)` within epsilon.
- Green stopping distance is `13 × p` for every legal Power.
- Full-Power Fairway Target is approximately 4.33 units.
- Rough and Bunker display the Fairway Target but stop sooner.
- Putter never enters a Carry phase.

### V1-SIM-004 — Terrain Roll and Green modifiers

Apply rolling deceleration continuously.

Acceptance:

- Base Green/Fairway/Rough/Bunker decelerations are 1/3/7/18.
- Terrain changes apply as the rolling ball crosses cells.
- Green non-putter deceleration uses original-Lie and Club multipliers.
- Driver multiplier is 0.40.
- Fairway pitching wedge produces 2.08 Green deceleration.
- Putts bypass Green origin/Club multipliers.

### V1-SIM-005 — Cup, Water, and Course Boundary events

Implement continuous event detection over every movement segment.

Acceptance:

- Rolling Cup intersection captures at speeds below and exactly 1.5, but not above.
- Capture radius is 0.35.
- Airborne Cup crossings never capture.
- Fast movement cannot tunnel through Cup, Water, Terrain boundaries, or Course Boundary.
- The earliest event on a segment wins deterministically.

### V1-SIM-006 — Scoring and penalty restoration

Implement Stroke accounting and restored state.

Acceptance:

- A normal Shot adds one Stroke.
- Water or Out of Bounds adds the failed Stroke plus one Penalty Stroke.
- Failure restores the pre-shot Lie.
- Club and Shot Direction used for the failure remain selected.
- Power Meter resets to one block.
- There is no per-Hole Stroke cap.

### V1-SIM-007 — Deterministic numeric behavior

Use fixed-step, normalized deterministic simulation.

Acceptance:

- Physics runs at 120 Hz independent of rendering.
- Persisted checkpoints normalize to six decimals.
- Comparisons use epsilon `1e-6` where specified.
- Identical inputs produce deeply equal persisted outcomes.
- Rendering frequency or skipped frames cannot alter results.

## Persistence

### V1-PER-001 — Immutable Round Course snapshot

Snapshot the validated selected Course when a Round starts.

Acceptance:

- Editing or deleting the source file cannot alter an active Round.
- The Course snapshot is stored once rather than duplicated in each Stroke entry.
- New Rounds use the latest selected source.

### V1-PER-002 — Atomic resolved-Shot entries

Resolve and persist each committed Shot before animation.

Acceptance:

- Entry contains inputs, outcome summary, and complete compact Round state.
- No animation frame data is persisted.
- Process interruption during playback resumes at the resolved outcome.
- A committed Stroke cannot be partially applied or duplicated.

### V1-PER-003 — Active-branch reconstruction

Restore state from Pi's active session branch.

Acceptance:

- Latest valid golf entry on the branch determines state.
- A fork before a Stroke does not inherit that Stroke.
- A fork after a Stroke reconstructs its result.
- Transient UI always resumes in aiming, Hole summary, or Round summary as appropriate—not mid-meter/playback/notice.

## Rendering

### V1-REN-001 — Fixed Braille Terrain tiles and colors

Render every Terrain cell with the agreed two-character pattern and exact 24-bit foreground color.

Acceptance:

- Glyphs and colors match `design.md` exactly.
- Off dots use terminal default background.
- Pattern alone distinguishes Terrain.
- ANSI resets prevent row/color bleed.
- Water is static while idle.

### V1-REN-002 — Overlay markers

Render Ball, Cup, Flag, Target, path, Course Boundary, and off-screen arrows with agreed glyphs/colors.

Acceptance:

- Target is `╳`; Course Boundary is `×`.
- Outside-Green Shot origin shows Flag; Green origin shows Cup.
- Hidden Cup remains mechanically active.
- Prediction path appears only while aiming.
- Putter path represents predicted Roll.

### V1-REN-003 — Responsive top-right overlay

Render gameplay in a borderless focused overlay anchored top-right.

Acceptance:

- Native canvas is 120 × 60 terminal cells representing 60 × 60 Course units.
- Minimum allocation is 60 × 20.
- Smaller-than-native terminals crop the camera without changing tile scale.
- Below minimum, UI enters resize-paused and resumes after resize.
- No rendered line exceeds supplied width.
- Closing restores prior Pi focus.

### V1-REN-004 — Camera and corner HUD

Implement camera tracking and corner HUD behavior.

Acceptance:

- Tab toggles Lie/Target views.
- Playback follows Ball and rest recenters on Lie.
- Off-screen marker arrows are visible.
- Critical markers remain inside the HUD-safe inset.
- HUD fields and corner placement match `design.md`.
- H toggles the HUD.

### V1-REN-005 — Power Meter

Render the visual-only ten-block Power Meter.

Acceptance:

- Uses only whole `█` blocks in `#ed8796`.
- Has no numeric/percentage display.
- Fills 1→10 in 1.5 seconds and empties 10→1 in 1.5 seconds.
- Stopping commits exactly the visible block count.

### V1-REN-006 — Playback presentation

Replay resolved trajectories at 30 FPS without mutating persisted gameplay.

Acceptance:

- Carry and Roll visually follow recorded simulation checkpoints.
- Frame skips do not affect final state.
- Water/OOB notices use exact text and remain for two seconds.
- Hole completion begins with exact text `It's in the hole!` after playback reaches capture.

## Gameplay UI

### V1-UI-001 — Explicit game finite-state machine

Implement every state and key transition from `design.md`.

Acceptance:

- Each state has tests for accepted and ignored keys.
- Direction/Club cannot change during metering or playback.
- Esc semantics match aiming, metering, and committed playback rules.
- Q requires confirmation before abandon.

### V1-UI-002 — Immediate Round and Hole flow

Implement intro, aiming, Hole transitions, and final scorecard.

Acceptance:

- `/golf` immediately shows current/new Lie with a one-second Hole intro.
- First Hole starts with driver and nearest Cup direction.
- Direction and Club persist between Strokes.
- Hole summary waits for Enter/Space.
- Final scorecard contains only Holes 1, 2, and 4 for Preview Course.
- R starts a new Round; Esc saves and closes.

### V1-UI-003 — Score display

Display official and secondary scoring consistently.

Acceptance:

- Official Score equals played plus Penalty Strokes.
- HUD shows Hole/par/Hole Strokes/total.
- Hole summary shows Hole and cumulative Strokes.
- Scorecard shows per-Hole and total values.
- Relative-to-par never replaces total Stroke display.

## Commands

### V1-CMD-001 — `/golf` and `/golf new`

Acceptance:

- `/golf` resumes active Round or starts selected Course.
- `/golf new` confirms before replacing an active Round.
- Non-TUI modes return a clear interactive-TUI-required response.

### V1-CMD-002 — `/golf course` settings UI

Acceptance:

- Uses `DynamicBorder`, `SettingsList`, and `getSettingsListTheme()`.
- Title is `Golf Settings`.
- The Preview-first reconciled Course catalog appears as values for one Course setting, including a valid effective selected source outside discovery.
- The UI renders reconciled identity precedence and does not independently filter or invent conflict behavior.
- Selection persists for future Rounds only.
- Invalid discovered files and identity conflicts appear as warning text, not selectable values.

### V1-CMD-003 — `/golf course <path>`

Acceptance:

- Resolves and validates the supplied path.
- Reports all errors with JSON paths on failure.
- Leaves current selection unchanged on failure.
- Persists and selects the Course on success.
- Does not alter an active Round.

## End-to-end acceptance

### V1-E2E-001 — Complete Preview Round

A player can launch `/golf`, complete Holes 1, 2, and 4, see exact Hole transitions and a final par-12 scorecard, and start or exit afterward.

### V1-E2E-002 — Hazard recovery

A player can hit Water and Out of Bounds, observe exact two-second notices, return to the previous Lie with +2 total Score impact, and continue.

### V1-E2E-003 — Save, reload, and resume

A player can pause, reload Pi resources or restart the saved Pi session, invoke `/golf`, and continue from the latest resolved state without duplicated Strokes.

### V1-E2E-004 — Custom Course path

A player can validate/select a valid one-Hole Course via `/golf course <path>`, start a new Round on it, and later return to Preview Course through `/golf course`.

## Orchestrator guidance

- Prefer vertical tickets that include implementation plus tests for one requirement cluster.
- Do not assign concurrent tickets that edit the same shared constants/domain module without an explicit ownership plan.
- Land Course schema/domain types before parallel Course-content, simulator, and renderer tickets.
- Land pure simulation before persistence and game playback integration.
- Keep the top-right overlay/game component integration until rendering primitives and FSM transitions are testable independently.
- Every ticket should cite its requirement IDs and relevant `design.md` sections.
- A ticket is not accepted solely because TypeScript compiles; it must satisfy its observable acceptance bullets and add/update deterministic tests.
