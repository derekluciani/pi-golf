import { initTheme, type Theme } from "@earendil-works/pi-coding-agent";
import { beforeAll, describe, expect, it, vi } from "vitest";

import {
  buildCourseSettingsModel,
  createCourseSettingsComponent,
  type CourseDiscoveryResult,
  type CourseSettingsComponent,
  type SelectedCourseSnapshot,
} from "./index.ts";

beforeAll(() => {
  initTheme("dark", false);
});

const theme = {
  fg: (_color: string, text: string) => text,
  bold: (text: string) => text,
} as unknown as Theme;

function previewSnapshot(): SelectedCourseSnapshot {
  return {
    course: { schemaVersion: 1, id: "preview-course", name: "Preview Course", holes: [] },
    sourcePath: "builtin:preview-course",
    usedPreviewFallback: false,
    warnings: [],
    courseWarnings: [],
  };
}

function discoveredCourses(...names: string[]): CourseDiscoveryResult {
  return {
    courses: names.map((name) => ({
      sourcePath: `/courses/${name.toLowerCase()}.json`,
      warnings: [],
      course: {
        schemaVersion: 1,
        id: `${name.toLowerCase()}-course`,
        name,
        holes: [],
      },
    })),
    warnings: [],
  };
}

interface Deferred {
  readonly promise: Promise<void>;
  readonly resolve: () => void;
  readonly reject: (error: Error) => void;
}

function deferred(): Deferred {
  let resolvePromise: (() => void) | undefined;
  let rejectPromise: ((error: Error) => void) | undefined;
  const promise = new Promise<void>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return {
    promise,
    resolve: () => resolvePromise?.(),
    reject: (error) => rejectPromise?.(error),
  };
}

async function flushPromises(): Promise<void> {
  await new Promise<void>((resolve) => queueMicrotask(resolve));
  await new Promise<void>((resolve) => queueMicrotask(resolve));
}

function renderedText(component: CourseSettingsComponent): string {
  const escape = String.fromCharCode(27);
  return component.render(80).join("\n").split(escape).map((segment, index) =>
    index === 0 ? segment : segment.replace(/^\[[0-9;]*m/u, "")).join("");
}

function interactiveComponent(
  changes: readonly Deferred[],
  onClose = vi.fn(),
): {
  readonly component: CourseSettingsComponent;
  readonly persistedValues: string[];
  readonly errors: string[];
  readonly onClose: ReturnType<typeof vi.fn>;
} {
  const model = buildCourseSettingsModel(
    "/courses",
    discoveredCourses("Alpha", "Bravo", "Charlie"),
    previewSnapshot(),
  );
  const persistedValues: string[] = [];
  const errors: string[] = [];
  const component = createCourseSettingsComponent({
    model,
    theme,
    requestRender: vi.fn(),
    onClose,
    onError: (message) => errors.push(message),
    onChange: (value) => {
      persistedValues.push(value);
      const pending = changes[persistedValues.length - 1];
      if (pending === undefined) throw new Error("Missing deferred persistence result.");
      return pending.promise;
    },
  });
  return { component, persistedValues, errors, onClose };
}

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
    const model = buildCourseSettingsModel(
      "/project/.pi/golf/courses",
      discovery,
      previewSnapshot(),
    );
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

  it("cycles only through selectable Course values and requests rendering", async () => {
    const model = buildCourseSettingsModel(
      "/courses",
      discoveredCourses("Custom Course"),
      previewSnapshot(),
    );
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
    await component.waitForPendingChanges();
    expect(onChange).toHaveBeenCalledWith("Custom Course");
    expect(requestRender).toHaveBeenCalled();
    expect(renderedText(component)).toContain("Course  Custom Course");
  });

  it("serializes rapid callbacks, reconciles a failed middle write, and defers close", async () => {
    const first = deferred();
    const middle = deferred();
    const final = deferred();
    const { component, persistedValues, errors, onClose } = interactiveComponent([
      first, middle, final,
    ]);

    component.handleInput?.(" ");
    component.handleInput?.(" ");
    component.handleInput?.(" ");
    component.handleInput?.("\u001b");
    await flushPromises();

    expect(persistedValues).toEqual(["Alpha"]);
    expect(renderedText(component)).toContain("Course  Preview Course");
    expect(renderedText(component)).toContain("Saving Course selection");
    expect(onClose).not.toHaveBeenCalled();

    first.resolve();
    await flushPromises();
    expect(persistedValues).toEqual(["Alpha", "Bravo"]);
    expect(renderedText(component)).toContain("Course  Alpha");

    middle.reject(new Error("middle write failed"));
    await flushPromises();
    expect(persistedValues).toEqual(["Alpha", "Bravo", "Charlie"]);
    expect(renderedText(component)).toContain("Course  Alpha");
    expect(renderedText(component)).toContain("middle write failed");
    expect(errors).toEqual(["Could not save Golf settings: middle write failed"]);
    expect(onClose).not.toHaveBeenCalled();

    final.resolve();
    await component.waitForPendingChanges();
    expect(renderedText(component)).toContain("Course  Charlie");
    expect(renderedText(component)).not.toContain("Error:");
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("restores the last committed value after a final failure without rejecting", async () => {
    const first = deferred();
    const final = deferred();
    const { component, errors } = interactiveComponent([first, final]);

    component.handleInput?.(" ");
    component.handleInput?.(" ");
    await flushPromises();
    first.resolve();
    await flushPromises();
    final.reject(new Error("final write failed"));

    await expect(component.waitForPendingChanges()).resolves.toBeUndefined();
    const rendered = renderedText(component);
    expect(rendered).toContain("Course  Alpha");
    expect(rendered).not.toContain("Course  Bravo");
    expect(rendered).toContain("Error: Could not save Golf settings: final write failed");
    expect(errors).toEqual(["Could not save Golf settings: final write failed"]);
  });

  it("rebuilds pre-themed title and warnings when the theme is invalidated", () => {
    let palette = "old";
    const changingTheme = {
      fg: (color: string, text: string) => `<${palette}:${color}>${text}</${palette}:${color}>`,
      bold: (text: string) => `<bold>${text}</bold>`,
    } as unknown as Theme;
    const model = buildCourseSettingsModel("/courses", {
      courses: [],
      warnings: [{
        code: "malformed-json",
        sourcePath: "/courses/bad.json",
        message: "Malformed JSON in Course file: /courses/bad.json",
        diagnostics: [],
        warnings: [],
      }],
    }, previewSnapshot());
    const component = createCourseSettingsComponent({
      model,
      theme: changingTheme,
      requestRender: vi.fn(),
      onClose: vi.fn(),
      onChange: vi.fn(),
    });

    const oldRender = renderedText(component);
    expect(oldRender).toContain("<old:accent><bold>Golf Settings</bold></old:accent>");
    expect(oldRender).toContain("<old:warning>Warning: Malformed JSON");

    palette = "new";
    component.invalidate();
    const newRender = renderedText(component);
    expect(newRender).toContain("<new:accent><bold>Golf Settings</bold></new:accent>");
    expect(newRender).toContain("<new:warning>Warning: Malformed JSON");
    expect(newRender).not.toContain("<old:");
    expect(newRender.split("\n")[0]).toContain("<new:accent>");
    expect(newRender.split("\n").at(-1)).toContain("<new:accent>");
  });
});
