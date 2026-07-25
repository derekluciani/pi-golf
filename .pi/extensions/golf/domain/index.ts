/** Ordered legal Club identifiers. Selection wraps in this order. */
export const CLUB_ORDER = [
  "driver",
  "3i",
  "4i",
  "5i",
  "6i",
  "7i",
  "8i",
  "9i",
  "pw",
  "putter",
] as const;

export type Club = (typeof CLUB_ORDER)[number];

/** Full-Power nominal Carry distance, or expected Green Roll for the putter. */
export const CLUB_NOMINAL_DISTANCES = {
  driver: 50,
  "3i": 44,
  "4i": 40,
  "5i": 35,
  "6i": 31,
  "7i": 27,
  "8i": 23,
  "9i": 19,
  pw: 15,
  putter: 13,
} as const satisfies Readonly<Record<Club, number>>;

/** Landing-speed retention; the putter has no Carry phase. */
export const CLUB_LANDING_SPEED_RETENTION = {
  driver: 0.45,
  "3i": 0.39,
  "4i": 0.35,
  "5i": 0.31,
  "6i": 0.27,
  "7i": 0.23,
  "8i": 0.19,
  "9i": 0.15,
  pw: 0.08,
  putter: null,
} as const satisfies Readonly<Record<Club, number | null>>;

/** Club multipliers used when a non-putter rolls onto Green. */
export const GREEN_DECELERATION_CLUB_MULTIPLIERS = {
  driver: 0.4,
  "3i": 0.7,
  "4i": 0.8,
  "5i": 0.9,
  "6i": 1,
  "7i": 1.1,
  "8i": 1.25,
  "9i": 1.4,
  pw: 1.6,
} as const satisfies Readonly<Record<Exclude<Club, "putter">, number>>;

/** The five Terrain values represented by Course cells. */
export const TERRAINS = ["rough", "fairway", "green", "bunker", "water"] as const;
export type Terrain = (typeof TERRAINS)[number];
export type PlayableTerrain = Exclude<Terrain, "water">;

/** Carry effectiveness for a non-putter from each playable original Lie. */
export const TERRAIN_CARRY_MULTIPLIERS = {
  fairway: 1,
  green: 1,
  rough: 0.7,
  bunker: 0.4,
} as const satisfies Readonly<Record<PlayableTerrain, number>>;

/** Constant Roll deceleration. Water resolves immediately as a hazard. */
export const TERRAIN_ROLL_DECELERATION = {
  green: 1,
  fairway: 3,
  rough: 7,
  bunker: 18,
  water: null,
} as const satisfies Readonly<Record<Terrain, number | null>>;

/** Original-Lie multipliers used when a non-putter rolls onto Green. */
export const GREEN_DECELERATION_ORIGIN_MULTIPLIERS = {
  fairway: 1.3,
  green: 1,
  rough: 0.8,
  bunker: 0.6,
} as const satisfies Readonly<Record<PlayableTerrain, number>>;

export interface TerrainRenderSpec {
  readonly tile: string;
  readonly color: `#${string}`;
}

/** Authoritative one-bit Braille pattern and 24-bit color for each Terrain. */
export const TERRAIN_RENDERING = {
  green: { tile: "⠁⠈", color: "#a6da95" },
  fairway: { tile: "⠒⠒", color: "#a6da95" },
  rough: { tile: "⣶⣶", color: "#a6da95" },
  bunker: { tile: "⠶⠶", color: "#eed49f" },
  water: { tile: "⠛⣤", color: "#8aadf4" },
} as const satisfies Readonly<Record<Terrain, TerrainRenderSpec>>;

/** Every legal committed Power fraction. */
export const POWER_LEVELS = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1] as const;
export type Power = (typeof POWER_LEVELS)[number];

/** Every legal Shot Direction bearing in degrees. */
export const SHOT_DIRECTIONS = [
  0, 22.5, 45, 67.5, 90, 112.5, 135, 157.5,
  180, 202.5, 225, 247.5, 270, 292.5, 315, 337.5,
] as const;
export type ShotDirection = (typeof SHOT_DIRECTIONS)[number];

