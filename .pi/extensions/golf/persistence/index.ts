import { mkdir, open, readFile, readdir, stat, unlink } from "node:fs/promises";
import { basename, dirname, resolve, sep } from "node:path";

import { parseCourseJson } from "../course-loader/raw-parser.ts";
import type { RoundCourseSnapshot } from "../course-loader/types.ts";
import { CLUB_ORDER, parseCourseHoleIndex, parseCourseId, parseHoleId, parseHoleNumber, parseShotDirectionIndex, type PersistedRoundState } from "../domain/index.ts";
import type { DurableResolvedShot } from "../simulation/outcome.ts";

export const GOLF_ENTRY_VERSION = 1 as const;
export const GOLF_BRANCH_REFERENCE_TYPE = "pi-golf-round-v1";
export type GolfEntryKind = "round-start" | "shot" | "checkpoint" | "round-terminal" | "round-replacement";
export interface GolfEntryV1 { readonly entryVersion: 1; readonly roundId: string; readonly revision: number; readonly kind: GolfEntryKind; readonly payload: unknown; }
export interface RoundStartPayload { readonly courseSnapshot: string; readonly state: PersistedRoundState; /** Session fallback only when Pi has no durable custom entry. */ readonly branchId: string; }
export interface ShotPayload { readonly shot: DurableResolvedShot; readonly state: PersistedRoundState; }
export type Lifecycle = "aiming" | "hole-summary" | "round-summary";
export interface CheckpointPayload { readonly state: PersistedRoundState; readonly lifecycle: Lifecycle; }
export interface RoundTerminalPayload { readonly status: "complete" | "abandoned"; readonly state: PersistedRoundState; }
/** The successor start is carried by the predecessor transition so an interruption cannot leave an unidentifiable successor. */
export interface RoundReplacementPayload { readonly successorRoundId: string; readonly successorStartRevision: 0; readonly successorStart: RoundStartPayload; }
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
const closed = (value: unknown, keys: readonly string[]): Record<string, unknown> | undefined => { const v = object(value); return v !== undefined && Object.keys(v).every((key) => keys.includes(key)) && keys.every((key) => key in v) ? v : undefined; };
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const integer = (value: unknown): value is number => finite(value) && Number.isInteger(value);
function point(value: unknown): boolean { const p = closed(value, ["x", "y"]); return p !== undefined && finite(p.x) && finite(p.y); }
function persistedState(value: unknown): value is PersistedRoundState {
  const v = closed(value, ["kind", "courseId", "currentHoleIndex", "lie", "selectedClub", "shotDirectionIndex", "holeScores", "status"]);
  if (v === undefined || v.kind !== "persisted-round" || parseCourseId(v.courseId) === undefined || parseCourseHoleIndex(v.currentHoleIndex) === undefined || !CLUB_ORDER.includes(v.selectedClub as never) || parseShotDirectionIndex(v.shotDirectionIndex) === undefined || !["active", "complete", "abandoned"].includes(v.status as string) || !point(v.lie) || !Array.isArray(v.holeScores)) return false;
  let prior = -1;
  return v.holeScores.every((score) => { const s = closed(score, ["hole", "playedStrokes", "penaltyStrokes", "completed"]); if (s === undefined || !integer(s.playedStrokes) || s.playedStrokes < 1 || !integer(s.penaltyStrokes) || s.penaltyStrokes < 0 || s.completed !== true) return false; const h = closed(s.hole, ["id", "number", "courseIndex"]); const courseIndex = h === undefined ? undefined : parseCourseHoleIndex(h.courseIndex); if (h === undefined || parseHoleId(h.id) === undefined || parseHoleNumber(h.number) === undefined || courseIndex === undefined || courseIndex !== prior + 1) return false; prior = courseIndex; return true; });
}
function durableShot(value: unknown): value is DurableResolvedShot {
  const v = closed(value, ["shotId", "preShotLie", "inputs", "landingPosition", "finalPosition", "terminal", "resultingSpeed", "elapsed", "resultingRound"]);
  if (v === undefined || typeof v.shotId !== "string" || !ROUND_ID.test(v.shotId) || !point(v.preShotLie) || !point(v.landingPosition) || !point(v.finalPosition) || !["rest", "cup", "water", "out-of-bounds"].includes(v.terminal as string) || !finite(v.resultingSpeed) || !finite(v.elapsed) || v.elapsed < 0) return false;
  const i = closed(v.inputs, ["club", "directionIndex", "power"]); const r = closed(v.resultingRound, ["lie", "playedStrokes", "penaltyStrokes", "selectedClub", "directionIndex"]);
  return i !== undefined && CLUB_ORDER.includes(i.club as never) && parseShotDirectionIndex(i.directionIndex) !== undefined && typeof i.power === "number" && i.power >= .1 && i.power <= 1 && Math.round(i.power * 10) === i.power * 10 && r !== undefined && point(r.lie) && integer(r.playedStrokes) && r.playedStrokes >= 0 && integer(r.penaltyStrokes) && r.penaltyStrokes >= 0 && CLUB_ORDER.includes(r.selectedClub as never) && parseShotDirectionIndex(r.directionIndex) !== undefined;
}
function startPayload(value: unknown): value is RoundStartPayload { const v = closed(value, ["courseSnapshot", "state", "branchId"]); return v !== undefined && typeof v.courseSnapshot === "string" && v.courseSnapshot.length > 0 && typeof v.branchId === "string" && v.branchId.length > 0 && persistedState(v.state) && v.state.status === "active" && parseCourseJson(v.courseSnapshot).ok; }
function validPayload(kind: GolfEntryKind, value: unknown): boolean {
  if (kind === "round-start") return startPayload(value);
  if (kind === "shot") { const v = closed(value, ["shot", "state"]); return v !== undefined && durableShot(v.shot) && persistedState(v.state) && v.state.status === "active" && v.shot.resultingRound.lie.x === v.state.lie.x && v.shot.resultingRound.lie.y === v.state.lie.y && v.shot.resultingRound.selectedClub === v.state.selectedClub && v.shot.resultingRound.directionIndex === v.state.shotDirectionIndex; }
  if (kind === "checkpoint") { const v = closed(value, ["state", "lifecycle"]); return v !== undefined && persistedState(v.state) && v.state.status === "active" && (v.lifecycle === "aiming" || v.lifecycle === "hole-summary"); }
  if (kind === "round-terminal") { const v = closed(value, ["status", "state"]); return v !== undefined && (v.status === "complete" || v.status === "abandoned") && persistedState(v.state) && v.state.status === v.status; }
  const v = closed(value, ["successorRoundId", "successorStartRevision", "successorStart"]); return v !== undefined && typeof v.successorRoundId === "string" && ROUND_ID.test(v.successorRoundId) && v.successorStartRevision === 0 && startPayload(v.successorStart);
}
export const GOLF_ENTRY_MIGRATIONS: ReadonlyMap<number, (entry: unknown) => GolfEntryV1> = new Map();
export function parseGolfEntry(value: unknown): ValidGolfEntry { const v = closed(value, ["entryVersion", "roundId", "revision", "kind", "payload"]); if (v === undefined || v.entryVersion !== 1 || typeof v.roundId !== "string" || !ROUND_ID.test(v.roundId) || !integer(v.revision) || v.revision < 0 || !["round-start", "shot", "checkpoint", "round-terminal", "round-replacement"].includes(v.kind as string) || !validPayload(v.kind as GolfEntryKind, v.payload)) throw new Error("Invalid Golf entry."); return v as ValidGolfEntry; }
export interface ReconstructedRound { readonly roundId: string; readonly revision: number; readonly state: PersistedRoundState; readonly lifecycle: Lifecycle; /** Replayed from durable Shot entries; never presentation state. */ readonly currentHolePlayedStrokes: number; readonly currentHolePenaltyStrokes: number; readonly terminal: boolean; readonly replacement: string | null; readonly successorStart: RoundStartPayload | null; readonly branchId: string; }
/** Strictly validates ordering and semantic state transitions; there is never an older-entry fallback. */
export function reconstructRound(entries: readonly unknown[]): ReconstructedRound {
  if (entries.length === 0) throw new Error("Round log is empty.");
  const parsed = entries.map(parseGolfEntry); const start = parsed[0];
  if (start === undefined || start.kind !== "round-start" || start.revision !== 0) throw new Error("Round log must begin with round-start revision 0.");
  const parsedCourse = parseCourseJson(start.payload.courseSnapshot);
  if (!parsedCourse.ok) throw new Error("Invalid immutable Course snapshot.");
  const course = parsedCourse.value;
  const samePoint = (a: { x: number; y: number }, b: { x: number; y: number }) => a.x === b.x && a.y === b.y;
  const conforms = (s: PersistedRoundState): boolean => s.courseId === course.id && s.currentHoleIndex < course.holes.length && s.holeScores.length <= course.holes.length && s.holeScores.every((score, i) => { const h = course.holes[i]; return h !== undefined && score.hole.courseIndex === i && score.hole.id === h.id && score.hole.number === h.number; });
  const initial = start.payload.state; const firstHole = course.holes[0];
  if (firstHole === undefined || !conforms(initial) || initial.currentHoleIndex !== 0 || initial.holeScores.length !== 0 || !samePoint(initial.lie, firstHole.tee)) throw new Error("Round start is not the immutable Course initial state.");
  let current = initial; let lifecycle: Lifecycle = "aiming"; let terminal = false; let replacement: string | null = null; let successorStart: RoundStartPayload | null = null;
  let holePlayed = 0; let holePenalty = 0; const shots = new Set<string>();
  for (const [index, entry] of parsed.entries()) {
    if (entry.roundId !== start.roundId || entry.revision !== index) throw new Error("Invalid Round revision chain.");
    if (index === 0) continue;
    if (terminal || replacement !== null || entry.kind === "round-start") throw new Error("Invalid entry after terminal/replacement.");
    if (entry.kind === "shot") {
      const { shot, state: next } = entry.payload;
      if (!conforms(next) || lifecycle !== "aiming" || shots.has(shot.shotId) || !samePoint(shot.preShotLie, current.lie) || shot.inputs.club !== shot.resultingRound.selectedClub || shot.inputs.directionIndex !== shot.resultingRound.directionIndex || !samePoint(shot.resultingRound.lie, next.lie) || shot.resultingRound.selectedClub !== next.selectedClub || shot.resultingRound.directionIndex !== next.shotDirectionIndex) throw new Error("Incoherent Shot transition.");
      const played = holePlayed + 1; const penalty = holePenalty + ((shot.terminal === "water" || shot.terminal === "out-of-bounds") ? 1 : 0);
      if (shot.resultingRound.playedStrokes !== played || shot.resultingRound.penaltyStrokes !== penalty) throw new Error("Incoherent Shot scoring transition.");
      if (shot.terminal === "cup") { const score = next.holeScores.at(-1); const hole = course.holes[current.currentHoleIndex]; if (hole === undefined || next.currentHoleIndex !== current.currentHoleIndex || next.holeScores.length !== current.holeScores.length + 1 || score === undefined || score.playedStrokes !== played || score.penaltyStrokes !== penalty || !samePoint(next.lie, hole.cup)) throw new Error("Incoherent cup completion transition."); lifecycle = "hole-summary"; holePlayed = 0; holePenalty = 0; }
      else { if (next.currentHoleIndex !== current.currentHoleIndex || JSON.stringify(next.holeScores) !== JSON.stringify(current.holeScores)) throw new Error("Incoherent non-cup Shot transition."); lifecycle = "aiming"; holePlayed = played; holePenalty = penalty; }
      shots.add(shot.shotId); current = next;
    } else if (entry.kind === "checkpoint") {
      const next = entry.payload.state;
      if (!conforms(next)) throw new Error("Incoherent checkpoint transition.");
      if (lifecycle === "aiming") {
        if (entry.payload.lifecycle !== "aiming" || next.currentHoleIndex !== current.currentHoleIndex || JSON.stringify(next.holeScores) !== JSON.stringify(current.holeScores) || !samePoint(next.lie, current.lie)) throw new Error("Incoherent aiming checkpoint transition.");
      } else if (entry.payload.lifecycle === "aiming") {
        const hole = course.holes[current.currentHoleIndex + 1];
        if (hole === undefined || next.currentHoleIndex !== current.currentHoleIndex + 1 || JSON.stringify(next.holeScores) !== JSON.stringify(current.holeScores) || !samePoint(next.lie, hole.tee)) throw new Error("Incoherent Hole advancement.");
      } else if (next.currentHoleIndex !== current.currentHoleIndex || JSON.stringify(next.holeScores) !== JSON.stringify(current.holeScores) || !samePoint(next.lie, current.lie)) throw new Error("Incoherent Hole summary checkpoint transition.");
      current = next; lifecycle = entry.payload.lifecycle;
    } else if (entry.kind === "round-terminal") {
      const next = entry.payload.state;
      const immutableState = next.currentHoleIndex === current.currentHoleIndex && JSON.stringify(next.holeScores) === JSON.stringify(current.holeScores) && samePoint(next.lie, current.lie) && next.selectedClub === current.selectedClub && next.shotDirectionIndex === current.shotDirectionIndex;
      if (!conforms(next) || !immutableState || (entry.payload.status === "complete" && (lifecycle !== "hole-summary" || next.holeScores.length !== course.holes.length || next.currentHoleIndex !== course.holes.length - 1))) throw new Error("Incoherent terminal transition.");
      current = next; terminal = true; lifecycle = "round-summary";
    } else {
      if (entry.payload.successorRoundId === start.roundId || !startPayload(entry.payload.successorStart) || entry.payload.successorStart.branchId !== start.payload.branchId) throw new Error("Invalid Round replacement.");
      replacement = entry.payload.successorRoundId; successorStart = entry.payload.successorStart; terminal = true;
    }
  }
  return { roundId: start.roundId, revision: parsed.length - 1, state: current, lifecycle, currentHolePlayedStrokes: holePlayed, currentHolePenaltyStrokes: holePenalty, terminal, replacement, successorStart, branchId: start.payload.branchId };
}
export type WriteBoundary = "open" | "write" | "file-sync" | "directory-sync";
export interface RoundStoreOptions { readonly root: string; readonly beforeWrite?: (boundary: WriteBoundary) => Promise<void> | void; readonly afterWrite?: (boundary: WriteBoundary) => Promise<void> | void; }
export class RoundStore {
  static readonly #appendTails = new Map<string, Promise<void>>();
  readonly #root: string; readonly #before?: RoundStoreOptions["beforeWrite"]; readonly #after?: RoundStoreOptions["afterWrite"];
  public constructor(options: RoundStoreOptions) { this.#root = resolve(options.root); this.#before = options.beforeWrite; this.#after = options.afterWrite; }
  /** Stable authority identity shared by transient wrappers over the same durable store. */
  get identity(): string { return this.#root; }
  pathFor(roundId: string): string { if (!ROUND_ID.test(roundId)) throw new Error("Invalid Round ID."); const path = resolve(this.#root, `${roundId}.jsonl`); if (dirname(path) !== this.#root || basename(path) !== `${roundId}.jsonl` || !path.startsWith(`${this.#root}${sep}`)) throw new Error("Round path escapes store."); return path; }
  async #boundary(kind: WriteBoundary, after = false): Promise<void> { await (after ? this.#after : this.#before)?.(kind); }
  async append(entry: GolfEntryV1): Promise<void> {
    const v = parseGolfEntry(entry); const key = `${this.#root}\u0000${v.roundId}`;
    const prior = RoundStore.#appendTails.get(key) ?? Promise.resolve();
    const work = prior.then(() => this.#appendValidated(v));
    RoundStore.#appendTails.set(key, work.catch(() => undefined));
    await work;
  }
  /**
   * A physical line without its newline was never acknowledged as a JSONL entry.
   * Remove only that tail, flush the truncation, then append at a record boundary.
   */
  async #discardUncommittedTail(roundId: string): Promise<void> {
    const path = this.pathFor(roundId); const info = await stat(path);
    if (info.size > MAX_LOG_BYTES) throw new Error("Round log exceeds bound.");
    const raw = await readFile(path);
    if (raw.length === 0 || raw.at(-1) === 0x0a) return;
    const committedLength = raw.lastIndexOf(0x0a) + 1;
    const file = await open(path, "r+");
    try { await file.truncate(committedLength); await file.sync(); } finally { await file.close(); }
  }
  async #appendValidated(v: ValidGolfEntry): Promise<void> {
    const path = this.pathFor(v.roundId); await mkdir(this.#root, { recursive: true }); let existed = await stat(path).then(() => true, () => false);
    if (existed) await this.#discardUncommittedTail(v.roundId);
    // Only a retry of revision-zero round-start may remove the known zero-byte artifact
    // created when its predecessor link was already committed but open was interrupted.
    // Any non-empty artifact is committed or malformed data and is preserved fail-closed.
    if (existed && v.kind === "round-start" && v.revision === 0 && (await stat(path)).size === 0) { await unlink(path); existed = false; }
    if (existed) { const existing = await this.#entries(v.roundId); const reconstructed = reconstructRound(existing); if (v.revision !== reconstructed.revision + 1) throw new Error("Round append revision does not match authoritative predecessor."); reconstructRound([...existing, v]); }
    else { if (v.kind !== "round-start" || v.revision !== 0) throw new Error("Round append lacks authoritative round-start predecessor."); reconstructRound([v]); }
    await this.#boundary("open"); const file = await open(path, "a");
    try { await this.#boundary("open", true); await this.#boundary("write"); await file.writeFile(`${JSON.stringify(v)}\n`, "utf8"); await this.#boundary("write", true); await this.#boundary("file-sync"); await file.sync(); await this.#boundary("file-sync", true); } finally { await file.close(); }
    if (!existed) { await this.#boundary("directory-sync"); const directory = await open(this.#root, "r"); try { await directory.sync(); await this.#boundary("directory-sync", true); } finally { await directory.close(); } }
  }
  async #entries(roundId: string): Promise<unknown[]> { const path = this.pathFor(roundId); if ((await stat(path)).size > MAX_LOG_BYTES) throw new Error("Round log exceeds bound."); const raw = await readFile(path, "utf8"); const lines = raw.split("\n"); lines.pop(); return lines.map((line) => { try { return JSON.parse(line) as unknown; } catch { throw new Error("Malformed committed Round entry."); } }); }
  async read(roundId: string): Promise<ReconstructedRound> { return reconstructRound(await this.#entries(roundId)); }
  /** Strictly exposes only the persisted successor start for replacement association checks. */
  async startEntry(roundId: string): Promise<Extract<ValidGolfEntry, { readonly kind: "round-start" }>> { const first = parseGolfEntry((await this.#entries(roundId))[0]); if (first.kind !== "round-start") throw new Error("Successor lacks round-start."); return first; }
  async entryAt(roundId: string, revision: number): Promise<ValidGolfEntry> { const entries = await this.#entries(roundId); reconstructRound(entries); const entry = entries[revision]; if (entry === undefined) throw new Error("Round revision is absent."); return parseGolfEntry(entry); }
  async hasRound(roundId: string): Promise<boolean> { return stat(this.pathFor(roundId)).then(() => true, () => false); }
  /** Validate the whole authoritative log before selecting the branch's historical prefix. */
  async readAtRevision(roundId: string, revision: number): Promise<ReconstructedRound> { const entries = await this.#entries(roundId); reconstructRound(entries); if (!integer(revision) || revision < 0 || revision >= entries.length) throw new Error("Branch Round reference revision is invalid."); return reconstructRound(entries.slice(0, revision + 1)); }
  async findByBranch(branchId: string): Promise<ReconstructedRound[]> { const names = (await readdir(this.#root).catch(() => [])).filter((n) => /^[a-z0-9][a-z0-9_-]{0,63}\.jsonl$/u.test(n)).sort().slice(0, MAX_ROUND_FILES); const all = await Promise.all(names.map(async (n) => this.read(n.slice(0, -6)).catch(() => { throw new Error("Invalid durable Round log."); }))); const relevant = all.filter((round) => round.branchId === branchId); const dangling = relevant.some((round) => round.replacement !== null && !relevant.some((candidate) => candidate.roundId === round.replacement)); if (dangling) throw new Error("Replacement successor is not durably associated."); const active = relevant.filter((round) => !round.terminal); if (active.length > 1) throw new Error("Ambiguous durable Round association."); return active; }
}
/** Actual Pi SessionEntry shape relevant to getBranch(). */
export interface BranchEntryLike { readonly type: string; readonly id: string; readonly parentId: string | null; readonly timestamp: string; readonly customType?: string; readonly data?: unknown; }
export interface BranchRoundReference { readonly roundId: string; readonly revision: number; }
export function parseBranchRoundReference(value: unknown): BranchRoundReference | undefined { const v = closed(value, ["roundId", "revision"]); return v !== undefined && typeof v.roundId === "string" && ROUND_ID.test(v.roundId) && integer(v.revision) && v.revision >= 0 ? { roundId: v.roundId, revision: v.revision } : undefined; }
/** Validates every Golf reference on the real root-to-leaf getBranch path. */
export async function reconstructActiveBranch(store: RoundStore, branch: readonly BranchEntryLike[], sessionId: string): Promise<ReconstructedRound | null> {
  let prior: BranchEntryLike | undefined; let selected: ReconstructedRound | null = null;
  for (const entry of branch) { if (typeof entry.id !== "string" || entry.id.length === 0 || (prior !== undefined && entry.parentId !== prior.id)) throw new Error("Malformed Pi branch path."); prior = entry; if (entry.type !== "custom" || entry.customType !== GOLF_BRANCH_REFERENCE_TYPE) continue; const ref = parseBranchRoundReference(entry.data); if (ref === undefined) throw new Error("Malformed Golf branch reference."); const round = await store.readAtRevision(ref.roundId, ref.revision); if (selected !== null && (selected.roundId !== round.roundId || round.revision < selected.revision)) throw new Error("Incoherent Golf branch references."); selected = round; }
  if (selected !== null) {
    if (selected.replacement !== null && selected.successorStart !== null) {
      const successor = await store.read(selected.replacement);
      const successorStart = await store.startEntry(selected.replacement);
      if (JSON.stringify(selected.successorStart) !== JSON.stringify(successorStart.payload)) throw new Error("Replacement successor is not authoritatively associated.");
      return successor;
    }
    return selected;
  }
  const candidates = await store.findByBranch(sessionId); if (candidates.length > 1) throw new Error("Ambiguous durable Round association."); return candidates[0] ?? null;
}
export async function appendRoundStart(store: RoundStore, args: { readonly roundId: string; readonly snapshot: RoundCourseSnapshot; readonly state: PersistedRoundState; readonly branchId: string }): Promise<ReconstructedRound> { await store.append({ entryVersion: 1, roundId: args.roundId, revision: 0, kind: "round-start", payload: { courseSnapshot: args.snapshot.serializedCourse, state: args.state, branchId: args.branchId } }); return store.read(args.roundId); }

/** Link first, then materialize the carried start. A crash can only leave a fail-closed dangling link, never an active unlinked successor. */
export async function appendRoundReplacement(store: RoundStore, args: { readonly predecessorRoundId: string; readonly predecessorRevision: number; readonly successorRoundId: string; readonly successorSnapshot: RoundCourseSnapshot; readonly successorState: PersistedRoundState; readonly branchId: string }): Promise<ReconstructedRound> {
  if (args.successorRoundId === args.predecessorRoundId) throw new Error("Successor Round identity is not unique.");
  const successorStart: RoundStartPayload = { courseSnapshot: args.successorSnapshot.serializedCourse, state: args.successorState, branchId: args.branchId };
  const payload: RoundReplacementPayload = { successorRoundId: args.successorRoundId, successorStartRevision: 0, successorStart };
  const authoritative = await store.read(args.predecessorRoundId);
  if (authoritative.replacement !== null) {
    if (authoritative.replacement !== args.successorRoundId || JSON.stringify(authoritative.successorStart) !== JSON.stringify(successorStart)) throw new Error("Round already has a different replacement.");
  } else {
    if (authoritative.terminal || authoritative.revision !== args.predecessorRevision) throw new Error("Round replacement predecessor is not current and active.");
    await store.append({ entryVersion: 1, roundId: args.predecessorRoundId, revision: authoritative.revision + 1, kind: "round-replacement", payload });
  }
  try { await appendRoundStart(store, { roundId: args.successorRoundId, snapshot: args.successorSnapshot, state: args.successorState, branchId: args.branchId }); } catch (error) {
    // A committed successor is idempotent; a known empty post-open artifact is removed
    // inside the serialized revision-zero append and then materialized on this retry.
    try { const existing = await store.startEntry(args.successorRoundId); if (JSON.stringify(existing.payload) !== JSON.stringify(successorStart)) throw error; } catch { throw error; }
  }
  return store.read(args.successorRoundId);
}

/** A session authority must survive transient RoundStore wrappers created by command invocations. */
const writers = new Map<string, RoundMutationWriter>();
/** One authority per durable-store identity, session, and Round; wrappers cannot race a stale writer. */
export class RoundMutationWriter {
  #tail: Promise<void> = Promise.resolve(); #pendingShotId: string | null = null; #shotCommit: { readonly shotId: string; readonly promise: Promise<number> } | null = null;
  private constructor(private readonly store: RoundStore, private readonly roundId: string, private revision: number) {}
  static async forSession(store: RoundStore, sessionId: string, roundId: string, recoveredRevision: number): Promise<RoundMutationWriter> {
    const durable = await store.read(roundId); if (durable.revision !== recoveredRevision) throw new Error("Recovered Round revision does not match authoritative store.");
    const key = `${store.identity}\u0000${sessionId}\u0000${roundId}`; const existing = writers.get(key);
    if (existing !== undefined) { if (existing.#pendingShotId !== null || existing.#shotCommit !== null || existing.revision !== durable.revision) throw new Error("Session Round writer is stale or committing."); return existing; }
    const writer = new RoundMutationWriter(store, roundId, durable.revision); writers.set(key, writer); return writer;
  }
  get pendingShotId(): string | null { return this.#pendingShotId; }
  async append(entry: Omit<GolfEntryV1, "roundId" | "revision" | "entryVersion">): Promise<number> { let result = 0; const work = this.#tail.then(async () => { const next = this.revision + 1; await this.store.append({ ...entry, entryVersion: 1, roundId: this.roundId, revision: next }); this.revision = next; result = next; }); this.#tail = work.catch(() => undefined); await work; return result; }
  beginShot(shotId: string): boolean { if (this.#pendingShotId !== null && this.#pendingShotId !== shotId) return false; this.#pendingShotId ??= shotId; return true; }
  cancelPendingShot(shotId: string): boolean { if (this.#shotCommit !== null || this.#pendingShotId !== shotId) return false; this.#pendingShotId = null; return true; }
  commitShot(shot: DurableResolvedShot, state: PersistedRoundState): Promise<number> { if (this.#shotCommit !== null) return this.#shotCommit.shotId === shot.shotId ? this.#shotCommit.promise : Promise.reject(new Error("Another Shot is committing.")); if (!this.beginShot(shot.shotId)) return Promise.reject(new Error("Another Shot is committing.")); const expectedRevision = this.revision + 1; const promise = this.append({ kind: "shot", payload: { shot, state } }).then((revision) => { this.#pendingShotId = null; this.#shotCommit = null; return revision; }, async (error: unknown) => {
      // A sync failure is uncertain: the newline may already be durable. Never retry until
      // the authoritative chain proves whether this exact shot/revision committed.
      try { const durable = await this.store.readAtRevision(this.roundId, expectedRevision); const committed = await this.store.entryAt(this.roundId, expectedRevision); if (durable.revision === expectedRevision && committed.kind === "shot" && committed.payload.shot.shotId === shot.shotId) { this.revision = expectedRevision; this.#pendingShotId = null; this.#shotCommit = null; return expectedRevision; } } catch { /* predecessor remains retryable with the retained shot identity. */ }
      this.#shotCommit = null; throw error;
    }); this.#shotCommit = { shotId: shot.shotId, promise }; return promise; }
}
