import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const DEFAULT_NAME = (index) => `cut_${String(index + 1).padStart(2, '0')}.png`;
const makeId = () => (crypto.randomUUID ? crypto.randomUUID() : `cut-${Date.now()}-${Math.random().toString(16).slice(2)}`);

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
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
      const dx = Math.abs(item.x - rect.x);
      const dy = Math.abs(item.y - rect.y);
      const dw = Math.abs(item.width - rect.width);
      const dh = Math.abs(item.height - rect.height);
      return dx + dy + dw + dh < tolerance;
    });
    if (!duplicate) result.push(rect);
  }

  return result.sort((a, b) => (a.y === b.y ? a.x - b.x : a.y - b.y));
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
  const rowCount = new Uint32Array(height);
  const colCount = new Uint32Array(width);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const r = data[offset];
      const g = data[offset + 1];
      const b = data[offset + 2];
      const alpha = data[offset + 3];
      const luma = 0.299 * r + 0.587 * g + 0.114 * b;
      const isDark = alpha > 20 && luma < 92;
      if (isDark) {
        dark[y * width + x] = 1;
        rowCount[y] += 1;
        colCount[x] += 1;
      }
    }
  }

  const rowThreshold = Math.max(16, Math.round(width * 0.2));
  const colThreshold = Math.max(16, Math.round(height * 0.2));
  const horizontal = mergeBands([...rowCount.keys()].filter((y) => rowCount[y] >= rowThreshold), 4);
  const vertical = mergeBands([...colCount.keys()].filter((x) => colCount[x] >= colThreshold), 4);
  const linesX = vertical.map((band) => band.center);
  const linesY = horizontal.map((band) => band.center);
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

      const top = lineDensity(dark, width, height, x1, x2, y1, true);
      const bottom = lineDensity(dark, width, height, x1, x2, y2, true);
      const left = lineDensity(dark, width, height, y1, y2, x1, false);
      const right = lineDensity(dark, width, height, y1, y2, x2, false);
      if ((top + bottom + left + right) / 4 < 0.2) continue;

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

  if (rects.length) return uniqueRects(rects);
  return detectComponents(image, sourceCanvas);
}

function lineDensity(dark, width, height, from, to, fixed, horizontal) {
  let hits = 0;
  let total = 0;
  const radius = 2;
  for (let value = from; value <= to; value += 1) {
    let found = false;
    for (let delta = -radius; delta <= radius; delta += 1) {
      const x = horizontal ? value : fixed + delta;
      const y = horizontal ? fixed + delta : value;
      if (x < 0 || x >= width || y < 0 || y >= height) continue;
      if (dark[y * width + x]) found = true;
    }
    if (found) hits += 1;
    total += 1;
  }
  return total ? hits / total : 0;
}

function detectComponents(image, sourceCanvas) {
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
  const mark = new Uint8Array(width * height);
  const visited = new Uint8Array(width * height);

  for (let i = 0; i < width * height; i += 1) {
    const offset = i * 4;
    const luma = 0.299 * data[offset] + 0.587 * data[offset + 1] + 0.114 * data[offset + 2];
    mark[i] = luma > 180 ? 1 : 0;
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
    const fill = count / area;
    if (area < width * height * 0.02 || rectWidth < width * 0.12 || rectHeight < height * 0.1 || fill < 0.55) continue;

    rects.push({
      x: Math.round(minX / scale),
      y: Math.round(minY / scale),
      width: Math.round(rectWidth / scale),
      height: Math.round(rectHeight / scale),
      source: 'auto'
    });
  }

  return uniqueRects(rects, 24);
}

function getCanvasBlob(canvas, type = 'image/png', quality) {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

async function cropToBlob(sourceCanvas, rect) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(rect.width));
  canvas.height = Math.max(1, Math.round(rect.height));
  const ctx = canvas.getContext('2d');
  ctx.drawImage(
    sourceCanvas,
    rect.x,
    rect.y,
    rect.width,
    rect.height,
    0,
    0,
    canvas.width,
    canvas.height
  );
  return getCanvasBlob(canvas, 'image/png');
}

function sanitizeFileName(name, fallback) {
  const cleaned = name.trim().replace(/[\\/:*?"<>|]+/g, '_');
  return cleaned.toLowerCase().endsWith('.png') ? cleaned : `${cleaned || fallback}.png`;
}

async function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1200);
}

