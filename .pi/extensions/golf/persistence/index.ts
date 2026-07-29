import { mkdir, open, readFile, readdir, stat } from "node:fs/promises";
import { basename, dirname, resolve, sep } from "node:path";

import { parseCourseJson } from "../course-loader/raw-parser.ts";
import type { RoundCourseSnapshot } from "../course-loader/types.ts";
import {
  CLUB_ORDER,
  parseCourseHoleIndex,
  parseCourseId,
  parseHoleId,
  parseHoleNumber,
  parseShotDirectionIndex,
  type PersistedRoundState,
} from "../domain/index.ts";
import type { DurableResolvedShot } from "../simulation/outcome.ts";

export const GOLF_ENTRY_VERSION = 1 as const;
export const GOLF_BRANCH_REFERENCE_TYPE = "pi-golf-round-v1";
export type GolfEntryKind = "round-start" | "shot" | "checkpoint" | "round-terminal" | "round-replacement";
export interface GolfEntryV1 { readonly entryVersion: 1; readonly roundId: string; readonly revision: number; readonly kind: GolfEntryKind; readonly payload: unknown; }
export interface RoundStartPayload { readonly courseSnapshot: string; readonly state: PersistedRoundState; readonly branchId: string; }
export interface ShotPayload { readonly shot: DurableResolvedShot; readonly state: PersistedRoundState; }
export interface CheckpointPayload { readonly state: PersistedRoundState; readonly lifecycle: Lifecycle; }
export interface RoundTerminalPayload { readonly status: "complete" | "abandoned"; readonly state: PersistedRoundState; }
export interface RoundReplacementPayload { readonly successorRoundId: string; readonly successorStartRevision: 0; }
export type Lifecycle = "aiming" | "hole-summary" | "round-summary";
export type ValidGolfEntry =
  | (Omit<GolfEntryV1, "payload" | "kind"> & { readonly kind: "round-start"; readonly payload: RoundStartPayload })
  | (Omit<GolfEntryV1, "payload" | "kind"> & { readonly kind: "shot"; readonly payload: ShotPayload })
  | (Omit<GolfEntryV1, "payload" | "kind"> & { readonly kind: "checkpoint"; readonly payload: CheckpointPayload })
  | (Omit<GolfEntryV1, "payload" | "kind"> & { readonly kind: "round-terminal"; readonly payload: RoundTerminalPayload })
  | (Omit<GolfEntryV1, "payload" | "kind"> & { readonly kind: "round-replacement"; readonly payload: RoundReplacementPayload });

const ROUND_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/u;
const MAX_LOG_BYTES = 4 * 1024 * 1024;
const MAX_ROUND_FILES = 256;
const object = (value: unknown): Record<string, unknown> | undefined => typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
const closed = (value: unknown, keys: readonly string[]): Record<string, unknown> | undefined => {
  const candidate = object(value);
  return candidate !== undefined && Object.keys(candidate).every((key) => keys.includes(key)) && keys.every((key) => key in candidate) ? candidate : undefined;
};
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const integer = (value: unknown): value is number => finite(value) && Number.isInteger(value);

