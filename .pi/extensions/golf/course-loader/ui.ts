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
  readonly onChange: (value: string) => Promise<void> | void;
  readonly onClose: () => void;
  readonly onError?: (message: string) => void;
  readonly requestRender: () => void;
}

export interface CourseSettingsComponent extends Component {
  waitForPendingChanges(): Promise<void>;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown persistence failure.";
}

class GolfSettingsComponent implements CourseSettingsComponent {
  private container = new Container();
  private settingsList!: SettingsList;
  private committedValue: string;
  private requestedValue: string;
  private persistenceTail: Promise<void> = Promise.resolve();
  private pendingChanges = 0;
  private closeRequested = false;
  private persistenceError: string | undefined;

  constructor(private readonly options: CourseSettingsComponentOptions) {
    const item = options.model.items[0];
    if (options.model.items.length !== 1 || item?.id !== COURSE_SETTING_ID) {
      throw new Error("Golf Settings requires exactly one Course setting.");
    }
    this.committedValue = item.currentValue;
    this.requestedValue = item.currentValue;
    this.rebuild();
  }

  private settingItems(): SettingItem[] {
    return this.options.model.items.map((item) => item.values === undefined
      ? { ...item, currentValue: this.committedValue }
      : { ...item, currentValue: this.committedValue, values: [...item.values] });
  }

  private rebuild(): void {
    const container = new Container();
    container.addChild(new DynamicBorder((text: string) => this.options.theme.fg("accent", text)));
    container.addChild(new Text(
      this.options.theme.fg("accent", this.options.theme.bold(this.options.model.title)),
      1,
      0,
    ));

    this.settingsList = new SettingsList(
      this.settingItems(),
      3,
      getSettingsListTheme(),
      (id, newValue) => {
        if (id === COURSE_SETTING_ID) this.enqueueChange(newValue);
      },
      () => this.requestClose(),
    );
    container.addChild(this.settingsList);

    for (const warning of this.options.model.warningLines) {
      container.addChild(new Text(
        this.options.theme.fg("warning", `Warning: ${warning}`),
        1,
        0,
      ));
    }
    if (this.pendingChanges > 0) {
      container.addChild(new Text(
        this.options.theme.fg("warning", "Saving Course selection…"),
        1,
        0,
      ));
    }
    if (this.persistenceError !== undefined) {
      container.addChild(new Text(
        this.options.theme.fg("error", `Error: ${this.persistenceError}`),
        1,
        0,
      ));
    }
    container.addChild(new DynamicBorder((text: string) => this.options.theme.fg("accent", text)));
    this.container = container;
  }

  private enqueueChange(value: string): void {
    if (!this.options.model.options.some((option) => option.label === value)) {
      this.persistenceError = `Unknown Course setting value: ${value}`;
      this.settingsList.updateValue(COURSE_SETTING_ID, this.committedValue);
      this.rebuild();
      this.options.onError?.(this.persistenceError);
      this.options.requestRender();
      return;
    }

    this.requestedValue = value;
    this.pendingChanges += 1;
    this.persistenceError = undefined;
    this.settingsList.updateValue(COURSE_SETTING_ID, this.committedValue);
    this.rebuild();
    this.options.requestRender();

    this.persistenceTail = this.persistenceTail.then(async () => {
      try {
        await this.options.onChange(value);
        this.committedValue = value;
        this.persistenceError = undefined;
      } catch (error: unknown) {
        this.persistenceError = `Could not save Golf settings: ${errorMessage(error)}`;
        try {
          this.options.onError?.(this.persistenceError);
        } catch {
          // Notification failures must not turn a handled persistence error into a rejection.
        }
      } finally {
        this.pendingChanges -= 1;
        if (this.pendingChanges === 0) this.requestedValue = this.committedValue;
        this.rebuild();
        this.options.requestRender();
        if (this.pendingChanges === 0 && this.closeRequested) this.options.onClose();
      }
    });
  }

  private requestClose(): void {
    if (this.pendingChanges === 0) {
      this.options.onClose();
      return;
    }
    this.closeRequested = true;
    this.options.requestRender();
  }

  render(width: number): string[] {
    return this.container.render(width);
  }

  handleInput(data: string): void {
    const activeList = this.settingsList;
    // SettingsList cycles from the latest requested value, but the user-visible
    // value is immediately reconciled to the last successful commit.
    activeList.updateValue(COURSE_SETTING_ID, this.requestedValue);
    activeList.handleInput(data);
    activeList.updateValue(COURSE_SETTING_ID, this.committedValue);
    this.options.requestRender();
  }

  invalidate(): void {
    this.container.invalidate();
    this.rebuild();
    this.container.invalidate();
  }

  async waitForPendingChanges(): Promise<void> {
    await this.persistenceTail;
  }
}

/** Creates ordinary replacement UI framed with Pi's documented settings style. */
export function createCourseSettingsComponent(
  options: CourseSettingsComponentOptions,
): CourseSettingsComponent {
  return new GolfSettingsComponent(options);
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
  let component: CourseSettingsComponent | undefined;

  await ctx.ui.custom((tui, theme, _keybindings, done) => {
    component = createCourseSettingsComponent({
      model,
      theme,
      requestRender: () => tui.requestRender(),
      onClose: () => done(undefined),
      onError: (message) => ctx.ui.notify(message, "error"),
      onChange: async (value) => {
        const option = model.options.find((candidate) => candidate.label === value);
        if (option === undefined) throw new Error(`Unknown Course setting value: ${value}`);
        await selectLoadedCourse(ctx.cwd, option.loaded);
        ctx.ui.notify(`${option.label} selected for the next new Round.`, "info");
      },
    });
    return component;
  });

  await component?.waitForPendingChanges();
}
