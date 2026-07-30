import type { ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";
import type { Component, KeybindingsManager, TUI } from "@earendil-works/pi-tui";

import { openGolfOverlay } from "../../.pi/extensions/golf/ui/overlay.ts";

const OVERLAY_WIDTH = 80;

/**
 * Explicit-only evidence harness for AC-REN-003-01. It is not discovered as a
 * product extension and invokes the checked-in T08 overlay shell directly.
 */
export default function registerT08OverlayProof(pi: ExtensionAPI): void {
  pi.on("session_start", async (_event, ctx) => {
    if (ctx.mode === "tui") return;
    const result = await openGolfOverlay(ctx, createProofComponent);
    process.stdout.write(`AC-REN-003-01 non-TUI: mode=${ctx.mode}; overlay result=${String(result)}; interactive TUI required.\n`);
    process.exit(0);
  });

  pi.registerCommand("t08-overlay-proof", {
    description: "Run the explicit V2-T08 overlay evidence harness.",
    handler: async (_args, ctx) => {
      // This visible prefill makes the post-close editor-input observation concrete.
      ctx.ui.setEditorText("prior-focus:");
      await openGolfOverlay(ctx, createProofComponent);
    },
  });
}

function createProofComponent(_tui: TUI, _theme: Theme, _keybindings: KeybindingsManager, done: (result: undefined) => void): Component {
  let received = "waiting for k";
  return {
    render: (width) => {
      const text = `T08 OVERLAY | keyboard: ${received} | x closes`;
      const line = `${text.slice(0, Math.min(width, OVERLAY_WIDTH) - 1).padEnd(Math.min(width, OVERLAY_WIDTH) - 1)}R`;
      return [line];
    },
    handleInput: (data) => {
      if (data === "k") received = "received k";
      if (data === "x") done(undefined);
    },
    invalidate: () => {},
  };
}
