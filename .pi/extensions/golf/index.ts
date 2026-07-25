import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/** Registers the project-local Pi Golf extension foundation. */
export default function registerGolfExtension(pi: ExtensionAPI): void {
  pi.registerCommand("golf", {
    description: "Open Pi Golf.",
    handler: async (_args, ctx) => {
      ctx.ui.notify("Pi Golf foundation loaded.", "info");
    },
  });
}
