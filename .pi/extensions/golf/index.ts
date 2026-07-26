import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import {
  formatCourseLoadIssue,
  selectCourseFromPath,
  showCourseSettings,
} from "./course-loader/index.ts";

const FOUNDATION_MESSAGE = "Pi Golf foundation loaded.";

/** Registers Pi Golf command routing without starting gameplay outside this ticket. */
export default function registerGolfExtension(pi: ExtensionAPI): void {
  pi.registerCommand("golf", {
    description: "Open Pi Golf.",
    handler: async (args, ctx) => {
      const trimmed = args.trim();
      if (trimmed === "course") {
        if (ctx.mode !== "tui") {
          ctx.ui.notify("/golf course requires interactive TUI mode.", "warning");
          return;
        }
        try {
          await showCourseSettings(ctx);
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : "Unknown Course settings failure.";
          ctx.ui.notify(`Could not open Golf Settings: ${message}`, "error");
        }
        return;
      }

      const explicitMatch = /^course\s+([\s\S]+)$/u.exec(trimmed);
      if (explicitMatch !== null) {
        const suppliedPath = explicitMatch[1]?.trim();
        if (suppliedPath === undefined || suppliedPath.length === 0) {
          ctx.ui.notify("Provide a Course JSON path after /golf course.", "error");
          return;
        }
        try {
          const result = await selectCourseFromPath(ctx.cwd, suppliedPath);
          if (!result.ok) {
            ctx.ui.notify(formatCourseLoadIssue(result.issue), "error");
            return;
          }
          ctx.ui.notify(
            `${result.selected.course.name} selected for the next new Round.`,
            "info",
          );
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : "Unknown Course persistence failure.";
          ctx.ui.notify(`Could not save Golf settings: ${message}`, "error");
        }
        return;
      }

      ctx.ui.notify(FOUNDATION_MESSAGE, "info");
    },
  });
}
