import { useState } from 'react';
import { createPortal } from 'react-dom';
import ExcelJS from 'exceljs';
import type { Gap } from '../types';

// ─── Calibration (mirrors ResultsPanel.tsx) ───────────────────────────────────
const AREA_FACTOR   = 0.871076;    // µm² per px²
const LENGTH_FACTOR = 0.9333146;   // µm per px

const THUMB_PX       = 72;         // thumbnail height/width in Excel (px)
const THUMB_PADDING  = 0.5;        // fraction of equiv_radius to add as crop padding

interface ExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  gaps: Gap[];
  selectedGapIds: Set<number>;
  hiddenGapIndices: Set<number>;
  stem: string;
  fileKey?: string;
  imageSrc?: string; // Explicit source URL
  imageSize: { width: number; height: number } | null;
  outlineColor: string;
  fillColor: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Strictly loads an image and awaits its onload event.
 */
function loadImg(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    console.log(`[Export] Attempting to load image: ${url}`);
    const img = new Image();
    img.crossOrigin = 'anonymous'; 
    
    img.onload = () => {
      console.log(`[Export] Successfully loaded image: ${url} (${img.width}x${img.height})`);
      resolve(img);
    };
    
    img.onerror = (e) => {
      console.error(`[Export] Failed to load image: ${url}`, e);
      reject(new Error(`Cannot load ${url}`));
    };
    
    img.src = url;
  });
}

/** 
 * Attempt to load the original source image from various potential paths.
 */
async function tryLoadSourceImage(stem: string, fileKey?: string, explicitSrc?: string): Promise<HTMLImageElement | null> {
  const urls = [];
  
  if (explicitSrc) {
    urls.push(explicitSrc);
  }

  if (fileKey) {
    urls.push(`/tiles/${fileKey}`);
    urls.push(`/tiles/${stem}/${fileKey}`);
    // If it's a full URL already
    if (fileKey.startsWith('http') || fileKey.startsWith('/')) {
      urls.push(fileKey);
    }
  }

  urls.push(
    `/tiles/${stem}.jpg`,
    `/tiles/${stem}.jpeg`,
    `/tiles/${stem}.png`,
    `/tiles/${stem}/${stem}.jpg`,
    `/tiles/${stem}/${stem}.jpeg`,
    `/tiles/${stem}/${stem}.png`,
    `/tiles/${stem}/source.jpg`,
    `/tiles/${stem}/original.jpg`,
  );

  // Remove duplicates and empty strings
  const uniqueUrls = Array.from(new Set(urls.filter(Boolean)));

  for (const url of uniqueUrls) {
    try { 
      const img = await loadImg(url!); 
      if (img.width > 0 && img.height > 0) return img;
    } catch { 
      /* try next */ 
    }
  }
  
  console.error(`[Export] All image source candidates failed for stem=${stem}, fileKey=${fileKey}`);
  return null;
}

/** Compute the pixel bounding box of a gap, with padding. */
function gapBBox(gap: Gap, imgW: number, imgH: number) {
  const pad = gap.equiv_radius_px * THUMB_PADDING + 12;
  const coords = gap.coordinates;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  if (coords && coords.length >= 4) {
    for (let i = 0; i < coords.length; i += 2) {
      minX = Math.min(minX, coords[i]);   maxX = Math.max(maxX, coords[i]);
      minY = Math.min(minY, coords[i+1]); maxY = Math.max(maxY, coords[i+1]);
    }
  } else {
    const cx = gap.centroid_norm[0] * imgW;
    const cy = gap.centroid_norm[1] * imgH;
    minX = cx - gap.equiv_radius_px; maxX = cx + gap.equiv_radius_px;
    minY = cy - gap.equiv_radius_px; maxY = cy + gap.equiv_radius_px;
  }
  const x = Math.max(0, minX - pad);
  const y = Math.max(0, minY - pad);
  const w = Math.min(imgW, maxX + pad) - x;
  const h = Math.min(imgH, maxY + pad) - y;
  return { x, y, w: Math.max(1, w), h: Math.max(1, h) };
}