/** Shared deterministic numeric constants. */
export const NUMERIC_RULES = {
  comparisonEpsilon: 1e-6,
  normalizationDecimalPlaces: 6,
  physicsFramesPerSecond: 120,
  playbackFramesPerSecond: 30,
  fullPowerCarryDurationSeconds: 3,
} as const;

/** Cup capture constants; maximum speed is inclusive. */
export const CUP = {
  captureRadius: 0.35,
  maximumCaptureSpeed: 1.5,
} as const;

/** Putter constants derived from expected Green Roll. */
export const PUTTER = {
  fullPowerGreenRollDistance: 13,
  fullPowerInitialSpeedSquared: 26,
} as const;

/** Power Meter timing and presentation constants. */
export const POWER_METER = {
  minimumBlocks: 1,
  maximumBlocks: 10,
  fillDurationSeconds: 1.5,
  emptyDurationSeconds: 1.5,
  color: "#ed8796",
} as const;

/** Fixed terminal viewport constants. */
export const VIEWPORT = {
  nativeCourseWidth: 60,
  nativeCourseHeight: 60,
  columnsPerCourseUnit: 2,
  rowsPerCourseUnit: 1,
  nativeTerminalWidth: 120,
  nativeTerminalHeight: 60,
  minimumTerminalWidth: 60,
  minimumTerminalHeight: 20,
} as const;

/** Fixed glyph and color values for overlays rendered above Terrain. */
export const OVERLAY_RENDERING = {
  ball: { glyph: "●", color: "#f4dbd6" },
  cup: { glyph: "○", color: "#cad3f5" },
  flag: { glyph: "⚑", color: "#ed8796" },
  target: { glyph: "╳", color: "#ed8796" },
  path: { glyph: "·", color: "#939ab7" },
  courseBoundary: { glyph: "×", color: "#5b6078" },
  offScreenArrow: { color: "#f5a97f" },
} as const;

declare const holeNumberBrand: unique symbol;
declare const holeIdBrand: unique symbol;
declare const courseHoleIndexBrand: unique symbol;

/** Designer-facing Hole number, independent from Course order. */
export type HoleNumber = number & { readonly [holeNumberBrand]: "HoleNumber" };
/** Stable Hole identity, independent from display number and Course order. */
export type HoleId = string & { readonly [holeIdBrand]: "HoleId" };
/** Zero-based position in a Course's ordered Hole array. */
export type CourseHoleIndex = number & { readonly [courseHoleIndexBrand]: "CourseHoleIndex" };

/** Keeps all three Hole identity concepts explicit at API boundaries. */
export interface HoleReference {
  readonly id: HoleId;
  readonly number: HoleNumber;
  readonly courseIndex: CourseHoleIndex;
}

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface PersistedHoleScore {
  readonly hole: HoleReference;
  readonly playedStrokes: number;
  readonly penaltyStrokes: number;
  readonly completed: boolean;
}

export type PersistedRoundStatus = "active" | "complete" | "abandoned";

/** Compact gameplay state persisted after deterministic simulation checkpoints. */
export interface PersistedRoundState {
  readonly kind: "persisted-round";
  readonly courseId: string;
  readonly currentHoleIndex: CourseHoleIndex;
  readonly lie: Point;
  readonly selectedClub: Club;
  readonly shotDirection: ShotDirection;
  readonly holeScores: readonly PersistedHoleScore[];
  readonly status: PersistedRoundStatus;
}

/** Mutually exclusive presentation states, none of which belong in Round saves. */
export const UI_STATES = [
  "intro",
  "aiming",
  "metering",
  "playback",
  "penalty-notice",
  "hole-summary",
  "round-summary",
  "resize-paused",
  "confirm-abandon",
] as const;
export type UiStateName = (typeof UI_STATES)[number];

/** Session-local UI state kept type-distinct from persisted Round state. */
export interface TransientUiState {
  readonly kind: "transient-ui";
  readonly state: UiStateName;
}
