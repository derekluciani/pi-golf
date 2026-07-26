import { initTheme, type Theme } from "@earendil-works/pi-coding-agent";
import { beforeAll, describe, expect, it, vi } from "vitest";

import {
  buildCourseSettingsModel,
  createCourseSettingsComponent,
  type CourseDiscoveryResult,
} from "./index.ts";

beforeAll(() => {
  initTheme("dark", false);
});

const theme = {
  fg: (_color: string, text: string) => text,
  bold: (text: string) => text,
} as unknown as Theme;

describe("Golf Settings replacement component", () => {
  it("frames the exact title and renders warnings below the SettingsList", () => {
    const discovery: CourseDiscoveryResult = {
      courses: [],
      warnings: [{
        code: "malformed-json",
        sourcePath: "/project/bad.json",
        message: "Malformed JSON in Course file: /project/bad.json",
        diagnostics: [],
        warnings: [],
      }],
    };
    const model = buildCourseSettingsModel("/project/.pi/golf/courses", discovery, "builtin:preview-course", []);
    const requestRender = vi.fn();
    const onClose = vi.fn();
    const component = createCourseSettingsComponent({
      model,
      theme,
      requestRender,
      onClose,
      onChange: vi.fn(),
    });

    const lines = component.render(80);
    expect(lines[0]).toBe("─".repeat(80));
    expect(lines.some((line) => line.includes("Golf Settings"))).toBe(true);
    const courseIndex = lines.findIndex((line) => line.includes("Course"));
    const warningIndex = lines.findIndex((line) => line.includes("Warning: Malformed JSON"));
    expect(courseIndex).toBeGreaterThan(0);
    expect(warningIndex).toBeGreaterThan(courseIndex);
    expect(lines.at(-1)).toBe("─".repeat(80));

    component.handleInput?.("\u001b");
    expect(onClose).toHaveBeenCalledOnce();
    expect(requestRender).toHaveBeenCalledOnce();
  });

  it("cycles only through selectable Course values and requests rendering", () => {
    const model = buildCourseSettingsModel("/courses", {
      courses: [{
        sourcePath: "/courses/custom.json",
        warnings: [],
        course: {
          schemaVersion: 1,
          id: "custom",
          name: "Custom Course",
          holes: [],
        },
      }],
      warnings: [],
    }, "builtin:preview-course", []);
    const onChange = vi.fn();
    const requestRender = vi.fn();
    const component = createCourseSettingsComponent({
      model,
      theme,
      requestRender,
      onClose: vi.fn(),
      onChange,
    });

    component.handleInput?.(" ");
    expect(onChange).toHaveBeenCalledWith("Custom Course");
    expect(requestRender).toHaveBeenCalledOnce();
  });
});
