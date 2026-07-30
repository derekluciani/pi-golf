import { VIEWPORT } from "../domain/index.ts";

export interface ViewportAllocation {
  readonly suspended: boolean;
  readonly columns: number;
  readonly rows: number;
  readonly courseUnitsWide: number;
  readonly courseUnitsHigh: number;
}

/** Allocates only complete two-column Course Units; HUDs remain inside this rectangle. */
export function allocateViewport(width: number, height: number): ViewportAllocation {
  const columns = Math.max(0, Math.min(VIEWPORT.nativeTerminalWidth, Math.floor(width)));
  const rows = Math.max(0, Math.min(VIEWPORT.nativeTerminalHeight, Math.floor(height)));
  return {
    suspended: width < VIEWPORT.minimumTerminalWidth || height < VIEWPORT.minimumTerminalHeight,
    columns,
    rows,
    courseUnitsWide: Math.floor(columns / VIEWPORT.columnsPerCourseUnit),
    courseUnitsHigh: rows,
  };
}

export interface HudInset { readonly top: number; readonly right: number; readonly bottom: number; readonly left: number; }
export interface CanvasPoint { readonly x: number; readonly y: number; }

/** Clamps marker/arrows to the canvas after reserving panel-covered cells. */
export function hudSafePoint(point: CanvasPoint, viewport: ViewportAllocation, inset: HudInset): CanvasPoint {
  const minX = Math.min(viewport.courseUnitsWide - 1, Math.max(0, inset.left));
  const maxX = Math.max(minX, viewport.courseUnitsWide - 1 - Math.max(0, inset.right));
  const minY = Math.min(viewport.courseUnitsHigh - 1, Math.max(0, inset.top));
  const maxY = Math.max(minY, viewport.courseUnitsHigh - 1 - Math.max(0, inset.bottom));
  return { x: Math.min(maxX, Math.max(minX, Math.floor(point.x))), y: Math.min(maxY, Math.max(minY, Math.floor(point.y))) };
}
