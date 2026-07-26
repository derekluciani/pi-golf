# Pi Golf — Version 2 Product Requirements Document

**Status:** Normative Version 2 reimplementation baseline  
**Product:** Pi Golf  
**Requirements version:** 2.0  
**Last consolidated:** 2026-07-26

## 1. Document authority

This PRD is the sole normative, content-complete product and acceptance specification for Pi Golf Version 2.

Authority is divided as follows:

1. [`CONTEXT.md`](CONTEXT.md) is authoritative for domain terminology.
2. This PRD is authoritative for product behavior, constraints, requirement IDs, and acceptance criteria.
3. [`adr/`](adr/) records architectural rationale and does not override this PRD.
4. The checked-in [Preview Course JSON](../.pi/extensions/golf/courses/preview-course.json) is authoritative for its exact coordinates and region data; this PRD defines the required content and behavior of that artifact.

[`design.md`](design.md), [`version-1-requirements.md`](version-1-requirements.md), and [`requirements-audit-findings.md`](requirements-audit-findings.md) are historical inputs. They MUST NOT be used to resolve an ambiguity or derive a Version 2 ticket. If implementation, tests, or another document conflict with this PRD, work stops until the conflict is resolved in this PRD. Requirements MUST NOT be silently inferred from historical documents.

The key words **MUST**, **MUST NOT**, **SHOULD**, and **MAY** are normative. Every acceptance criterion has a stable `AC-` identifier. Delivery evidence MUST map each acceptance and completion identifier to a named automated test or explicitly approved manual evidence.

## 2. Product summary

Pi Golf is a deterministic, single-player golf game implemented as a project-local Pi terminal extension. A player completes every Hole in a selected Course and minimizes the Round Score. Version 2 reimplements the three-Hole Preview Course while hardening deterministic simulation, Course handling, persistence, rendering, and interruption-safe game flow.

### 2.1 Goals

- Provide an immediately playable terminal golf Round through `/golf`.
- Produce identical canonical outcomes from identical Course snapshots, Round state, and Shot inputs.
- Resolve and durably persist a committed Shot before presenting its playback.
- Support built-in and player-supplied Courses through one bounded, versioned JSON pipeline.
- Preserve an active Round across pause, reload, interruption, branch reconstruction, and command-only fresh Pi sessions.
- Render a responsive, keyboard-focused Pi TUI without changing gameplay according to frame timing or terminal size.
- Supply stable, testable requirements from which implementation tickets can be derived.

### 2.2 Version 2 scope

Version 2 includes:

- The built-in **Preview Course**, containing Holes 1, 2, and 4 in that order.
- A complete playable Round over every Hole in the selected Course.
- Deterministic Club, Power, Carry, Roll, Terrain, Cup, hazard, and scoring rules.
- A borderless game overlay anchored to the top-right of Pi's terminal viewport.
- Durable save/resume associated with a Pi branch and project-level Course selection.
- A versioned JSON Course format shared by built-in and custom Courses.
- Course discovery, validation, selection, and authoring artifacts.
- Headless tests plus required real Pi/TUI evidence.

### 2.3 Out of scope

Version 2 does not include:

- Preview Course Holes 3, 5, 6, 7, 8, or 9.
- Wind, elevation, slopes, spin controls, curved shots, or random dispersion.
- Trees, walls, bouncing collisions, or other obstacle physics.
- Multiplayer, AI opponents, online leaderboards, global statistics, or a Round-history UI.
- Audio or a visual Hole editor.
- Global or cross-project Round saves.
- A required connected ground route from tee to Green.

## 3. Platform and architecture constraints

### V2-FND-001 — Project-local Pi extension

The implementation MUST be a multi-file project-local extension under `.pi/extensions/golf/`. It MUST run directly through Pi's TypeScript loader without a production build step. Module boundaries MUST separate domain contracts, Course loading, pure simulation, durable persistence, and TUI presentation, even if exact filenames differ.

The supported runtime is Node `>=22.19.0`. Pi and Pi TUI compatibility MUST be tested against the project's pinned versions; the baseline at consolidation is `@earendil-works/pi-coding-agent@0.82.1` and `@earendil-works/pi-tui@0.82.1`.

Acceptance criteria:

- **AC-FND-001-01:** Pi discovers the extension from the project-local path, and `/reload` reloads it without a runtime error.
- **AC-FND-001-02:** The repository declares and tests Node `>=22.19.0` rather than advertising unsupported Node 20 releases.
- **AC-FND-001-03:** Documented lint, type-check, and headless-test commands run without a production build step.
- **AC-FND-001-04:** Pure simulation and Course validation can execute without constructing the TUI.

### V2-FND-002 — Shared contracts and clocks

One authoritative domain boundary MUST define Club order, distances, Terrain constants, Power levels, Cup constants, simulation rates, viewport constants, rendering values, and persisted contracts. Hole ID, displayed Hole number, and zero-based Course position MUST remain distinct types or validated concepts. Persisted Round state and transient UI state MUST be type-distinct.

Simulation time, playback time, display timers, camera timers, and meter timing MUST use injected or controllable monotonic clocks. Any timer described as using **active time** excludes time spent in resize suspension and, where applicable, confirmation suspension.

Acceptance criteria:

- **AC-FND-002-01:** Simulator and UI do not duplicate authoritative mechanical constants.
- **AC-FND-002-02:** Tests cannot accidentally substitute a Hole number or ID for its ordered Course index.
- **AC-FND-002-03:** Persisted contracts cannot contain transient meter, notice, camera, or playback state.
- **AC-FND-002-04:** Meter, camera, intro, notice, and playback timing can be tested with a deterministic monotonic clock.

## 4. Preview Course and Round rules

### V2-CNT-001 — Preview Course content

The built-in Course has ID `preview-course`, display name `Preview Course`, and exactly Holes `hole-1`, `hole-2`, and `hole-4` in that order. Their displayed numbers are 1, 2, and 4; their pars are 4, 3, and 5; total par is 12. Hole display names are always `Hole {number}` and Holes have no descriptive name field.

The editable checked-in Preview Course JSON is the exact authority for coordinates, polygons, and ordered regions. It MUST pass through the same raw JSON parser, validator, immutable snapshot boundary, and rasterizer as an external Course.

Required behavioral summaries:

- **Hole 1:** tee `(8, 20)`, Cup `(113, 20)`, calculated Length 105, a forgiving straight Fairway, Green around the Cup, no Bunker or Water, and Rough elsewhere inside the Boundary.
- **Hole 2:** tee `(8, 43)`, Cup `(52, 10)`, calculated Length 55, a diagonal interrupted Fairway, guarded Green, two Bunkers, no Water, and Rough elsewhere inside the Boundary.
- **Hole 4:** tee `(8, 30)`, Cup `(168, 30)`, calculated Length 160, a staged Fairway and full-height Water strip separating playable land, a guarded Green, and Rough elsewhere inside the Boundary. The first full-power Driver MUST stop before the Water; a later legal Carry MUST be able to clear it. A ground route around the Water is not required.

Acceptance criteria:

- **AC-CNT-001-01:** The Preview artifact has the required identity, Hole order, numbers, pars, calculated Lengths, and total par.
- **AC-CNT-001-02:** Every Preview tee owns playable Terrain and every Preview Cup owns Green under the gameplay Terrain lookup in V2-CRS-003.
- **AC-CNT-001-03:** The built-in artifact is loaded only through public Course parsing, validation, snapshot, and rasterization boundaries.
- **AC-CNT-001-04:** Simulator integration proves Hole 4's first full Driver stops before Water, a later legal Carry can clear it, and the Course remains completable.

### V2-GME-001 — Round and Hole flow

`/golf` MUST resume the active Round associated with the active Pi branch or immediately start the selected Course. A new Hole starts at its tee with Driver selected. Its initial Shot Direction is the discrete direction nearest the direct tee-to-Cup bearing, using V2-SIM-001's halfway rule. There is no maximum Played Stroke count and no forced pickup.

A Hole completes only through an eligible Cup capture; there is no alternate completion or pickup rule. After Cup capture and playback, a centered Hole summary MUST begin with exactly `It's in the hole!`. Enter or Space advances from a Hole summary. After the final Hole, a Round summary MUST show the final scorecard. `R` starts a replacement Round and Esc saves and closes. Summaries wait for input and do not time out.