/** Crop a gap thumbnail from the source image, returns base64 JPEG (no prefix). */
async function makeThumbnail(
  src: HTMLImageElement,
  gap: Gap,
  imgW: number,
  imgH: number,
  outlineColor: string,
  fillColor: string,
): Promise<string> {
  const bbox = gapBBox(gap, imgW, imgH);
  
  // Use an off-screen canvas
  const c = typeof OffscreenCanvas !== 'undefined' 
    ? new OffscreenCanvas(THUMB_PX, THUMB_PX) as unknown as HTMLCanvasElement
    : document.createElement('canvas');
    
  c.width = THUMB_PX; c.height = THUMB_PX;
  const ctx = c.getContext('2d')!;
  
  // 1. Background
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, THUMB_PX, THUMB_PX);
  
  const scale = Math.min(THUMB_PX / bbox.w, THUMB_PX / bbox.h);
  const dw = bbox.w * scale, dh = bbox.h * scale;
  const dx = (THUMB_PX - dw) / 2;
  const dy = (THUMB_PX - dh) / 2;

  // 2. Draw base photo crop
  ctx.drawImage(src, bbox.x, bbox.y, bbox.w, bbox.h, dx, dy, dw, dh);

  // 3. Gap Overlay (Mask + Outline)
  drawGap(ctx, gap, scale, scale, true, true, outlineColor, fillColor, -bbox.x, -bbox.y, dx, dy, 1.5);

  if (c instanceof HTMLCanvasElement) {
    return c.toDataURL('image/jpeg', 0.85).replace(/^data:image\/jpeg;base64,/, '');
  } else {
    // OffscreenCanvas path
    const blob = await (c as unknown as OffscreenCanvas).convertToBlob({ type: 'image/jpeg', quality: 0.85 });
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64 = reader.result as string;
        resolve(base64.split(',')[1]);
      };
      reader.readAsDataURL(blob);
    });
  }
}

/** Draw a gap polygon on a canvas context. */
function drawGap(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  gap: Gap,
  sx: number, sy: number,
  drawOutlines: boolean, drawMasks: boolean,
  outlineColor: string, fillColor: string,
  ox = 0, oy = 0, // offset in image pixels
  tx = 0, ty = 0, // offset in canvas pixels
  lineWidth?: number,
) {
  const coords = gap.coordinates;
  if (!coords || coords.length < 4) return;
  
  ctx.beginPath();
  ctx.moveTo(tx + (coords[0] + ox) * sx, ty + (coords[1] + oy) * sy);
  for (let i = 2; i < coords.length; i += 2) {
    ctx.lineTo(tx + (coords[i] + ox) * sx, ty + (coords[i + 1] + oy) * sy);
  }
  ctx.closePath();
  
  if (drawMasks)    { ctx.fillStyle = fillColor + '55'; ctx.fill(); }
  if (drawOutlines) {
    ctx.strokeStyle = outlineColor;
    ctx.lineWidth = lineWidth ?? (2 / sx);
    ctx.stroke();
  }
}