function point(value: unknown): boolean { const p = closed(value, ["x", "y"]); return p !== undefined && finite(p.x) && finite(p.y); }
function persistedState(value: unknown): value is PersistedRoundState {
  const v = closed(value, ["kind", "courseId", "currentHoleIndex", "lie", "selectedClub", "shotDirectionIndex", "holeScores", "status"]);
  if (v === undefined || v.kind !== "persisted-round" || parseCourseId(v.courseId) === undefined || parseCourseHoleIndex(v.currentHoleIndex) === undefined || !CLUB_ORDER.includes(v.selectedClub as never) || parseShotDirectionIndex(v.shotDirectionIndex) === undefined || !["active", "complete", "abandoned"].includes(v.status as string) || !point(v.lie) || !Array.isArray(v.holeScores)) return false;
  return v.holeScores.every((score) => {
    const s = closed(score, ["hole", "playedStrokes", "penaltyStrokes", "completed"]);
    if (s === undefined || !integer(s.playedStrokes) || s.playedStrokes < 0 || !integer(s.penaltyStrokes) || s.penaltyStrokes < 0 || typeof s.completed !== "boolean") return false;
    const hole = closed(s.hole, ["id", "number", "courseIndex"]);
    return hole !== undefined && parseHoleId(hole.id) !== undefined && parseHoleNumber(hole.number) !== undefined && parseCourseHoleIndex(hole.courseIndex) !== undefined;
  });
}
function durableShot(value: unknown): value is DurableResolvedShot {
  const v = closed(value, ["shotId", "preShotLie", "inputs", "landingPosition", "finalPosition", "terminal", "resultingSpeed", "elapsed", "resultingRound"]);
  if (v === undefined || typeof v.shotId !== "string" || !ROUND_ID.test(v.shotId) || !point(v.preShotLie) || !point(v.landingPosition) || !point(v.finalPosition) || !["rest", "cup", "water", "out-of-bounds"].includes(v.terminal as string) || !finite(v.resultingSpeed) || !finite(v.elapsed)) return false;
  const inputs = closed(v.inputs, ["club", "directionIndex", "power"]); const round = closed(v.resultingRound, ["lie", "playedStrokes", "penaltyStrokes", "selectedClub", "directionIndex"]);
  return inputs !== undefined && CLUB_ORDER.includes(inputs.club as never) && parseShotDirectionIndex(inputs.directionIndex) !== undefined && typeof inputs.power === "number" && Number.isFinite(inputs.power) && inputs.power >= 0.1 && inputs.power <= 1 && Math.round(inputs.power * 10) === inputs.power * 10 && round !== undefined && point(round.lie) && integer(round.playedStrokes) && round.playedStrokes >= 0 && integer(round.penaltyStrokes) && round.penaltyStrokes >= 0 && CLUB_ORDER.includes(round.selectedClub as never) && parseShotDirectionIndex(round.directionIndex) !== undefined;
}
function validPayload(kind: GolfEntryKind, value: unknown): boolean {
  if (kind === "round-start") { const v = closed(value, ["courseSnapshot", "state", "branchId"]); if (v === undefined || typeof v.courseSnapshot !== "string" || v.courseSnapshot.length === 0 || typeof v.branchId !== "string" || v.branchId.length === 0 || !persistedState(v.state)) return false; return parseCourseJson(v.courseSnapshot).ok; }
  if (kind === "shot") { const v = closed(value, ["shot", "state"]); return v !== undefined && durableShot(v.shot) && persistedState(v.state); }
  if (kind === "checkpoint") { const v = closed(value, ["state", "lifecycle"]); return v !== undefined && persistedState(v.state) && ["aiming", "hole-summary", "round-summary"].includes(v.lifecycle as string); }
  if (kind === "round-terminal") { const v = closed(value, ["status", "state"]); return v !== undefined && (v.status === "complete" || v.status === "abandoned") && persistedState(v.state) && v.state.status === v.status; }
  const v = closed(value, ["successorRoundId", "successorStartRevision"]); return v !== undefined && typeof v.successorRoundId === "string" && ROUND_ID.test(v.successorRoundId) && v.successorStartRevision === 0;
}

/** Explicit registry: V2 supports no predecessor envelope versions, so unknown versions never migrate heuristically. */
export const GOLF_ENTRY_MIGRATIONS: ReadonlyMap<number, (entry: unknown) => GolfEntryV1> = new Map();
export function parseGolfEntry(value: unknown): ValidGolfEntry {
  const v = closed(value, ["entryVersion", "roundId", "revision", "kind", "payload"]);
  if (v === undefined || v.entryVersion !== GOLF_ENTRY_VERSION || typeof v.roundId !== "string" || !ROUND_ID.test(v.roundId) || !integer(v.revision) || v.revision < 0 || !["round-start", "shot", "checkpoint", "round-terminal", "round-replacement"].includes(v.kind as string) || !validPayload(v.kind as GolfEntryKind, v.payload)) throw new Error("Invalid Golf entry.");
  return v as ValidGolfEntry;
}

