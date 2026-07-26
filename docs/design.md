# Pi Golf — Version 1 Design

## Purpose

Pi Golf is a deterministic, single-player golf game implemented as a project-local Pi terminal extension. Version 1 is a three-hole preview used to validate the game loop, physics, rendering, persistence, and custom-course format before the remaining six planned holes are built.

This document is the implementation source of truth for version 1. Domain terminology is defined in [`CONTEXT.md`](CONTEXT.md). Architectural rationale is recorded in [`adr/`](adr/).

## Version 1 scope

Version 1 includes:

- The built-in **Preview Course**, containing Holes 1, 2, and 4 in that order.
- A complete playable Round over every Hole in the selected Course.
- Deterministic Club, Power, Carry, Roll, Terrain, Cup, hazard, and scoring rules.
- A borderless game overlay anchored to the top-right of Pi's terminal viewport.
- Save/resume within a Pi session and a persisted project-level Course selection.
- A versioned JSON Course format shared by built-in and custom Courses.
- Course selection and validation commands.
- Headless tests for simulation, Course handling, persistence, and rendering.

Version 1 does not include:

- Holes 3, 5, 6, 7, 8, or 9.
- Wind, elevation, slopes, spin controls, or curved shots.
- Trees, walls, or bouncing collisions.
- Random shot dispersion.
- Multiplayer, AI opponents, online leaderboards, or global statistics.
- Audio.
- A visual Hole editor.
- Global or cross-project Round saves.

## Content

### Preview Course

- Course ID: `preview-course`
- Display name: `Preview Course`
- Hole order: 1, 2, 4
- Pars: 4, 3, 5
- Total par: 12
- Scorecards contain exactly these three Holes.

Hole display names are always `Hole {number}`. Holes have no descriptive display names.

### Hole 1

A forgiving, straight introduction.

- ID: `hole-1`
- Number: 1
- Par: 4
- Boundary: polygon approximating a `120 × 40`-unit rounded rectangle
- Tee: `(8, 20)`
- Cup: `(113, 20)`
- Calculated Length: 105
- Fairway: straight corridor from tee to Green, width 18
- Green: ellipse centered on Cup, radii `8 × 6`
- No bunker or water
- All other playable Terrain: Rough

### Hole 2

A diagonal par 3 with an interrupted Fairway and guarded Green.

- ID: `hole-2`
- Number: 2
- Par: 3
- Boundary: polygon spanning roughly `65 × 50` units
- Tee: `(8, 43)`
- Cup: `(52, 10)`
- Calculated Length: 55
- Fairway: diagonal corridor from tee to Green, width 12
- Rough interruption: ellipse near `(28, 28)`, radii `6 × 5`, applied after the Fairway
- Green: ellipse centered on Cup, radii `7 × 6`
- Guard bunkers: ellipses near `(43, 7)` and `(53, 19)`, radii `5 × 4`
- Bunkers may overlap the outer Green approach visually but may not cover the Cup
- No water
- All other playable Terrain: Rough

### Hole 4

A staged par 5 requiring Carry over water.

- ID: `hole-4`
- Number: 4
- Par: 5
- Boundary: polygon spanning roughly `180 × 60` units
- Tee: `(8, 30)`
- Cup: `(168, 30)`
- Calculated Length: 160
- Fairway corridor, width 16, through:
  - `(8, 30)`
  - `(65, 22)`
  - `(110, 38)`
  - `(168, 30)`
- Water: a full-height strip from approximately `x=75` through `x=100`, applied after Fairway and dividing the playable land
- Green: ellipse centered on Cup, radii `8 × 7`
- Guard bunkers: ellipses near `(157, 20)` and `(157, 40)`, radii `6 × 4`
- All other playable Terrain: Rough

The first full driver should stop before the water. A later deliberate Carry can clear it. A ground route around the water is not required.

## Game flow

### Round lifecycle

1. `/golf` resumes an active Round or starts the selected Course.
2. New Holes begin at the tee with the driver selected.
3. The initial Shot Direction is the 22.5-degree direction nearest the direct tee-to-Cup bearing.
4. The player completes a Hole only by entering the Cup.
5. After Cup capture and animation, show a centered summary beginning with `It's in the hole!`.
6. Enter or Space advances from the Hole summary.
7. After the Course's final Hole, show the final scorecard.
8. From the final scorecard, `R` starts a new Round and Esc saves and returns to Pi.

