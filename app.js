export type UpscaleMode = 'none' | '2x' | '4x';

export interface BrowserUpscaleOptions {
  mode: UpscaleMode;
  sharpen?: boolean;
}

export interface LocalRealEsrganRequest {
  inputDir: string;
  outputDir: string;
  scale: 2 | 4;
}

// Browser fallback upscale. This runs without APIs and without a backend.
// It enlarges the canvas with high-quality interpolation and optionally applies
// a light sharpening pass. It does not hallucinate new detail like AI upscalers.
export async function upscaleInBrowser(
  source: HTMLCanvasElement,
  options: BrowserUpscaleOptions
): Promise<HTMLCanvasElement> {
  const factor = options.mode === '4x' ? 4 : options.mode === '2x' ? 2 : 1;
  const canvas = document.createElement('canvas');
  canvas.width = source.width * factor;
  canvas.height = source.height * factor;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas context is not available.');

  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(source, 0, 0, canvas.width, canvas.height);

  if (options.sharpen && factor > 1) {
    sharpenCanvas(context, canvas.width, canvas.height);
  }

  return canvas;
}

// Intended Node-side adapter. A browser-only file:// app cannot spawn Python,
// so a local Node wrapper should call this command and return the output files.
export function buildRealEsrganCommand(request: LocalRealEsrganRequest): string[] {
  const script = 'local-upscaler/upscale.py';
  return [
    'python',
    script,
    '--input',
    request.inputDir,
    '--output',
    request.outputDir,
    '--scale',
    String(request.scale)
  ];
}

function sharpenCanvas(context: CanvasRenderingContext2D, width: number, height: number) {
  const imageData = context.getImageData(0, 0, width, height);
  const source = imageData.data;
  const output = new Uint8ClampedArray(source);
  const amount = 0.45;

  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const index = (y * width + x) * 4;
      for (let channel = 0; channel < 3; channel += 1) {
        const center = source[index + channel] * (1 + 4 * amount);
        const neighbors =
          source[index - 4 + channel] +
          source[index + 4 + channel] +
          source[index - width * 4 + channel] +
          source[index + width * 4 + channel];
        output[index + channel] = Math.max(0, Math.min(255, center - neighbors * amount));
      }
    }
  }

  imageData.data.set(output);
  context.putImageData(imageData, 0, 0);
}