A newly entered Hole shows `{Course name} — Hole {number} — Par {par}` centered for exactly one second of active time, then uses the corner HUD. Preview therefore shows `Preview Course — Hole {number} — Par {par}`. This is an intro notice, not a title screen or menu. Expanded controls remain visible until the first Stroke and then collapse to a one-line hint.

All other timed notices use one reusable `display-timer` duration of exactly two seconds of active time. Hole and Round summaries wait for input. Reload never resumes an intro, notice, or playback.

Acceptance criteria:

- **AC-GME-001-01:** A new Preview Round begins immediately on Hole 1 with Driver and the correctly quantized Cup direction.
- **AC-GME-001-02:** Club and direction persist between Strokes on a Hole; a new Hole resets them as specified.
- **AC-GME-001-03:** Hole and Round summaries contain only the selected Course's ordered Holes, wait for the specified input, and use the exact completion text.
- **AC-GME-001-04:** The intro lasts exactly one second of active time, freezes during resize, and is never resumed after reload.
- **AC-GME-001-05:** Every timed notice uses the shared two-second active-time duration; summaries do not time out and reload does not resume notices.

### V2-GME-002 — Scoring

The official scoring model is:

```text
playedStrokes
penaltyStrokes
holeScore = playedStrokes + penaltyStrokes
roundScore = sum(holeScore)
```

A normal committed Shot adds one Played Stroke. A Shot ending in Water or Out of Bounds adds that Played Stroke plus one Penalty Stroke. UI and persistence MUST preserve the distinction. The official per-Hole value MUST be labeled **Hole Score**, never penalty-inclusive “Hole Strokes.” Relative-to-par is secondary and MUST NOT replace numeric Score.

Acceptance criteria:

- **AC-GME-002-01:** Normal, Water, and Out-of-Bounds outcomes update played, penalty, Hole, and Round values according to the formula.
- **AC-GME-002-02:** HUD, Hole summaries, Round scorecards, persistence, and tests use `playedStrokes`, `penaltyStrokes`, `holeScore`, and `roundScore` consistently.
- **AC-GME-002-03:** Preview scorecards contain exactly Holes 1, 2, and 4 and total par 12.

## 5. Shot preparation

### V2-SIM-001 — Club, direction, and Power inputs

Club selection wraps continuously in this order:

```text
Driver → 3i → 4i → 5i → 6i → 7i → 8i → 9i → PW → Putter → Driver
```

Every Club is legal from every playable Terrain.

| Club | Full-power nominal distance (Course Units) |
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
| Putter | 13 units of expected Green Roll |

Shot Direction has 16 indices at 22.5-degree intervals. `0°` points toward increasing `x`; `90°` points toward increasing `y`; bearings increase clockwise in terminal coordinates. Left/Right changes the index by one and wraps. Exact halfway quantization chooses the higher clockwise index. Physics reconstructs a unit vector from the discrete index/bearing; a persisted or rounded vector MUST NOT drive displacement. Persistence stores the discrete index or exact bearing.

Power is exactly one of `0.1, 0.2, …, 1.0` and is selected by the Power Meter.

Acceptance criteria:

- **AC-SIM-001-01:** All Club distances, selection order, and wrapping are covered by table-driven tests.
- **AC-SIM-001-02:** Direction orientation, wrapping, all 16 vectors, and exact-halfway clockwise quantization are tested.
- **AC-SIM-001-03:** Long displacements use vectors reconstructed from discrete direction and do not drift because of six-decimal rounded vectors.
- **AC-SIM-001-04:** Only the ten legal Power values can be committed, and every Club remains legal on every playable Terrain.

### V2-SIM-002 — Shared Target projection

The Target is an **expected projection**, not a guarantee when the path changes Terrain. One shared projection result MUST feed simulation preparation, prediction path rendering, camera targeting, and HUD Target distance/marker behavior.

At full Power:

- A non-putter Target from Fairway or Green uses nominal Carry distance.
- A non-putter Target from Rough or Bunker deliberately displays the Fairway projection and hides the actual Carry penalty.
- A Putter Target from Green uses 13 units of expected Roll.
- A Putter Target from Fairway uses `26 / 6` units of expected Roll.
- A Putter Target from Rough or Bunker deliberately displays the Fairway projection and hides the additional resistance.
- Terrain transitions along the projected or actual path may cause the resting position to differ.
- A Target outside the Course Boundary remains legal and produces a HUD warning.
- The dotted path is visible only while aiming. A Putter path is an expected Roll path; other Clubs show Carry prediction.

Acceptance criteria:

- **AC-SIM-002-01:** One projection interface supplies simulator preparation, path, camera, marker, distance, and Out-of-Bounds warning consumers.
- **AC-SIM-002-02:** Integration cases cover Fairway, Green, Rough, Bunker, Putter, and Out-of-Bounds Target results without cross-layer disagreement.
- **AC-SIM-002-03:** Product text and UI never claim that a projection guarantees the actual result across Terrain transitions.

## 6. Course format and Terrain semantics

### V2-CRS-001 — Versioned and bounded Course schema

Built-in and external Courses use one JSON schema and pipeline. Top-level fields are:

- `schemaVersion`: exactly `1` for the Version 2 Course format.
- `id`: stable Course ID.
- `name`: Course display name.
- `holes`: ordered array of 1–18 Hole objects.

Each Hole requires `id`, `number`, `par`, `boundary`, `tee`, `cup`, and ordered `regions`. A Hole has no display name or declared Length. Display Length is:

```text
round(sqrt((cup.x - tee.x)^2 + (cup.y - tee.y)^2))
```

Par is designer-supplied and independent of Length. Hole number is unique within the Course and is an integer 1–18. Par is 3, 4, or 5.

Regions contain Terrain plus polygon, ellipse, or positive-width corridor geometry. Terrain values are Rough, Fairway, Green, Bunker, and Water. Every schema object is closed: unknown/additional properties are rejected.

Shape objects are exact:

- A point is `{ "x": number, "y": number }` and has no additional fields.
- A polygon is `{ "type": "polygon", "points": Point[] }`, with 3–1,024 points. It has nonzero area, is non-self-intersecting, and has no equal consecutive vertices; its final point connects to its first.
- An ellipse is `{ "type": "ellipse", "center": Point, "radiusX": number, "radiusY": number }`, with both radii in the positive approved numeric domain.
- A corridor is `{ "type": "corridor", "points": Point[], "width": number }`, with 2–1,024 points, no equal consecutive points, and positive full width.
- A region is `{ "terrain": Terrain, "shape": Shape }` and has no additional fields.

Course and Hole IDs MUST match:

```regex
^[a-z0-9](?:[a-z0-9._-]{0,63})$
```

A Course name is 1–30 characters, rejects control characters, and rejects leading or trailing whitespace rather than trimming it.

Resource limits are exact/raw schema or validation limits:

| Resource | Maximum |
|---|---:|
| Course JSON bytes | 1 MiB (1,048,576 bytes) |
| Holes | 18 |
| Regions per Hole | 128 |
| Points per polygon or corridor | 1,024 |
| Course/Hole ID characters | 64 |
| Course name characters | 30 |
| Geometry coordinate magnitude | 1,000,000 inclusive |
| Ellipse radii/corridor width | 1,000,000; must also be > 0 |
| Boundary bounding-box width/height | 512 Course Units each |
| Total raster cells over all Holes | 2,000,000 |
| Returned diagnostics/warnings | 256 including a truncation diagnostic when needed |

Acceptance criteria:

- **AC-CRS-001-01:** A machine-readable schema and runtime structural authority accept exactly the required fields, shapes, Terrain values, counts, ID policy, and name policy.
- **AC-CRS-001-02:** Schema limits reject at exact JSON paths without epsilon, coercion, clamping, translation, trimming, or repair.
- **AC-CRS-001-03:** Boundary extent, per-shape complexity, per-Hole regions, total raster cells, input bytes, and bounded diagnostics have limit and over-limit tests.
- **AC-CRS-001-04:** Static JSON schema and runtime structural validation cannot drift unnoticed; generation or exact schema-equivalence testing enforces this.

### V2-CRS-002 — Raw parsing and complete validation

File input MUST use a duplicate-aware raw JSON parser. Duplicate object members are blocking errors reported with useful paths; a parser MUST NOT silently keep the last value. `parseCourse(unknown)` MAY remain available for already-parsed programmatic input, but built-in and external files MUST pass through the raw parser.

