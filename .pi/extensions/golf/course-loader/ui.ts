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
import {
  PREVIEW_COURSE_CATALOG,
  reconcileCourseCatalog,
  type CourseCatalogOption,
} from "./catalog.ts";
import {
  discoverCourses,
  type CourseDiscoveryResult,
} from "./loading.ts";
import {
  captureSelectedCourseSnapshot,
  selectLoadedCourse,
  type SelectedCourseSnapshot,
} from "./selection.ts";
import { getCourseProjectPaths } from "./settings.ts";

export const GOLF_SETTINGS_TITLE = "Golf Settings";
export const COURSE_SETTING_ID = "course";
export const COURSE_SETTING_LABEL = "Course";

export type CourseSettingOption = CourseCatalogOption;

export interface CourseSettingsModel {
  readonly title: typeof GOLF_SETTINGS_TITLE;
  readonly items: readonly SettingItem[];
  readonly options: readonly CourseSettingOption[];
  readonly warningLines: readonly string[];
}

/** Builds the inspectable single-setting model separately from terminal rendering. */
export function buildCourseSettingsModel(
  coursesDirectory: string,
  discovery: CourseDiscoveryResult,
  selectedSnapshot: SelectedCourseSnapshot,
): CourseSettingsModel {
  const catalog = reconcileCourseCatalog({
    preview: PREVIEW_COURSE_CATALOG,
    coursesDirectory,
    discovery,
    selectedSnapshot,
  });

  return {
    title: GOLF_SETTINGS_TITLE,
    items: [{
      id: COURSE_SETTING_ID,
      label: COURSE_SETTING_LABEL,
      currentValue: catalog.currentValue,
      values: catalog.options.map((option) => option.label),
    }],
    options: catalog.options,
    warningLines: catalog.warnings.map((warning) => warning.message),
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
  const model = buildCourseSettingsModel(paths.coursesDirectory, discovery, selected);
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