export interface ReconstructedRound { readonly roundId: string; readonly revision: number; readonly state: PersistedRoundState; readonly lifecycle: Lifecycle; readonly terminal: boolean; readonly replacement: string | null; readonly branchId: string; }
/** Validates all committed bytes before exposing state. There is deliberately no older-entry fallback. */
export function reconstructRound(entries: readonly unknown[]): ReconstructedRound {
  if (entries.length === 0) throw new Error("Round log is empty.");
  const parsed = entries.map(parseGolfEntry); const start = parsed[0];
  if (start === undefined || start.kind !== "round-start" || start.revision !== 0) throw new Error("Round log must begin with round-start revision 0.");
  let current = start.payload.state; let lifecycle: Lifecycle = "aiming"; let terminal = false; let replacement: string | null = null; const shotIds = new Set<string>();
  for (const [index, entry] of parsed.entries()) {
    if (entry.roundId !== start.roundId || entry.revision !== index) throw new Error("Invalid Round revision chain.");
    if (index === 0) continue;
    if (terminal || replacement !== null || entry.kind === "round-start") throw new Error("Invalid entry after terminal/replacement.");
    if (entry.kind === "shot") { if (shotIds.has(entry.payload.shot.shotId)) throw new Error("Duplicate shotId."); shotIds.add(entry.payload.shot.shotId); current = entry.payload.state; }
    if (entry.kind === "checkpoint") { current = entry.payload.state; lifecycle = entry.payload.lifecycle; }
    if (entry.kind === "round-terminal") { current = entry.payload.state; terminal = true; lifecycle = "round-summary"; }
    if (entry.kind === "round-replacement") { replacement = entry.payload.successorRoundId; terminal = true; }
  }
  return { roundId: start.roundId, revision: parsed.length - 1, state: current, lifecycle, terminal, replacement, branchId: start.payload.branchId };
}

