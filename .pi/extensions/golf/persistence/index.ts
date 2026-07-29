import { mkdir, open, readFile, readdir, stat } from "node:fs/promises";
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
  return v.holeScores.every((score) => { const s = closed(score, ["hole", "playedStrokes", "penaltyStrokes", "completed"]); if (s === undefined || !integer(s.playedStrokes) || s.playedStrokes < 0 || !integer(s.penaltyStrokes) || s.penaltyStrokes < 0 || typeof s.completed !== "boolean") return false; const h = closed(s.hole, ["id", "number", "courseIndex"]); const courseIndex = h === undefined ? undefined : parseCourseHoleIndex(h.courseIndex); if (h === undefined || parseHoleId(h.id) === undefined || parseHoleNumber(h.number) === undefined || courseIndex === undefined || courseIndex <= prior) return false; prior = courseIndex; return true; });
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
export interface ReconstructedRound { readonly roundId: string; readonly revision: number; readonly state: PersistedRoundState; readonly lifecycle: Lifecycle; readonly terminal: boolean; readonly replacement: string | null; readonly successorStart: RoundStartPayload | null; readonly branchId: string; }
/** Strictly validates ordering and semantic state transitions; there is never an older-entry fallback. */
export function reconstructRound(entries: readonly unknown[]): ReconstructedRound {
  if (entries.length === 0) throw new Error("Round log is empty."); const parsed = entries.map(parseGolfEntry); const start = parsed[0]; if (start === undefined || start.kind !== "round-start" || start.revision !== 0) throw new Error("Round log must begin with round-start revision 0.");
  const parsedCourse = parseCourseJson(start.payload.courseSnapshot);
  if (!parsedCourse.ok) throw new Error("Invalid immutable Course snapshot.");
  const conformsToSnapshot = (state: PersistedRoundState): boolean => state.courseId === parsedCourse.value.id && state.currentHoleIndex < parsedCourse.value.holes.length && state.holeScores.every((score) => {
    const hole = parsedCourse.value.holes[score.hole.courseIndex];
    return hole !== undefined && hole.id === score.hole.id && hole.number === score.hole.number;
  });
  if (!conformsToSnapshot(start.payload.state)) throw new Error("Round state does not match immutable Course snapshot.");
  let current = start.payload.state; let lifecycle: Lifecycle = "aiming"; let terminal = false; let replacement: string | null = null; let successorStart: RoundStartPayload | null = null; const shots = new Set<string>();
  for (const [index, entry] of parsed.entries()) { if (entry.roundId !== start.roundId || entry.revision !== index) throw new Error("Invalid Round revision chain."); if (index === 0) continue; if (terminal || replacement !== null || entry.kind === "round-start") throw new Error("Invalid entry after terminal/replacement.");
    if (entry.kind === "shot") { if (!conformsToSnapshot(entry.payload.state) || shots.has(entry.payload.shot.shotId) || entry.payload.shot.preShotLie.x !== current.lie.x || entry.payload.shot.preShotLie.y !== current.lie.y) throw new Error("Incoherent Shot transition."); shots.add(entry.payload.shot.shotId); current = entry.payload.state; lifecycle = entry.payload.shot.terminal === "cup" ? "hole-summary" : "aiming"; }
    if (entry.kind === "checkpoint") { if (!conformsToSnapshot(entry.payload.state) || entry.payload.state.currentHoleIndex !== current.currentHoleIndex || JSON.stringify(entry.payload.state.holeScores) !== JSON.stringify(current.holeScores) || entry.payload.state.lie.x !== current.lie.x || entry.payload.state.lie.y !== current.lie.y) throw new Error("Incoherent checkpoint transition."); current = entry.payload.state; lifecycle = entry.payload.lifecycle; }
    if (entry.kind === "round-terminal") { if (!conformsToSnapshot(entry.payload.state) || (entry.payload.status === "complete" && entry.payload.state.currentHoleIndex !== parsedCourse.value.holes.length - 1)) throw new Error("Incoherent terminal transition."); current = entry.payload.state; terminal = true; lifecycle = "round-summary"; }
    if (entry.kind === "round-replacement") { if (entry.payload.successorRoundId === start.roundId || entry.payload.successorStart.state.status !== "active") throw new Error("Invalid Round replacement."); replacement = entry.payload.successorRoundId; successorStart = entry.payload.successorStart; terminal = true; }
  } return { roundId: start.roundId, revision: parsed.length - 1, state: current, lifecycle, terminal, replacement, successorStart, branchId: start.payload.branchId };
}
export type WriteBoundary = "open" | "write" | "file-sync" | "directory-sync";
export interface RoundStoreOptions { readonly root: string; readonly beforeWrite?: (boundary: WriteBoundary) => Promise<void> | void; readonly afterWrite?: (boundary: WriteBoundary) => Promise<void> | void; }
export class RoundStore {
  readonly #root: string; readonly #before?: RoundStoreOptions["beforeWrite"]; readonly #after?: RoundStoreOptions["afterWrite"];
  public constructor(options: RoundStoreOptions) { this.#root = resolve(options.root); this.#before = options.beforeWrite; this.#after = options.afterWrite; }
  pathFor(roundId: string): string { if (!ROUND_ID.test(roundId)) throw new Error("Invalid Round ID."); const path = resolve(this.#root, `${roundId}.jsonl`); if (dirname(path) !== this.#root || basename(path) !== `${roundId}.jsonl` || !path.startsWith(`${this.#root}${sep}`)) throw new Error("Round path escapes store."); return path; }
  async #boundary(kind: WriteBoundary, after = false): Promise<void> { await (after ? this.#after : this.#before)?.(kind); }
  async append(entry: GolfEntryV1): Promise<void> { const v = parseGolfEntry(entry); const path = this.pathFor(v.roundId); await mkdir(this.#root, { recursive: true }); const existed = await stat(path).then(() => true, () => false); await this.#boundary("open"); const file = await open(path, "a"); await this.#boundary("open", true); try { await this.#boundary("write"); await file.writeFile(`${JSON.stringify(v)}\n`, "utf8"); await this.#boundary("write", true); await this.#boundary("file-sync"); await file.sync(); await this.#boundary("file-sync", true); } finally { await file.close(); } if (!existed) { await this.#boundary("directory-sync"); const directory = await open(this.#root, "r"); try { await directory.sync(); await this.#boundary("directory-sync", true); } finally { await directory.close(); } } }
  async #entries(roundId: string): Promise<unknown[]> { const path = this.pathFor(roundId); if ((await stat(path)).size > MAX_LOG_BYTES) throw new Error("Round log exceeds bound."); const raw = await readFile(path, "utf8"); const lines = raw.split("\n"); lines.pop(); return lines.map((line) => { try { return JSON.parse(line) as unknown; } catch { throw new Error("Malformed committed Round entry."); } }); }
  async read(roundId: string): Promise<ReconstructedRound> { return reconstructRound(await this.#entries(roundId)); }
  /** Strictly exposes only the persisted successor start for replacement association checks. */
  async startEntry(roundId: string): Promise<Extract<ValidGolfEntry, { readonly kind: "round-start" }>> { const first = parseGolfEntry((await this.#entries(roundId))[0]); if (first.kind !== "round-start") throw new Error("Successor lacks round-start."); return first; }
  async entryAt(roundId: string, revision: number): Promise<ValidGolfEntry> { const entries = await this.#entries(roundId); reconstructRound(entries); const entry = entries[revision]; if (entry === undefined) throw new Error("Round revision is absent."); return parseGolfEntry(entry); }
  async hasRound(roundId: string): Promise<boolean> { return stat(this.pathFor(roundId)).then(() => true, () => false); }
  /** Validate the whole authoritative log before selecting the branch's historical prefix. */
  async readAtRevision(roundId: string, revision: number): Promise<ReconstructedRound> { const entries = await this.#entries(roundId); reconstructRound(entries); if (!integer(revision) || revision < 0 || revision >= entries.length) throw new Error("Branch Round reference revision is invalid."); return reconstructRound(entries.slice(0, revision + 1)); }
  async findByBranch(branchId: string): Promise<ReconstructedRound[]> { const names = (await readdir(this.#root).catch(() => [])).filter((n) => /^[a-z0-9][a-z0-9_-]{0,63}\.jsonl$/u.test(n)).sort().slice(0, MAX_ROUND_FILES); const all = await Promise.all(names.map(async (n) => this.read(n.slice(0, -6)).catch(() => { throw new Error("Invalid durable Round log."); }))); return all.filter((round) => round.branchId === branchId); }
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

/** Persist a successor before linking it; recovery only follows a real authoritative successor log. */
export async function appendRoundReplacement(store: RoundStore, args: { readonly predecessorRoundId: string; readonly predecessorRevision: number; readonly successorRoundId: string; readonly successorSnapshot: RoundCourseSnapshot; readonly successorState: PersistedRoundState; readonly branchId: string }): Promise<void> {
  if (args.successorRoundId === args.predecessorRoundId || await store.hasRound(args.successorRoundId)) throw new Error("Successor Round identity is not unique.");
  const successor = await appendRoundStart(store, { roundId: args.successorRoundId, snapshot: args.successorSnapshot, state: args.successorState, branchId: args.branchId });
  if (successor.revision !== 0) throw new Error("Successor Round start is not unique.");
  await store.append({ entryVersion: 1, roundId: args.predecessorRoundId, revision: args.predecessorRevision + 1, kind: "round-replacement", payload: { successorRoundId: args.successorRoundId, successorStartRevision: 0, successorStart: { courseSnapshot: args.successorSnapshot.serializedCourse, state: args.successorState, branchId: args.branchId } } });
}

/** A session authority must survive transient RoundStore wrappers created by command invocations. */
const writers = new Map<string, RoundMutationWriter>();
/** One authority per (store, session, Round); callers cannot independently construct a competing writer. */
export class RoundMutationWriter {
  #tail: Promise<void> = Promise.resolve(); #pendingShotId: string | null = null; #shotCommit: { readonly shotId: string; readonly promise: Promise<number> } | null = null;
  private constructor(private readonly store: RoundStore, private readonly roundId: string, private revision: number) {}
  static forSession(store: RoundStore, sessionId: string, roundId: string, revision: number): RoundMutationWriter { const key = `${sessionId}\u0000${roundId}`; const existing = writers.get(key); if (existing !== undefined) return existing; const writer = new RoundMutationWriter(store, roundId, revision); writers.set(key, writer); return writer; }
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