/** Draw a rounded rectangle via arc. */
function roundRect(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y,     x + w, y + r,     r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x,     y + h, x,     y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

// ─── Image Export ─────────────────────────────────────────────────────────────

interface ImgParams {
  stem: string;
  fileKey?: string;
  imageSrc?: string;
  exportGaps: Gap[];
  imageSize: { width: number; height: number } | null;
  format: 'jpeg' | 'png';
  drawOutlines: boolean;
  drawMasks: boolean;
  addLabel: boolean;
  outlineColor: string;
  fillColor: string;
}

async function runImageExport(p: ImgParams): Promise<void> {
  console.log('[Export] Starting full image export...', { stem: p.stem, fileKey: p.fileKey, imageSrc: p.imageSrc });
  
  // 1. Wait for the original image to be fully loaded
  const src = await tryLoadSourceImage(p.stem, p.fileKey, p.imageSrc);
  
  if (!src) {
    console.error('[Export] runImageExport: Original image source could not be loaded.');
  }

  // 2. Set canvas dimensions to perfectly match the original image (or fallback)
  const imgW = src ? src.width  : (p.imageSize?.width  ?? 1024);
  const imgH = src ? src.height : (p.imageSize?.height ?? 768);

  const canvas = document.createElement('canvas');
  canvas.width = imgW; 
  canvas.height = imgH;
  const ctx = canvas.getContext('2d')!;

  // 3. Draw base layer (PHOTO FIRST)
  if (src) {
    ctx.drawImage(src, 0, 0);
  } else {
    // If photo fails to load, draw placeholder
    ctx.fillStyle = '#111';
    ctx.fillRect(0, 0, imgW, imgH);
    ctx.fillStyle = '#fff';
    ctx.font = `bold ${Math.round(imgW / 30)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText('Original image unavailable', imgW / 2, imgH / 2 - 20);
    ctx.font = `${Math.round(imgW / 50)}px sans-serif`;
    ctx.fillText('Exporting detections only', imgW / 2, imgH / 2 + 30);
  }

  // 4. Draw gap overlays (masks and outlines)
  if ((p.drawOutlines || p.drawMasks) && p.exportGaps.length > 0) {
    for (const gap of p.exportGaps) {
      drawGap(ctx, gap, 1, 1, p.drawOutlines, p.drawMasks, p.outlineColor, p.fillColor);
    }
  }

  // 5. Add Analysis Label
  if (p.addLabel && p.exportGaps.length > 0) {
    const totalArea   = p.exportGaps.reduce((s, g) => s + g.area_px, 0);
    const avgRadius   = p.exportGaps.reduce((s, g) => s + g.equiv_radius_px, 0) / p.exportGaps.length;
    const minRadius   = Math.min(...p.exportGaps.map(g => g.equiv_radius_px));
    const maxRadius   = Math.max(...p.exportGaps.map(g => g.equiv_radius_px));

    const lines = [
      `Gaps detected: ${p.exportGaps.length}`,
      `Total Area:    ${(totalArea * AREA_FACTOR).toFixed(1)} µm²`,
      `Avg Radius:    ${(avgRadius * LENGTH_FACTOR).toFixed(2)} µm`,
      `Radius Range:  ${(minRadius * LENGTH_FACTOR).toFixed(2)} – ${(maxRadius * LENGTH_FACTOR).toFixed(2)} µm`,
    ];

    const fontSize = Math.max(14, Math.round(imgW / 70));
    ctx.font = `bold ${fontSize}px "Courier New", monospace`;
    const lineH  = fontSize * 1.5;
    const pad    = fontSize * 0.8;
    const maxW   = Math.max(...lines.map(l => ctx.measureText(l).width));
    const boxW   = maxW + pad * 2;
    const boxH   = lines.length * lineH + pad * 1.5;
    const bx     = imgW - boxW - pad * 2;
    const by     = imgH - boxH - pad * 2;

    ctx.fillStyle = 'rgba(0,0,0,0.75)';
    roundRect(ctx, bx, by, boxW, boxH, fontSize / 2);
    ctx.fill();

    ctx.fillStyle = '#fff';
    ctx.textAlign = 'left';
    lines.forEach((line, i) => {
      ctx.fillText(line, bx + pad, by + pad + fontSize + i * lineH);
    });
  }

  // 6. Export Final combined image
  const mime = p.format === 'jpeg' ? 'image/jpeg' : 'image/png';
  const quality = p.format === 'jpeg' ? 0.95 : undefined;

  canvas.toBlob(blob => {
    if (!blob) {
      console.error('[Export] Failed to create blob from canvas.');
      return;
    }
    const url = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement('a'), {
      href: url, download: `${p.stem}-export.${p.format === 'jpeg' ? 'jpg' : 'png'}`,
    });
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 100);
  }, mime, quality);
}

// ─── Excel Export ─────────────────────────────────────────────────────────────

interface XlsxParams {
  stem: string;
  fileKey?: string;
  imageSrc?: string;
  exportGaps: Gap[];
  imageSize: { width: number; height: number } | null;
  columns: { gapNo: boolean; areaPx: boolean; areaUm: boolean; radiusPx: boolean; radiusUm: boolean; thumbnail: boolean };
  statistics: { average: boolean; min: boolean; max: boolean };
  outlineColor: string;
  fillColor: string;
}

async function runExcelExport(p: XlsxParams): Promise<void> {
  console.log('[Export] Starting Excel export...', { stem: p.stem, fileKey: p.fileKey, imageSrc: p.imageSrc });
  const wb = new ExcelJS.Workbook();
  // ... (rest of metadata)
  wb.creator = 'Glue Gap Analyser';
  wb.created = new Date();

  const ws = wb.addWorksheet('Gap Analysis');

  // ── Metadata (rows 1-5) ──────────────────────────────────────────────────────
  const metaStyle: Partial<ExcelJS.Style> = {
    font: { bold: true, color: { argb: 'FF374151' }, size: 10 },
  };
  const metaValStyle: Partial<ExcelJS.Style> = {
    font: { color: { argb: 'FF111827' }, size: 10 },
  };

  const meta: Array<[string, string | number]> = [
    ['Filename',     p.stem],
    ['Export Date',  new Date().toLocaleString()],
    ['Calibration',  `1 px = ${LENGTH_FACTOR} µm  |  1 px² = ${AREA_FACTOR} µm²`],
    ['Gap Count',    p.exportGaps.length],
  ];
  meta.forEach(([label, val], i) => {
    const row = ws.getRow(i + 1);
    row.height = 18;
    const c1 = row.getCell(1); c1.value = label; Object.assign(c1, metaStyle);
    const c2 = row.getCell(2); c2.value = val;   Object.assign(c2, metaValStyle);
    row.commit();
  });

  // Blank separator (row 5)
  ws.getRow(5).height = 8;

  // ── Column definitions ────────────────────────────────────────────────────────
  type ColKey = 'gapNo' | 'areaPx' | 'areaUm' | 'radiusPx' | 'radiusUm' | 'thumbnail';
  const allCols: Array<{ key: ColKey; header: string; width: number; fmt?: string }> = [
    { key: 'gapNo',    header: 'Gap No.',    width: 10  },
    { key: 'areaPx',   header: 'Area (px²)', width: 15, fmt: '#,##0' },
    { key: 'areaUm',   header: 'Area (µm²)', width: 15, fmt: '#,##0.0000' },
    { key: 'radiusPx', header: 'Radius (px)', width: 15, fmt: '0.00' },
    { key: 'radiusUm', header: 'Radius (µm)', width: 15, fmt: '0.0000' },
    { key: 'thumbnail',header: 'Thumbnail',  width: 12  },
  ];
  const colDefs = allCols.filter(c => p.columns[c.key]);
  if (colDefs.length === 0) return;

  colDefs.forEach((def, ci) => { ws.getColumn(ci + 1).width = def.width; });

  // ── Header row (row 6) ────────────────────────────────────────────────────────
  const HEADER_ROW_IDX = 6;
  const hRow = ws.getRow(HEADER_ROW_IDX);
  hRow.height = 26;
  colDefs.forEach((def, ci) => {
    const cell = hRow.getCell(ci + 1);
    cell.value = def.header;
    cell.style = {
      font:      { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 },
      fill:      { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1D4ED8' } },
      alignment: { vertical: 'middle', horizontal: 'center' },
      border:    { bottom: { style: 'thin', color: { argb: 'FF1E40AF' } } },
    };
  });
  hRow.commit();

  // ── Try to load source image for thumbnails ────────────────────────────────────
  let srcImg: HTMLImageElement | null = null;
  if (p.columns.thumbnail) srcImg = await tryLoadSourceImage(p.stem, p.fileKey, p.imageSrc);

  const thumbColPos = colDefs.findIndex(d => d.key === 'thumbnail');   // 0-based
  const ROW_H_THUMB = 58; // Excel row height in pts (≈ THUMB_PX * 0.75)

  // ── Data rows ─────────────────────────────────────────────────────────────────
  for (let gi = 0; gi < p.exportGaps.length; gi++) {
    const gap      = p.exportGaps[gi];
    const rowIdx   = HEADER_ROW_IDX + 1 + gi;   // 1-based worksheet row
    const row      = ws.getRow(rowIdx);
    const isEven   = gi % 2 === 1;

    colDefs.forEach((def, ci) => {
      const cell = row.getCell(ci + 1);

      if (def.key === 'gapNo')    cell.value = gi + 1;
      if (def.key === 'areaPx')   cell.value = Math.round(gap.area_px);
      if (def.key === 'areaUm')   cell.value = parseFloat((gap.area_px * AREA_FACTOR).toFixed(6));
      if (def.key === 'radiusPx') cell.value = parseFloat(gap.equiv_radius_px.toFixed(4));
      if (def.key === 'radiusUm') cell.value = parseFloat((gap.equiv_radius_px * LENGTH_FACTOR).toFixed(6));

      if (def.fmt && def.key !== 'thumbnail') cell.numFmt = def.fmt;

      cell.style = {
        ...cell.style,
        alignment: { vertical: 'middle', horizontal: def.key === 'gapNo' ? 'center' : 'right' },
        fill: isEven
          ? { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } }
          : undefined,
        font: { size: 10 },
      };
    });

    // Thumbnail
    if (p.columns.thumbnail) {
      row.height = ROW_H_THUMB;
      if (srcImg && p.imageSize) {
        try {
          const b64 = await makeThumbnail(
            srcImg,
            gap,
            p.imageSize.width,
            p.imageSize.height,
            p.outlineColor,
            p.fillColor,
          );
          const imgId = wb.addImage({ base64: b64, extension: 'jpeg' });
          ws.addImage(imgId, {
            tl: { col: thumbColPos,     row: rowIdx - 1 } as any,
            br: { col: thumbColPos + 1, row: rowIdx } as any,
          });
        } catch (err) {
          console.error('Thumbnail generation failed:', err);
          const cell = row.getCell(thumbColPos + 1);
          cell.value = 'N/A';
          cell.style = { font: { italic: true, color: { argb: 'FF9CA3AF' }, size: 9 }, alignment: { vertical: 'middle', horizontal: 'center' } };
        }
      } else {
        const cell = row.getCell(thumbColPos + 1);
        cell.value = 'N/A';
        cell.style = { font: { italic: true, color: { argb: 'FF9CA3AF' }, size: 9 }, alignment: { vertical: 'middle', horizontal: 'center' } };
      }
    }

    row.commit();
  }

  // ── Statistics rows ───────────────────────────────────────────────────────────
  const hasStats = p.statistics.average || p.statistics.min || p.statistics.max;
  if (hasStats && p.exportGaps.length > 0) {
    const areas   = p.exportGaps.map(g => g.area_px);
    const radii   = p.exportGaps.map(g => g.equiv_radius_px);
    const sum     = (arr: number[]) => arr.reduce((a, b) => a + b, 0);

    const statRows: Array<{ label: string; areaPx: number; areaUm: number; radiusPx: number; radiusUm: number }> = [];
    if (p.statistics.average) {
      const aP = sum(areas) / areas.length, rP = sum(radii) / radii.length;
      statRows.push({ label: 'Average', areaPx: aP, areaUm: aP * AREA_FACTOR, radiusPx: rP, radiusUm: rP * LENGTH_FACTOR });
    }
    if (p.statistics.min) {
      const aP = Math.min(...areas), rP = Math.min(...radii);
      statRows.push({ label: 'Minimum', areaPx: aP, areaUm: aP * AREA_FACTOR, radiusPx: rP, radiusUm: rP * LENGTH_FACTOR });
    }
    if (p.statistics.max) {
      const aP = Math.max(...areas), rP = Math.max(...radii);
      statRows.push({ label: 'Maximum', areaPx: aP, areaUm: aP * AREA_FACTOR, radiusPx: rP, radiusUm: rP * LENGTH_FACTOR });
    }

    // Spacer row
    const spacerIdx = HEADER_ROW_IDX + 1 + p.exportGaps.length;
    ws.getRow(spacerIdx).height = 8;

    statRows.forEach((stat, si) => {
      const rowIdx = spacerIdx + 1 + si;
      const row    = ws.getRow(rowIdx);
      row.height   = 22;

      colDefs.forEach((def, ci) => {
        const cell = row.getCell(ci + 1);
        const isFirst = si === 0;

        let val: string | number | undefined;
        if (def.key === 'gapNo')    val = stat.label;
        if (def.key === 'areaPx')   val = parseFloat(stat.areaPx.toFixed(2));
        if (def.key === 'areaUm')   val = parseFloat(stat.areaUm.toFixed(6));
        if (def.key === 'radiusPx') val = parseFloat(stat.radiusPx.toFixed(4));
        if (def.key === 'radiusUm') val = parseFloat(stat.radiusUm.toFixed(6));

        if (val !== undefined) cell.value = val;
        if (def.fmt && def.key !== 'gapNo' && def.key !== 'thumbnail') cell.numFmt = def.fmt;

        cell.style = {
          font:      { bold: def.key === 'gapNo', color: { argb: 'FF1E3A8A' }, size: 10 },
          fill:      { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFF6FF' } },
          alignment: { vertical: 'middle', horizontal: def.key === 'gapNo' ? 'left' : 'right' },
          border:    isFirst ? { top: { style: 'medium', color: { argb: 'FF93C5FD' } } } : {},
        };
      });
      row.commit();
    });
  }

  // ── Download ──────────────────────────────────────────────────────────────────
  const buf  = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url  = URL.createObjectURL(blob);
  const a    = Object.assign(document.createElement('a'), { href: url, download: `${p.stem}-gap-analysis.xlsx` });
  a.click();
  URL.revokeObjectURL(url);
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function ExportModal({
  isOpen, onClose, gaps, selectedGapIds, hiddenGapIndices,
  stem, fileKey, imageSrc, imageSize, outlineColor, fillColor,
}: ExportModalProps) {
  const [activeTab,        setActiveTab]        = useState<'image' | 'excel'>('image');
  const [exportScope,      setExportScope]      = useState<'all' | 'selected'>('all');
  const [imageFormat,      setImageFormat]      = useState<'jpeg' | 'png'>('jpeg');
  const [drawOutlines,     setDrawOutlines]     = useState(true);
  const [drawMasks,        setDrawMasks]        = useState(true);
  const [addAnalysisLabel, setAddAnalysisLabel] = useState(true);
  const [columns, setColumns] = useState({
    gapNo: true, areaPx: true, areaUm: true, radiusPx: true, radiusUm: true, thumbnail: true,
  });
  const [statistics, setStatistics] = useState({ average: true, min: true, max: true });
  const [isExporting,  setIsExporting]  = useState(false);
  const [exportError,  setExportError]  = useState<string | null>(null);

  // All hooks must run before any early return
  if (!isOpen) return null;

  function getExportGaps(): Gap[] {
    if (exportScope === 'selected') {
      if (selectedGapIds.size > 0) {
        return Array.from(selectedGapIds)
          .filter(i => i < gaps.length)
          .sort((a, b) => a - b)
          .map(i => gaps[i]);
      }
      return gaps.filter((_, i) => !hiddenGapIndices.has(i));
    }
    return gaps;
  }

  const exportGapCount = (() => {
    if (exportScope === 'selected') {
      if (selectedGapIds.size > 0) return Math.min(selectedGapIds.size, gaps.length);
      return gaps.length - hiddenGapIndices.size;
    }
    return gaps.length;
  })();

  async function handleExport() {
    if (isExporting) return;
    setIsExporting(true);
    setExportError(null);
    try {
      const exportGaps = getExportGaps();
      if (activeTab === 'image') {
        await runImageExport({ 
          stem, 
          fileKey,
          imageSrc,
          exportGaps, 
          imageSize, 
          format: imageFormat, 
          drawOutlines, 
          drawMasks, 
          addLabel: addAnalysisLabel, 
          outlineColor, 
          fillColor 
        });
      } else {
        await runExcelExport({ 
          stem, 
          fileKey,
          imageSrc,
          exportGaps, 
          imageSize, 
          columns, 
          statistics,
          outlineColor,
          fillColor
        });
      }
      onClose();
    } catch (err) {
      setExportError(err instanceof Error ? err.message : 'Export failed. Please try again.');
    } finally {
      setIsExporting(false);
    }
  }

  // ── Reusable Checkbox ────────────────────────────────────────────────────────
  function Checkbox({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
    return (
      <div
        className={`w-4 h-4 rounded border-2 flex items-center justify-center flex-shrink-0 transition-colors ${
          checked ? 'bg-blue-600 border-blue-500' : 'border-gray-500 bg-transparent'
        }`}
      >
        {checked && (
          <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
          </svg>
        )}
        <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} className="sr-only" />
      </div>
    );
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div className="relative w-full max-w-xl mx-4 max-h-[90vh] flex flex-col bg-gray-900 rounded-2xl shadow-2xl border border-gray-700/80 overflow-hidden">

        {/* ── Header ────────────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-700/80 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center shrink-0">
              <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
              </svg>
            </div>
            <div>
              <h2 className="text-sm font-semibold text-white leading-tight">Export Detection Results</h2>
              <p className="text-xs text-gray-400">{gaps.length} gap{gaps.length !== 1 ? 's' : ''} available</p>
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors p-1 rounded-md hover:bg-gray-800">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* ── Scrollable body ────────────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5 min-h-0">

          {/* Export Scope */}
          <section>
            <p className="text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-2">Export Scope</p>
            <div className="flex gap-2">
              {(['all', 'selected'] as const).map(scope => {
                const count = scope === 'all'
                  ? gaps.length
                  : selectedGapIds.size > 0
                    ? Math.min(selectedGapIds.size, gaps.length)
                    : gaps.length - hiddenGapIndices.size;
                const label = scope === 'all' ? 'All Gaps' : 'Selected / Visible';
                const sub   = scope === 'all'
                  ? `${gaps.length} gap${gaps.length !== 1 ? 's' : ''}`
                  : selectedGapIds.size > 0
                    ? `${selectedGapIds.size} selected`
                    : `${count} visible`;
                return (
                  <button
                    key={scope}
                    onClick={() => setExportScope(scope)}
                    className={`flex-1 flex items-center gap-3 px-4 py-3 rounded-xl border transition-all text-left ${
                      exportScope === scope
                        ? 'border-blue-500 bg-blue-500/10'
                        : 'border-gray-700 bg-gray-800/50 hover:border-gray-600'
                    }`}
                  >
                    <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${
                      exportScope === scope ? 'border-blue-400' : 'border-gray-600'
                    }`}>
                      {exportScope === scope && <div className="w-2 h-2 rounded-full bg-blue-400" />}
                    </div>
                    <div>
                      <div className={`text-sm font-medium ${exportScope === scope ? 'text-white' : 'text-gray-300'}`}>{label}</div>
                      <div className="text-xs text-gray-500">{sub}</div>
                    </div>
                  </button>
                );
              })}
            </div>
          </section>

          {/* Tab selector */}
          <section>
            <p className="text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-2">Format</p>
            <div className="flex bg-gray-800 rounded-xl p-1 gap-1">
              {(['image', 'excel'] as const).map(tab => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`flex-1 flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg text-sm font-semibold transition-all ${
                    activeTab === tab ? 'bg-gray-700 text-white shadow-sm' : 'text-gray-400 hover:text-gray-300'
                  }`}
                >
                  {tab === 'image' ? (
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v12a1.5 1.5 0 001.5 1.5zm10.5-11.25h.008v.008h-.008V8.25zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" />
                    </svg>
                  ) : (
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3.375 19.5h17.25m-17.25 0a1.125 1.125 0 01-1.125-1.125M3.375 19.5h7.5c.621 0 1.125-.504 1.125-1.125m-9.75 0V5.625m0 12.75v-1.5c0-.621.504-1.125 1.125-1.125m18.375 2.625V5.625m0 12.75c0 .621-.504 1.125-1.125 1.125m1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125m0 3.75h-7.5A1.125 1.125 0 0112 18.375m9.75-12.75c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125m19.5 0v1.5c0 .621-.504 1.125-1.125 1.125M2.25 5.625v1.5c0 .621.504 1.125 1.125 1.125m0 0h17.25m-17.25 0c-.621 0-1.125.504-1.125 1.125v1.5m17.25-1.5h-17.25m17.25 0c-.621 0-1.125.504-1.125 1.125v1.5" />
                    </svg>
                  )}
                  {tab === 'image' ? 'Image' : 'Excel (.xlsx)'}
                </button>
              ))}
            </div>
          </section>

          {/* ── Image options ─────────────────────────────────────────────────── */}
          {activeTab === 'image' && (
            <section className="space-y-4">
              {/* Format buttons */}
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-2">Image Format</p>
                <div className="flex gap-2">
                  {(['jpeg', 'png'] as const).map(fmt => (
                    <button
                      key={fmt}
                      onClick={() => setImageFormat(fmt)}
                      className={`flex-1 py-2 rounded-lg text-sm font-semibold border transition-all ${
                        imageFormat === fmt
                          ? 'bg-blue-600 border-blue-500 text-white'
                          : 'bg-gray-800 border-gray-700 text-gray-400 hover:border-gray-600 hover:text-gray-300'
                      }`}
                    >
                      {fmt.toUpperCase()}
                      {fmt === 'jpeg' && <span className="ml-1.5 text-[10px] opacity-60">smaller</span>}
                      {fmt === 'png'  && <span className="ml-1.5 text-[10px] opacity-60">lossless</span>}
                    </button>
                  ))}
                </div>
              </div>

              {/* Overlay checkboxes */}
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-2">Overlay Options</p>
                <div className="space-y-2">
                  {[
                    { v: drawOutlines,     s: setDrawOutlines,     label: 'Draw Gap Outlines',  desc: 'Trace the boundary of each gap polygon' },
                    { v: drawMasks,        s: setDrawMasks,        label: 'Draw Gap Masks',     desc: 'Fill gap regions with semi-transparent colour' },
                    { v: addAnalysisLabel, s: setAddAnalysisLabel, label: 'Add Analysis Label', desc: 'Overlay summary statistics in the bottom-right corner' },
                  ].map(opt => (
                    <label key={opt.label} className="flex items-start gap-3 px-4 py-3 rounded-xl border border-gray-700 bg-gray-800/40 cursor-pointer hover:border-gray-600 transition-all">
                      <div className="mt-0.5"><Checkbox checked={opt.v} onChange={opt.s} /></div>
                      <div>
                        <div className="text-sm font-medium text-gray-200">{opt.label}</div>
                        <div className="text-xs text-gray-500">{opt.desc}</div>
                      </div>
                    </label>
                  ))}
                </div>
              </div>
            </section>
          )}

          {/* ── Excel options ─────────────────────────────────────────────────── */}
          {activeTab === 'excel' && (
            <section className="space-y-4">
              {/* Column checkboxes */}
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-2">Columns to Include</p>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { key: 'gapNo',    label: 'Gap No.',       desc: 'Sequential index' },
                    { key: 'areaPx',   label: 'Area (px²)',    desc: 'Area in square pixels' },
                    { key: 'areaUm',   label: 'Area (µm²)',    desc: 'Area in square microns' },
                    { key: 'radiusPx', label: 'Radius (px)',   desc: 'Equivalent circle radius' },
                    { key: 'radiusUm', label: 'Radius (µm)',   desc: 'Radius in microns' },
                    { key: 'thumbnail',label: 'Gap Thumbnail', desc: 'Cropped image embedded in row' },
                  ].map(col => (
                    <label key={col.key} className="flex items-start gap-2.5 px-3 py-2.5 rounded-lg border border-gray-700 bg-gray-800/40 cursor-pointer hover:border-gray-600 transition-all">
                      <div className="mt-0.5">
                        <Checkbox
                          checked={columns[col.key as keyof typeof columns]}
                          onChange={v => setColumns({ ...columns, [col.key]: v })}
                        />
                      </div>
                      <div>
                        <div className="text-xs font-semibold text-gray-200">{col.label}</div>
                        <div className="text-[10px] text-gray-500">{col.desc}</div>
                      </div>
                    </label>
                  ))}
                </div>
              </div>

              {/* Statistics checkboxes */}
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-2">Summary Statistics Rows</p>
                <div className="flex gap-2">
                  {(['average', 'min', 'max'] as const).map(stat => (
                    <label key={stat} className="flex-1 flex items-center gap-2 px-3 py-2.5 rounded-lg border border-gray-700 bg-gray-800/40 cursor-pointer hover:border-gray-600 transition-all">
                      <Checkbox checked={statistics[stat]} onChange={v => setStatistics({ ...statistics, [stat]: v })} />
                      <span className="text-xs font-semibold text-gray-200 capitalize">{stat}</span>
                    </label>
                  ))}
                </div>
                <p className="mt-2 text-[10px] text-gray-500 leading-relaxed">
                  Appended after the data rows for Area and Radius columns.
                </p>
              </div>

              {/* Metadata note */}
              <div className="flex gap-2.5 px-3 py-3 rounded-xl border border-gray-700/50 bg-gray-800/20">
                <svg className="w-4 h-4 text-blue-400 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0Zm-9-3.75h.008v.008H12V8.25Z" />
                </svg>
                <p className="text-[11px] text-gray-400 leading-relaxed">
                  The spreadsheet always includes a <span className="text-gray-200 font-medium">Metadata</span> section at the top — filename, export date, and calibration constant&nbsp;
                  (<span className="font-mono text-gray-200">1 px = {LENGTH_FACTOR} µm</span>).
                </p>
              </div>
            </section>
          )}

          {/* Error banner */}
          {exportError && (
            <div className="flex gap-2 px-3 py-2.5 rounded-lg border border-red-700/60 bg-red-900/20 text-red-300 text-xs">
              <svg className="w-4 h-4 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
              </svg>
              {exportError}
            </div>
          )}
        </div>

        {/* ── Footer ────────────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between gap-3 px-6 py-4 border-t border-gray-700/80 shrink-0">
          <p className="text-xs text-gray-500">
            Exporting{' '}
            <span className="font-semibold text-gray-300">{exportGapCount}</span>{' '}
            gap{exportGapCount !== 1 ? 's' : ''}
          </p>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              disabled={isExporting}
              className="px-4 py-2 text-sm text-gray-300 hover:text-white border border-gray-600 rounded-lg hover:bg-gray-800 transition-colors disabled:opacity-40"
            >
              Cancel
            </button>
            <button
              onClick={handleExport}
              disabled={isExporting || exportGapCount === 0}
              className="px-5 py-2 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-500 active:bg-blue-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {isExporting ? (
                <>
                  <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Exporting…
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
                  </svg>
                  Export {activeTab === 'image' ? imageFormat.toUpperCase() : 'XLSX'}
                </>
              )}
            </button>
          </div>
        </div>

      </div>
    </div>,
    document.body,
  );
}
