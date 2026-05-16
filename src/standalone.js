const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const DEFAULT_NAME = (index) => `cut_${String(index + 1).padStart(2, '0')}.png`;
const makeId = () => (crypto.randomUUID ? crypto.randomUUID() : `cut-${Date.now()}-${Math.random().toString(16).slice(2)}`);
const EXPORT_SIZES = {
  original: { label: '원본', folder: 'cuts_original', suffix: '', width: null, height: null },
  '1920x1080': { label: '1920x1080', folder: 'cuts_1920x1080', suffix: '_1920x1080', width: 1920, height: 1080 },
  '3840x2160': { label: '3840x2160', folder: 'cuts_3840x2160', suffix: '_3840x2160', width: 3840, height: 2160 },
  '1080x1920': { label: '1080x1920', folder: 'cuts_1080x1920', suffix: '_1080x1920', width: 1080, height: 1920 },
  '1080x1080': { label: '1080x1080', folder: 'cuts_1080x1080', suffix: '_1080x1080', width: 1080, height: 1080 },
  '1080x1350': { label: '1080x1350', folder: 'cuts_1080x1350', suffix: '_1080x1350', width: 1080, height: 1350 }
};

const state = {
  sourceFile: null,
  image: null,
  imageUrl: '',
  sourceCanvas: null,
  cuts: [],
  manualMode: false,
  draft: null,
  busy: false,
  projectName: 'storyboard-project',
  exportFormat: 'png',
  exportSizes: ['original', '1920x1080'],
  resizeMode: 'cover',
  upscale: 'none',
  upscaleAfterSave: false,
  quality: 95,
  includeMetadata: true
};

const els = {
  topFileInput: document.querySelector('#topFileInput'),
  dropFileInput: document.querySelector('#dropFileInput'),
  pickButton: document.querySelector('#pickButton'),
  manualButton: document.querySelector('#manualButton'),
  cancelButton: document.querySelector('#cancelButton'),
  resetButton: document.querySelector('#resetButton'),
  zipButton: document.querySelector('#zipButton'),
  projectNameInput: document.querySelector('#projectNameInput'),
  formatSelect: document.querySelector('#formatSelect'),
  upscaleSelect: document.querySelector('#upscaleSelect'),
  upscaleAfterSaveInput: document.querySelector('#upscaleAfterSaveInput'),
  qualityInput: document.querySelector('#qualityInput'),
  metadataVisibleInput: document.querySelector('#metadataVisibleInput'),
  previewExportsButton: document.querySelector('#previewExportsButton'),
  downloadZipButton: document.querySelector('#downloadZipButton'),
  exportPreviewPanel: document.querySelector('#exportPreviewPanel'),
  exportPreviewGrid: document.querySelector('#exportPreviewGrid'),
  previewStage: document.querySelector('#previewStage'),
  cutsGrid: document.querySelector('#cutsGrid'),
  cutCount: document.querySelector('#cutCount'),
  statusText: document.querySelector('#statusText')
};

let dragStart = null;
const cutUrls = [];
const previewUrls = [];

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function setStatus(text, busy = state.busy) {
  state.busy = busy;
  els.statusText.textContent = busy ? '작업 중' : text;
  els.manualButton.disabled = !state.image || busy;
  els.cancelButton.disabled = !state.image || busy || (!state.manualMode && !state.draft);
  els.resetButton.disabled = !state.image || busy;
  els.zipButton.disabled = !state.cuts.length || busy;
  els.manualButton.classList.toggle('active', state.manualMode);
  els.cutCount.textContent = `${state.cuts.length} 컷`;
}

function clearCutUrls() {
  while (cutUrls.length) URL.revokeObjectURL(cutUrls.pop());
}

function clearPreviewUrls() {
  while (previewUrls.length) URL.revokeObjectURL(previewUrls.pop());
}

function mergeBands(indices, gap = 3) {
  if (!indices.length) return [];
  const bands = [];
  let start = indices[0];
  let prev = indices[0];
  for (let i = 1; i < indices.length; i += 1) {
    const value = indices[i];
    if (value - prev <= gap) {
      prev = value;
    } else {
      bands.push({ start, end: prev, center: Math.round((start + prev) / 2) });
      start = value;
      prev = value;
    }
  }
  bands.push({ start, end: prev, center: Math.round((start + prev) / 2) });
  return bands;
}

function uniqueRects(rects, tolerance = 18) {
  const sorted = [...rects].sort((a, b) => b.width * b.height - a.width * a.height);
  const result = [];
  for (const rect of sorted) {
    const duplicate = result.some((item) => {
      return Math.abs(item.x - rect.x) + Math.abs(item.y - rect.y) + Math.abs(item.width - rect.width) + Math.abs(item.height - rect.height) < tolerance;
    });
    if (!duplicate) result.push(rect);
  }
  return result.sort((a, b) => (a.y === b.y ? a.x - b.x : a.y - b.y));
}

