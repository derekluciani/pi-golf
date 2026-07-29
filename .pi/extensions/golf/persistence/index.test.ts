import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import type { PersistedRoundState } from "../domain/index.ts";
import { appendRoundReplacement, GOLF_ENTRY_MIGRATIONS, GOLF_BRANCH_REFERENCE_TYPE, RoundMutationWriter, RoundStore, parseGolfEntry, reconstructActiveBranch, reconstructRound, type BranchEntryLike, type GolfEntryV1, type WriteBoundary } from "./index.ts";

const snapshot = JSON.stringify({ schemaVersion: 1, id: "tiny", name: "Tiny", holes: [{ id: "tiny-hole", number: 1, par: 3, boundary: { type: "polygon", points: [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }, { x: 0, y: 4 }] }, tee: { x: 1, y: 1 }, cup: { x: 2, y: 2 }, regions: [{ terrain: "green", shape: { type: "polygon", points: [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }, { x: 0, y: 4 }] } }] }] });
const state = (status: PersistedRoundState["status"] = "active", lie = { x: 1, y: 1 }): PersistedRoundState => ({ kind: "persisted-round", courseId: "tiny" as PersistedRoundState["courseId"], currentHoleIndex: 0 as PersistedRoundState["currentHoleIndex"], lie, selectedClub: "driver", shotDirectionIndex: 0 as PersistedRoundState["shotDirectionIndex"], holeScores: [], status });
const start = (roundId = "round-a", branchId = "session-a"): GolfEntryV1 => ({ entryVersion: 1, roundId, revision: 0, kind: "round-start", payload: { courseSnapshot: snapshot, state: state(), branchId } });
const shot = (revision = 1, shotId = "shot-a"): GolfEntryV1 => ({ entryVersion: 1, roundId: "round-a", revision, kind: "shot", payload: { state: state("active", { x: 2, y: 1 }), shot: { shotId, preShotLie: { x: 1, y: 1 }, inputs: { club: "driver", directionIndex: 0, power: 1 }, landingPosition: { x: 2, y: 1 }, finalPosition: { x: 2, y: 1 }, terminal: "rest", resultingSpeed: 0, elapsed: 1, resultingRound: { lie: { x: 2, y: 1 }, playedStrokes: 1, penaltyStrokes: 0, selectedClub: "driver", directionIndex: 0 } } } });
const completedState = (status: PersistedRoundState["status"] = "active"): PersistedRoundState => ({ ...state(status, { x: 2, y: 2 }), holeScores: [{ hole: { id: "tiny-hole" as never, number: 1 as never, courseIndex: 0 as never }, playedStrokes: 1, penaltyStrokes: 0, completed: true }] });
const cupShot = (revision = 1): GolfEntryV1 => ({ entryVersion: 1, roundId: "round-a", revision, kind: "shot", payload: { state: completedState(), shot: { shotId: "cup-shot", preShotLie: { x: 1, y: 1 }, inputs: { club: "driver", directionIndex: 0, power: 1 }, landingPosition: { x: 2, y: 2 }, finalPosition: { x: 2, y: 2 }, terminal: "cup", resultingSpeed: 0, elapsed: 1, resultingRound: { lie: { x: 2, y: 2 }, playedStrokes: 1, penaltyStrokes: 0, selectedClub: "driver", directionIndex: 0 } } } });
const multiHoleSnapshot = JSON.stringify({ schemaVersion: 1, id: "two-hole", name: "Two Hole", holes: [{ id: "one", number: 1, par: 3, boundary: { type: "polygon", points: [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }, { x: 0, y: 4 }] }, tee: { x: 1, y: 1 }, cup: { x: 2, y: 2 }, regions: [{ terrain: "green", shape: { type: "polygon", points: [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }, { x: 0, y: 4 }] } }] }, { id: "two", number: 2, par: 3, boundary: { type: "polygon", points: [{ x: 5, y: 0 }, { x: 9, y: 0 }, { x: 9, y: 4 }, { x: 5, y: 4 }] }, tee: { x: 6, y: 1 }, cup: { x: 7, y: 2 }, regions: [{ terrain: "green", shape: { type: "polygon", points: [{ x: 5, y: 0 }, { x: 9, y: 0 }, { x: 9, y: 4 }, { x: 5, y: 4 }] } }] }] });
const multiState = (currentHoleIndex: number, lie: { x: number; y: number }, holeScores: PersistedRoundState["holeScores"], status: PersistedRoundState["status"] = "active"): PersistedRoundState => ({ kind: "persisted-round", courseId: "two-hole" as PersistedRoundState["courseId"], currentHoleIndex: currentHoleIndex as PersistedRoundState["currentHoleIndex"], lie, selectedClub: "driver", shotDirectionIndex: 0 as PersistedRoundState["shotDirectionIndex"], holeScores, status });
const firstScore = { hole: { id: "one" as never, number: 1 as never, courseIndex: 0 as never }, playedStrokes: 1, penaltyStrokes: 0, completed: true };
const secondScore = { hole: { id: "two" as never, number: 2 as never, courseIndex: 1 as never }, playedStrokes: 1, penaltyStrokes: 0, completed: true };
const multiStart = (): GolfEntryV1 => ({ entryVersion: 1, roundId: "multi-round", revision: 0, kind: "round-start", payload: { courseSnapshot: multiHoleSnapshot, state: multiState(0, { x: 1, y: 1 }, []), branchId: "multi-session" } });
const multiCupShot = (revision: number, shotId: string, preShotLie: { x: number; y: number }, cup: { x: number; y: number }, stateAfterCup: PersistedRoundState): GolfEntryV1 => ({ entryVersion: 1, roundId: "multi-round", revision, kind: "shot", payload: { state: stateAfterCup, shot: { shotId, preShotLie, inputs: { club: "driver", directionIndex: 0, power: 1 }, landingPosition: cup, finalPosition: cup, terminal: "cup", resultingSpeed: 0, elapsed: 1, resultingRound: { lie: cup, playedStrokes: 1, penaltyStrokes: 0, selectedClub: "driver", directionIndex: 0 } } } });
const branch = (refs: readonly { roundId: string; revision: number }[]): BranchEntryLike[] => [{ type: "session", id: "root", parentId: null, timestamp: "2026-01-01T00:00:00Z" }, ...refs.map((ref, i) => ({ type: "custom", id: `golf-${i}`, parentId: i === 0 ? "root" : `golf-${i - 1}`, timestamp: "2026-01-01T00:00:00Z", customType: GOLF_BRANCH_REFERENCE_TYPE, data: ref }))];
async function fixture(): Promise<{ root: string; store: RoundStore }> { const root = await mkdtemp(join(tmpdir(), "pi-golf-round-")); return { root, store: new RoundStore({ root: join(root, ".pi/golf/rounds") }) }; }