Validation MUST aggregate all independently discoverable structural and semantic errors up to the diagnostic cap. Each blocking error includes a stable code and JSON path. Invalid input is never silently repaired.

Blocking semantic conditions include:

- Unsupported schema version, invalid identity/name, Hole count, duplicate Hole identity/number, or invalid par.
- Non-finite coordinates or coordinates outside inclusive `[-1_000_000, 1_000_000]`.
- Invalid shape geometry, invalid Course Boundary, non-positive or oversized dimensions, or oversized Boundary box.
- Tee or Cup outside the closed Course Boundary.
- Tee owning Water or Bunker, or any non-playable Terrain.
- Cup's gameplay Terrain not Green.
- Unsupported Terrain or shape types.
- Any resource limit violation.

Ground connectivity is not a blocking rule. Isolated playable land is permitted. A Course MUST NOT be rejected merely because reaching a destination requires Carry.

Acceptance criteria:

- **AC-CRS-002-01:** Built-in and external JSON with duplicate keys fail before ordinary schema validation can discard the duplicate.
- **AC-CRS-002-02:** Every blocking rule has a path-aware test, and multiple independent errors are returned deterministically up to the cap.
- **AC-CRS-002-03:** A valid disconnected Course is accepted without a ground-route requirement.
- **AC-CRS-002-04:** File parsing and programmatic `parseCourse(unknown)` are distinct, documented boundaries.

### V2-CRS-003 — Geometry containment and gameplay Terrain

Geometry follows these exact ownership rules:

1. Course Boundaries, polygons, ellipses, corridors, and Cup disks are closed; a point exactly on an edge is inside.
2. Corridors are unions of closed-radius segment capsules, including caps and joins.
3. Every polygon follows V2-CRS-001's validity rules; the Course Boundary is always a polygon.
4. Region overlap is valid and later regions override earlier regions.
5. Geometry outside the Course Boundary never paints playable Terrain.
6. A point outside the continuous closed Course Boundary is Out of Bounds.
7. A point inside the Boundary owns raster cell `(floor(x), floor(y))`, including for negative coordinates. Cell ranges are half-open `[n, n + 1)`.
8. Gameplay Terrain is the rasterized Terrain of that owning cell.
9. Tee validation, Cup validation, Lie classification, simulation, and rendering-facing gameplay lookup MUST use this same Boundary-first rule.

Rasterization starts Out of Bounds, marks cells whose centers `(x + 0.5, y + 0.5)` are inside the closed Boundary as Rough, then applies ordered regions by center sampling. Boundary rendering derives separately from the exact polygon segments/intersections and never changes Terrain classification.

Numeric policy is predicate-specific:

- Schema and resource bounds use exact/raw comparisons.
- Geometry uses operation-specific robust predicates appropriate to orientation, normalized ellipse distance, and squared capsule distance.
- There is no global geometry or comparison epsilon.
- Roll event ties alone use V2-SIM-006's `1e-9`-second tolerance.
- Cup speed alone uses exact `speed <= 1.5`.

Acceptance criteria:

- **AC-CRS-003-01:** Edge, ellipse-boundary, corridor cap/join, overlap, clipping, negative-coordinate, and half-open-cell cases obey the nine ownership rules.
- **AC-CRS-003-02:** A sub-cell Green that contains the continuous Cup but does not affect its cell is rejected because the Cup's gameplay Terrain is not Green.
- **AC-CRS-003-03:** A Cup continuously inside/on the Boundary whose owning cell rasterizes Out of Bounds is rejected.
- **AC-CRS-003-04:** Robust-predicate tests cover ordinary coordinates and coordinates near the allowed magnitude without applying one dimensionally inconsistent epsilon.

### V2-CRS-004 — Deterministic raster and warnings

Raster output is row-major from its declared `(minX, minY)` and uses bounded offset loops. Repeated rasterization of equal validated input MUST produce exact typed deep equality. Public compatibility is typed data equality, not byte-for-byte JSON serialization.

Every valid region that affects no raster cell MUST emit exactly one structured `narrow-region` warning. All diagnostics and warnings are structured objects; presentation text is not identity. Warning identity includes a stable code, canonical source path where applicable, JSON path/details, and relevant Course/Hole/region identity. Deduplicate by structured identity, then sort by canonical source path, warning code, JSON path, Course index, Hole index, and region index, using relevant fields in that order. Output is capped at 256 entries while retaining one deterministic truncation diagnostic if entries were omitted.

Acceptance criteria:

- **AC-CRS-004-01:** Repeated rasterization is exactly deeply equal as typed data and remains row-major with deterministic bounds.
- **AC-CRS-004-02:** Every no-cell region emits exactly one `narrow-region` warning; affected regions emit none.
- **AC-CRS-004-03:** Candidate input order and rendered warning wording cannot alter structured deduplication or ordering.
- **AC-CRS-004-04:** Excess diagnostics are bounded and report deterministic truncation.

### V2-CRS-005 — Immutable Round snapshot

Selection and preview MAY operate on ordinary validated objects. Round start MUST perform a fresh stable read, parse and validate those exact bytes, clone the resulting plain-data Course graph, deeply freeze it, and serialize that immutable snapshot once in the initial Round entry before the Round becomes active. Source path or metadata MUST NOT substitute for Course data. Only this snapshot may supply Course state to simulation. Editing, replacing, or deleting a source affects only future Rounds.

Acceptance criteria:

- **AC-CRS-005-01:** Mutating a caller-held parse input or editing/deleting the source after Round start cannot change the active Course or simulation.
- **AC-CRS-005-02:** The Round snapshot is fresh, deeply immutable, persisted once, and reused rather than duplicated in each Shot entry.
- **AC-CRS-005-03:** A new Round uses a newly read snapshot of the then-selected source.

## 7. Deterministic simulation

### V2-SIM-003 — Non-Putter Carry

For a non-Putter Club:

- `D` is nominal Carry distance.
- `p` is committed Power in `0.1 … 1.0`.
- `m` is the original Lie Carry multiplier.
- `L = D × p × m` is Carry distance.
- `T = 3 × sqrt(p)` seconds is exact Carry duration.
- `u = clamp(t / T, 0, 1)`.
- `r` is landing-speed retention.

```text
f(u) = (1 - r) × (1 - (1 - u)^2) + r × u
position distance = L × f(u)
v(u) = (L / T) × (2 × (1 - r) × (1 - u) + r)
```

Original Lie Carry multipliers are Fairway `1.00`, Green `1.00`, Rough `0.70`, and Bunker `0.40`.

| Club | Landing-speed retention `r` |
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

Terrain, Water, Boundary, and Cup crossed while airborne have no effect. At the continuous Landing Position, use V2-CRS-003's authoritative lookup and test Out of Bounds and Water before beginning Roll. Landing inside the closed Cup disk begins Roll and immediately applies the Cup-entry speed rule.

In-memory Carry checkpoints occur at `t = 0`, every `n / 120` second for positive integer `n` strictly before `T`, and exactly `t = T`. `T` MUST NOT be rounded to the fixed-step grid.

Acceptance criteria:

- **AC-SIM-003-01:** Golden tests cover every Club and Power at start, midpoint, fixed checkpoints, and exact landing for `L`, `T`, `f(u)`, and `v(u)`.
- **AC-SIM-003-02:** Rough and Bunker change actual Carry by exactly 70% and 40% while the displayed Target follows V2-SIM-002.
- **AC-SIM-003-03:** Airborne crossings do not trigger Terrain, Water, Boundary, or Cup events, while exact landing does.
- **AC-SIM-003-04:** Checkpoint tests include durations not divisible by `1/120` and contain both the final prior grid point and exact `T`.

### V2-SIM-004 — Putter

A Putt has no Carry. Its Green initial speed is:

```text
v_max = sqrt(2 × 1 × 13) = sqrt(26)
v(p) = sqrt(26 × p)
```

On uninterrupted Green this stops at exactly `13 × p` Course Units. A full-Power expected Fairway projection is `26 / (2 × 3) = 26 / 6` Course Units. Rough and Bunker display the Fairway projection but actual Roll uses their Terrain resistance.

Acceptance criteria:

- **AC-SIM-004-01:** Every Power produces the specified initial speed and uninterrupted Green distance.
- **AC-SIM-004-02:** Full-Power uninterrupted Fairway expected distance is `26 / 6`, and Rough/Bunker actual outcomes are shorter while displaying that projection.
- **AC-SIM-004-03:** A Putter never produces Carry checkpoints or an airborne phase.

