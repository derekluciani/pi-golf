import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";

import registerGolfExtension from "./index.ts";

describe("project-local extension entrypoint", () => {
  it("imports and registers its command on each load", () => {
    const registerCommand = vi.fn();
    // The extension factory only reads registerCommand; the narrow fake models that boundary.
    const pi = { registerCommand } as unknown as ExtensionAPI;

    expect(() => registerGolfExtension(pi)).not.toThrow();
    expect(() => registerGolfExtension(pi)).not.toThrow();
    expect(registerCommand).toHaveBeenCalledTimes(2);
    expect(registerCommand).toHaveBeenLastCalledWith(
      "golf",
      expect.objectContaining({ description: "Open Pi Golf." }),
    );
  });
});