There is no maximum Stroke count per Hole.

### Immediate start

`/golf` enters gameplay immediately rather than showing a title screen. Show `Preview Course — Hole {number} — Par {par}` centered for about one second, then transition to the corner HUD. Keep expanded controls visible until the first Stroke, then collapse them to a one-line hint.

### Finite-state machine

Transient UI uses mutually exclusive states:

- `intro`
- `aiming`
- `metering`
- `playback`
- `penalty-notice`
- `hole-summary`
- `round-summary`
- `resize-paused`
- `confirm-abandon`

Persisted Round state is separate from transient UI state. Resume never restores a meter, notice, or partially played animation.

## Controls

| Action | Control |
|---|---|
| Rotate Shot Direction by 22.5 degrees | Left/Right |
| Select Club | Up/Down |
| Toggle camera between Lie and Target | Tab |
| Start Power Meter | Space or Enter |
| Stop meter and commit Shot | Space or Enter |
| Toggle HUD | H |
| Pause, save, and return to Pi | Esc |
| Abandon Round | Q, then confirmation |

Club selection wraps continuously:

`Driver → 3i → 4i → 5i → 6i → 7i → 8i → 9i → PW → Putter → Driver`

Shot Direction and Club are locked while metering and during committed-shot playback.

Esc behavior:

- While aiming: save and close.
- While metering: cancel the uncommitted meter without a Stroke, save, and close.
- During playback or a penalty notice: queue the pause until playback and notice complete.

## Shot preparation

### Shot Direction

- Sixteen directions at 22.5-degree intervals.
- Left/Right rotates by one interval and wraps at 360 degrees.
- Direction persists between Strokes on a Hole.
- A new Hole initializes toward the Cup as described above.

### Club selection and nominal distance

All Clubs are legal from every playable Terrain. Poor choices remain legal rather than being blocked.

| Club | Full-power nominal distance (course units) |
|---|---:|
| Driver | 50 |
| 3 iron | 44 |
| 4 iron | 40 |
| 5 iron | 35 |
| 6 iron | 31 |
| 7 iron | 27 |
| 8 iron | 23 |
| 9 iron | 19 |
| Pitching wedge | 15 |
| Putter | 13 units of expected Green roll |

For a non-putter Club, nominal distance is Carry. For the putter, nominal distance is expected Roll on Green.

### Target

- The Target is displayed at the selected Club's full-power distance along Shot Direction.
- On Fairway and Green, it truthfully predicts 100%-Power Landing Position for non-putter Clubs.
- On Green, a putter Target truthfully predicts its 100%-Power resting position.
- On Fairway, a putter Target uses Fairway-adjusted expected Roll.
- On Rough and Bunker, the Target deliberately shows the Fairway projection and hides the Terrain penalty.
- If the Target lies outside the Course Boundary, aiming remains legal and the HUD shows a warning.
- The dotted prediction path is visible only while aiming. It is hidden when metering starts and throughout playback.
- A putter displays a predicted Roll path rather than a Carry path.

### Power Meter

- Ten whole `█` blocks.
- Single fixed color: `#ed8796`.
- No percentage or numeric Power display.
- Blocks fill left-to-right from one block to ten blocks over 1.5 seconds.
- Blocks empty right-to-left from ten blocks to one block over 1.5 seconds.
- The cycle repeats until stopped.
- The committed Power is exactly the visible block count: 10%, 20%, …, 100%.
- Each new meter starts at one block and moves upward.

## Deterministic simulation

There is no wind, randomness, hidden accuracy value, or shot dispersion. Identical inputs and state produce identical outcomes.

### Coordinate and numeric rules

- Terrain occupies integer Course cells.
- Tee, Cup, ball, Target, geometry, and movement use continuous coordinates.
- Persisted coordinates, speeds, elapsed times, and direction vectors are normalized to six decimal places.
- Shared comparison epsilon: `1e-6`.
- Version 1 Course geometry coordinates are limited to the inclusive range `[-1_000_000, 1_000_000]`.
- Course ellipse radii and corridor widths must be greater than zero and at most `1_000_000` units.
- Reject numeric values outside these limits at their exact JSON paths; never clamp, translate, coerce, or repair them.
- Do not round animation frames; normalize only deterministic simulation checkpoints and persisted results.

### Lie Carry multipliers

For non-putter Clubs:

