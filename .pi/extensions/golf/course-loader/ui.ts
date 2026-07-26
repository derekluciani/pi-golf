import {
  DynamicBorder,
  getSettingsListTheme,
  type ExtensionCommandContext,
  type Theme,
} from "@earendil-works/pi-coding-agent";
import {
  Container,
  SettingsList,
  Text,
  type Component,
  type SettingItem,
} from "@earendil-works/pi-tui";
import { relative } from "node:path";

import {
  discoverCourses,
  formatCourseLoadIssue,
  type CourseDiscoveryResult,
  type LoadedCourseFile,
} from "./loading.ts";
import {
  captureSelectedCourseSnapshot,
  selectLoadedCourse,
  type CourseSelectionWarning,
} from "./selection.ts";
import { getCourseProjectPaths, type CourseSettingsIssue } from "./settings.ts";

export const GOLF_SETTINGS_TITLE = "Golf Settings";
export const COURSE_SETTING_ID = "course";
export const COURSE_SETTING_LABEL = "Course";

export interface CourseSettingOption {
  readonly label: string;
  readonly courseId: string;
  readonly sourcePath: string;
  readonly loaded: LoadedCourseFile | "preview";
}

export interface CourseSettingsModel {
  readonly title: typeof GOLF_SETTINGS_TITLE;
  readonly items: readonly SettingItem[];
  readonly options: readonly CourseSettingOption[];
  readonly warningLines: readonly string[];
}

function selectionWarningText(warning: CourseSettingsIssue | CourseSelectionWarning): string {
  if ("settingsPath" in warning) return warning.message;
  if (warning.loadIssue === undefined) return warning.message;
  return `${warning.message}\n${formatCourseLoadIssue(warning.loadIssue)}`;
}

function uniqueCourseLabels(
  coursesDirectory: string,
  courses: readonly LoadedCourseFile[],
): readonly string[] {
  const nameCounts = new Map<string, number>();
  for (const loaded of courses) {
    nameCounts.set(loaded.course.name, (nameCounts.get(loaded.course.name) ?? 0) + 1);
  }

  const used = new Set(["Preview Course"]);
  return courses.map((loaded) => {
    const duplicateName = (nameCounts.get(loaded.course.name) ?? 0) > 1
      || used.has(loaded.course.name);
    const base = duplicateName
      ? `${loaded.course.name} — ${relative(coursesDirectory, loaded.sourcePath)}`
      : loaded.course.name;
    let label = base;
    let suffix = 2;
    while (used.has(label)) {
      label = `${base} (${suffix})`;
      suffix += 1;
    }
    used.add(label);
    return label;
  });
}

/** Builds the inspectable single-setting model separately from terminal rendering. */
export function buildCourseSettingsModel(
  coursesDirectory: string,
  discovery: CourseDiscoveryResult,
  selectedSourcePath: string,
  selectionWarnings: readonly (CourseSettingsIssue | CourseSelectionWarning)[],
): CourseSettingsModel {
  const labels = uniqueCourseLabels(coursesDirectory, discovery.courses);
  const options: CourseSettingOption[] = [{
    label: "Preview Course",
    courseId: "preview-course",
    sourcePath: "builtin:preview-course",
    loaded: "preview",
  }];
  discovery.courses.forEach((loaded, index) => {
    const label = labels[index];
    if (label === undefined) throw new Error("Missing deterministic Course label.");
    options.push({
      label,
      courseId: loaded.course.id,
      sourcePath: loaded.sourcePath,
      loaded,
    });
  });
  const selected = options.find((option) => option.sourcePath === selectedSourcePath) ?? options[0];
  if (selected === undefined) throw new Error("Preview Course option is missing.");

  return {
    title: GOLF_SETTINGS_TITLE,
    items: [{
      id: COURSE_SETTING_ID,
      label: COURSE_SETTING_LABEL,
      currentValue: selected.label,
      values: options.map((option) => option.label),
    }],
    options,
    warningLines: [
      ...discovery.warnings.map(formatCourseLoadIssue),
      ...selectionWarnings.map(selectionWarningText),
    ],
  };
}

export interface CourseSettingsComponentOptions {
  readonly model: CourseSettingsModel;
  readonly theme: Theme;
  readonly onChange: (value: string) => void;
  readonly onClose: () => void;
  readonly requestRender: () => void;
}

/** Creates ordinary replacement UI framed with Pi's documented settings style. */
export function createCourseSettingsComponent(options: CourseSettingsComponentOptions): Component {
  const container = new Container();
  container.addChild(new DynamicBorder((text: string) => options.theme.fg("accent", text)));
  container.addChild(new Text(options.theme.fg("accent", options.theme.bold(options.model.title)), 1, 0));

  const settingsList = new SettingsList(
    [...options.model.items],
    3,
    getSettingsListTheme(),
    (id, newValue) => {
      if (id === COURSE_SETTING_ID) options.onChange(newValue);
    },
    options.onClose,
  );
  container.addChild(settingsList);

  if (options.model.warningLines.length > 0) {
    const warningText = options.model.warningLines
      .map((warning) => options.theme.fg("warning", `Warning: ${warning}`))
      .join("\n");
    container.addChild(new Text(warningText, 1, 0));
  }
  container.addChild(new DynamicBorder((text: string) => options.theme.fg("accent", text)));

  return {
    render: (width) => container.render(width),
    invalidate: () => container.invalidate(),
    handleInput: (data) => {
      settingsList.handleInput(data);
      options.requestRender();
    },
  };
}

/** Opens `/golf course` and serializes all asynchronous selection writes. */
export async function showCourseSettings(ctx: ExtensionCommandContext): Promise<void> {
  const paths = getCourseProjectPaths(ctx.cwd);
  const [discovery, selected] = await Promise.all([
    discoverCourses(paths.coursesDirectory),
    captureSelectedCourseSnapshot(ctx.cwd),
  ]);
  const model = buildCourseSettingsModel(
    paths.coursesDirectory,
    discovery,
    selected.sourcePath,
    selected.warnings,
  );
  let persistenceTail: Promise<void> = Promise.resolve();

  await ctx.ui.custom((tui, theme, _keybindings, done) => createCourseSettingsComponent({
    model,
    theme,
    requestRender: () => tui.requestRender(),
    onClose: () => done(undefined),
    onChange: (value) => {
      const option = model.options.find((candidate) => candidate.label === value);
      if (option === undefined) {
        ctx.ui.notify(`Unknown Course setting value: ${value}`, "error");
        return;
      }
      persistenceTail = persistenceTail.then(async () => {
        await selectLoadedCourse(ctx.cwd, option.loaded);
        ctx.ui.notify(`${option.label} selected for the next new Round.`, "info");
      }).catch((error: unknown) => {
        const message = error instanceof Error ? error.message : "Unknown persistence failure.";
        ctx.ui.notify(`Could not save Golf settings: ${message}`, "error");
      });
    },
  }));

  await persistenceTail;
}
