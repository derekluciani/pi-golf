import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { FOUNDATION_CONTRACT_VERSION } from "./domain/index.ts";

/** Registers the project-local Pi Golf extension shell directly through Pi's TypeScript loader. */
export default function registerGolfExtension(pi: ExtensionAPI): void {
  pi.registerCommand("golf", {
    description: "Open Pi Golf.",
    handler: async (_args, ctx) => {
      ctx.ui.notify(`Pi Golf foundation v${FOUNDATION_CONTRACT_VERSION} loaded.`, "info");
    },
  });
}