| Original Lie Terrain | Carry multiplier |
|---|---:|
| Fairway | 1.00 |
| Green | 1.00 |
| Rough | 0.70 |
| Bunker | 0.40 |

Rough and Bunker reductions are fixed, deterministic, uniform across non-putter Clubs, and hidden by the displayed Target.

### Carry distance and duration

Let:

- `D` be the Club's nominal Carry distance.
- `p` be committed Power from `0.1` through `1.0`.
- `m` be the original Lie's Carry multiplier.
- `L = D × p × m` be actual Carry distance.
- `T = 3 × sqrt(p)` seconds be Carry duration.
- `u = t / T`, clamped to `[0, 1]`.
- `r` be Club landing-speed retention.

Normalized Carry progress is:

```text
f(u) = (1 - r) × (1 - (1 - u)^2) + r × u
```

Distance traveled during Carry is `L × f(u)`.

Instantaneous Carry speed is:

```text
v(u) = (L / T) × (2 × (1 - r) × (1 - u) + r)
```

A full-Power Carry lasts approximately three seconds. Weaker shots travel less distance, move more slowly, and finish sooner. Terrain crossed while airborne does not affect the ball. Water and the Course Boundary are checked when Carry lands, not while airborne.

### Landing-speed retention

| Club | `r` |
|---|---:|
| Driver | 0.45 |
| 3 iron | 0.39 |
| 4 iron | 0.35 |
| 5 iron | 0.31 |
| 6 iron | 0.27 |
| 7 iron | 0.23 |
| 8 iron | 0.19 |
| 9 iron | 0.15 |
| Pitching wedge | 0.08 |

The putter has no Carry and therefore no retention value.

### Roll

After landing, the ball continues in the same Shot Direction. Terrain beneath the rolling ball applies constant deceleration and may change continuously as boundaries are crossed.

| Terrain | Base deceleration (course units/s²) |
|---|---:|
| Green | 1 |
| Fairway | 3 |
| Rough | 7 |
| Bunker | 18 |
| Water | Immediate hazard |

Roll ends when the ball stops, enters the Cup, enters water, or goes Out of Bounds.

### Green deceleration for incoming non-putter shots

When a non-putter ball rolls on Green:

```text
green deceleration = 1.0 × origin Terrain multiplier × Club multiplier
```

Origin is the Terrain at the pre-shot Lie and remains fixed for that Shot.

Origin multipliers:

| Original Lie | Multiplier |
|---|---:|
| Fairway | 1.30 |
| Green | 1.00 |
| Rough | 0.80 |
| Bunker | 0.60 |

Club multipliers:

| Club | Multiplier |
|---|---:|
| Driver | 0.40 |
| 3 iron | 0.70 |
| 4 iron | 0.80 |
| 5 iron | 0.90 |
| 6 iron | 1.00 |
| 7 iron | 1.10 |
| 8 iron | 1.25 |
| 9 iron | 1.40 |
| Pitching wedge | 1.60 |

A pitching wedge from Fairway therefore uses `1.0 × 1.30 × 1.60 = 2.08` course units/s² on Green. A putt bypasses origin and Club modifiers and uses the Green's base deceleration of 1.

### Putter

A putt has no Carry. Its full-Power initial speed is derived from 13 units of Green Roll:

```text
v_max = sqrt(2 × 1 × 13) = sqrt(26) ≈ 5.10 units/s
v(p) = sqrt(26 × p)
```

This produces a stopping distance of exactly `13 × p` units on Green.

A full-Power putter's truthful Fairway Target is:

```text
26 / (2 × 3) = 26 / 6 ≈ 4.33 units
```

Rough and Bunker display the Fairway putter Target but produce shorter actual Roll.

### Cup capture

- Capture radius: `0.35` course units.
- Maximum capture speed: `1.5` course units/s, inclusive.
- Cup capture is possible only during Roll.
- Airborne Carry over the Cup is ignored.
- A ball landing inside the radius begins Roll and is immediately tested at landing speed.
- A faster rolling ball passes over the Cup.
- Flag versus Cup rendering never changes capture behavior.

### Water and Out of Bounds

A ball triggers a failure when:

- Carry lands in water or beyond the Course Boundary, or
- Roll crosses into water or beyond the Course Boundary.

The failed Shot counts as one Stroke. Add one Penalty Stroke, so total Score increases by two. Restore the pre-shot Lie, preserve the used Club and Shot Direction, and reset the Power Meter to one block.