function crc32(bytes) {
  let table = crc32.table;
  if (!table) {
    table = new Uint32Array(256);
    for (let i = 0; i < 256; i += 1) {
      let c = i;
      for (let k = 0; k < 8; k += 1) {
        c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      }
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

function PreviewCanvas({ imageUrl, image, cuts, selection, onFile, onManualCut }) {
  const canvasRef = useRef(null);
  const wrapRef = useRef(null);
  const dragRef = useRef(null);

  useEffect(() => {
    if (!imageUrl || !canvasRef.current || !image) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    canvas.width = image.width;
    canvas.height = image.height;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, 0, 0);
  }, [imageUrl, image]);

  const getPoint = (event) => {
    const rect = canvasRef.current.getBoundingClientRect();
    return {
      x: clamp(((event.clientX - rect.left) / rect.width) * image.width, 0, image.width),
      y: clamp(((event.clientY - rect.top) / rect.height) * image.height, 0, image.height)
    };
  };

  const startDrag = (event) => {
    if (!selection || !image) return;
    const point = getPoint(event);
    dragRef.current = point;
    event.currentTarget.setPointerCapture(event.pointerId);
    onManualCut({ draft: { x: point.x, y: point.y, width: 0, height: 0 } });
  };

  const moveDrag = (event) => {
    if (!dragRef.current || !selection || !image) return;
    const point = getPoint(event);
    const start = dragRef.current;
    onManualCut({
      draft: {
        x: Math.min(start.x, point.x),
        y: Math.min(start.y, point.y),
        width: Math.abs(point.x - start.x),
        height: Math.abs(point.y - start.y)
      }
    });
  };

  const endDrag = (event) => {
    if (!dragRef.current || !selection || !image) return;
    const point = getPoint(event);
    const start = dragRef.current;
    dragRef.current = null;
    const rect = {
      x: Math.round(Math.min(start.x, point.x)),
      y: Math.round(Math.min(start.y, point.y)),
      width: Math.round(Math.abs(point.x - start.x)),
      height: Math.round(Math.abs(point.y - start.y)),
      source: 'manual'
    };
    onManualCut({ commit: rect });
    event.currentTarget.releasePointerCapture(event.pointerId);
  };

  return (
    <div
      className="previewStage"
      ref={wrapRef}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        onFile(event.dataTransfer.files?.[0]);
      }}
    >
      {imageUrl ? (
        <div
          className={`canvasShell ${selection ? 'selecting' : ''}`}
          onPointerDown={startDrag}
          onPointerMove={moveDrag}
          onPointerUp={endDrag}
          onPointerCancel={() => {
            dragRef.current = null;
            onManualCut({ draft: null });
          }}
        >
          <canvas ref={canvasRef} />
          {cuts.map((cut, index) => (
            <div
              className={`cutBox ${cut.source === 'manual' ? 'manual' : ''}`}
              key={cut.id}
              style={{
                left: `${(cut.x / image.width) * 100}%`,
                top: `${(cut.y / image.height) * 100}%`,
                width: `${(cut.width / image.width) * 100}%`,
                height: `${(cut.height / image.height) * 100}%`
              }}
            >
              <span>{String(index + 1).padStart(2, '0')}</span>
            </div>
          ))}
          {selection && selection.width > 0 && selection.height > 0 ? (
            <div
              className="cutBox draft"
              style={{
                left: `${(selection.x / image.width) * 100}%`,
                top: `${(selection.y / image.height) * 100}%`,
                width: `${(selection.width / image.width) * 100}%`,
                height: `${(selection.height / image.height) * 100}%`
              }}
            />
          ) : null}
        </div>
      ) : (
        <label className="dropTarget">
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={(event) => onFile(event.target.files?.[0])}
          />
          <strong>스토리보드 이미지 업로드</strong>
          <span>JPG, PNG, WEBP</span>
        </label>
      )}
    </div>
  );
}

function CutCard({ cut, index, total, onRename, onDelete, onMove, onDownload }) {
  return (
    <article className="cutCard">
      <div className="thumbWrap">
        <img src={cut.url} alt={`${index + 1}번 컷`} />
        <span className="badge">{String(index + 1).padStart(2, '0')}</span>
      </div>
      <div className="cardBody">
        <input
          aria-label="파일명"
          value={cut.name}
          onChange={(event) => onRename(cut.id, event.target.value)}
        />
        <div className="meta">
          {Math.round(cut.width)} x {Math.round(cut.height)} px
        </div>
        <div className="cardActions">
          <button type="button" onClick={() => onMove(index, -1)} disabled={index === 0} title="앞으로 이동">
            ↑
          </button>
          <button type="button" onClick={() => onMove(index, 1)} disabled={index === total - 1} title="뒤로 이동">
            ↓
          </button>
          <button type="button" onClick={() => onDownload(cut)} title="PNG 다운로드">
            PNG
          </button>
          <button type="button" className="danger" onClick={() => onDelete(cut.id)} title="삭제">
            삭제
          </button>
        </div>
      </div>
    </article>
  );
}