function lineDensity(dark, width, height, from, to, fixed, horizontal) {
  let hits = 0;
  let total = 0;
  for (let value = from; value <= to; value += 1) {
    let found = false;
    for (let delta = -2; delta <= 2; delta += 1) {
      const x = horizontal ? value : fixed + delta;
      const y = horizontal ? fixed + delta : value;
      if (x >= 0 && x < width && y >= 0 && y < height && dark[y * width + x]) found = true;
    }
    if (found) hits += 1;
    total += 1;
  }
  return total ? hits / total : 0;
}

function detectStoryboardCuts(image, sourceCanvas) {
  const maxSize = 1200;
  const scale = Math.min(1, maxSize / Math.max(image.width, image.height));
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(sourceCanvas, 0, 0, width, height);

  const { data } = ctx.getImageData(0, 0, width, height);
  const dark = new Uint8Array(width * height);
  const edge = new Uint8Array(width * height);
  const rowCount = new Uint32Array(height);
  const colCount = new Uint32Array(width);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const luma = 0.299 * data[offset] + 0.587 * data[offset + 1] + 0.114 * data[offset + 2];
      const rightOffset = (y * width + Math.min(width - 1, x + 1)) * 4;
      const downOffset = (Math.min(height - 1, y + 1) * width + x) * 4;
      const rightLuma = 0.299 * data[rightOffset] + 0.587 * data[rightOffset + 1] + 0.114 * data[rightOffset + 2];
      const downLuma = 0.299 * data[downOffset] + 0.587 * data[downOffset + 1] + 0.114 * data[downOffset + 2];
      const isLineLike = data[offset + 3] > 20 && (luma < 132 || Math.abs(luma - rightLuma) > 34 || Math.abs(luma - downLuma) > 34);
      if (isLineLike) {
        dark[y * width + x] = 1;
        rowCount[y] += 1;
        colCount[x] += 1;
      }
      edge[y * width + x] = isLineLike ? 1 : 0;
    }
  }

  const rowThreshold = Math.max(12, Math.round(width * 0.12));
  const colThreshold = Math.max(12, Math.round(height * 0.12));
  let linesY = mergeBands([...rowCount.keys()].filter((y) => rowCount[y] >= rowThreshold), 6).map((band) => band.center);
  let linesX = mergeBands([...colCount.keys()].filter((x) => colCount[x] >= colThreshold), 6).map((band) => band.center);
  linesY = addImageBoundaries(linesY, height);
  linesX = addImageBoundaries(linesX, width);
  const rects = [];

  for (let yIndex = 0; yIndex < linesY.length - 1; yIndex += 1) {
    for (let xIndex = 0; xIndex < linesX.length - 1; xIndex += 1) {
      const x1 = linesX[xIndex];
      const x2 = linesX[xIndex + 1];
      const y1 = linesY[yIndex];
      const y2 = linesY[yIndex + 1];
      const w = x2 - x1;
      const h = y2 - y1;
      if (w < width * 0.08 || h < height * 0.08) continue;

      const edgeScore = (
        lineDensity(edge, width, height, x1, x2, y1, true) +
        lineDensity(edge, width, height, x1, x2, y2, true) +
        lineDensity(edge, width, height, y1, y2, x1, false) +
        lineDensity(edge, width, height, y1, y2, x2, false)
      ) / 4;
      if (edgeScore < 0.12) continue;

      const margin = Math.max(2, Math.round(Math.min(w, h) * 0.015));
      rects.push({
        x: Math.round((x1 + margin) / scale),
        y: Math.round((y1 + margin) / scale),
        width: Math.round((w - margin * 2) / scale),
        height: Math.round((h - margin * 2) / scale),
        source: 'auto'
      });
    }
  }

  const lineRects = uniqueRects(rects);
  if (lineRects.length) return lineRects;
  return detectContentBlocks(image, sourceCanvas);
}

function addImageBoundaries(lines, limit) {
  const nearStart = lines.some((line) => line < limit * 0.04);
  const nearEnd = lines.some((line) => line > limit * 0.96);
  const result = [...lines];
  if (!nearStart) result.unshift(0);
  if (!nearEnd) result.push(limit - 1);
  return [...new Set(result)].sort((a, b) => a - b);
}

function colorDistance(a, b) {
  return Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);
}