After failure playback, display for two seconds:

- `Water Hazard! (+1 penalty)`, or
- `Out of Bounds! (+1 penalty)`

Then pan automatically to the restored Lie. Do not show a replay message or animate backward travel.

### Continuous event detection

During Roll, test the entire movement segment from the prior to next position rather than only endpoints. Resolve the earliest event along the segment. This applies to:

- Cup capture
- Water entry
- Terrain transitions
- Course Boundary crossing

During Carry, crossed Terrain, water, and Course Boundary are ignored; evaluate Water and Out of Bounds only at the continuous Landing Position. This prevents tunneling at high Ball Speed without incorrectly treating airborne crossings as ground contact.

### Simulation and playback separation

Per [ADR 0002](adr/0002-resolve-shots-before-animation.md):

1. Resolve a committed Shot completely with a pure simulator.
2. Persist its resulting Round state atomically.
3. Replay the recorded trajectory as presentation only.

- Physics timestep: fixed 120 Hz.
- Playback frame rate: 30 FPS.
- Playback interpolates recorded checkpoints.
- Rendering may skip delayed frames, but simulation outcome never changes.
- Animation frames are not persisted.
- If Pi exits mid-playback, resume from the already resolved Lie.

## Scoring

- Official Score is total played Strokes plus Penalty Strokes.
- HUD shows current Hole, par, Hole Strokes, and Round total.
- Hole summary shows `It's in the hole!`, Hole Strokes, and cumulative Score.
- Scorecard contains only the selected Course's Holes.
- Relative-to-par is secondary information.
- No forced pickup or per-Hole Stroke cap.

## Rendering and viewport

### Overlay

- Gameplay uses a focused `ctx.ui.custom()` overlay.
- Anchor: absolute top-right.
- Margin: zero.
- Border: none.
- Overlay captures keyboard focus while open and restores prior focus when closed.
- Existing Pi content remains around or beneath the overlay.
- Gameplay requires `ctx.mode === "tui"`; other modes receive a clear interactive-TUI-required response.

### Native and minimum size

- Native viewport: 60 × 60 Course units.
- One Course unit: two terminal columns × one terminal row.
- Native canvas: 120 × 60 terminal cells.
- Minimum terminal allocation: 60 × 20 terminal cells, showing a cropped 30 × 20-unit camera view.
- Available space expands the visible Course continuously up to native size; it does not magnify tiles.
- Space beyond native size is not used to enlarge gameplay.
- The canvas includes HUD overlays; no external HUD rows or border are added.
- Recompute dimensions on every render.
- If available size falls below 60 × 20, enter `resize-paused`, pause visual playback, and show a centered resize message.
- Resume automatically when sufficient size returns.
- No rendered line may exceed the width passed to `render()`.

### Camera

- Center on the ball while initially selecting Club and direction.
- Pan toward the Target after a brief delay.
- Tab toggles immediately between Lie and Target views.
- Show an edge arrow toward whichever is off-screen.
- During playback, follow the ball smoothly.
- After rest or restoration, recenter on the current Lie.
- Use a HUD-safe inset so ball, Target, Cup/Flag, and edge arrows are not placed beneath corner panels.
- The terminal viewport is not the Course Boundary.

### HUD

HUD panels overlay viewport corners:

- Top-left: Hole, par, Hole Strokes, total Score.
- Top-right: Club, Lie Terrain, Shot Direction, displayed Target distance, Out-of-Bounds Target warning.
- Bottom-left: compact controls.
- Bottom-right: Power Meter while metering; live Ball Speed during playback.

`H` hides or shows all HUD panels. Terrain may be obscured under panels, but critical markers use the HUD-safe inset.

### One-bit Braille Terrain tiles

Each Course unit uses two Braille characters, producing a 4 × 4-dot bichrome tile. Raised dots receive a fixed 24-bit ANSI foreground color. Off dots use the terminal's default background. Pattern, not color, is authoritative.

| Terrain | Tile | Hex color |
|---|---|---|
| Green | `⠁⠈` | `#a6da95` |
| Fairway | `⠒⠒` | `#a6da95` |
| Rough | `⣶⣶` | `#a6da95` |
| Bunker | `⠶⠶` | `#eed49f` |
| Water | `⠛⣤` | `#8aadf4` |
| Out of Bounds | two spaces | terminal default |

