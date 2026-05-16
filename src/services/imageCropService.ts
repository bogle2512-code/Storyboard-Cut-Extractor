export interface CutRect {
  id: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

// Creates a canvas containing only the selected storyboard cut.
export function cropCutToCanvas(source: HTMLCanvasElement, cut: CutRect): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(cut.width));
  canvas.height = Math.max(1, Math.round(cut.height));
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas context is not available.');
  context.drawImage(source, cut.x, cut.y, cut.width, cut.height, 0, 0, canvas.width, canvas.height);
  return canvas;
}
