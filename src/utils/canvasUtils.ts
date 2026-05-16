export function canvasToBlob(canvas: HTMLCanvasElement, type = 'image/png', quality = 0.92) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('Canvas export failed.'));
    }, type, quality);
  });
}
