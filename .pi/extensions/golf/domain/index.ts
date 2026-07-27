export {
  ACTIVE_TIME_SUSPENSION_REASONS,
  ActiveTimeClock,
  ManualMonotonicClock,
  PRESENTATION_TIMER_NAMES,
  PresentationClockSet,
  SystemMonotonicClock,
  type ActiveTimeSuspensionReason,
  type MonotonicClock,
  type PresentationTimerName,
} from "./clock.ts";

/** Version of the shared Version 2 foundation contract consumed by the extension shell. */
export const FOUNDATION_CONTRACT_VERSION = 2 as const;

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
export const POWER_LEVELS = [
  0.1,
  0.2,
  0.3,
  0.4,
  0.5,
  0.6,
  0.7,
  0.8,
  0.9,
  1,
] as const;
export type Power = (typeof POWER_LEVELS)[number];

/** Every legal Shot Direction bearing in clockwise terminal-coordinate order. */
export const SHOT_DIRECTIONS = [
  0,
  22.5,
  45,
  67.5,
  90,
  112.5,
  135,
  157.5,
  180,
  202.5,
  225,
  247.5,
  270,
  292.5,
  315,
  337.5,
] as const;
export type ShotDirection = (typeof SHOT_DIRECTIONS)[number];

/** Shared deterministic simulation and normalization rates. */
export const NUMERIC_RULES = {
  normalizationDecimalPlaces: 6,
  physicsFramesPerSecond: 120,
  playbackFramesPerSecond: 30,
  fullPowerCarryDurationSeconds: 3,
  rollEventTimeTieToleranceSeconds: 1e-9,
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
  fullPowerFairwayRollDistance: 26 / 6,
} as const;

/** Power Meter presentation constants; timing lives only in TIMING. */
export const POWER_METER = {
  minimumBlocks: 1,
  maximumBlocks: 10,
  color: "#ed8796",
} as const;

/** Authoritative durations for every Version 2 active-time presentation timer. */
export const TIMING = {
  introMilliseconds: 1_000,
  displayTimerMilliseconds: 2_000,
  targetPanDelayMilliseconds: 250,
  targetPanDurationMilliseconds: 1_000,
  powerMeterBinMilliseconds: 150,
  powerMeterFillMilliseconds: 1_500,
  powerMeterEmptyMilliseconds: 1_500,
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

declare const courseIdBrand: unique symbol;
declare const holeNumberBrand: unique symbol;
declare const holeIdBrand: unique symbol;
declare const courseHoleIndexBrand: unique symbol;
declare const shotDirectionIndexBrand: unique symbol;

export type CourseId = string & { readonly [courseIdBrand]: "CourseId" };
/** Designer-facing Hole number, independent from Course order. */
export type HoleNumber = number & { readonly [holeNumberBrand]: "HoleNumber" };
/** Stable Hole identity, independent from display number and Course order. */
export type HoleId = string & { readonly [holeIdBrand]: "HoleId" };
/** Zero-based position in a Course's ordered Hole array. */
export type CourseHoleIndex = number & {
  readonly [courseHoleIndexBrand]: "CourseHoleIndex";
};
/** Zero-based index into SHOT_DIRECTIONS. */
export type ShotDirectionIndex = number & {
  readonly [shotDirectionIndexBrand]: "ShotDirectionIndex";
};

const DOMAIN_ID_PATTERN = /^[a-z0-9](?:[a-z0-9._-]{0,63})$/u;

export function parseCourseId(value: unknown): CourseId | undefined {
  return typeof value === "string" && DOMAIN_ID_PATTERN.test(value)
    ? (value as CourseId)
    : undefined;
}

export function parseHoleId(value: unknown): HoleId | undefined {
  return typeof value === "string" && DOMAIN_ID_PATTERN.test(value)
    ? (value as HoleId)
    : undefined;
}

export function parseHoleNumber(value: unknown): HoleNumber | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 18
    ? (value as HoleNumber)
    : undefined;
}

export function parseCourseHoleIndex(value: unknown): CourseHoleIndex | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value < 18
    ? (value as CourseHoleIndex)
    : undefined;
}

export function parseShotDirectionIndex(value: unknown): ShotDirectionIndex | undefined {
  return typeof value === "number" && Number.isInteger(value)
    && value >= 0 && value < SHOT_DIRECTIONS.length
    ? (value as ShotDirectionIndex)
    : undefined;
}

/** Reconstructs the exact bearing from a validated discrete direction index. */
export function bearingForShotDirection(index: ShotDirectionIndex): ShotDirection {
  const bearing = SHOT_DIRECTIONS[index];
  if (bearing === undefined) throw new RangeError("Invalid Shot Direction index.");
  return bearing;
}

/** Pure simulation primitive in terminal coordinates, where positive y points down. */
export function vectorForShotDirection(index: ShotDirectionIndex): Point {
  const radians = bearingForShotDirection(index) * Math.PI / 180;
  return { x: Math.cos(radians), y: Math.sin(radians) };
}

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

/** Compact canonical gameplay state; presentation-only state is intentionally absent. */
export interface PersistedRoundState {
  readonly kind: "persisted-round";
  readonly courseId: CourseId;
  readonly currentHoleIndex: CourseHoleIndex;
  readonly lie: Point;
  readonly selectedClub: Club;
  readonly shotDirectionIndex: ShotDirectionIndex;
  readonly holeScores: readonly PersistedHoleScore[];
  readonly status: PersistedRoundStatus;
}

/** Runtime-visible persisted key allowlist for strict external-boundary validators. */
export const PERSISTED_ROUND_STATE_KEYS = [
  "kind",
  "courseId",
  "currentHoleIndex",
  "lie",
  "selectedClub",
  "shotDirectionIndex",
  "holeScores",
  "status",
] as const satisfies readonly (keyof PersistedRoundState)[];

/** The nine mutually exclusive base states. */
export const BASE_UI_STATES = [
  "intro",
  "aiming",
  "metering",
  "committing",
  "playback",
  "penalty-notice",
  "hole-summary",
  "round-summary",
  "confirm-abandon",
] as const;
export type BaseUiStateName = (typeof BASE_UI_STATES)[number];

/** All ten names, including the orthogonal resize suspension wrapper. */
export const UI_STATES = [...BASE_UI_STATES, "resize-paused"] as const;
export type UiStateName = (typeof UI_STATES)[number];

export interface TransientMeterState {
  readonly blockCount: number;
  readonly startedAtActiveMilliseconds: number;
}

export interface TransientNoticeState {
  readonly text: string;
  readonly startedAtActiveMilliseconds: number;
}

export interface TransientCameraState {
  readonly mode: "lie" | "target" | "ball";
  readonly transitionStartedAtActiveMilliseconds: number | null;
}

export interface TransientPlaybackState {
  readonly shotId: string;
  readonly cursorMilliseconds: number;
}

/** Session-local presentation state kept type-distinct from persisted Round state. */
export interface TransientUiState {
  readonly kind: "transient-ui";
  readonly state: UiStateName;
  readonly meter: TransientMeterState | null;
  readonly notice: TransientNoticeState | null;
  readonly camera: TransientCameraState;
  readonly playback: TransientPlaybackState | null;
}
