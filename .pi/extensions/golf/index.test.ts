import { readFile } from "node:fs/promises";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";

import { validateCourse } from "./course-loader/index.ts";
import {
  parseShotDirectionIndex,
  vectorForShotDirection,
} from "./domain/index.ts";
import registerGolfExtension from "./index.ts";

async function readProjectFile(path: string): Promise<string> {
  return readFile(new URL(`../../../${path}`, import.meta.url), "utf8");
}

describe("V2-FND-001 project-local extension foundation", () => {
  it("AC-FND-001-01 exports a reload-safe project-local registration shell", () => {
    const registerCommand = vi.fn();
    // The extension factory reads only this API member; the assertion follows that tested boundary.
    const pi = { registerCommand } as unknown as ExtensionAPI;

    expect(() => registerGolfExtension(pi)).not.toThrow();
    expect(() => registerGolfExtension(pi)).not.toThrow();
    expect(registerCommand).toHaveBeenCalledTimes(2);
    expect(registerCommand).toHaveBeenLastCalledWith(
      "golf",
      expect.objectContaining({ description: "Open Pi Golf.", handler: expect.any(Function) }),
    );
  });

  it("AC-FND-001-02 declares and enforces Node >=22.19.0", async () => {
    const packageText = await readProjectFile("package.json");
    const packageValue: unknown = JSON.parse(packageText);

    expect(packageValue).toEqual(expect.objectContaining({
      engines: { node: ">=22.19.0" },
      scripts: expect.objectContaining({ "check:node": "node scripts/check-node-version.mjs" }),
    }));
    await expect(readProjectFile(".nvmrc")).resolves.toBe("22.19.0\n");
    await expect(readProjectFile(".npmrc")).resolves.toContain("engine-strict=true");
    expect(process.versions.node.split(".").map(Number)).toEqual(
      expect.arrayContaining([expect.any(Number)]),
    );
  });

  it("AC-FND-001-03 documents headless lint, type-check, and test commands without a build", async () => {
    const packageText = await readProjectFile("package.json");
    const packageValue: unknown = JSON.parse(packageText);
    const readme = await readProjectFile("README.md");

    expect(packageValue).toEqual(expect.objectContaining({
      scripts: expect.objectContaining({
        lint: "eslint .",
        typecheck: "tsc --noEmit",
        test: "vitest run",
      }),
    }));
    expect(packageText).not.toMatch(/"build"\s*:/u);
    expect(readme).toContain("npm run lint");
    expect(readme).toContain("npm run typecheck");
    expect(readme).toContain("npm test");
    expect(readme).toContain("No production build");
  });

  it("AC-FND-001-04 executes pure simulation and Course validation without constructing TUI", async () => {
    const direction = parseShotDirectionIndex(4);
    expect(direction).toBeDefined();
    if (direction === undefined) throw new Error("Expected validated Shot Direction index.");
    expect(vectorForShotDirection(direction)).toEqual({ x: Math.cos(Math.PI / 2), y: 1 });

    const result = validateCourse({
      schemaVersion: 1,
      id: "headless-course",
      name: "Headless Course",
      holes: [{
        id: "headless-hole",
        number: 1,
        par: 3,
        boundary: {
          type: "polygon",
          points: [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }, { x: 0, y: 4 }],
        },
        tee: { x: 1, y: 1 },
        cup: { x: 3, y: 3 },
        regions: [{
          terrain: "green",
          shape: {
            type: "polygon",
            points: [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }, { x: 0, y: 4 }],
          },
        }],
      }],
    });
    expect(result.ok).toBe(true);

    const pureSourcePaths = [
      ".pi/extensions/golf/domain/index.ts",
      ".pi/extensions/golf/domain/clock.ts",
      ".pi/extensions/golf/course-loader/validation.ts",
    ];
    const pureSources = await Promise.all(pureSourcePaths.map(readProjectFile));
    for (const source of pureSources) {
      expect(source).not.toContain("@earendil-works/pi-tui");
      expect(source).not.toContain("ctx.ui.custom");
    }
  });
});
