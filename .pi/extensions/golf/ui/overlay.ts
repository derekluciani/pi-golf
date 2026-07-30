import type { ExtensionCommandContext, Theme } from "@earendil-works/pi-coding-agent";
import type { Component, KeybindingsManager, TUI } from "@earendil-works/pi-tui";

/** T10 supplies the game component; this shell owns only Pi overlay lifecycle and focus. */
export async function openGolfOverlay<Result>(
  ctx: ExtensionCommandContext,
  createComponent: (tui: TUI, theme: Theme, keybindings: KeybindingsManager, done: (result: Result) => void) => Component,
): Promise<Result | undefined> {
  if (ctx.mode !== "tui") {
    ctx.ui.notify("Pi Golf requires interactive TUI mode.", "warning");
    return undefined;
  }
  return ctx.ui.custom<Result>(createComponent, {
    overlay: true,
    overlayOptions: { anchor: "top-right", margin: 0 },
    onHandle: (handle) => handle.focus(),
  });
}
