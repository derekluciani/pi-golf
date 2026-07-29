# Pi Golf Course JSON format (version 1)

Pi Golf uses the same versioned JSON format for built-in and custom Courses. The editable built-in Course is [Preview Course](../.pi/extensions/golf/courses/preview-course.json), and [minimal-course.json](examples/minimal-course.json) is a complete one-Hole starting point. The machine-readable schema is [`course.schema.json`](../.pi/extensions/golf/course-loader/course.schema.json).

## Course and Hole structure

A Course contains these fields and no others:

- `schemaVersion`: exactly `1`.
- `id`: a stable, non-blank string.
- `name`: a non-blank display name.
- `holes`: an ordered array of 1–18 Hole objects. Array order is play order.

A Hole contains these fields and no others:

- `id`: a stable, non-blank ID, unique within the Course.
- `number`: an integer from 1 through 18, unique within the Course. It is independent of array position.
- `par`: integer `3`, `4`, or `5`.
- `boundary`: a polygon defining the Course Boundary.
- `tee` and `cup`: continuous points of the form `{ "x": number, "y": number }`.
- `regions`: an ordered array of Terrain regions.

Holes do not have a `name` or declared Length. A Hole is displayed as `Hole {number}`.

## Coordinates, numeric domain, and Length

Geometry, the tee, and the Cup use continuous Course coordinates. Terrain occupies integer cells, but each cell `(x, y)` is classified at its center `(x + 0.5, y + 0.5)`. A boundary is Course geometry, not the terminal viewport, and boundary rendering is separate from Terrain cells.

Every coordinate must be a finite JSON number in the inclusive range `[-1_000_000, 1_000_000]`. Ellipse radii and corridor widths must be greater than zero and at most `1_000_000`. Values are rejected rather than clamped, translated, coerced, or rounded. A Course Boundary bounding box may be no larger than `512 × 512` Course units.

## Resource limits

Course source is limited to 1,048,576 bytes. A Course has at most 18 Holes; each Hole has at most 128 regions; each polygon or corridor has at most 1,024 points; and all Hole rasters together have at most 2,000,000 cells. Course and Hole IDs are at most 64 characters and Course names at most 30 characters. Runtime diagnostics and warnings are capped at 256 entries, including a truncation diagnostic when necessary. These are hard validation limits, not authoring suggestions.

Length is calculated, never authored:

```text
round(sqrt((cup.x - tee.x)^2 + (cup.y - tee.y)^2))
```

It is the rounded direct tee-to-Cup distance, not route distance, and does not determine par.

## Terrain and region layering

The JSON Terrain values are exactly:

| Value | Meaning |
| --- | --- |
| `rough` | Default playable Terrain inside the Course Boundary. |
| `fairway` | Short playable grass. |
| `green` | Playable Terrain required at the Cup. |
| `bunker` | Playable sand hazard; a tee or Cup may not be placed on it. |
| `water` | Non-playable Water Hazard; a tee or Cup may not be placed on it. |

Rasterization is deterministic:

1. Start all cells as Out of Bounds.
2. Set cell centers inside the Course Boundary to `rough`.
3. Apply `regions` in array order. A later matching region overrides every earlier region at that point.
4. Keep Course Boundary rendering separate from Terrain classification.

Containment is closed: points exactly on a Boundary, polygon edge, ellipse edge, corridor cap, or corridor join are inside. A point outside the continuous Course Boundary is Out of Bounds. A point inside owns cell `(floor(x), floor(y))`, including negative coordinates; cells are half-open `[n, n + 1)`. Tee validation, Cup validation, Lies, simulation, and rendering-facing gameplay lookup all use that cell's rasterized Terrain. A continuous shape that misses a cell center does not own that cell's gameplay Terrain.

Order regions deliberately. For example, putting a Green after a Fairway makes the overlap Green; putting a Water strip after that Fairway makes the overlap Water.

## Shapes

### Polygon

A polygon has at least three points. Its last point connects back to its first. Vertices must describe a non-zero-area, non-self-intersecting polygon, and consecutive vertices must be distinct.

```json
{
  "type": "polygon",
  "points": [
    { "x": 0, "y": 0 },
    { "x": 20, "y": 0 },
    { "x": 20, "y": 10 },
    { "x": 0, "y": 10 }
  ]
}
```

The Hole `boundary` must be a polygon. A Terrain region may also use a polygon.

### Ellipse

An ellipse has a continuous center and positive horizontal and vertical radii.

```json
{
  "type": "ellipse",
  "center": { "x": 17, "y": 5 },
  "radiusX": 2,
  "radiusY": 2
}
```

### Corridor

A corridor is centered on a polyline of at least two points. `width` is the full corridor width. Consecutive points must be distinct.

```json
{
  "type": "corridor",
  "points": [
    { "x": 2, "y": 5 },
    { "x": 10, "y": 4 },
    { "x": 17, "y": 5 }
  ],
  "width": 4
}
```

A region combines Terrain and one shape:

```json
{
  "terrain": "fairway",
  "shape": {
    "type": "corridor",
    "points": [{ "x": 2, "y": 5 }, { "x": 17, "y": 5 }],
    "width": 4
  }
}
```

## Blocking validation and warnings

Runtime validation rejects the entire Course and reports all discovered errors with JSON paths when it finds:

- an unsupported `schemaVersion`, missing fields, extra fields, or invalid Course ID/name;
- a Hole count outside 1–18, duplicate or invalid Hole IDs/numbers, or par outside 3–5;
- unsupported Terrain or shape types;
- non-finite or out-of-range coordinates;
- malformed, degenerate, or self-intersecting polygons;
- ellipse radii or corridor widths outside the approved domain, or invalid corridor polylines;
- a Course Boundary bounding box over `512 × 512`;
- a tee or Cup outside its Course Boundary;
- a tee or Cup resolving to `water` or `bunker` after layering; or
- a Cup not resolving to `green` after layering.

A region that affects no sampled cell center produces a non-blocking `narrow-region` warning. Ground connectivity is not a blocking rule: isolated playable land and a mandatory airborne Water crossing are valid designs. Tools may warn about disconnected land, but must not reject it for that reason.

Validation never repairs input. Fix the reported JSON paths in the authority file and validate again.

## Static and runtime authoring workflow

1. Copy and edit [`minimal-course.json`](examples/minimal-course.json), or edit the bundled [Preview Course](../.pi/extensions/golf/courses/preview-course.json).
2. Configure an editor or JSON Schema validator to validate the file directly against [`course.schema.json`](../.pi/extensions/golf/course-loader/course.schema.json). This catches structural errors before runtime.
3. Pass raw file text or bytes to the exported `parseCourseJson()` API. It rejects duplicate object members before JSON decoding and then applies path-aware structural, geometry, placement, and layering validation. Do not use `JSON.parse()` for Course files because it silently discards duplicate members.
4. `parseCourse(unknown)` remains available only for already-parsed programmatic input that did not originate from a Course file.
5. Only after successful parsing, pass the returned Course to the exported `rasterizeCourse()` API.

```ts
const result = parseCourseJson(jsonText);
if (!result.ok) {
  console.error(result.errors);
} else {
  const raster = rasterizeCourse(result.value);
}
```

```ts
// Programmatic input only; raw Course files must use parseCourseJson().
const result = parseCourse(programmaticInput);
```

`npm test` validates both shipped JSON artifacts through runtime validation and directly against the checked-in static schema. It also compares that static schema exactly with the runtime schema definition, so schema drift fails the test suite.