### V2-SIM-005 — Terrain Roll and Green modifiers

Roll continues in the same discrete Shot Direction. Base constant deceleration is:

| Gameplay Terrain | Deceleration (Course Units/s²) |
|---|---:|
| Green | 1 |
| Fairway | 3 |
| Rough | 7 |
| Bunker | 18 |
| Water | Immediate hazard |

For a rolling non-Putter on Green:

```text
green deceleration = 1 × original-Lie multiplier × Club multiplier
```

Original-Lie multipliers are Fairway `1.30`, Green `1.00`, Rough `0.80`, and Bunker `0.60`.

| Club | Green multiplier |
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

The original Lie multiplier remains fixed for the Shot. A Putt bypasses both multiplier tables and uses Green's base deceleration.

Acceptance criteria:

- **AC-SIM-005-01:** Table-driven tests cover all base decelerations and the complete non-Putter Green multiplier matrix.
- **AC-SIM-005-02:** Driver-on-Green uses Club multiplier `0.40`; Fairway Pitching Wedge uses deceleration `2.08`.
- **AC-SIM-005-03:** Terrain transitions change deceleration at the exact event while retaining the Shot's original-Lie multiplier.
- **AC-SIM-005-04:** Putts on Green use base deceleration `1` regardless of original-Lie/Club modifier tables.

### V2-SIM-006 — Analytical Roll and event splitting

Physics uses fixed `1/120`-second outer steps, but each piecewise-constant Terrain interval is integrated analytically. For initial speed `v0`, deceleration `a`, and local duration `t` before rest:

```text
v(t) = v0 - a × t
s(t) = v0 × t - 0.5 × a × t²
rest time = v0 / a
```

Within each outer step, the simulator MUST find swept events against gameplay Terrain transitions, the Course Boundary, Water, and the Cup. It MUST advance to the earliest exact fractional event time, process it, and consume the remaining time in the same step. If speed reaches zero first, it stops at exact fractional rest time. Endpoint-only collision checks and Euler/semi-implicit integration are nonconforming.

Events whose computed times differ by at most `1e-9` seconds are tied and use this precedence:

```text
Out of Bounds > Water > eligible Cup capture > playable-Terrain transition
```

No epsilon is applied to unrelated times, speeds, schema values, or geometry predicates. Pairwise and multi-event ties MUST be deterministic.

Acceptance criteria:

- **AC-SIM-006-01:** Analytical results across one and multiple Terrain segments match closed-form expected position, speed, elapsed time, and exact rest time.
- **AC-SIM-006-02:** An event inside an outer step consumes the remaining time under the new Terrain rather than discarding it.
- **AC-SIM-006-03:** Fast movement cannot tunnel through Cup, Water, playable-Terrain, or Boundary events.
- **AC-SIM-006-04:** Pairwise tie tests and representative multi-event tests enforce the stated tolerance and precedence.
- **AC-SIM-006-05:** Identical initial state and inputs produce deeply equal canonical outcomes independent of render/playback rate.

### V2-SIM-007 — Cup capture

The Cup is a closed disk of radius `0.35` Course Units. Capture is possible only during Roll at exact speed `<= 1.5` Course Units/s.

Speed is evaluated at the first intersection with the disk. If it is above `1.5`, that traversal cannot capture later merely because the ball slows while still inside; the ball MUST exit and re-enter before another capture attempt. A Carry over the disk is ignored. Landing inside the disk is tested immediately at landing speed. Flag versus Cup rendering has no mechanical effect.

Acceptance criteria:

- **AC-SIM-007-01:** Swept entry and direct landing capture below and exactly at `1.5`, and do not capture above `1.5`.
- **AC-SIM-007-02:** A fast entry that slows below threshold while remaining inside does not capture; exit and eligible re-entry does.
- **AC-SIM-007-03:** Airborne crossings never capture, and rendering the Flag instead of Cup never changes an outcome.

### V2-SIM-008 — Hazard restoration and canonical result

Carry landing or Roll entry in Water or beyond the Course Boundary ends the Shot. The Shot adds one Played Stroke and one Penalty Stroke, then restores the exact canonical pre-Shot Lie. The used Club and Shot Direction remain selected. The simulator returns the hazard/restoration outcome; the UI FSM owns resetting a new Power Meter to one block.

After failure playback, show exactly one notice for exactly two seconds of active time:

- `Water Hazard! (+1 penalty)`
- `Out of Bounds! (+1 penalty)`

Then recenter immediately on the restored Lie. Do not animate backward movement or show a replay message.

Canonical simulation checkpoints and results normalize coordinates, speeds, and elapsed times to six decimal places. A normalized result becomes the live result before persistence. Its normalized position is reclassified through V2-CRS-003's gameplay Terrain lookup before commit. Resume uses exactly the persisted normalized state.

Acceptance criteria:

- **AC-SIM-008-01:** Carry and Roll Water/OOB failures score, restore, and preserve Club/direction exactly.
- **AC-SIM-008-02:** Notices have exact text and two seconds of active time, freeze under resize, and are not resumed after reload.
- **AC-SIM-008-03:** Six-decimal normalization can change classification near an edge only through the required post-normalization reclassification; live and resumed results remain equal.
- **AC-SIM-008-04:** Simulator results do not contain or mutate Power Meter state.

### V2-SIM-009 — Resolved Shot contract

Pure simulation returns one shared `ResolvedShot` contract containing at least:

- `shotId`;
- pre-Shot Lie and canonical inputs;
- Landing Position, final/restored position, and terminal result;
- resulting speed and elapsed time;
- the resulting compact Round state; and
- bounded in-memory playback keyframes.

The durable Shot payload contains canonical inputs, outcome, and compact Round state, but MUST NOT persist animation frames. Carry and Roll resolution completes before playback begins. Playback is presentation-only at a target 30 FPS and MAY skip delayed frames without changing the result. Interpolated render frames are noncanonical, are not normalized as simulation checkpoints, and never feed back into simulation.

Acceptance criteria:

- **AC-SIM-009-01:** Simulator, persistence, and playback consume the same resolved contract rather than independently reconstructing an outcome.
- **AC-SIM-009-02:** Persisted entries contain no animation frames, while in-memory keyframes are bounded and sufficient for Carry/Roll playback.
- **AC-SIM-009-03:** Skipped or differently timed playback frames cannot mutate canonical Round state.

## 8. Course discovery, identity, and settings

### V2-CRS-006 — Discovery and physical source identity

Discover external Courses recursively under `.pi/golf/courses/` with these rules:

- Maximum recursion depth: 16.
- Maximum discovered candidate files: 256.
- `.json` matching is case-insensitive.
- A missing root is non-fatal.
- Unreadable descendants produce bounded diagnostics and do not stop other traversal.
- Existing files are identified by absolute canonical `realpath`.
- In-root symlink aliases collapse to the same canonical source.
- Discovered symlinks escaping the discovery root are rejected.
- Hard links remain distinct sources.
- Filesystem canonicalization determines case behavior; display strings do not.
- Traversal, candidate selection, and diagnostics are deterministically ordered.

A valid explicit `/golf course <path>` source MAY be outside discovery. It still uses canonical identity and all bounded read/parse/validation rules, but is not rejected merely for being outside the discovery root.

Acceptance criteria:

- **AC-CRS-006-01:** Missing roots, unreadable descendants, depth/count limits, case-insensitive extensions, and deterministic traversal are tested.
- **AC-CRS-006-02:** Relative aliases and in-root symlinks collapse by canonical path; hard links remain distinct.
- **AC-CRS-006-03:** Escaping discovery symlinks are rejected, while a valid explicit outside path can be selected.
- **AC-CRS-006-04:** Discovery never reads more than the bounded number or size of candidates and never emits unbounded diagnostics.

### V2-CRS-007 — Stable reads and selection linearization

Every selected-file read MUST be a bounded regular-file read bracketed by pre-read and post-read `fstat`. If relevant metadata changes, the operation performs a bounded retry or rejects deterministically. It MUST parse and validate exactly the stable bytes it read before committing settings. Round start performs its own new stable read and snapshot; selection-time data is not reused as the Round snapshot.

Acceptance criteria:

- **AC-CRS-007-01:** File, symlink-target, or metadata replacement during selection cannot validate one byte sequence and persist identity for another.
- **AC-CRS-007-02:** Non-regular, oversized, unstable, unreadable, malformed, duplicate-key, and validator-invalid inputs leave the prior selection unchanged.
- **AC-CRS-007-03:** Round start detects a source change after successful selection and snapshots only a newly stable, valid read.

### V2-CRS-008 — Catalog reconciliation

Preview Course exclusively owns ID `preview-course`; an external source with that ID is invalid and nonselectable.

One pure catalog reconciler owns exact-source collapse, selected-source precedence, duplicate-ID exclusion, labels, ordering, current value, and identity warnings:

1. Resolve persisted `(Course ID, canonical source path)` as a locator-plus-integrity pair before catalog reconciliation.
2. Missing, unreadable, malformed, invalid, reserved-ID, or ID-changed selected sources fall back to Preview and MUST NOT reappear as options under a changed ID.
3. A freshly validated effective selected external source wins its nonreserved ID, inside or outside discovery. Other discovered sources with that ID are excluded and each loser emits one structured source-aware warning; the winner never warns against itself.
4. Without an effective selected winner, all sources in a duplicate discovered-ID group are excluded with deterministic warnings.
5. Equal display names with distinct IDs remain selectable through deterministic source-qualified labels.
6. Discovery changes cannot replace a valid selected source. Explicitly selecting another valid conflicting source makes that source the winner after persistence and reconciliation.
7. Preview is first. Option IDs, canonical paths, and labels are globally unique; current value maps to exactly one option; warnings are never option values. Candidate order cannot affect output.
8. Discovery retains independently valid candidates and issues for reconciliation rather than implementing cross-source identity policy itself.

Acceptance criteria:

- **AC-CRS-008-01:** Reserved Preview identity and ID-changed-source regressions cannot expose invalid or changed external sources as options.
- **AC-CRS-008-02:** Selected-source winner, unselected duplicate-group exclusion, same-name/different-ID labeling, and explicit winner replacement match all eight rules.
- **AC-CRS-008-03:** Permuting candidates produces deeply equal options, current value, and structured warnings.
- **AC-CRS-008-04:** An exported selection boundary cannot persist an external `preview-course` record or bypass reconciliation policy.

### V2-CRS-009 — Durable settings

`.pi/golf/settings.json` persists the selected Course ID and canonical source path for future Rounds only. Settings input is a strict schema and at most 16 KiB.

Writes MUST use same-directory UUID-named temporary files, write/flush/close, atomic rename, and directory sync where supported. The implementation cleans up only temporary files it owns, preserves the exact prior settings bytes on failure, serializes writers across extension/runtime instances, and rolls back or reconciles optimistic UI state after failure.

Acceptance criteria:

- **AC-CRS-009-01:** Successful writes survive process interruption at the supported durability boundary and leave strict, bounded settings.
- **AC-CRS-009-02:** Injected failures before rename preserve prior bytes and remove only the operation's owned temporary file.
- **AC-CRS-009-03:** Concurrent independent writers cannot collide, interleave, or make UI state disagree silently with durable settings.
- **AC-CRS-009-04:** Selection changes never mutate an active Round's Course snapshot.

### V2-CRS-010 — Course settings UI and authoring artifacts

`/golf course` uses Pi's settings style with `DynamicBorder`, `SettingsList`, and `getSettingsListTheme()`. Its title is `Golf Settings`; it contains one `Course` setting populated only from the reconciled Preview-first catalog. Validation and identity warnings appear below the list as text, never as selectable values. This is replacement UI, not the gameplay overlay.

Version 2 ships a machine-readable Course schema, `docs/course-format.md`, an editable Preview JSON, a minimal valid one-Hole example, shape/layer examples, resource and source-identity rules, duplicate-aware parsing guidance, and runtime path-aware diagnostics.

Acceptance criteria:

- **AC-CRS-010-01:** The settings UI uses the required Pi components, title, one setting, exact reconciled values, and nonselectable warnings.
- **AC-CRS-010-02:** A valid effective selected source outside discovery appears as the unique current option.
- **AC-CRS-010-03:** Authoring documentation covers coordinates, Length, all shapes, closed containment, ordered layering, gameplay cell ownership, resource limits, duplicate keys, and validation.
- **AC-CRS-010-04:** The unchanged minimal example validates, can be explicitly selected and played, and the user can return to Preview.

## 9. Durable Round persistence

### V2-PER-001 — Separate authoritative Round store

Pi `0.82.1` does not durably flush extension custom entries when `/golf` is the first action in a fresh session. Per [ADR 0003](adr/0003-keep-round-state-in-a-separate-durable-store.md), the authoritative durable Round state MUST therefore be an append-only per-Round log at:

```text
.pi/golf/rounds/<roundId>.jsonl
```

The implementation MUST prevent `roundId` from escaping this directory. The Round store is authoritative for Round state. The complete active Pi branch identifies which Round is active and MAY contain mirrored entries or references, but a Pi custom entry alone is not the durability boundary. Reconciliation MUST preserve branch semantics while making a command-only fresh-session Round recoverable. The first durable `round-start` append and branch association happen before gameplay treats the Round as active.

Each JSONL entry is one single-line UTF-8 JSON object terminated by a newline. The writer completes the entire append and flushes the file before acknowledging it; new-file creation also syncs the containing directory where supported. Recovery treats a final unterminated physical line as an uncommitted interrupted append, but any malformed newline-terminated entry fails closed. An accepted append is never rewritten in place.

Acceptance criteria:

- **AC-PER-001-01:** Starting `/golf` as the first action in a fresh session, then interrupting before any assistant message, does not lose the Round.
- **AC-PER-001-02:** Every Round has an append-only log confined beneath `.pi/golf/rounds/`, and source/settings files never become Round-state authority.
- **AC-PER-001-03:** Branch reconciliation selects the branch-associated Round without importing a Shot from a fork that precedes it.
- **AC-PER-001-04:** The store/branch reconciliation protocol is documented and exercised against the pinned real Pi session behavior.
- **AC-PER-001-05:** Interrupted append tests distinguish an uncommitted unterminated tail from a malformed committed line and verify file/directory flush boundaries.

### V2-PER-002 — Versioned entry envelope and revision chain

Every durable or mirrored Golf entry uses this envelope:

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

Runtime payload validation MUST be strict and kind-specific despite the transport type `unknown`. Required payload ownership is:

- `round-start`: immutable Course snapshot, initial compact Round state, and the durable branch/session association needed for reconciliation;
- `shot`: `shotId`, canonical pre-Shot inputs, resolved outcome, and resulting compact Round state, without animation frames;
- `checkpoint`: a state-only aiming or lifecycle transition that adds no Played Stroke;
- `round-terminal`: completed or abandoned status plus final canonical scoring state; and
- `round-replacement`: an idempotent link from the terminal/replaced Round to exactly one successor and its start.

`round-start` begins a revision chain. Every later entry matches the same `roundId` and has exactly its accepted predecessor's revision plus one. Gaps, duplicates, wrong Round IDs, invalid payloads, and invalid ordering fail closed.

Each application entry requires `entryVersion: 1`. A migration registry handles only explicitly supported older versions. Unsupported versions fail closed. A newest invalid or unsupported Round MUST NOT cause reconstruction to roll back to an older entry or resurrect a terminal/replaced Round.

Acceptance criteria:

- **AC-PER-002-01:** Every kind round-trips through strict envelope and kind-specific payload validation.
- **AC-PER-002-02:** Wrong Round, duplicate/gapped revision, invalid order, malformed payload, and unsupported newest-version chains fail closed.
- **AC-PER-002-03:** Explicit migration tests cover every supported old version; there is no heuristic or silent migration.
- **AC-PER-002-04:** Newer invalid data cannot resurrect an earlier active state.

### V2-PER-003 — Single-writer Shot commit

One session-scoped writer serializes all Round mutations. On the first valid meter-stop input it MUST synchronously leave `metering`, enter `committing`, and assign a unique `shotId` before asynchronous work. Duplicate Space/Enter, overlapping `/golf`, shutdown, pause, abandon, or new-Round actions cannot create a second Shot.

The writer resolves the complete Shot and appends the canonical entry before canonical in-memory state advances or playback begins. A persistence failure leaves the UI in `committing`, does not advance canonical state, presents a deterministic error, and permits retrying only the same commit with the same `shotId`. A successful retry creates exactly one Shot.

Acceptance criteria:

- **AC-PER-003-01:** Repeated and held commit input, overlapping commands, and concurrent mutation attempts append one Shot with one `shotId`.
- **AC-PER-003-02:** Playback and canonical state advance only after a successful durable append.
- **AC-PER-003-03:** Injected append failure remains in `committing`; retry reuses `shotId` and creates one revision/Played Stroke.
- **AC-PER-003-04:** Process interruption at every append boundary reconstructs either the complete predecessor or complete committed Shot, never a partial state.

### V2-PER-004 — Checkpoints, completion, and replacement

Esc after Club or Shot Direction changes MUST persist a state-only `checkpoint` so aiming changes survive reload. It MUST NOT add a Played Stroke.

Cup completion and Hole advancement use an idempotent protocol. Reconstruction can target aiming, Hole summary, or Round summary as appropriate. Advancing a Hole cannot duplicate its Score. Completing the final Hole writes one `round-terminal` entry. Confirmed abandonment also writes terminal status before closing.

`/golf new` and `R` from Round summary use one interruption-safe `round-replacement` transition linking old and new Round identity and carrying or atomically associating the new Round start. Repeated commands or interruption cannot duplicate replacement, resurrect the old Round, or leave ambiguous active state.

Acceptance criteria:

- **AC-PER-004-01:** Aiming changes followed by Esc resume exactly, without adding a Shot.
- **AC-PER-004-02:** Interruption before/after Cup playback, Hole summary, Hole advancement, and final summary reconstructs the correct state and Score exactly once.
- **AC-PER-004-03:** Completion and abandonment write one terminal status and cannot later reconstruct as active.
- **AC-PER-004-04:** Repeated or interrupted new-Round replacement yields exactly one active successor and never resurrects its predecessor.

### V2-PER-005 — Active-branch reconstruction

Reconstruction MUST use `ctx.sessionManager.getBranch()` and process the complete active branch root-to-leaf. It MUST NOT use `buildContextEntries()` because LLM compaction does not define Round history. It validates Round references, entry versions, revisions, `shotId` idempotency, terminal status, and replacement status against the authoritative Round store.

Reload never resumes intro, meter, committing work that was not durably appended, notice, or playback. It resumes the latest durable canonical state in aiming, Hole summary, or Round summary. A durably committed Shot interrupted during playback resumes at its resolved outcome without replaying or duplicating the Stroke.

Acceptance criteria:

- **AC-PER-005-01:** Fork-before-Shot and fork-after-Shot tests reconstruct the correct branch-specific state from `getBranch()`.
- **AC-PER-005-02:** Pi context compaction does not remove or change Round state.
- **AC-PER-005-03:** Mid-playback, notice, and intro interruption resumes only the latest canonical aiming/summary state.
- **AC-PER-005-04:** The newest invalid Round fails visibly and closed instead of selecting an older apparently valid Round.

## 10. Rendering, viewport, and camera

### V2-REN-001 — Terrain tiles and Out of Bounds

Each Course Unit occupies exactly two terminal columns and one row. Terrain uses fixed one-bit Braille patterns with direct 24-bit foreground color; pattern, not color, is authoritative.

| Terrain | Tile | Color |
|---|---|---|
| Green | `⠁⠈` | `#a6da95` |
| Fairway | `⠒⠒` | `#a6da95` |
| Rough | `⣶⣶` | `#a6da95` |
| Bunker | `⠶⠶` | `#eed49f` |
| Water | `⠛⣤` | `#8aadf4` |
| Out of Bounds | exactly two spaces | terminal default, unstyled |

Off dots use terminal-default background. ANSI state resets after every tile row. Water is static while idle; a temporary local pattern MAY indicate a Water landing.

Acceptance criteria:

- **AC-REN-001-01:** Snapshot tests verify every exact glyph, color, two-column width, terminal-default background, and row reset.
- **AC-REN-001-02:** Explicit Out-of-Bounds snapshots contain exactly two unstyled spaces with no ANSI bleed across Boundary transitions.
- **AC-REN-001-03:** Pattern-only snapshots distinguish all playable Terrain and Water without relying on color.

### V2-REN-002 — Markers and prediction

| Element | Glyph | Color |
|---|---|---|
| Ball | `●` | `#f4dbd6` |
| Cup | `○` | `#cad3f5` |
| Flag | `⚑` | `#ed8796` |
| Target | `╳` | `#ed8796` |
| Carry/Putt path | `·` | `#939ab7` |
| Course Boundary | `×` | `#5b6078` |
| Off-screen arrows | cardinal/diagonal arrow | `#f5a97f` |

A Shot originating outside Green displays Flag; one originating on Green displays Cup. The choice remains fixed during that Shot and updates at the next Lie. The hidden Cup remains mechanically active. Marker overlays SHOULD replace complete tile content where possible and MUST preserve terminal width. Target and Ball rendering outside the Course Boundary MUST remain visible where inside the viewport.

Visible-element collision resolution MUST be deterministic, width-safe, documented in one shared rendering contract, and locked by golden snapshots before dependent UI integration. Collision presentation never changes mechanics.

Acceptance criteria:

- **AC-REN-002-01:** Exact marker glyph/color snapshots include Flag/Cup origin switching and mechanically active hidden Cup cases.
- **AC-REN-002-02:** Prediction path appears only while aiming and uses the one shared Target projection.
- **AC-REN-002-03:** Boundary, OOB Target, and transient OOB Ball cases render without width changes or ANSI leakage.
- **AC-REN-002-04:** Every pairwise marker collision and representative multi-marker collision obeys the declared visual priority without changing mechanics.

### V2-REN-003 — Pi overlay and responsive allocation

Gameplay requires `ctx.mode === "tui"`. It uses a focused `ctx.ui.custom()` overlay with absolute top-right anchor, zero margin, and no border. It captures keyboard focus and restores prior focus when closed. Existing Pi content remains around or beneath it. Non-TUI modes receive a clear interactive-TUI-required response.

Rendering uses the full dimensions passed to `render()` subject to these canvas rules:

- Native Course view: 60 × 60 Course Units, or 120 × 60 terminal cells.
- Minimum allocation: 60 × 20 terminal cells, showing at most 30 × 20 complete Course Units.
- Canvas is clamped to at most 120 × 60 terminal cells; extra space does not magnify tiles.
- Width uses `floor(width / 2)` complete Course Units; an odd extra column is unused.
- HUD panels are overlays inside the canvas and add no rows, columns, or borders.
- Below 60 × 20, resize suspension applies.
- No line exceeds the supplied render width and no output exceeds supplied height.

Acceptance criteria:

- **AC-REN-003-01:** Real Pi evidence verifies top-right placement, no border/margin, keyboard capture, focus restoration, and non-TUI rejection.
- **AC-REN-003-02:** Golden/property tests cover widths `59, 60, 61, 119, 120`, heights `19, 20, 21, 59, 60`, and representative intermediate/native/oversized dimensions.
- **AC-REN-003-03:** Odd widths never split a tile, and HUDs never create external geometry or overflow.

### V2-REN-004 — ANSI and visible width

Layout and truncation MUST use Pi TUI's ANSI-aware `visibleWidth()` or an equivalent proven primitive. Crop before applying styles, only at complete two-column Terrain-tile boundaries. Never split an ANSI escape sequence, styled marker, or two-column tile. Rendered visible width, not JavaScript string length, determines layout.

Acceptance criteria:

- **AC-REN-004-01:** Styled and unstyled content has equal computed layout width where visually equal.
- **AC-REN-004-02:** Truncation tests cannot produce partial ANSI sequences, partial Terrain tiles, or overflow.
- **AC-REN-004-03:** Marker collisions and substitutions preserve complete visible-width accounting.

### V2-REN-005 — Camera and HUD

Camera behavior uses active time and an injected clock:

- Aiming begins centered on the Lie.
- Automatic Target pan begins after exactly `250 ms` of active aiming time and lasts exactly `1 s` with deterministic smoothstep easing.
- Tab switches Lie/Target immediately and cancels pending camera timers.
- Club or direction changes cancel and restart the Target-pan delay.
- Playback follows the Ball directly.
- Rest or restoration recenters immediately on the current Lie.
- Resize freezes camera active time and resumes from the same offset.
- Edge arrows indicate an off-screen Lie/Target/Cup as appropriate.
- A HUD-safe inset prevents critical markers and arrows from being placed under panels.

HUD panels overlay corners:

- Top-left: Hole, par, Hole Score, Round Score.
- Top-right: Club, Lie Terrain, Shot Direction, displayed Target distance, and OOB Target warning.
- Bottom-left: compact controls.
- Bottom-right: Power Meter while metering and live Ball Speed during playback.

`H` toggles all HUD panels.

Acceptance criteria:

- **AC-REN-005-01:** Fake-clock tests verify exact delay, duration, smoothstep positions, cancellation, direct playback following, recentering, and resize freeze/resume.
- **AC-REN-005-02:** Tab and Club/direction changes cannot leave stale camera timers that later override current mode.
- **AC-REN-005-03:** HUD fields use official scoring terms, occupy the required corners, toggle together, and preserve the HUD-safe inset.
- **AC-REN-005-04:** Off-screen arrows remain deterministic at marker and viewport edge cases.

### V2-REN-006 — Playback presentation

Playback targets 30 FPS and interpolates bounded in-memory simulation keyframes. It MAY skip delayed frames but MUST reach the canonical outcome. Rendering is incapable of changing Score, Lie, Shot identity, or persistence. Carry, Roll, Cup, Water, and OOB presentation follows the already resolved result.

Acceptance criteria:

- **AC-REN-006-01:** Different frame schedules and skipped frames end on the same rendered and canonical result.
- **AC-REN-006-02:** Playback never appends or mutates Round state and never persists animation frames.
- **AC-REN-006-03:** Hole completion text occurs only after playback reaches Cup capture; hazard notice occurs only after corresponding failure playback.

## 11. Finite-state UI and controls

### V2-UI-001 — Authoritative state model

There are ten named UI states. Nine are mutually exclusive base states:

```text
intro
aiming
metering
committing
playback
penalty-notice
hole-summary
round-summary
confirm-abandon
```

`resize-paused` is the tenth named state and is an orthogonal suspension wrapper carrying the suspended base state, its active-time offsets, and already queued actions. It does not destroy or replace the base state.

Persisted Round state remains separate. Any key not explicitly accepted below is ignored. Club/direction mutation is accepted only in `aiming`.

| State | Accepted input/event | Required transition/effect |
|---|---|---|
| `intro` | one-second active timer | `aiming` |
| `aiming` | Left/Right | rotate direction one index with wrap; restart Target camera delay |
| `aiming` | Up/Down | select adjacent Club with wrap; restart Target camera delay |
| `aiming` | Tab | immediately toggle Lie/Target camera and cancel pending pan |
| `aiming` | Space/Enter new press | start a one-block meter; enter `metering` |
| `aiming` | Esc | persist checkpoint if needed, then close |
| `aiming` | Q | enter `confirm-abandon`, retaining prior state |
| `metering` | Space/Enter eligible new press | sample event-time block, assign `shotId`, enter `committing` synchronously |
| `metering` | Esc | cancel uncommitted meter, persist checkpoint if needed, close; no Stroke |
| `metering` | Q | suspend meter active time and enter `confirm-abandon` |
| `committing` | append succeeds | advance canonical state; if Esc is queued, close, otherwise enter `playback` |
| `committing` | append fails | show deterministic error; if Esc is queued, close on the unchanged predecessor, otherwise remain and let Space/Enter retry the same `shotId` |
| `committing` | Esc | queue pause until append succeeds or fails |
| `playback` | playback completes normally | enter `aiming`, `hole-summary`, or `penalty-notice` according to result, then apply a queued pause/abandon action at that legal boundary |
| `playback` | Esc/Q | queue pause/abandon until committed sequence completes |
| `penalty-notice` | two-second active timer | recenter and enter `aiming`, then apply queued pause/abandon |
| `penalty-notice` | Esc/Q | queue pause/abandon until notice completes |
| `hole-summary` | Enter/Space | idempotently advance to next Hole `intro` |
| `hole-summary` | Esc | persist summary state and close |
| `round-summary` | R | perform interruption-safe new-Round replacement |
| `round-summary` | Esc | persist terminal state and close |
| `confirm-abandon` | Y or Enter | persist abandonment terminal state and close |
| `confirm-abandon` | N or Esc | return to retained prior state and active-time offset |
| any open base state | H | toggle all HUD panels without changing Round state |
| any base state | allocation below minimum | wrap in `resize-paused` |
| `resize-paused` | allocation restored | unwrap the same base state and active-time offsets |

Shutdown during an asynchronous append relies on the atomic store boundary: reconstruction sees either the predecessor or the complete next entry. Queued actions MUST NOT create another writer operation.

Acceptance criteria:

- **AC-UI-001-01:** The state type/test enumerates the nine base states and orthogonal `resize-paused` wrapper exactly, including `committing`.
- **AC-UI-001-02:** Every table row and every ignored key/state pair has deterministic transition/effect tests.
- **AC-UI-001-03:** Club, direction, canonical state, and writer mutation are rejected outside their named states.
- **AC-UI-001-04:** Persistence success/failure, queued Esc/Q, summary, shutdown, and retry transitions cannot duplicate a Shot or terminal action.

### V2-UI-002 — Power Meter timing and key repeat

The Power Meter uses ten whole `█` blocks in fixed color `#ed8796`, with no percentage or numeric Power. It uses monotonic active time and this half-open cycle:

- Fill phase: `0 <= t < 1.5 s`.
- Empty phase: `1.5 <= t < 3.0 s`.
- Each of ten bins lasts `0.15 s`.
- Fill displays 1 through 10 blocks.
- Empty displays 10 through 1 blocks.
- Exactly `1.5 s` displays 10 blocks.
- Exactly `3.0 s` wraps to 1 block.
- Commit samples the block at the key-event timestamp, not the last rendered frame.
- Every newly started meter begins at one block.

The same Space or Enter press that starts a meter cannot stop it. The FSM requires a release/new press before that key can commit. Where key-release events are unavailable, repeated events are ignored until a distinct press sequence is observed.

Acceptance criteria:

- **AC-UI-002-01:** Fake-clock tests cover every bin, both phase boundaries, cycle wrap, delayed rendering, and event-time sampling.
- **AC-UI-002-02:** The meter renders only the exact whole-block count and color with no numeric/percentage display.
- **AC-UI-002-03:** Held/repeated Space or Enter cannot both start and stop a meter; a new eligible press can.
- **AC-UI-002-04:** Resize and confirmation freeze meter active time and resume at the same offset; a new post-Shot meter resets to one block under FSM ownership.

### V2-UI-003 — Resize suspension

Below `60 × 20`, `resize-paused` preserves the complete base state, freezes every active-time timer, preserves already queued actions without applying them, and shows a centered resize message. Gameplay mutation input while undersized is ignored. Restoring sufficient size resumes the same base state and timer offset. Resize never changes canonical Round state, commits a Shot, advances a summary, or consumes a queued action early.

Acceptance criteria:

- **AC-UI-003-01:** Resize during intro, aiming, metering, committing, playback, notice, each summary, and confirmation resumes the same state safely.
- **AC-UI-003-02:** Meter, camera, intro, notice, and playback active time does not advance while suspended.
- **AC-UI-003-03:** Queued pause/abandon actions survive resize and execute only at their original legal boundary.
- **AC-UI-003-04:** Width/height threshold tests align exactly with V2-REN-003's responsive matrix.

### V2-UI-004 — Pause and abandonment

Esc saves and closes from aiming; cancels an uncommitted meter and closes from metering; queues pause from committing, playback, or penalty notice; and closes from either summary after persisting the canonical summary/terminal state.

Q opens confirmation immediately from aiming or metering. During playback or penalty notice it queues until that committed sequence finishes. Confirmation text MUST clearly state that the active Round will be abandoned. `Y` or Enter confirms; `N` or Esc cancels and returns to the exact prior state. Confirmation freezes prior active-time timers. Confirmed abandonment is durable before gameplay closes.

Acceptance criteria:

- **AC-UI-004-01:** Esc from every state follows the stated behavior and preserves uncommitted-versus-committed Stroke semantics.
- **AC-UI-004-02:** Confirmation accept/cancel keys, retained state, timer freeze, and queued behavior are tested from every allowed source.
- **AC-UI-004-03:** Confirmed abandonment writes terminal state before close and cannot be resumed as active.

## 12. Commands

### V2-CMD-001 — `/golf` and `/golf new`