export interface RoundStoreOptions { readonly root: string; readonly beforeWrite?: (boundary: "open" | "write" | "file-sync" | "directory-sync") => Promise<void> | void; }
/** Authoritative JSONL store. Paths are validated identifiers, never settings/source paths. */
export class RoundStore {
  readonly #root: string; readonly #beforeWrite?: RoundStoreOptions["beforeWrite"];
  public constructor(options: RoundStoreOptions) { this.#root = resolve(options.root); this.#beforeWrite = options.beforeWrite; }
  pathFor(roundId: string): string { if (!ROUND_ID.test(roundId)) throw new Error("Invalid Round ID."); const path = resolve(this.#root, `${roundId}.jsonl`); if (dirname(path) !== this.#root || basename(path) !== `${roundId}.jsonl` || !path.startsWith(`${this.#root}${sep}`)) throw new Error("Round path escapes store."); return path; }
  async append(entry: GolfEntryV1): Promise<void> {
    const validated = parseGolfEntry(entry); const path = this.pathFor(validated.roundId); await mkdir(this.#root, { recursive: true });
    const existed = await stat(path).then(() => true, () => false); await this.#beforeWrite?.("open"); const file = await open(path, "a");
    try { await this.#beforeWrite?.("write"); await file.writeFile(`${JSON.stringify(validated)}\n`, "utf8"); await this.#beforeWrite?.("file-sync"); await file.sync(); } finally { await file.close(); }
    if (!existed) { await this.#beforeWrite?.("directory-sync"); const directory = await open(this.#root, "r"); try { await directory.sync(); } finally { await directory.close(); } }
  }
  async read(roundId: string): Promise<ReconstructedRound> {
    const path = this.pathFor(roundId); const metadata = await stat(path); if (metadata.size > MAX_LOG_BYTES) throw new Error("Round log exceeds bound.");
    const raw = await readFile(path, "utf8"); const physical = raw.split("\n"); const terminated = raw.endsWith("\n"); if (terminated) physical.pop(); else physical.pop(); // final unterminated bytes are an uncommitted append
    return reconstructRound(physical.map((line) => { try { return JSON.parse(line) as unknown; } catch { throw new Error("Malformed committed Round entry."); } }));
  }
  async findByBranch(branchId: string): Promise<ReconstructedRound[]> {
    const names = (await readdir(this.#root).catch(() => [])).filter((name) => /^[a-z0-9][a-z0-9_-]{0,63}\.jsonl$/u.test(name)).sort().slice(0, MAX_ROUND_FILES);
    const rounds = await Promise.all(names.map(async (name) => this.read(name.slice(0, -6)).catch(() => { throw new Error("Invalid durable Round log."); })));
    return rounds.filter((round) => round.branchId === branchId);
  }
}

export interface BranchEntryLike { readonly type: string; readonly customType?: string; readonly data?: unknown; }
export interface BranchRoundReference { readonly roundId: string; readonly revision: number; }
export function parseBranchRoundReference(value: unknown): BranchRoundReference | undefined { const v = closed(value, ["roundId", "revision"]); return v !== undefined && typeof v.roundId === "string" && ROUND_ID.test(v.roundId) && integer(v.revision) && v.revision >= 0 ? { roundId: v.roundId, revision: v.revision } : undefined; }
/** Reconciles only complete root-to-leaf branch references; compaction/context entries are intentionally irrelevant. */
export async function reconstructActiveBranch(store: RoundStore, branch: readonly BranchEntryLike[], branchId: string): Promise<ReconstructedRound | null> {
  const refs = branch.filter((entry) => entry.type === "custom" && entry.customType === GOLF_BRANCH_REFERENCE_TYPE).map((entry) => parseBranchRoundReference(entry.data));
  const reference = refs.at(-1);
  if (reference !== undefined) { const round = await store.read(reference.roundId); if (round.revision !== reference.revision || round.branchId !== branchId) throw new Error("Branch Round reference does not match authoritative store."); return round; }
  const candidates = await store.findByBranch(branchId); if (candidates.length > 1) throw new Error("Ambiguous durable Round association."); return candidates[0] ?? null;
}

/** T09 narrow seam: durable start precedes the caller's custom branch reference/UI activation. */
export async function appendRoundStart(store: RoundStore, args: { readonly roundId: string; readonly snapshot: RoundCourseSnapshot; readonly state: PersistedRoundState; readonly branchId: string }): Promise<ReconstructedRound> {
  await store.append({ entryVersion: 1, roundId: args.roundId, revision: 0, kind: "round-start", payload: { courseSnapshot: args.snapshot.serializedCourse, state: args.state, branchId: args.branchId } });
  return store.read(args.roundId);
}

/** Serial session writer used by T10; it exposes no state advance until append resolves. */
export class RoundMutationWriter {
  #tail: Promise<void> = Promise.resolve();
  #pendingShotId: string | null = null;
  #shotCommit: { readonly shotId: string; readonly promise: Promise<number> } | null = null;
  public constructor(private readonly store: RoundStore, private readonly roundId: string, private revision: number) {}
  async append(entry: Omit<GolfEntryV1, "roundId" | "revision" | "entryVersion">): Promise<number> {
    let result = 0; const work = this.#tail.then(async () => { const revision = this.revision + 1; await this.store.append({ ...entry, entryVersion: 1, roundId: this.roundId, revision }); this.revision = revision; result = revision; }); this.#tail = work.catch(() => undefined); await work; return result;
  }
  beginShot(shotId: string): boolean { if (this.#pendingShotId !== null && this.#pendingShotId !== shotId) return false; this.#pendingShotId ??= shotId; return true; }
  commitShot(shot: DurableResolvedShot, state: PersistedRoundState): Promise<number> {
    if (this.#shotCommit !== null) { if (this.#shotCommit.shotId !== shot.shotId) return Promise.reject(new Error("Another Shot is committing.")); return this.#shotCommit.promise; }
    if (!this.beginShot(shot.shotId)) return Promise.reject(new Error("Another Shot is committing."));
    const promise = this.append({ kind: "shot", payload: { shot, state } }).finally(() => { this.#pendingShotId = null; this.#shotCommit = null; });
    this.#shotCommit = { shotId: shot.shotId, promise };
    return promise;
  }
}