function detectContentBlocks(image, sourceCanvas) {
  const maxSize = 900;
  const scale = Math.min(1, maxSize / Math.max(image.width, image.height));
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(sourceCanvas, 0, 0, width, height);
  const { data } = ctx.getImageData(0, 0, width, height);
  const sample = (x, y) => {
    const offset = (y * width + x) * 4;
    return [data[offset], data[offset + 1], data[offset + 2]];
  };
  const background = [
    sample(0, 0),
    sample(width - 1, 0),
    sample(0, height - 1),
    sample(width - 1, height - 1)
  ].sort((a, b) => a[0] + a[1] + a[2] - (b[0] + b[1] + b[2]))[2];

  const mark = new Uint8Array(width * height);
  const visited = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const rgb = [data[offset], data[offset + 1], data[offset + 2]];
      const luma = 0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2];
      mark[y * width + x] = data[offset + 3] > 20 && (colorDistance(rgb, background) > 48 || luma < 210) ? 1 : 0;
    }
  }

  const rects = [];
  const queue = [];
  for (let start = 0; start < mark.length; start += 1) {
    if (!mark[start] || visited[start]) continue;
    visited[start] = 1;
    queue.length = 0;
    queue.push(start);
    let minX = width;
    let minY = height;
    let maxX = 0;
    let maxY = 0;
    let count = 0;

    for (let qi = 0; qi < queue.length; qi += 1) {
      const index = queue[qi];
      const x = index % width;
      const y = Math.floor(index / width);
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      count += 1;

      const neighbors = [index - 1, index + 1, index - width, index + width];
      for (const next of neighbors) {
        if (next < 0 || next >= mark.length || visited[next] || !mark[next]) continue;
        const nx = next % width;
        if (Math.abs(nx - x) > 1) continue;
        visited[next] = 1;
        queue.push(next);
      }
    }

    const rectWidth = maxX - minX + 1;
    const rectHeight = maxY - minY + 1;
    const area = rectWidth * rectHeight;
    if (area < width * height * 0.015 || rectWidth < width * 0.08 || rectHeight < height * 0.08) continue;
    const padding = Math.round(Math.min(rectWidth, rectHeight) * 0.04);
    rects.push({
      x: Math.round(Math.max(0, minX - padding) / scale),
      y: Math.round(Math.max(0, minY - padding) / scale),
      width: Math.round(Math.min(width - minX, rectWidth + padding * 2) / scale),
      height: Math.round(Math.min(height - minY, rectHeight + padding * 2) / scale),
      source: 'auto'
    });
  }
  return uniqueRects(rects, 30).slice(0, 48);
}

function getCanvasBlob(canvas, type = 'image/png', quality) {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

async function cropToBlob(sourceCanvas, rect) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(rect.width));
  canvas.height = Math.max(1, Math.round(rect.height));
  canvas.getContext('2d').drawImage(sourceCanvas, rect.x, rect.y, rect.width, rect.height, 0, 0, canvas.width, canvas.height);
  return getCanvasBlob(canvas);
}