- `/golf` resumes the active branch's Round or durably starts the selected Course.
- Repeated or overlapping `/golf` calls MUST NOT create multiple overlays, writers, or Rounds.
- `/golf new` confirms before replacing an active Round and uses V2-PER-004's atomic replacement protocol.
- Non-TUI invocation returns a clear interactive-TUI-required response.

Acceptance criteria:

- **AC-CMD-001-01:** New, active, complete, abandoned, repeated, and overlapping invocation cases select exactly one correct action.
- **AC-CMD-001-02:** `/golf new` cannot replace an active Round without confirmation and cannot create ambiguous successors under retry/interruption.
- **AC-CMD-001-03:** Actual Pi evidence demonstrates `/golf`, focus behavior, close, and `/reload`.

### V2-CMD-002 — `/golf course`

The command opens V2-CRS-010's Golf Settings replacement UI. Selection applies only to future Rounds. Persistence failure leaves or restores UI to the actual durable value and reports the failure.

Acceptance criteria:

- **AC-CMD-002-01:** The selector shows exactly the reconciled unique catalog and current value, with warnings outside selectable values.
- **AC-CMD-002-02:** Successful and failed selections reconcile UI, settings bytes, and future-Round source without changing an active Round.

### V2-CMD-003 — `/golf course <path>`

The command canonicalizes, stably reads, duplicate-aware parses, validates, and selects the supplied file. It reports all bounded structured errors with paths on failure, leaves the selection unchanged on failure, and never alters an active Round.

Acceptance criteria:

- **AC-CMD-003-01:** Valid discovered and outside-root paths persist canonical identity and become the future-Round selection.
- **AC-CMD-003-02:** Every read/parse/validation/identity/settings failure preserves the prior durable and visible selection.
- **AC-CMD-003-03:** Selecting the minimal example, playing it, and returning to Preview works end-to-end.

## 13. End-to-end acceptance

### V2-E2E-001 — Complete Preview Round

- **AC-E2E-001-01:** In actual Pi TUI, a player launches `/golf`, completes Holes 1, 2, and 4, sees exact transitions and a par-12 final scorecard, then starts a replacement Round or exits.
- **AC-E2E-001-02:** The journey exercises direction, Club, Power, Carry, Roll, Cup capture, score display, camera, HUD, and responsive rendering.

### V2-E2E-002 — Hazard recovery

- **AC-E2E-002-01:** A player hits Water and Out of Bounds, sees exact two-second notices, returns to the prior Lie with one Played plus one Penalty Stroke, and continues.
- **AC-E2E-002-02:** Interruption before, during, and after failure playback never duplicates Score or loses the restored Lie.

### V2-E2E-003 — Save, reload, branch, and resume

- **AC-E2E-003-01:** A player changes aim, pauses, reloads Pi resources or reopens the saved Pi session, invokes `/golf`, and resumes the exact durable state.
- **AC-E2E-003-02:** A committed mid-playback interruption resumes at the canonical outcome without replay or duplicate Stroke.
- **AC-E2E-003-03:** `/golf` as the first fresh-session action remains recoverable without an assistant message.
- **AC-E2E-003-04:** Fork-before-Shot and fork-after-Shot journeys reconstruct the expected active branch.

### V2-E2E-004 — Custom Course lifecycle

- **AC-E2E-004-01:** A player validates/selects the minimal one-Hole Course by explicit path, starts and completes it, then returns to Preview through `/golf course`.
- **AC-E2E-004-02:** Editing or deleting the selected file cannot alter the active custom Round but is reflected in the next Round's stable-read behavior.

## 14. Delivery plan and dependency gates

### V2-DLV-001 — Ticket dependency and ownership gates

The following are recommended actionable ticket slices. A ticket MAY be subdivided, but no acceptance criterion may be dropped. Each ticket description MUST cite its PRD requirement and `AC-` identifiers, list shared-file ownership, and include tests with the capability rather than deferring them all to integration.

| Ticket slice | Scope | Required predecessors |
|---|---|---|
| **V2-T01 Foundation hardening** | V2-FND-001/002; Node runtime; domain types; direction/numeric/state contracts | None |
| **V2-T02 Course semantics hardening** | V2-CRS-001–005; raw parsing; limits; robust geometry; gameplay Terrain; immutability | V2-T01 |
| **V2-T03 Preview and authoring compatibility** | V2-CNT-001 and authoring artifacts in V2-CRS-010 | V2-T02 |
| **V2-T04 Discovery and settings** | V2-CRS-006–010; V2-CMD-002/003 | V2-T02 |
| **V2-T05 Shot inputs, Target, and Carry** | V2-SIM-001–004 | V2-T01, V2-T02 |
| **V2-T06 Analytical Roll and outcomes** | V2-SIM-005–009 | V2-T05 |
| **V2-T07 Rendering primitives** | V2-REN-001/002/004 | V2-T01, V2-T02 |
| **V2-T08 Responsive viewport, camera, and playback** | V2-REN-003/005/006 | V2-T05, V2-T07 |
| **V2-T09 Durable Round store** | V2-PER-001–005 | V2-T02, V2-T06 |
| **V2-T10 FSM and game component** | V2-UI-001–004, V2-UI-002 meter, V2-GME-001/002 | V2-T06, V2-T08, V2-T09 |
| **V2-T11 Command and Round integration** | V2-CMD-001 plus cross-command lifecycle | V2-T04, V2-T10 |
| **V2-T12 End-to-end evidence and release** | V2-E2E-001–004, complete traceability matrix, real Pi/TUI evidence | V2-T03, V2-T11 |

`Ready` means every required predecessor is merged and Done. Project tooling MUST record actual dependencies; blocked tickets MUST NOT be labeled Ready. Concurrent tickets MUST NOT edit a shared constants/domain module, package export, extension entrypoint, or other shared file without explicit ownership and an integration plan.

Acceptance criteria:

- **AC-DLV-001-01:** Every implementation ticket cites all owned requirement and acceptance IDs and declares actual predecessor dependencies.
- **AC-DLV-001-02:** Project status never marks a ticket Ready while a required predecessor is unmerged or unaccepted.
- **AC-DLV-001-03:** Parallel work has explicit shared-file/API ownership and does not silently redefine shared contracts.

## 15. Verification and traceability

All deterministic behavior MUST have automated tests. Acceptance may not be inferred from compilation or a broad “tests pass” statement.

Before Version 2 completion, check in a traceability matrix mapping:

- every `AC-` identifier in this PRD; and
- every `CC-` completion criterion below

to a named automated test or explicitly approved manual evidence. Manual evidence records date, Pi version, terminal/runtime, steps, and result.

Actual Pi/TUI evidence is mandatory for overlay focus, absolute placement, keyboard capture, focus restoration, `/reload`, command-only fresh-session durability, and a playable Round. Mocked tests do not satisfy these criteria. A waiver is valid only when written by the product owner and naming the exact unproven `AC-` or `CC-` identifier; documenting missing evidence without owner approval is a failure.

The release verification command set MUST include lint, type-check, all tests, dependency vulnerability review, package/dry-run verification where packaging remains supported, and `git diff --check`.

## 16. Version 2 completion criteria

- **CC-01:** `/golf` launches the borderless top-right overlay in actual Pi and Preview Course is playable end-to-end.
- **CC-02:** Preview Holes 1, 2, and 4 match the authoritative artifact, required content behavior, and scoring model.
- **CC-03:** All deterministic mechanics match this PRD's formulas, constants, event rules, normalization, and shared Target contract.
- **CC-04:** Course parsing, validation, rasterization, discovery, selection, settings, and immutable snapshots satisfy all bounds and identity rules.
- **CC-05:** Fresh-session, pause, retry, branch, interruption, Hole completion, terminal, and replacement persistence are durable and idempotent.
- **CC-06:** Rendering works without overflow from the exact minimum through native sizes and passes the complete responsive matrix, ANSI-width, and OOB contracts.
- **CC-07:** The authoritative ten-state model, active-time timers, meter repeat guard, resize wrapper, pause, and abandonment transitions pass deterministic tests.
- **CC-08:** `/golf`, `/golf new`, `/golf course`, and `/golf course <path>` satisfy real and headless acceptance evidence.
- **CC-09:** The checked-in traceability matrix maps every `AC-` and `CC-` identifier to passing named evidence, with owner-approved waivers only where explicitly recorded.
- **CC-10:** Pi loads/reloads the project-local extension without a build step or runtime error on Node `>=22.19.0`, and the complete release verification command set passes.
