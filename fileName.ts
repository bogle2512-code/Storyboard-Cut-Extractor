export interface ExportMetadataCut {
  id: number;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  exports: string[];
}

export interface ExportMetadata {
  projectName: string;
  createdAt: string;
  originalFileName: string;
  totalCuts: number;
  exportOptions: {
    sizes: string[];
    resizeMode: string;
    upscale: string;
    format: string;
    quality: number;
  };
  cuts: ExportMetadataCut[];
}

// Keeps metadata generation separate so a future React version can reuse it.
export function createMetadata(metadata: ExportMetadata): string {
  return JSON.stringify(metadata, null, 2);
}