- Use direct 24-bit ANSI colors, not Pi semantic theme colors.
- Reset ANSI styling after every tile row to prevent bleed.
- Water remains static while idle.
- A local temporary pattern change may indicate a water landing.

### Overlay glyphs

| Element | Glyph | Hex color |
|---|---|---|
| Ball | `●` | `#f4dbd6` |
| Cup | `○` | `#cad3f5` |
| Flag | `⚑` | `#ed8796` |
| Target | `╳` | `#ed8796` |
| Carry/putt path | `·` | `#939ab7` |
| Course Boundary | `×` | `#5b6078` |
| Off-screen arrows | cardinal/diagonal arrow | `#f5a97f` |

Display rules:

- If the current Shot originates outside Green, render Flag at the Cup position.
- If the current Shot originates from Green, render Cup instead.
- Marker choice stays fixed during a Shot and updates at the next Lie.
- The hidden Cup remains mechanically active while Flag is displayed.
- Overlays replace only the necessary character within a two-character Terrain tile where possible.

## Course format and authoring

Per [ADR 0001](adr/0001-versioned-json-course-format.md), built-in and custom Courses use one versioned JSON format and one validation/rasterization pipeline.

### Discovery and selection

- Built-in Preview Course is stored in the same JSON format as custom Courses.
- Discover project custom Courses under `.pi/golf/courses/`.
- `/golf course` opens a Pi-settings-style Course selector.
- `/golf course <path>` validates the specified file and, when valid, selects it for the next new Round.
- Invalid selection leaves the existing Course unchanged and reports all validation errors.
- An active Round remains bound to its saved Course snapshot.
- Persist selected Course ID and source path in `.pi/golf/settings.json`.
- If a selected external file disappears, warn and fall back to Preview Course.

### `/golf course` UI

Use Pi's settings visual style:

- `DynamicBorder`
- `SettingsList`
- `getSettingsListTheme()`
- Title: `Golf Settings`
- One setting: `Course`
- Values: Preview Course plus every valid discovered custom Course
- Validation failures appear below the list as warning text, not selectable Courses

This is ordinary replacement UI, not the top-right gameplay overlay.

### Course schema

Top-level fields:

- `schemaVersion`: exactly `1`
- `id`: stable Course ID
- `name`: Course display name
- `holes`: ordered array of 1–18 Hole objects

Hole fields:

- `id`: stable, unique within Course
- `number`: unique integer from 1 through 18; displayed as `Hole {number}`
- `par`: integer 3, 4, or 5
- `boundary`: polygon
- `tee`: continuous point
- `cup`: continuous point
- `regions`: ordered Terrain regions

There is no Hole `name` and no declared Length. Calculate display Length as rounded Euclidean tee-to-Cup distance:

```text
round(sqrt((cup.x - tee.x)^2 + (cup.y - tee.y)^2))
```

Par is designer-supplied and independent of calculated Length.

Terrain region fields:

- `terrain`: Rough, Fairway, Green, Bunker, or Water
- `shape`: one of:
  - polygon
  - ellipse
  - corridor along a polyline with positive width

Rasterization:

1. Begin Out of Bounds.
2. Mark cell centers inside the boundary as Rough.
3. Apply regions in array order; later regions override earlier regions.
4. Draw Course Boundary separately from polygon-edge intersections.

Classify integer Terrain cell `(x, y)` using center `(x + 0.5, y + 0.5)`. Warn, but do not reject, when a region is too narrow to affect any cell. Tee, Cup, ball, and physics remain continuous.

### Validation

Reject an entire Course and report every error with its JSON path when any blocking rule fails:

- Unsupported `schemaVersion`.
- Missing or invalid Course ID/name.
- Hole count outside 1–18.
- Duplicate/invalid Hole IDs or numbers.
- Par outside 3–5.
- Non-finite coordinates or coordinates outside inclusive `[-1_000_000, 1_000_000]`.
- Invalid polygons, or ellipse radii/corridor widths that are not greater than zero and at most `1_000_000`.
- Course Boundary bounding box larger than 512 × 512 units.
- Tee or Cup outside the Course Boundary.
- Tee or Cup resolving to Water or Bunker after region layering.
- Cup not resolving to Green.
- Unsupported Terrain or shape type.

Do not require a connected ground route from tee to Green. Airborne water crossing and isolated playable land are legal design choices. A disconnected tee or Green may produce a non-blocking warning only. Never silently repair malformed geometry.

### Course authoring artifacts

Version 1 ships:

- A machine-readable `course.schema.json`.
- `docs/course-format.md` with coordinate, region-order, and shape examples.
- A minimal one-Hole example Course.
- Editable Preview Course JSON.
- Runtime path-aware validation.

The JSON schema and runtime validator derive from one shared schema definition or are tested for exact equivalence.

## Persistence

### Active Round

Save state after every committed Shot and Hole completion using Pi custom session entries.

At Round start, append one immutable snapshot containing the fully validated selected Course. File edits or deletion affect only future Rounds.

After each Shot, append:

- Inputs: Club, Shot Direction, Power, and pre-shot Lie.
- Outcome: final/restored Lie, Cup/hazard result, and compact trajectory summary.
- Complete compact Round state: current Hole index, per-Hole scores, selected Club/direction, status.

Reconstruct from the latest valid entry on the active Pi session branch. Do not duplicate the Course snapshot in every Shot entry and do not persist animation frames.

### Pause and abandon

- Esc saves and returns to Pi according to the state-specific behavior above.
- `/golf` resumes an active Round in the same Pi session.
- `/golf new` confirms before replacing an active Round.
- Q asks for confirmation, then marks the Round abandoned.
- Historical session entries remain; version 1 has no leaderboard/history UI.

## Commands

- `/golf` — resume active Round or start selected Course.
- `/golf new` — confirm and start a new Round.
- `/golf course` — open Golf Settings Course selector.
- `/golf course <path>` — validate and select a Course for the next new Round.

Gameplay remains inside the overlay; there are no slash commands for individual shots or scoring.

## Suggested source structure

```text
.pi/extensions/golf/
├── index.ts
├── domain/
├── simulation/
├── courses/
│   └── preview-course.json
├── course-loader/
├── persistence/
└── ui/
```

The extension runs directly through Pi's TypeScript loader without a build step. A root `package.json` may provide type-checking and headless-test scripts. A later release may package the same extension for distribution.

## Test requirements

All tests are deterministic and headless where possible.

### Simulation

- Every Club's nominal distance.
- Every landing-speed retention value.
- Every Power level from 10% through 100%.
- Carry duration and blended quadratic progress/speed.
- Rough 70% and Bunker 40% hidden Carry outcomes.
- Base Roll deceleration across Terrain transitions.
- Green origin and Club multiplier matrix, including Driver 0.40 and fairway-PW 2.08.
- Putter Green and Fairway distances.
- Cup capture below, at, and above 1.5 units/s.
- Airborne Cup crossings ignored.
- Swept Cup, Water, Terrain, and Course Boundary events.
- Water and Out-of-Bounds score increase, restore behavior, and preserved Club/direction.
- Six-decimal persistence normalization.

### Course handling

- Valid one-Hole and 18-Hole Courses.
- Every blocking validation rule and JSON-path diagnostics.
- No ground-route rejection.
- Narrow-region warning.
- Region precedence and center-point rasterization.
- Built-in Preview Course loads through the custom Course pipeline.
- Holes 1, 2, and 4 rasterize with expected tee/Cup Terrain and calculated Length.
- JSON schema/runtime validator equivalence.

### Persistence

- Round Course snapshot remains unchanged after source-file edits.
- Latest state reconstructs from the active Pi branch.
- Mid-playback interruption resumes at resolved outcome without duplicating a Stroke.
- Missing selected custom Course falls back to Preview Course for a new Round.

### Rendering and UI

- No line exceeds render width.
- Minimum 60 × 20 and native 120 × 60 layouts.
- Resize-paused transitions.
- Top-right borderless overlay options.
- HUD-safe camera placement.
- Flag/Cup origin-Terrain switching.
- Power Meter block count and timing.
- FSM key acceptance and rejection by state.
- Exact penalty and Hole-summary messages.

## Version 1 completion criteria

Version 1 is complete when:

1. `/golf` launches the borderless top-right overlay and Preview Course is playable end-to-end.
2. Holes 1, 2, and 4 match this document's geometry and scoring.
3. All deterministic mechanics match the formulas and constants above.
4. Pause/resume and interruption-safe Shot persistence work.
5. `/golf course` and `/golf course <path>` select and validate versioned Courses.
6. Rendering works from 60 × 20 through native 120 × 60 without overflow.
7. Required simulation, Course, persistence, and rendering tests pass.
8. Pi loads and reloads the project-local extension without a build step or runtime error.