function sanitizeFileName(name, fallback) {
  const cleaned = name.trim().replace(/[\\/:*?"<>|]+/g, '_');
  return cleaned.toLowerCase().endsWith('.png') ? cleaned : `${cleaned || fallback}.png`;
}

function exportExtension() {
  if (state.exportFormat === 'jpeg') return 'jpg';
  if (state.exportFormat === 'webp') return 'webp';
  return 'png';
}

function exportMimeType() {
  if (state.exportFormat === 'jpeg') return 'image/jpeg';
  if (state.exportFormat === 'webp') return 'image/webp';
  return 'image/png';
}

function exportButtonLabel() {
  if (state.exportFormat === 'jpeg') return 'JPG';
  if (state.exportFormat === 'webp') return 'WEBP';
  return 'PNG';
}

function baseCutName(name, fallback) {
  return (name || fallback)
    .trim()
    .replace(/[\\/:*?"<>|]+/g, '_')
    .replace(/\.(png|jpe?g|webp)$/i, '') || fallback.replace(/\.(png|jpe?g|webp)$/i, '');
}

function sanitizeProjectName(name) {
  return (name || 'storyboard-project').trim().replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, '_') || 'storyboard-project';
}

function buildExportFileName(name, fallback, sizeKey = 'original') {
  const config = EXPORT_SIZES[sizeKey] || EXPORT_SIZES.original;
  if (sizeKey === 'original') return `${baseCutName(name, fallback)}_original.${exportExtension()}`;
  return `${baseCutName(name, fallback)}${config.suffix}_cover.${exportExtension()}`;
}

function selectedExportSizes() {
  // The user can select one or many output folders. If every checkbox is off,
  // keep one safe default so downloads never produce an empty ZIP.
  const checked = [...document.querySelectorAll('input[name="exportSize"]:checked')].map((input) => input.value);
  state.exportSizes = checked.length ? checked : ['original'];
  return state.exportSizes;
}

function aspectRatioLabel(sizeKey) {
  if (sizeKey === '1920x1080' || sizeKey === '3840x2160') return '16:9';
  if (sizeKey === '1080x1920') return '9:16';
  if (sizeKey === '1080x1080') return '1:1';
  if (sizeKey === '1080x1350') return '4:5';
  return 'original';
}

function qualityValue() {
  return clamp(Number(state.quality) || 92, 80, 100) / 100;
}

function upscaleFactor() {
  if (!state.upscaleAfterSave) return 1;
  if (state.upscale === '2x') return 2;
  if (state.upscale === '4x') return 4;
  return 1;
}

function exportCanvasSize(rect, sizeKey = 'original') {
  // Fixed social/video presets stay exact. The original preset can optionally
  // become 2x/4x when "업스케일 후 저장" is enabled.
  const config = EXPORT_SIZES[sizeKey] || EXPORT_SIZES.original;
  const factor = sizeKey === 'original' ? upscaleFactor() : 1;
  return {
    width: Math.max(1, Math.round((config.width || rect.width) * factor)),
    height: Math.max(1, Math.round((config.height || rect.height) * factor))
  };
}

function selectedBox(cut) {
  return {
    x: clamp(cut.x, 0, state.sourceCanvas.width - 1),
    y: clamp(cut.y, 0, state.sourceCanvas.height - 1),
    width: Math.max(1, cut.width),
    height: Math.max(1, cut.height)
  };
}

function selectedCanvas(cut) {
  const box = selectedBox(cut);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(box.width);
  canvas.height = Math.round(box.height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(state.sourceCanvas, box.x, box.y, box.width, box.height, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function coverSizeForCut(cut, sizeKey) {
  const box = selectedBox(cut);
  const size = sizeKey === 'original'
    ? { width: Math.max(1, Math.round(box.width * upscaleFactor())), height: Math.max(1, Math.round(box.height * upscaleFactor())) }
    : exportCanvasSize(cut, sizeKey);
  return { box, size };
}

async function exportCutBlob(cut, sizeKey = 'original') {
  // Export uses only the user's selected box. First crop selectedBox to an
  // in-memory image, then cover-resize that image to each requested size.
  const source = selectedCanvas(cut);
  const { size } = coverSizeForCut(cut, sizeKey);
  const canvas = document.createElement('canvas');
  canvas.width = size.width;
  canvas.height = size.height;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  const scale = Math.max(size.width / source.width, size.height / source.height);
  const drawWidth = Math.round(source.width * scale);
  const drawHeight = Math.round(source.height * scale);
  const offsetX = Math.round((size.width - drawWidth) / 2);
  const offsetY = Math.round((size.height - drawHeight) / 2);
  ctx.drawImage(source, offsetX, offsetY, drawWidth, drawHeight);

  if (state.upscaleAfterSave && state.upscale !== 'none') applySharpen(ctx, size.width, size.height);
  return getCanvasBlob(canvas, exportMimeType(), qualityValue());
}

function applySharpen(ctx, width, height) {
  if (width * height > 12000000) return;
  const imageData = ctx.getImageData(0, 0, width, height);
  const src = imageData.data;
  const out = new Uint8ClampedArray(src);
  const amount = 0.45;

  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const index = (y * width + x) * 4;
      for (let channel = 0; channel < 3; channel += 1) {
        const center = src[index + channel] * (1 + 4 * amount);
        const neighbors =
          src[index - 4 + channel] +
          src[index + 4 + channel] +
          src[index - width * 4 + channel] +
          src[index + width * 4 + channel];
        out[index + channel] = clamp(center - neighbors * amount, 0, 255);
      }
    }
  }

  imageData.data.set(out);
  ctx.putImageData(imageData, 0, 0);
}

function downloadBlob(blob, fileName) {
  if (!blob) {
    setStatus('다운로드 파일을 만들지 못했습니다. 업스케일 배율을 낮춰 다시 시도해 주세요.', false);
    return;
  }
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.style.display = 'none';
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

async function downloadCut(cut, index) {
  const sizes = selectedExportSizes();
  setStatus(`선택한 사이즈 ${sizes.length}개를 준비하는 중입니다.`, true);
  try {
    if (sizes.length === 1) {
      const blob = await exportCutBlob(cut, sizes[0]);
      downloadBlob(blob, buildExportFileName(cut.name, DEFAULT_NAME(index), sizes[0]));
    } else {
      const projectName = sanitizeProjectName(state.projectName);
      const files = await Promise.all(sizes.map(async (sizeKey) => ({
        path: `${projectName}/${EXPORT_SIZES[sizeKey].folder}/${buildExportFileName(cut.name, DEFAULT_NAME(index), sizeKey)}`,
        blob: await exportCutBlob(cut, sizeKey)
      })));
      const zip = await createZip(files);
      downloadBlob(zip, `${baseCutName(cut.name, DEFAULT_NAME(index))}_exports.zip`);
    }
    setStatus('선택한 사이즈 다운로드를 시작했습니다.', false);
  } catch (error) {
    setStatus('다운로드 중 문제가 생겼습니다. 업스케일 배율을 낮춰 다시 시도해 주세요.', false);
  }
}

function crc32(bytes) {
  let table = crc32.table;
  if (!table) {
    table = new Uint32Array(256);
    for (let i = 0; i < 256; i += 1) {
      let c = i;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[i] = c >>> 0;
    }
    crc32.table = table;
  }
  let crc = 0xffffffff;
  for (const byte of bytes) crc = table[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function pushUint16(parts, value) {
  parts.push(value & 0xff, (value >>> 8) & 0xff);
}

function pushUint32(parts, value) {
  parts.push(value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff);
}

function dosTime(date) {
  return ((date.getHours() & 31) << 11) | ((date.getMinutes() & 63) << 5) | ((date.getSeconds() / 2) & 31);
}

function dosDate(date) {
  return (((date.getFullYear() - 1980) & 127) << 9) | (((date.getMonth() + 1) & 15) << 5) | (date.getDate() & 31);
}

async function createZip(files) {
  const encoder = new TextEncoder();
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  const now = new Date();
  const time = dosTime(now);
  const date = dosDate(now);

  for (const file of files) {
    const nameBytes = encoder.encode(file.path);
    const data = new Uint8Array(await file.blob.arrayBuffer());
    const crc = crc32(data);
    const localHeader = [];
    pushUint32(localHeader, 0x04034b50);
    pushUint16(localHeader, 20);
    pushUint16(localHeader, 0x0800);
    pushUint16(localHeader, 0);
    pushUint16(localHeader, time);
    pushUint16(localHeader, date);
    pushUint32(localHeader, crc);
    pushUint32(localHeader, data.length);
    pushUint32(localHeader, data.length);
    pushUint16(localHeader, nameBytes.length);
    pushUint16(localHeader, 0);
    localParts.push(new Uint8Array(localHeader), nameBytes, data);

    const centralHeader = [];
    pushUint32(centralHeader, 0x02014b50);
    pushUint16(centralHeader, 20);
    pushUint16(centralHeader, 20);
    pushUint16(centralHeader, 0x0800);
    pushUint16(centralHeader, 0);
    pushUint16(centralHeader, time);
    pushUint16(centralHeader, date);
    pushUint32(centralHeader, crc);
    pushUint32(centralHeader, data.length);
    pushUint32(centralHeader, data.length);
    pushUint16(centralHeader, nameBytes.length);
    pushUint16(centralHeader, 0);
    pushUint16(centralHeader, 0);
    pushUint16(centralHeader, 0);
    pushUint16(centralHeader, 0);
    pushUint32(centralHeader, 0);
    pushUint32(centralHeader, offset);
    centralParts.push(new Uint8Array(centralHeader), nameBytes);
    offset += localHeader.length + nameBytes.length + data.length;
  }

  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const end = [];
  pushUint32(end, 0x06054b50);
  pushUint16(end, 0);
  pushUint16(end, 0);
  pushUint16(end, files.length);
  pushUint16(end, files.length);
  pushUint32(end, centralSize);
  pushUint32(end, offset);
  pushUint16(end, 0);
  return new Blob([...localParts, ...centralParts, new Uint8Array(end)], { type: 'application/zip' });
}

async function makeCuts(rects) {
  clearCutUrls();
  const nextCuts = [];
  for (let index = 0; index < rects.length; index += 1) {
    const rect = rects[index];
    const blob = await cropToBlob(state.sourceCanvas, rect);
    const url = URL.createObjectURL(blob);
    cutUrls.push(url);
    nextCuts.push({ ...rect, id: makeId(), name: DEFAULT_NAME(index), blob, url });
  }
  state.cuts = nextCuts;
  render();
  setStatus(nextCuts.length ? `${nextCuts.length}개 컷을 감지했습니다.` : '자동 감지된 컷이 없습니다. 수동 선택을 사용할 수 있습니다.', false);
}

function drawPreview() {
  els.previewStage.innerHTML = '';
  if (!state.image) {
    const label = document.createElement('label');
    label.className = 'dropTarget';
    label.innerHTML = '<input id="dropFileInput" type="file" accept="image/jpeg,image/png,image/webp" /><strong>스토리보드 이미지 업로드</strong><span>JPG, PNG, WEBP</span>';
    els.previewStage.append(label);
    label.querySelector('input').addEventListener('change', (event) => handleFile(event.target.files?.[0]));
    return;
  }

  const shell = document.createElement('div');
  shell.className = `canvasShell ${state.manualMode ? 'selecting' : ''}`;
  const canvas = document.createElement('canvas');
  canvas.width = state.image.width;
  canvas.height = state.image.height;
  canvas.getContext('2d').drawImage(state.image, 0, 0);
  shell.append(canvas);

  state.cuts.forEach((cut, index) => {
    const box = document.createElement('div');
    box.className = `cutBox ${cut.source === 'manual' ? 'manual' : ''}`;
    box.style.left = `${(cut.x / state.image.width) * 100}%`;
    box.style.top = `${(cut.y / state.image.height) * 100}%`;
    box.style.width = `${(cut.width / state.image.width) * 100}%`;
    box.style.height = `${(cut.height / state.image.height) * 100}%`;
    box.innerHTML = `<span>${String(index + 1).padStart(2, '0')}</span>`;
    shell.append(box);
  });

  if (state.manualMode && state.draft && state.draft.width > 0 && state.draft.height > 0) {
    const draft = document.createElement('div');
    draft.className = 'cutBox draft';
    draft.style.left = `${(state.draft.x / state.image.width) * 100}%`;
    draft.style.top = `${(state.draft.y / state.image.height) * 100}%`;
    draft.style.width = `${(state.draft.width / state.image.width) * 100}%`;
    draft.style.height = `${(state.draft.height / state.image.height) * 100}%`;
    shell.append(draft);
  }

  shell.addEventListener('pointerdown', startManualSelection);
  shell.addEventListener('pointermove', moveManualSelection);
  shell.addEventListener('pointerup', endManualSelection);
  shell.addEventListener('pointercancel', () => {
    dragStart = null;
    state.draft = null;
    drawPreview();
  });
  els.previewStage.append(shell);
}

function renderCuts() {
  els.cutsGrid.innerHTML = '';
  if (!state.cuts.length) {
    els.cutsGrid.innerHTML = '<div class="emptyState">감지된 컷이 여기에 표시됩니다.</div>';
    return;
  }

  state.cuts.forEach((cut, index) => {
    const card = document.createElement('article');
    card.className = 'cutCard';
    card.innerHTML = `
      <div class="thumbWrap">
        <img src="${cut.url}" alt="${index + 1}번 컷" />
        <span class="badge">${String(index + 1).padStart(2, '0')}</span>
      </div>
      <div class="cardBody">
        <input aria-label="파일명" value="${cut.name.replaceAll('"', '&quot;')}" />
        <div class="meta">${Math.round(cut.width)} x ${Math.round(cut.height)} px → ${exportLabelForCut(cut)}</div>
        <div class="cardActions">
          <button type="button" title="앞으로 이동" ${index === 0 ? 'disabled' : ''}>앞</button>
          <button type="button" title="뒤로 이동" ${index === state.cuts.length - 1 ? 'disabled' : ''}>뒤</button>
          <button type="button" title="선택 사이즈 다운로드">선택 다운로드</button>
          <button type="button" class="danger" title="삭제">삭제</button>
        </div>
      </div>
    `;
    const input = card.querySelector('input');
    const buttons = card.querySelectorAll('button');
    input.addEventListener('input', () => {
      cut.name = input.value;
    });
    buttons[0].addEventListener('click', () => moveCut(index, -1));
    buttons[1].addEventListener('click', () => moveCut(index, 1));
    buttons[2].addEventListener('click', () => downloadCut(cut, index));
    buttons[3].addEventListener('click', () => deleteCut(cut.id));
    els.cutsGrid.append(card);
  });
}

function exportLabelForCut(cut) {
  const sizes = selectedExportSizes();
  const first = exportCanvasSize(cut, sizes[0]);
  const extra = sizes.length > 1 ? ` 외 ${sizes.length - 1}개` : '';
  return `${first.width} x ${first.height}${extra}, ${exportButtonLabel()}, ${state.resizeMode.toUpperCase()}`;
}

async function generateExportPreview() {
  if (!state.cuts.length) {
    setStatus('미리보기할 컷이 없습니다.', false);
    return;
  }
  selectedExportSizes();
  clearPreviewUrls();
  els.exportPreviewGrid.innerHTML = '';
  els.exportPreviewPanel.hidden = false;

  for (const [cutIndex, cut] of state.cuts.entries()) {
    const group = document.createElement('details');
    group.className = 'exportPreviewGroup';
    group.open = cutIndex === 0;
    group.innerHTML = `<summary>${baseCutName(cut.name, DEFAULT_NAME(cutIndex))} 미리보기</summary><div class="exportPreviewItems"></div>`;
    const items = group.querySelector('.exportPreviewItems');
    for (const sizeKey of state.exportSizes) {
      const blob = await exportCutBlob(cut, sizeKey);
      const url = URL.createObjectURL(blob);
      previewUrls.push(url);
      const size = coverSizeForCut(cut, sizeKey).size;
      const item = document.createElement('figure');
      item.className = 'exportPreviewItem';
      item.innerHTML = `
        <img src="${url}" alt="${EXPORT_SIZES[sizeKey].label} 저장 미리보기" />
        <figcaption>${EXPORT_SIZES[sizeKey].label} · ${size.width} x ${size.height}</figcaption>
      `;
      items.append(item);
    }
    els.exportPreviewGrid.append(group);
  }
  drawPreview();
  setStatus('모든 컷의 선택 사이즈 미리보기를 생성했습니다.', false);
}

function render() {
  drawPreview();
  renderCuts();
  setStatus(els.statusText.textContent, state.busy);
}

function getPoint(event) {
  const canvas = els.previewStage.querySelector('canvas');
  const rect = canvas.getBoundingClientRect();
  return {
    x: clamp(((event.clientX - rect.left) / rect.width) * state.image.width, 0, state.image.width),
    y: clamp(((event.clientY - rect.top) / rect.height) * state.image.height, 0, state.image.height)
  };
}

function updateDraftBox() {
  const shell = els.previewStage.querySelector('.canvasShell');
  if (!shell) return;
  let draft = shell.querySelector('.cutBox.draft');
  if (!state.draft || state.draft.width <= 0 || state.draft.height <= 0) {
    if (draft) draft.remove();
    return;
  }
  if (!draft) {
    draft = document.createElement('div');
    draft.className = 'cutBox draft';
    shell.append(draft);
  }
  draft.style.left = `${(state.draft.x / state.image.width) * 100}%`;
  draft.style.top = `${(state.draft.y / state.image.height) * 100}%`;
  draft.style.width = `${(state.draft.width / state.image.width) * 100}%`;
  draft.style.height = `${(state.draft.height / state.image.height) * 100}%`;
}

function startManualSelection(event) {
  if (!state.manualMode || !state.image) return;
  dragStart = getPoint(event);
  event.currentTarget.setPointerCapture(event.pointerId);
  state.draft = { x: dragStart.x, y: dragStart.y, width: 0, height: 0 };
  updateDraftBox();
}

function moveManualSelection(event) {
  if (!dragStart || !state.manualMode || !state.image) return;
  const point = getPoint(event);
  state.draft = {
    x: Math.min(dragStart.x, point.x),
    y: Math.min(dragStart.y, point.y),
    width: Math.abs(point.x - dragStart.x),
    height: Math.abs(point.y - dragStart.y)
  };
  updateDraftBox();
}

async function endManualSelection(event) {
  if (!dragStart || !state.manualMode || !state.image) return;
  const point = getPoint(event);
  const rect = {
    x: Math.round(Math.min(dragStart.x, point.x)),
    y: Math.round(Math.min(dragStart.y, point.y)),
    width: Math.round(Math.abs(point.x - dragStart.x)),
    height: Math.round(Math.abs(point.y - dragStart.y)),
    source: 'manual'
  };
  dragStart = null;
  state.draft = null;
  if (rect.width < 20 || rect.height < 20) {
    drawPreview();
    return;
  }
  const blob = await cropToBlob(state.sourceCanvas, rect);
  const url = URL.createObjectURL(blob);
  cutUrls.push(url);
  state.cuts.push({ ...rect, id: makeId(), name: DEFAULT_NAME(state.cuts.length), blob, url });
  render();
  setStatus('수동 컷을 추가했습니다.', false);
  event.currentTarget.releasePointerCapture(event.pointerId);
}

async function handleFile(file) {
  if (!file || !ACCEPTED_TYPES.includes(file.type)) {
    setStatus('JPG, PNG, WEBP 이미지만 사용할 수 있습니다.', false);
    return;
  }
  setStatus('이미지를 불러오는 중입니다.', true);
  state.sourceFile = file;
  state.manualMode = true;
  state.draft = null;
  clearCutUrls();
  state.cuts = [];
  if (state.imageUrl) URL.revokeObjectURL(state.imageUrl);
  state.imageUrl = URL.createObjectURL(file);

  const image = new Image();
  image.onload = async () => {
    state.image = image;
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    canvas.getContext('2d').drawImage(image, 0, 0);
    state.sourceCanvas = canvas;
    render();
    setStatus('원본 이미지 위에서 드래그해 컷을 추가하세요.', false);
  };
  image.onerror = () => setStatus('이미지를 불러오지 못했습니다.', false);
  image.src = state.imageUrl;
}

function cancelSelection() {
  state.manualMode = false;
  state.draft = null;
  dragStart = null;
  render();
  setStatus('선택을 취소했습니다.', false);
}

function resetAll() {
  if (state.imageUrl) URL.revokeObjectURL(state.imageUrl);
  clearCutUrls();
  clearPreviewUrls();
  state.sourceFile = null;
  state.image = null;
  state.imageUrl = '';
  state.sourceCanvas = null;
  state.cuts = [];
  state.manualMode = false;
  state.draft = null;
  state.busy = false;
  state.projectName = 'storyboard-project';
  state.exportFormat = 'png';
  state.exportSizes = ['original', '1920x1080'];
  state.resizeMode = 'cover';
  state.upscale = 'none';
  state.upscaleAfterSave = false;
  state.quality = 95;
  state.includeMetadata = true;
  dragStart = null;
  els.topFileInput.value = '';
  els.projectNameInput.value = state.projectName;
  els.formatSelect.value = state.exportFormat;
  els.upscaleSelect.value = state.upscale;
  els.upscaleAfterSaveInput.checked = state.upscaleAfterSave;
  els.qualityInput.value = String(state.quality);
  els.metadataVisibleInput.checked = state.includeMetadata;
  document.querySelectorAll('input[name="exportSize"]').forEach((input) => {
    input.checked = state.exportSizes.includes(input.value);
  });
  const dropInput = document.querySelector('#dropFileInput');
  if (dropInput) dropInput.value = '';
  els.exportPreviewPanel.hidden = true;
  els.exportPreviewGrid.innerHTML = '';
  render();
  setStatus('초기화했습니다. 새 이미지를 업로드하세요.', false);
}

function deleteCut(id) {
  const target = state.cuts.find((cut) => cut.id === id);
  if (target) URL.revokeObjectURL(target.url);
  state.cuts = state.cuts.filter((cut) => cut.id !== id);
  render();
  setStatus('컷을 삭제했습니다.', false);
}

function moveCut(index, direction) {
  const to = index + direction;
  if (to < 0 || to >= state.cuts.length) return;
  [state.cuts[index], state.cuts[to]] = [state.cuts[to], state.cuts[index]];
  render();
  setStatus('컷 순서를 변경했습니다.', false);
}

async function downloadZip() {
  if (!state.sourceFile || !state.cuts.length) return;
  setStatus('ZIP 파일을 만드는 중입니다.', true);
  const projectName = sanitizeProjectName(state.projectName);
  const sizes = selectedExportSizes();
  await generateExportPreview();
  setStatus('ZIP 파일을 만드는 중입니다.', true);
  const originalBlob = await getCanvasBlob(state.sourceCanvas, 'image/png');
  const metadata = {
    projectName,
    createdAt: new Date().toISOString(),
    originalFileName: state.sourceFile.name,
    totalCuts: state.cuts.length,
    exportOptions: {
      sizes,
      exportMode: 'selected-box-cover-resize',
      sourceMode: 'selectedBoxOnly',
      allowOutsideExpansion: false,
      resizeMode: 'cover',
      objectDetection: false,
      faceDetection: false,
      safeCrop: false,
      useBlurBackground: false,
      useSolidBackground: false,
      usePadding: false,
      upscale: state.upscaleAfterSave ? state.upscale : 'none',
      format: state.exportFormat,
      quality: state.quality
    },
    cuts: state.cuts.map((cut, index) => ({
      id: index + 1,
      name: baseCutName(cut.name, DEFAULT_NAME(index)),
      x: Math.round(cut.x),
      y: Math.round(cut.y),
      width: Math.round(cut.width),
      height: Math.round(cut.height),
      selectedBox: selectedBox(cut),
      exports: sizes.map((sizeKey) => buildExportFileName(cut.name, DEFAULT_NAME(index), sizeKey)),
      exportDetails: sizes.map((sizeKey) => ({
        exportSize: sizeKey,
        aspectRatio: aspectRatioLabel(sizeKey),
        resizeMode: 'cover',
        exportMode: 'selected-box-cover-resize',
        sourceMode: 'selectedBoxOnly',
        allowOutsideExpansion: false,
        objectDetection: false,
        faceDetection: false,
        safeCrop: false,
        useBlurBackground: false,
        useSolidBackground: false,
        usePadding: false,
        quality: state.quality,
        fileName: buildExportFileName(cut.name, DEFAULT_NAME(index), sizeKey)
      }))
    }))
  };

  const files = [
    { path: `${projectName}/original/storyboard_original.png`, blob: originalBlob }
  ];

  if (state.includeMetadata) {
    files.push({ path: `${projectName}/metadata.json`, blob: new Blob([JSON.stringify(metadata, null, 2)], { type: 'application/json' }) });
  }

  for (const cut of state.cuts) {
    const index = state.cuts.indexOf(cut);
    for (const sizeKey of sizes) {
      files.push({
        path: `${projectName}/${EXPORT_SIZES[sizeKey].folder}/${buildExportFileName(cut.name, DEFAULT_NAME(index), sizeKey)}`,
        blob: await exportCutBlob(cut, sizeKey)
      });
    }
  }

  const zip = await createZip(files);
  downloadBlob(zip, `${projectName}.zip`);
  setStatus('ZIP 파일이 준비되었습니다.', false);
}

els.pickButton.addEventListener('click', () => els.topFileInput.click());
els.topFileInput.addEventListener('change', (event) => handleFile(event.target.files?.[0]));
els.dropFileInput.addEventListener('change', (event) => handleFile(event.target.files?.[0]));
els.manualButton.addEventListener('click', () => {
  state.manualMode = !state.manualMode;
  render();
  setStatus(state.manualMode ? '원본 이미지 위에서 드래그해 컷을 추가하세요.' : '수동 선택을 종료했습니다.', false);
});
els.formatSelect.addEventListener('change', () => {
  state.exportFormat = els.formatSelect.value;
  renderCuts();
  setStatus(`${exportButtonLabel()}로 저장하도록 설정했습니다.`, false);
});
document.querySelectorAll('input[name="exportSize"]').forEach((input) => {
  input.addEventListener('change', () => {
    selectedExportSizes();
    renderCuts();
    setStatus(`선택한 출력 사이즈 ${state.exportSizes.length}개를 저장합니다.`, false);
  });
});
els.projectNameInput.addEventListener('input', () => {
  state.projectName = els.projectNameInput.value;
});
document.querySelectorAll('input[name="resizeMode"]').forEach((input) => {
  input.addEventListener('change', () => {
    state.resizeMode = 'cover';
    renderCuts();
    setStatus('선택 영역만 사용해 각 사이즈를 cover 방식으로 저장합니다.', false);
  });
});
els.upscaleSelect.addEventListener('change', () => {
  state.upscale = els.upscaleSelect.value;
  renderCuts();
  setStatus(state.upscale === 'none' ? '업스케일 없이 저장합니다.' : `${state.upscale} 업스케일 옵션을 사용합니다.`, false);
});
els.upscaleAfterSaveInput.addEventListener('change', () => {
  state.upscaleAfterSave = els.upscaleAfterSaveInput.checked;
  renderCuts();
  setStatus(state.upscaleAfterSave ? '원본 사이즈 저장 시 업스케일을 적용합니다.' : '업스케일 후 저장을 끕니다.', false);
});
els.qualityInput.addEventListener('input', () => {
  state.quality = clamp(Number(els.qualityInput.value) || 95, 80, 100);
});
els.metadataVisibleInput.addEventListener('change', () => {
  state.includeMetadata = els.metadataVisibleInput.checked;
});
els.previewExportsButton.addEventListener('click', generateExportPreview);
els.cancelButton.addEventListener('click', cancelSelection);
els.resetButton.addEventListener('click', resetAll);
els.zipButton.addEventListener('click', downloadZip);
els.downloadZipButton.addEventListener('click', downloadZip);
els.previewStage.addEventListener('dragover', (event) => event.preventDefault());
els.previewStage.addEventListener('drop', (event) => {
  event.preventDefault();
  handleFile(event.dataTransfer.files?.[0]);
});

setStatus('이미지를 업로드하면 컷 감지가 시작됩니다.', false);