function App() {
  const [sourceFile, setSourceFile] = useState(null);
  const [imageUrl, setImageUrl] = useState('');
  const [image, setImage] = useState(null);
  const [sourceCanvas, setSourceCanvas] = useState(null);
  const [cuts, setCuts] = useState([]);
  const [draftSelection, setDraftSelection] = useState(null);
  const [manualMode, setManualMode] = useState(false);
  const [status, setStatus] = useState('이미지를 업로드하면 컷 감지가 시작됩니다.');
  const [isBusy, setIsBusy] = useState(false);
  const objectUrls = useRef([]);
  const fileInputRef = useRef(null);

  useEffect(() => {
    return () => {
      objectUrls.current.forEach((url) => URL.revokeObjectURL(url));
      if (imageUrl) URL.revokeObjectURL(imageUrl);
    };
  }, [imageUrl]);

  const sortedCuts = useMemo(() => cuts.map((cut, index) => ({ ...cut, fallbackName: DEFAULT_NAME(index) })), [cuts]);

  const clearCutUrls = () => {
    objectUrls.current.forEach((url) => URL.revokeObjectURL(url));
    objectUrls.current = [];
  };

  const makeCuts = async (rects, canvas) => {
    clearCutUrls();
    const nextCuts = [];
    for (let index = 0; index < rects.length; index += 1) {
      const rect = rects[index];
      const blob = await cropToBlob(canvas, rect);
      const url = URL.createObjectURL(blob);
      objectUrls.current.push(url);
      nextCuts.push({
        ...rect,
        id: makeId(),
        name: DEFAULT_NAME(index),
        blob,
        url
      });
    }
    setCuts(nextCuts);
    setStatus(nextCuts.length ? `${nextCuts.length}개 컷을 감지했습니다.` : '자동 감지된 컷이 없습니다. 수동 선택을 사용할 수 있습니다.');
  };

  const handleFile = async (file) => {
    if (!file || !ACCEPTED_TYPES.includes(file.type)) {
      setStatus('JPG, PNG, WEBP 이미지만 사용할 수 있습니다.');
      return;
    }

    setIsBusy(true);
    setStatus('이미지를 분석하는 중입니다.');
    setManualMode(false);
    setDraftSelection(null);
    setSourceFile(file);
    if (imageUrl) URL.revokeObjectURL(imageUrl);
    const nextImageUrl = URL.createObjectURL(file);
    setImageUrl(nextImageUrl);

    const img = new Image();
    img.onload = async () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
      setImage(img);
      setSourceCanvas(canvas);

      try {
        const detected = detectStoryboardCuts(img, canvas);
        await makeCuts(detected, canvas);
      } finally {
        setIsBusy(false);
      }
    };
    img.onerror = () => {
      setStatus('이미지를 불러오지 못했습니다.');
      setIsBusy(false);
    };
    img.src = nextImageUrl;
  };

  const addManualCut = async (rect) => {
    if (!sourceCanvas || rect.width < 20 || rect.height < 20) {
      setDraftSelection(null);
      return;
    }
    const safeRect = {
      ...rect,
      x: clamp(rect.x, 0, sourceCanvas.width - 1),
      y: clamp(rect.y, 0, sourceCanvas.height - 1),
      width: clamp(rect.width, 1, sourceCanvas.width - rect.x),
      height: clamp(rect.height, 1, sourceCanvas.height - rect.y)
    };
    const blob = await cropToBlob(sourceCanvas, safeRect);
    const url = URL.createObjectURL(blob);
    objectUrls.current.push(url);
    setCuts((current) => [
      ...current,
      {
        ...safeRect,
        id: makeId(),
        name: DEFAULT_NAME(current.length),
        blob,
        url
      }
    ]);
    setStatus('수동 컷을 추가했습니다.');
    setDraftSelection(null);
  };

  const handleManualCut = ({ draft, commit }) => {
    if (draft !== undefined) setDraftSelection(draft);
    if (commit) addManualCut(commit);
  };

  const renameCut = (id, name) => {
    setCuts((current) => current.map((cut) => (cut.id === id ? { ...cut, name } : cut)));
  };

  const deleteCut = (id) => {
    setCuts((current) => {
      const target = current.find((cut) => cut.id === id);
      if (target) URL.revokeObjectURL(target.url);
      return current.filter((cut) => cut.id !== id);
    });
  };

  const moveCut = (index, direction) => {
    setCuts((current) => {
      const next = [...current];
      const to = index + direction;
      if (to < 0 || to >= next.length) return current;
      [next[index], next[to]] = [next[to], next[index]];
      return next;
    });
  };

  const redetect = async () => {
    if (!image || !sourceCanvas) return;
    setIsBusy(true);
    setStatus('컷을 다시 감지하는 중입니다.');
    try {
      const detected = detectStoryboardCuts(image, sourceCanvas);
      await makeCuts(detected, sourceCanvas);
    } finally {
      setIsBusy(false);
    }
  };

  const downloadCut = (cut) => {
    downloadBlob(cut.blob, sanitizeFileName(cut.name, 'cut'));
  };

  const downloadZip = async () => {
    if (!sourceFile || !cuts.length) return;
    setIsBusy(true);
    setStatus('ZIP 파일을 만드는 중입니다.');
    try {
      const extension = sourceFile.name.split('.').pop() || 'png';
      const originalName = `original.${extension.toLowerCase()}`;
      const metadata = {
        original: {
          fileName: sourceFile.name,
          savedAs: `original/${originalName}`,
          width: image?.width || 0,
          height: image?.height || 0,
          type: sourceFile.type
        },
        cuts: cuts.map((cut, index) => ({
          fileName: sanitizeFileName(cut.name, DEFAULT_NAME(index)),
          path: `cuts/${sanitizeFileName(cut.name, DEFAULT_NAME(index))}`,
          x: Math.round(cut.x),
          y: Math.round(cut.y),
          width: Math.round(cut.width),
          height: Math.round(cut.height),
          source: cut.source
        })),
        exportedAt: new Date().toISOString()
      };
      const files = [
        { path: `original/${originalName}`, blob: sourceFile },
        ...cuts.map((cut, index) => ({
          path: `cuts/${sanitizeFileName(cut.name, DEFAULT_NAME(index))}`,
          blob: cut.blob
        })),
        {
          path: 'metadata.json',
          blob: new Blob([JSON.stringify(metadata, null, 2)], { type: 'application/json' })
        }
      ];
      const zip = await createZip(files);
      await downloadBlob(zip, 'storyboard_cuts.zip');
      setStatus('ZIP 파일이 준비되었습니다.');
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <main className="app">
      <section className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">Storyboard Cut Extractor</p>
            <h1>스토리보드 컷 추출</h1>
          </div>
          <div className="topActions">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={(event) => handleFile(event.target.files?.[0])}
            />
            <button type="button" className="primary" onClick={() => fileInputRef.current?.click()}>
              이미지 선택
            </button>
            <button type="button" onClick={redetect} disabled={!image || isBusy}>
              자동 감지
            </button>
            <button
              type="button"
              className={manualMode ? 'active' : ''}
              onClick={() => setManualMode((value) => !value)}
              disabled={!image}
            >
              수동 선택
            </button>
            <button type="button" onClick={downloadZip} disabled={!cuts.length || isBusy}>
              ZIP 저장
            </button>
          </div>
        </header>

        <div className="content">
          <section className="imagePanel" aria-label="원본 이미지 미리보기">
            <PreviewCanvas
              imageUrl={imageUrl}
              image={image}
              cuts={cuts}
              selection={manualMode ? draftSelection : null}
              onFile={handleFile}
              onManualCut={handleManualCut}
            />
          </section>

          <aside className="sidePanel">
            <div className="statusBar">
              <strong>{cuts.length} 컷</strong>
              <span>{isBusy ? '작업 중' : status}</span>
            </div>

            <div className="cutsGrid">
              {sortedCuts.map((cut, index) => (
                <CutCard
                  cut={cut}
                  index={index}
                  total={sortedCuts.length}
                  key={cut.id}
                  onRename={renameCut}
                  onDelete={deleteCut}
                  onMove={moveCut}
                  onDownload={downloadCut}
                />
              ))}
              {!cuts.length ? <div className="emptyState">감지된 컷이 여기에 표시됩니다.</div> : null}
            </div>
          </aside>
        </div>
      </section>
    </main>
  );
}

createRoot(document.getElementById('root')).render(<App />);
