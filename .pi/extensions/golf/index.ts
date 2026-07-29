import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { createRoundCourseSnapshot } from "./course-loader/snapshot.ts";
import { captureSelectedCourseSnapshot, formatCourseLoadIssue, PREVIEW_COURSE_SOURCE, readStableCourseFile, selectCourseFromPath, showCourseSettings } from "./course-loader/index.ts";
import { FOUNDATION_CONTRACT_VERSION, parseCourseHoleIndex, parseCourseId, parseShotDirectionIndex } from "./domain/index.ts";
import { bearingToward, quantizeShotDirection } from "./simulation/inputs.ts";
import { appendRoundStart, reconstructActiveBranch, RoundStore } from "./persistence/index.ts";

/**
 * T09 owns only this first-action durability seam. T11 replaces its response and
 * lifecycle policy, but must preserve the ordering: durable round-start precedes gameplay.
 */
export default function registerGolfExtension(pi: ExtensionAPI): void {
  pi.registerCommand("golf", {
    description: "Open Pi Golf.",
    handler: async (args, ctx) => {
      const trimmed = args.trim();
      if (trimmed === "course") {
        if (ctx.mode !== "tui") { ctx.ui.notify("/golf course requires interactive TUI mode.", "warning"); return; }
        try { await showCourseSettings(ctx); } catch (error: unknown) { ctx.ui.notify(`Could not open Golf Settings: ${error instanceof Error ? error.message : "Unknown Course settings failure."}`, "error"); }
        return;
      }
      const explicit = /^course\s+([\s\S]+)$/u.exec(trimmed);
      if (explicit !== null) {
        const path = explicit[1]?.trim();
        if (path === undefined || path.length === 0) { ctx.ui.notify("Provide a Course JSON path after /golf course.", "error"); return; }
        try {
          const result = await selectCourseFromPath(ctx.cwd, path);
          if (!result.ok) { ctx.ui.notify(formatCourseLoadIssue(result.issue), "error"); return; }
          ctx.ui.notify(`${result.selected.course.name} selected for the next new Round.`, "info");
        } catch (error: unknown) { ctx.ui.notify(`Could not save Golf settings: ${error instanceof Error ? error.message : "Unknown Course persistence failure."}`, "error"); }
        return;
      }
      const store = new RoundStore({ root: join(ctx.cwd, ".pi/golf/rounds") });
      const branchId = ctx.sessionManager.getSessionId();
      // getBranch(), rather than compacted LLM context, defines the active Pi branch.
      const recovered = await reconstructActiveBranch(store, ctx.sessionManager.getBranch(), branchId);
      if (recovered === null) {
        const selected = await captureSelectedCourseSnapshot(ctx.cwd);
        const snapshot = selected.sourcePath === PREVIEW_COURSE_SOURCE
          ? await createRoundCourseSnapshot(async () => readFile(new URL("./courses/preview-course.json", import.meta.url)))
          : await createRoundCourseSnapshot(async () => {
            const stable = await readStableCourseFile(selected.sourcePath);
            if (!stable.ok) throw new Error(formatCourseLoadIssue(stable.issue));
            return stable.bytes;
          });
        const firstHole = snapshot.course.holes[0];
        const courseId = parseCourseId(snapshot.course.id);
        const holeIndex = parseCourseHoleIndex(0);
        if (firstHole === undefined || courseId === undefined || holeIndex === undefined) throw new Error("Preview Round start is invalid.");
        const direction = parseShotDirectionIndex(quantizeShotDirection(bearingToward(firstHole.tee, firstHole.cup)));
        if (direction === undefined) throw new Error("Preview Round direction is invalid.");
        // This awaited append is the T09 durability boundary before T11 activates gameplay.
        const roundId = randomUUID();
        const started = await appendRoundStart(store, { roundId, snapshot, branchId, state: { kind: "persisted-round", courseId, currentHoleIndex: holeIndex, lie: firstHole.tee, selectedClub: "driver", shotDirectionIndex: direction, holeScores: [], status: "active" } });
        // Pi's real custom-entry shape is the branch mirror. It is deliberately written
        // only after the authoritative JSONL start; a fork therefore selects its prefix.
        pi.appendEntry("pi-golf-round-v1", { roundId, revision: started.revision });
      }
      ctx.ui.notify(`Pi Golf foundation v${FOUNDATION_CONTRACT_VERSION} durable Round ${recovered === null ? "started" : "recovered"}.`, "info");
    },
  });
}
