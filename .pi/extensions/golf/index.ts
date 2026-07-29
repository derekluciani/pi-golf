import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { createRoundCourseSnapshot } from "./course-loader/snapshot.ts";
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
    handler: async (_args, ctx) => {
      const store = new RoundStore({ root: join(ctx.cwd, ".pi/golf/rounds") });
      const branchId = ctx.sessionManager.getSessionId();
      // getBranch(), rather than compacted LLM context, defines the active Pi branch.
      const recovered = await reconstructActiveBranch(store, ctx.sessionManager.getBranch(), branchId);
      if (recovered === null) {
        const snapshot = await createRoundCourseSnapshot(async () => readFile(new URL("./courses/preview-course.json", import.meta.url)));
        const firstHole = snapshot.course.holes[0];
        const courseId = parseCourseId(snapshot.course.id);
        const holeIndex = parseCourseHoleIndex(0);
        if (firstHole === undefined || courseId === undefined || holeIndex === undefined) throw new Error("Preview Round start is invalid.");
        const direction = parseShotDirectionIndex(quantizeShotDirection(bearingToward(firstHole.tee, firstHole.cup)));
        if (direction === undefined) throw new Error("Preview Round direction is invalid.");
        // This awaited append is the T09 durability boundary before T11 activates gameplay.
        await appendRoundStart(store, { roundId: randomUUID(), snapshot, branchId, state: { kind: "persisted-round", courseId, currentHoleIndex: holeIndex, lie: firstHole.tee, selectedClub: "driver", shotDirectionIndex: direction, holeScores: [], status: "active" } });
      }
      ctx.ui.notify(`Pi Golf foundation v${FOUNDATION_CONTRACT_VERSION} durable Round ${recovered === null ? "started" : "recovered"}.`, "info");
    },
  });
}
