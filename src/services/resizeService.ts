export type ResizeMode = 'selected_box_preserve';

export interface OutputSize {
  key: string;
  width: number | null;
  height: number | null;
}

// Draws a precomputed capture box into the exact target canvas. The capture box
// should already have the target aspect ratio and should include the user's
// selected reference box, so no extra crop is applied here.
export function drawResizedCut(
  context: CanvasRenderingContext2D,
  source: HTMLCanvasElement,
  rect: DOMRectReadOnly,
  width: number,
  height: number,
  mode: ResizeMode
) {
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(source, rect.x, rect.y, rect.width, rect.height, 0, 0, width, height);
}
