import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { formatCourseLoadIssue, playSelectedMinimalCourseAndReturnToPreview, selectCourseFromPath, showCourseSettings } from "./course-loader/index.ts";
import { runGolfRoundCommand } from "./command-round.ts";

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
      if (trimmed === "proof-minimal-course") {
        try {
          const result = await playSelectedMinimalCourseAndReturnToPreview(ctx.cwd);
          ctx.ui.notify(`${result.courseName} proof play completed (${result.rasterCellCount} raster cells); returned to Preview Course.`, "info");
        } catch (error: unknown) {
          ctx.ui.notify(`Minimal Course proof did not run; selection was left unchanged: ${error instanceof Error ? error.message : "Unknown Course proof failure."}`, "error");
        }
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
      if (trimmed !== "" && trimmed !== "new") {
        ctx.ui.notify("Usage: /golf or /golf new.", "warning");
        return;
      }
      try {
        await runGolfRoundCommand(pi, ctx, trimmed === "new");
      } catch (error: unknown) {
        ctx.ui.notify(`Could not open Pi Golf: ${error instanceof Error ? error.message : "Unknown Round failure."}`, "error");
      }
    },
  });
}
