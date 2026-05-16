export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

// The current export pipeline intentionally does not expand outside the user's
// selected box. This helper is kept as a tiny boundary utility for future UI
// overlays and tests.
export function normalizeSelectedBox(box: Box): Box {
  return {
    x: box.x,
    y: box.y,
    width: Math.max(1, box.width),
    height: Math.max(1, box.height)
  };
}