describe("V2-PER durable Round store", () => {
  it("AC-PER-001-02 confines append-only authority beneath .pi/golf/rounds", async () => { const { root, store } = await fixture(); try { await store.append(start()); expect(store.pathFor("round-a")).toBe(join(root, ".pi/golf/rounds/round-a.jsonl")); expect(() => store.pathFor("../settings")).toThrow(); const before = await readFile(store.pathFor("round-a"), "utf8"); await store.append(shot()); expect((await readFile(store.pathFor("round-a"), "utf8")).startsWith(before)).toBe(true); } finally { await rm(root, { recursive: true }); } });
  it("AC-PER-001-05 / AC-PER-003-04 interruption at every append boundary leaves predecessor or committed Shot", async () => { for (const boundary of ["open", "write", "file-sync", "directory-sync"] as const) { const { root, store } = await fixture(); try { await store.append(start()); const interrupted = new RoundStore({ root: join(root, ".pi/golf/rounds"), afterWrite: (at) => { if (at === boundary) throw new Error(`interrupt-${at}`); } }); if (boundary === "directory-sync") await expect(interrupted.append(shot())).resolves.toBeUndefined(); else await expect(interrupted.append(shot())).rejects.toThrow(`interrupt-${boundary}`); const recovered = await store.read("round-a"); expect([0, 1]).toContain(recovered.revision); } finally { await rm(root, { recursive: true }); } } });
  it("AC-PER-003-04 injects interruption after new-file directory sync", async () => { const { root } = await fixture(); try { const interrupted = new RoundStore({ root: join(root, ".pi/golf/rounds"), afterWrite: (at) => { if (at === "directory-sync") throw new Error("interrupt-directory-sync"); } }); await expect(interrupted.append(start())).rejects.toThrow("interrupt-directory-sync"); const recovered = new RoundStore({ root: join(root, ".pi/golf/rounds") }); await expect(recovered.read("round-a")).resolves.toMatchObject({ revision: 0 }); } finally { await rm(root, { recursive: true }); } });
  it("AC-PER-001-05 rejects a malformed committed line but discards an unterminated tail", async () => { const { root, store } = await fixture(); try { await store.append(start()); await writeFile(store.pathFor("round-a"), `${JSON.stringify(start())}\n{`); await expect(store.read("round-a")).resolves.toMatchObject({ revision: 0 }); await writeFile(store.pathFor("round-a"), `${JSON.stringify(start())}\n{bad}\n`); await expect(store.read("round-a")).rejects.toThrow("Malformed committed"); } finally { await rm(root, { recursive: true }); } });
  it("AC-PER-002-01 strictly round-trips every envelope kind", () => { const replacement: GolfEntryV1 = { entryVersion: 1, roundId: "round-a", revision: 1, kind: "round-replacement", payload: { successorRoundId: "round-b", successorStartRevision: 0, successorStart: start("round-b").payload as never } }; for (const entry of [start(), shot(), { entryVersion: 1, roundId: "round-a", revision: 1, kind: "checkpoint", payload: { state: state(), lifecycle: "aiming" } }, { entryVersion: 1, roundId: "round-a", revision: 1, kind: "round-terminal", payload: { status: "complete", state: state("complete") } }, replacement]) expect(parseGolfEntry(JSON.parse(JSON.stringify(entry)))).toEqual(entry); });
  it("AC-PER-002-02 / AC-PER-002-04 reject incoherent semantic chains without older fallback", () => { expect(() => reconstructRound([start(), { ...shot(), revision: 2 }])).toThrow(); expect(() => reconstructRound([start(), { ...shot(), payload: { ...(shot().payload as object), state: state() } }])).toThrow(); expect(() => reconstructRound([{ ...start(), entryVersion: 2 }])).toThrow(); });
  it("AC-PER-002-01 / AC-PER-004-02 / AC-PER-004-03 enforce immutable Course, scoring, cup, and terminal transitions", () => {
    const badInput = { ...shot(), payload: { ...(shot().payload as { shot: object; state: PersistedRoundState }), shot: { ...(shot().payload as { shot: { inputs: object } }).shot, inputs: { club: "putter", directionIndex: 0, power: 1 } } } };
    const badScore = { ...shot(), payload: { ...(shot().payload as { shot: object; state: PersistedRoundState }), state: { ...state("active", { x: 2, y: 1 }), holeScores: [{ hole: { id: "tiny-hole", number: 1, courseIndex: 0 }, playedStrokes: 1, penaltyStrokes: 0, completed: true }] } } };
    const terminal: GolfEntryV1 = { entryVersion: 1, roundId: "round-a", revision: 1, kind: "round-terminal", payload: { status: "complete", state: state("complete") } };
    expect(() => reconstructRound([start(), badInput])).toThrow("Incoherent Shot");
    expect(() => reconstructRound([start(), badScore])).toThrow("Incoherent non-cup");
    expect(() => reconstructRound([start(), terminal])).toThrow("Incoherent terminal");
  });
  it("AC-PER-002-03 has an explicit empty V2 migration registry", () => { expect(GOLF_ENTRY_MIGRATIONS.size).toBe(0); expect(() => parseGolfEntry({ ...start(), entryVersion: 0 })).toThrow(); });
  it("AC-PER-003-01 / AC-PER-003-03 scope one writer and retain failed shot identity for exact retry", async () => { const { root, store } = await fixture(); try { await store.append(start()); let fail = true; const flaky = new RoundStore({ root: join(root, ".pi/golf/rounds"), beforeWrite: (at) => { if (fail && at === "write") throw new Error("disk failure"); } }); const one = await RoundMutationWriter.forSession(flaky, "session-a", "round-a", 0); const same = await RoundMutationWriter.forSession(flaky, "session-a", "round-a", 0); expect(same).toBe(one); await expect(one.commitShot((shot().payload as { shot: never }).shot, state("active", { x: 2, y: 1 }))).rejects.toThrow("disk failure"); expect(one.pendingShotId).toBe("shot-a"); await expect(one.commitShot((shot(1, "shot-b").payload as { shot: never }).shot, state())).rejects.toThrow("Another Shot"); fail = false; await expect(one.commitShot((shot().payload as { shot: never }).shot, state("active", { x: 2, y: 1 }))).resolves.toBe(1); expect((await store.read("round-a")).revision).toBe(1); } finally { await rm(root, { recursive: true }); } });
  it("AC-PER-003-01 reconciles a transient wrapper only against its authoritative recovered revision", async () => { const { root, store } = await fixture(); try { await store.append(start()); const writer = await RoundMutationWriter.forSession(store, "recovery-session", "round-a", 0); await writer.commitShot((shot().payload as { shot: never }).shot, state("active", { x: 2, y: 1 })); await expect(RoundMutationWriter.forSession(new RoundStore({ root: join(root, ".pi/golf/rounds") }), "recovery-session", "round-a", 0)).rejects.toThrow("Recovered Round revision"); await expect(RoundMutationWriter.forSession(new RoundStore({ root: join(root, ".pi/golf/rounds") }), "recovery-session", "round-a", 1)).resolves.toBe(writer); } finally { await rm(root, { recursive: true }); } });
  it("AC-PER-001-05 / AC-PER-003-03 reconciles an uncertain existing-log Shot at write and file-sync before retry", async () => { const { root, store } = await fixture(); try { for (const boundary of ["write", "file-sync"] as const) { await store.append(start(`round-${boundary}`, `session-${boundary}`)); let fail = true; const interrupted = new RoundStore({ root: join(root, ".pi/golf/rounds"), afterWrite: (at) => { if (fail && at === boundary) { fail = false; throw new Error(`late-${boundary}`); } } }); const writer = await RoundMutationWriter.forSession(interrupted, `session-${boundary}`, `round-${boundary}`, 0); const candidate = { ...shot(1, `shot-${boundary}`), roundId: `round-${boundary}` }; await expect(writer.commitShot((candidate.payload as { shot: never }).shot, state("active", { x: 2, y: 1 }))).resolves.toBe(1); expect((await store.read(`round-${boundary}`)).revision).toBe(1); expect((await readFile(store.pathFor(`round-${boundary}`), "utf8")).trim().split("\n")).toHaveLength(2); } } finally { await rm(root, { recursive: true }); } });
  it("AC-PER-004-01 / AC-PER-004-02 reject aiming-to-summary holes and require a validated Cup predecessor", () => {
    const impossibleSummary: GolfEntryV1 = { entryVersion: 1, roundId: "round-a", revision: 1, kind: "checkpoint", payload: { state: state(), lifecycle: "hole-summary" } };
    const aiming: GolfEntryV1 = { entryVersion: 1, roundId: "round-a", revision: 1, kind: "checkpoint", payload: { state: { ...state(), selectedClub: "putter" }, lifecycle: "aiming" } };
    const terminal: GolfEntryV1 = { entryVersion: 1, roundId: "round-a", revision: 2, kind: "round-terminal", payload: { status: "complete", state: completedState("complete") } };
    expect(() => reconstructRound([start(), impossibleSummary])).toThrow("Incoherent aiming checkpoint");
    expect(reconstructRound([start(), aiming])).toMatchObject({ lifecycle: "aiming", state: expect.objectContaining({ selectedClub: "putter" }) });
    expect(reconstructRound([start(), cupShot(), terminal])).toMatchObject({ lifecycle: "round-summary", terminal: true });
    expect(() => reconstructRound([start(), terminal, shot(3)])).toThrow();
  });
  it("AC-PER-004-02 injects deterministic multi-Hole faults at Cup, summary, advancement, and terminal boundaries", async () => {
    const holeOneSummary = multiState(0, { x: 2, y: 2 }, [firstScore]);
    const holeTwoAiming = multiState(1, { x: 6, y: 1 }, [firstScore]);
    const finalHoleSummary = multiState(1, { x: 7, y: 2 }, [firstScore, secondScore]);
    const finalRoundSummary = multiState(1, { x: 7, y: 2 }, [firstScore, secondScore], "complete");
    const entries: readonly GolfEntryV1[] = [
      multiStart(),
      multiCupShot(1, "multi-cup-one", { x: 1, y: 1 }, { x: 2, y: 2 }, holeOneSummary),
      { entryVersion: 1, roundId: "multi-round", revision: 2, kind: "checkpoint", payload: { state: holeOneSummary, lifecycle: "hole-summary" } },
      { entryVersion: 1, roundId: "multi-round", revision: 3, kind: "checkpoint", payload: { state: holeTwoAiming, lifecycle: "aiming" } },
      multiCupShot(4, "multi-cup-two", { x: 6, y: 1 }, { x: 7, y: 2 }, finalHoleSummary),
      { entryVersion: 1, roundId: "multi-round", revision: 5, kind: "round-terminal", payload: { status: "complete", state: finalRoundSummary } },
    ];
    const cases = [
      { name: "before Cup playback", index: 1, phase: "before" },
      { name: "after Cup playback", index: 1, phase: "after" },
      { name: "Hole summary", index: 2, phase: "before" },
      { name: "Hole advancement", index: 3, phase: "after" },
      { name: "final Cup summary", index: 4, phase: "before" },
      { name: "final summary terminal", index: 5, phase: "after" },
    ] as const;
    const lifecycle = ["aiming", "hole-summary", "hole-summary", "aiming", "hole-summary", "round-summary"] as const;
    for (const fault of cases) {
      const { root, store } = await fixture();
      try {
        for (let index = 0; index < fault.index; index += 1) { const entry = entries[index]; if (entry === undefined) throw new Error("Missing multi-Hole fixture entry."); await store.append(entry); }
        let injected = false;
        const interrupted = new RoundStore({ root: join(root, ".pi/golf/rounds"), [fault.phase === "before" ? "beforeWrite" : "afterWrite"]: (boundary: WriteBoundary) => {
          if (!injected && boundary === "write") { injected = true; throw new Error(`interrupt-${fault.name}`); }
        } });
        const interruptedEntry = entries[fault.index]; if (interruptedEntry === undefined) throw new Error("Missing interrupted fixture entry.");
        await expect(interrupted.append(interruptedEntry)).rejects.toThrow(`interrupt-${fault.name}`);
        const reconstructed = new RoundStore({ root: join(root, ".pi/golf/rounds") });
        const committedRevision = fault.phase === "after" ? fault.index : fault.index - 1;
        const committed = await reconstructed.read("multi-round");
        expect(committed).toMatchObject({ revision: committedRevision, lifecycle: lifecycle[committedRevision], terminal: committedRevision === 5 });
        // A pre-write interruption retries its one pending transition. An after-write error is
        // uncertain but durable, so it advances only to the next pending transition.
        const retryIndex = fault.phase === "before" ? fault.index : fault.index + 1;
        if (retryIndex < entries.length) { const retry = entries[retryIndex]; if (retry === undefined) throw new Error("Missing retry fixture entry."); await reconstructed.append(retry); }
        const expectedRevision = retryIndex < entries.length ? retryIndex : committedRevision;
        const recovered = await reconstructed.read("multi-round");
        const expectedScores = expectedRevision >= 4 ? 2 : expectedRevision >= 1 ? 1 : 0;
        const expectedShots = expectedRevision >= 4 ? 2 : expectedRevision >= 1 ? 1 : 0;
        expect(recovered).toMatchObject({ revision: expectedRevision, lifecycle: lifecycle[expectedRevision], terminal: expectedRevision === 5, state: { currentHoleIndex: expectedRevision >= 3 ? 1 : 0 } });
        expect(recovered.state.holeScores).toHaveLength(expectedScores);
        expect(new Set(recovered.state.holeScores.map((score) => score.hole.id)).size).toBe(expectedScores);
        expect(recovered.state.holeScores.reduce((roundScore, score) => roundScore + score.playedStrokes + score.penaltyStrokes, 0)).toBe(expectedScores);
        const durable = await Promise.all(Array.from({ length: expectedRevision + 1 }, (_, revision) => reconstructed.entryAt("multi-round", revision)));
        const durableShots = durable.filter((entry) => entry.kind === "shot");
        expect(durable).toHaveLength(expectedRevision + 1);
        expect(durableShots).toHaveLength(expectedShots);
        expect(new Set(durableShots.map((entry) => entry.kind === "shot" ? entry.payload.shot.shotId : "")).size).toBe(expectedShots);
      } finally { await rm(root, { recursive: true }); }
    }
  });
  it("AC-PER-004-04 requires an atomic identifiable successor and rejects predecessor resurrection", () => { const replacement: GolfEntryV1 = { entryVersion: 1, roundId: "round-a", revision: 1, kind: "round-replacement", payload: { successorRoundId: "round-b", successorStartRevision: 0, successorStart: start("round-b").payload as never } }; expect(reconstructRound([start(), replacement])).toMatchObject({ terminal: true, replacement: "round-b" }); expect(() => reconstructRound([start(), { ...replacement, payload: { successorRoundId: "round-b", successorStartRevision: 0 } }, shot(2)])).toThrow(); });
  it("AC-PER-004-04 successor-side open/write/file-sync/directory-sync interruptions retry to one linked active successor", async () => { const { root } = await fixture(); try { for (const boundary of ["open", "write", "file-sync", "directory-sync"] as const) {
      const rootPath = join(root, `.pi/golf/rounds-${boundary}`); const base = new RoundStore({ root: rootPath }); await base.append(start()); let boundaryCalls = 0;
      const interrupted = new RoundStore({ root: rootPath, afterWrite: (at) => { if (at === boundary && ++boundaryCalls === (boundary === "directory-sync" ? 1 : 2)) throw new Error(`interrupt-successor-${boundary}`); } });
      const args = { predecessorRoundId: "round-a", predecessorRevision: 0, successorRoundId: "round-b", successorSnapshot: { serializedCourse: snapshot } as never, successorState: state(), branchId: "session-a" };
      if (boundary === "open") await expect(appendRoundReplacement(interrupted, args)).rejects.toThrow(`interrupt-successor-${boundary}`);
      else await expect(appendRoundReplacement(interrupted, args)).resolves.toBeUndefined();
      await expect(appendRoundReplacement(interrupted, args)).resolves.toBeUndefined();
      const recovered = new RoundStore({ root: rootPath });
      await expect(reconstructActiveBranch(recovered, branch([{ roundId: "round-a", revision: 1 }]), "session-a")).resolves.toMatchObject({ roundId: "round-b", revision: 0, terminal: false });
      expect((await readFile(recovered.pathFor("round-a"), "utf8")).trim().split("\n")).toHaveLength(2);
      expect((await readFile(recovered.pathFor("round-b"), "utf8")).trim().split("\n")).toHaveLength(1);
      await expect(reconstructActiveBranch(recovered, [], "session-a")).resolves.toMatchObject({ roundId: "round-b" });
    } } finally { await rm(root, { recursive: true }); } });
  it("AC-PER-001-03 / AC-PER-005-01 uses actual Pi getBranch entry shape for fork-before and fork-after Shot", async () => { const { root, store } = await fixture(); try { await store.append(start()); await store.append(shot()); await expect(reconstructActiveBranch(store, branch([{ roundId: "round-a", revision: 0 }]), "other-session")).resolves.toMatchObject({ revision: 0 }); await expect(reconstructActiveBranch(store, branch([{ roundId: "round-a", revision: 0 }, { roundId: "round-a", revision: 1 }]), "other-session")).resolves.toMatchObject({ revision: 1 }); const malformed = branch([{ roundId: "round-a", revision: 1 }]).at(0); if (malformed === undefined) throw new Error("Expected branch root."); await expect(reconstructActiveBranch(store, [{ ...malformed, type: "custom", customType: GOLF_BRANCH_REFERENCE_TYPE, data: {} }], "session-a")).rejects.toThrow("Malformed Golf"); } finally { await rm(root, { recursive: true }); } });
  it("AC-PER-005-02 ignores compaction but validates getBranch references", async () => { const { root, store } = await fixture(); try { await store.append(start()); const compacted: BranchEntryLike[] = [{ type: "session", id: "root", parentId: null, timestamp: "x" }, { type: "compaction", id: "compact", parentId: "root", timestamp: "x" }, { ...(branch([{ roundId: "round-a", revision: 0 }]).at(1) ?? (() => { throw new Error("Expected branch reference."); })()), parentId: "compact" }]; await expect(reconstructActiveBranch(store, compacted, "wrong-session")).resolves.toMatchObject({ roundId: "round-a" }); } finally { await rm(root, { recursive: true }); } });
  it("AC-PER-005-03 deterministic reconstruction persists no intro, notice, meter, committing, or playback state", () => {
    const terminal: GolfEntryV1 = { entryVersion: 1, roundId: "round-a", revision: 2, kind: "round-terminal", payload: { status: "complete", state: completedState("complete") } };
    const canonical = [[start()], [start(), cupShot()], [start(), cupShot(), terminal]];
    expect(canonical.map((entries) => reconstructRound(entries).lifecycle)).toEqual(["aiming", "hole-summary", "round-summary"]);
    for (const entries of canonical) expect(Object.keys(reconstructRound(entries).state).sort()).toEqual(["courseId", "currentHoleIndex", "holeScores", "kind", "lie", "selectedClub", "shotDirectionIndex", "status"]);
    expect(() => parseGolfEntry({ ...start(), payload: { ...start().payload as object, intro: true } })).toThrow("Invalid Golf entry");
  });
  it("AC-PER-005-04 newest invalid Round fails visibly and closed", async () => { const { root, store } = await fixture(); try { await store.append(start()); await writeFile(store.pathFor("round-a"), `${JSON.stringify(start())}\n{bad}\n`); await expect(reconstructActiveBranch(store, [], "session-a")).rejects.toThrow(); } finally { await rm(root, { recursive: true }); } });
});
