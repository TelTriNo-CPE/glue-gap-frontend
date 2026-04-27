import { useEffect, useRef, useState, useCallback } from 'react';
import OpenSeadragon from 'openseadragon';
import { getDziUrl } from '../api';
import type { BoundingBox, Gap, ClickMode } from '../types';
import { applyBrush, applyEraser, applySplit, applyPolygon } from '../utils/turfBridge';
import { executeMagicWand } from '../utils/magicWand';

interface Props {
  stem: string;
  gaps: Gap[];
  hiddenGapIndices: Set<number>;
  hideUnselected: boolean;
  isOutlineOnly: boolean;
  showMinimap: boolean;
  isFullscreen: boolean;
  clickMode: ClickMode;
  grayscale: boolean;
  selectedGapIds: Set<number>;
  onSelectGap: (id: number | number[] | null, mode?: 'select' | 'deselect' | 'toggle' | 'clear') => void;
  onVisibleGapsChange?: (visibleIds: Set<number>) => void;
  layoutSignal?: number;
  outlineColor: string;
  fillColor: string;
  selectedColor: string;
  brushSize: number;
  onGapsModified?: (newGaps: Gap[]) => void;
  imageSize: { width: number; height: number } | null;
  wandTolerance: number;
  onInfoToast?: (message: string) => void;
  onObjectSelectBbox?: (bbox: BoundingBox) => void;
}

// ─── Drawing constants ────────────────────────────────────────────────────────
const LINE_WIDTH   = 2;

// Minimum screen-pixel area to bother drawing during animation (LOD skip)
const MIN_SCREEN_AREA_ANIMATING = 12;

/**
 * Draw a closed straight-line polygon through the given screen-space points.
 */
function drawClosedPolyline(
  ctx: CanvasRenderingContext2D,
  pts: { x: number; y: number }[],
) {
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
}

/**
 * Flatten any coordinate format into a flat [x1,y1,x2,y2,...] array.
 */
function flattenCoords(raw: unknown[]): number[] {
  const out: number[] = [];
  for (const item of raw) {
    if (typeof item === 'number') {
      out.push(item);
    } else if (Array.isArray(item)) {
      const inner = Array.isArray(item[0]) ? item[0] : item;
      for (const v of inner) {
        if (typeof v === 'number') out.push(v);
      }
    } else if (typeof item === 'object' && item !== null) {
      const o = item as Record<string, unknown>;
      if (typeof o.x === 'number' && typeof o.y === 'number') {
        out.push(o.x, o.y);
      }
    }
  }
  return out;
}

/**
 * Extract the flat coordinate array from a gap object.
 */
function getCoords(gap: unknown): number[] | undefined {
  if (typeof gap !== 'object' || !gap) return undefined;
  const g = gap as Record<string, unknown>;

  for (const key of ['coordinates', 'contour', 'contour_pts', 'polygon', 'points', 'vertices']) {
    const val = g[key];
    if (Array.isArray(val) && val.length >= 3) {
      const flat = flattenCoords(val);
      if (flat.length >= 6) return flat;
    }
  }
  return undefined;
}

function hexToRgba(hex: string, alpha: number) {
  const normalized = hex.replace('#', '');
  const value = normalized.length === 3
    ? normalized.split('').map((char) => char + char).join('')
    : normalized;

  const r = Number.parseInt(value.slice(0, 2), 16);
  const g = Number.parseInt(value.slice(2, 4), 16);
  const b = Number.parseInt(value.slice(4, 6), 16);

  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export default function OsdViewer({ stem, gaps, hiddenGapIndices, hideUnselected, isOutlineOnly, showMinimap, isFullscreen, clickMode, grayscale, selectedGapIds, onSelectGap, onVisibleGapsChange, layoutSignal = 0, outlineColor, fillColor, selectedColor, brushSize, onGapsModified, imageSize, wandTolerance, onInfoToast, onObjectSelectBbox }: Props) {
  const containerRef  = useRef<HTMLDivElement>(null);
  const canvasRef     = useRef<HTMLCanvasElement | null>(null);
  const viewerRef     = useRef<OpenSeadragon.Viewer | null>(null);
  const retryRef      = useRef<ReturnType<typeof setTimeout> | null>(null);
  const animatingRef  = useRef(false);
  const rafIdRef      = useRef(0);
  const marqueeCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const brushCursorCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const marqueeStateRef  = useRef<{
    isDragging: boolean;
    startImg: { x: number; y: number };
    currentImg: { x: number; y: number };
  }>({ isDragging: false, startImg: { x: 0, y: 0 }, currentImg: { x: 0, y: 0 } });
  const isPaintingRef = useRef(false);
  const lastPaintImgRef = useRef<{ x: number; y: number } | null>(null);

  const [tilesReady,   setTilesReady]  = useState(false);
  const [tileError,    setTileError]   = useState<string | null>(null);
  const [retrySignal,  setRetrySignal] = useState(0);
  const [elapsed,      setElapsed]     = useState(0);
  const elapsedRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const gapsRef       = useRef<Gap[]>(gaps);
  const hiddenRef     = useRef<Set<number>>(hiddenGapIndices);
  const selectedRef   = useRef<Set<number>>(selectedGapIds);
  const hideUnselectedRef = useRef<boolean>(hideUnselected);
  const isOutlineOnlyRef = useRef<boolean>(isOutlineOnly);
  const clickModeRef  = useRef<ClickMode>(clickMode);
  const onVisibleGapsChangeRef = useRef(onVisibleGapsChange);
  const lastVisibleGapsRef = useRef<Set<number>>(new Set());
  const outlineColorRef = useRef(outlineColor);
  const fillColorRef = useRef(fillColor);
  const selectedColorRef = useRef(selectedColor);
  const brushSizeRef = useRef(brushSize);
  const onGapsModifiedRef = useRef(onGapsModified);
  const onSelectGapRef = useRef(onSelectGap);
  const imageSizeRef = useRef(imageSize);
  const wandToleranceRef = useRef(wandTolerance);
  const onInfoToastRef = useRef(onInfoToast);
  const onObjectSelectBboxRef = useRef(onObjectSelectBbox);

  useEffect(() => { gapsRef.current = gaps; }, [gaps]);
  useEffect(() => { hiddenRef.current = hiddenGapIndices; }, [hiddenGapIndices]);
  useEffect(() => { selectedRef.current = selectedGapIds; }, [selectedGapIds]);
  useEffect(() => { hideUnselectedRef.current = hideUnselected; }, [hideUnselected]);
  useEffect(() => { isOutlineOnlyRef.current = isOutlineOnly; }, [isOutlineOnly]);
  useEffect(() => { clickModeRef.current = clickMode; }, [clickMode]);
  useEffect(() => { onVisibleGapsChangeRef.current = onVisibleGapsChange; }, [onVisibleGapsChange]);
  useEffect(() => { outlineColorRef.current = outlineColor; }, [outlineColor]);
  useEffect(() => { brushSizeRef.current = brushSize; }, [brushSize]);
  useEffect(() => { onGapsModifiedRef.current = onGapsModified; }, [onGapsModified]);
  useEffect(() => { onSelectGapRef.current = onSelectGap; }, [onSelectGap]);
  useEffect(() => { imageSizeRef.current = imageSize; }, [imageSize]);
  useEffect(() => { wandToleranceRef.current = wandTolerance; }, [wandTolerance]);
  useEffect(() => { onInfoToastRef.current = onInfoToast; }, [onInfoToast]);
  useEffect(() => { onObjectSelectBboxRef.current = onObjectSelectBbox; }, [onObjectSelectBbox]);
  useEffect(() => { fillColorRef.current = fillColor; }, [fillColor]);
  useEffect(() => { selectedColorRef.current = selectedColor; }, [selectedColor]);

  const startTimer = useCallback(() => {
    setElapsed(0);
    elapsedRef.current = setInterval(() => setElapsed(s => s + 1), 1000);
  }, []);

  const stopTimer = useCallback(() => {
    if (elapsedRef.current) { clearInterval(elapsedRef.current); elapsedRef.current = null; }
  }, []);

  // ── Core draw function ────────────────────────────────────────────────────
  const drawPolygons = useCallback((forceFullQuality = false) => {
    const viewer = viewerRef.current;
    const canvas = canvasRef.current;

    if (!viewer || !canvas || !viewer.isOpen()) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    try {

    const tiledImage = viewer.world.getItemAt(0);
    if (!tiledImage) return;

    // Sync canvas backing buffer to OSD canvas container
    const osdCanvas = viewer.canvas as HTMLElement;
    if (!osdCanvas) return;

    const w = osdCanvas.clientWidth;
    const h = osdCanvas.clientHeight;
    if (w <= 0 || h <= 0) return;

    if (canvas.width !== w || canvas.height !== h) {
      canvas.width  = w;
      canvas.height = h;
    }

    ctx.clearRect(0, 0, w, h);

    const currentGaps   = gapsRef.current;
    const currentHidden = hiddenRef.current;
    const currentSelected = selectedRef.current;
    const isHideUnselected = hideUnselectedRef.current;
    const isOutlineOnly = isOutlineOnlyRef.current;

    if (currentGaps.length === 0) return;

    const isAnimating = animatingRef.current && !forceFullQuality;

    // ── 1. Viewport culling: get visible bounds in viewport coords ──────
    const bounds = viewer.viewport.getBounds(true);
    const bx1 = bounds.x;
    const by1 = bounds.y;
    const bx2 = bounds.x + bounds.width;
    const by2 = bounds.y + bounds.height;

    // Guard against invalid viewport during resize/fullscreen transitions
    if (!isFinite(bx1) || !isFinite(by1) || !isFinite(bx2) || !isFinite(by2)) return;

    // Image dimensions for denormalization
    const imgSize = tiledImage.getContentSize();
    const imgW = imgSize.x;
    const imgH = imgSize.y;

    // ── 2. Context state batching: set styles ONCE before the loop ──────
    const currentOutlineColor = outlineColorRef.current;
    const currentFillColor = fillColorRef.current;
    const currentSelectedColor = selectedColorRef.current;

    ctx.strokeStyle = currentOutlineColor;
    ctx.lineWidth   = LINE_WIDTH;
    ctx.fillStyle   = hexToRgba(currentFillColor, 0.3);
    ctx.lineJoin    = 'miter';

    let drawn = 0;
    const visibleGaps = new Set<number>();

    for (let gi = 0; gi < currentGaps.length; gi++) {
      // Hidden overrides highlight: never draw hidden gaps, even if selected
      if (currentHidden.has(gi)) {
        continue;
      }

      // Hide unselected: if enabled, only draw selected gaps
      if (isHideUnselected && !currentSelected.has(gi)) {
        continue;
      }

      const gap = currentGaps[gi];
      const coords = getCoords(gap);
      if (!coords) continue;

      const isNormalized = coords.every(v => v >= 0 && v <= 1);

      // ── Viewport culling using polygon AABB ──────────────────────────
      let aabbMinX = Infinity, aabbMinY = Infinity;
      let aabbMaxX = -Infinity, aabbMaxY = -Infinity;
      for (let i = 0; i < coords.length; i += 2) {
        const imgX = isNormalized ? coords[i] * imgW : coords[i];
        const imgY = isNormalized ? coords[i + 1] * imgH : coords[i + 1];
        if (imgX < aabbMinX) aabbMinX = imgX;
        if (imgX > aabbMaxX) aabbMaxX = imgX;
        if (imgY < aabbMinY) aabbMinY = imgY;
        if (imgY > aabbMaxY) aabbMaxY = imgY;
      }

      const vpMin = viewer.viewport.imageToViewportCoordinates(
        new OpenSeadragon.Point(aabbMinX, aabbMinY),
      );
      const vpMax = viewer.viewport.imageToViewportCoordinates(
        new OpenSeadragon.Point(aabbMaxX, aabbMaxY),
      );

      // Skip only if the polygon's bounding box is completely outside viewport
      if (vpMax.x < bx1 || vpMin.x > bx2 || vpMax.y < by1 || vpMin.y > by2) {
        continue;
      }

      // Track this gap as viewport-visible (before LOD skip, so the list
      // includes all gaps intersecting the viewport regardless of size)
      visibleGaps.add(gi);

      // ── 3. LOD: skip tiny gaps during animation ───────────────────────
      if (isAnimating) {
        // Estimate screen size from equiv_radius
        const radiusVp = gap.equiv_radius_px / imgW; // rough viewport-space radius
        const zoom = viewer.viewport.getZoom(true);
        const screenRadius = radiusVp * zoom * w;
        if (screenRadius * screenRadius * Math.PI < MIN_SCREEN_AREA_ANIMATING) {
          continue;
        }
      }

      try {
        // Convert all points to screen space
        const screenPts: { x: number; y: number }[] = [];
        for (let i = 0; i < coords.length; i += 2) {
          const imgX = isNormalized ? coords[i] * imgW : coords[i];
          const imgY = isNormalized ? coords[i + 1] * imgH : coords[i + 1];

          const vpPoint = viewer.viewport.imageToViewportCoordinates(
            new OpenSeadragon.Point(imgX, imgY),
          );
          const canvasPoint = viewer.viewport.pixelFromPoint(vpPoint, true);
          screenPts.push({ x: canvasPoint.x, y: canvasPoint.y });
        }

        ctx.beginPath();
        drawClosedPolyline(ctx, screenPts);
        ctx.closePath();
        if (currentSelected.has(gi)) {
          ctx.save();
          ctx.strokeStyle = currentSelectedColor;
          ctx.lineWidth = isOutlineOnly ? 6 : 4;
          ctx.stroke();
          if (!isOutlineOnly) {
            ctx.fillStyle = hexToRgba(currentSelectedColor, 0.5);
            ctx.fill();
          }
          ctx.restore();
        } else {
          ctx.strokeStyle = currentOutlineColor;
          ctx.stroke();
          if (!isOutlineOnly) {
            ctx.fillStyle = hexToRgba(currentFillColor, 0.3);
            ctx.fill();
          }
        }
        drawn++;
      } catch {
        // Skip individual polygon failures
      }
    }

    // Report visible gap IDs to parent — only on resting/full-quality draws
    // to avoid hammering React state on every animation frame
    if (forceFullQuality && onVisibleGapsChangeRef.current) {
      const last = lastVisibleGapsRef.current;
      let changed = visibleGaps.size !== last.size;
      if (!changed) {
        for (const id of visibleGaps) {
          if (!last.has(id)) { changed = true; break; }
        }
      }
      if (changed) {
        lastVisibleGapsRef.current = visibleGaps;
        onVisibleGapsChangeRef.current(visibleGaps);
      }
    }

    if (drawn === 0 && currentGaps.length > 0) {
      const msg = `⚠ ${currentGaps.length} gaps but 0 polygons drawn`;
      ctx.save();
      ctx.fillStyle = 'rgba(220,38,38,0.85)';
      ctx.fillRect(0, 0, w, 36);
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 13px ui-sans-serif, sans-serif';
      ctx.textBaseline = 'middle';
      ctx.fillText(msg, 12, 18);
      ctx.restore();
    }

    } catch {
      // Silently skip draw frame during viewport transitions (e.g. fullscreen exit)
    }
  }, []);

  // Throttled draw: coalesce multiple calls per frame into one rAF
  const scheduleRedraw = useCallback(() => {
    cancelAnimationFrame(rafIdRef.current);
    rafIdRef.current = requestAnimationFrame(() => drawPolygons());
  }, [drawPolygons]);

  // Full-quality redraw (called after animation ends)
  const scheduleFullRedraw = useCallback(() => {
    cancelAnimationFrame(rafIdRef.current);
    rafIdRef.current = requestAnimationFrame(() => drawPolygons(true));
  }, [drawPolygons]);

  // ── Viewer init ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current) return;

    setTilesReady(false);
    setTileError(null);
    startTimer();

    // Ray-casting point-in-polygon
    function isPointInPolygon(point: [number, number], polygon: number[]): boolean {
      let inside = false;
      for (let i = 0, j = polygon.length / 2 - 1; i < polygon.length / 2; j = i++) {
        const xi = polygon[2 * i], yi = polygon[2 * i + 1];
        const xj = polygon[2 * j], yj = polygon[2 * j + 1];
        const intersect = ((yi > point[1]) !== (yj > point[1])) &&
          (point[0] < (xj - xi) * (point[1] - yi) / (yj - yi + 1e-12) + xi);
        if (intersect) inside = !inside;
      }
      return inside;
    }

    const viewer = OpenSeadragon({
      element: containerRef.current,
      showNavigationControl: false,
      showNavigator: true,
      navigatorPosition: 'BOTTOM_RIGHT',
      gestureSettingsMouse: { clickToZoom: false },
      animationTime: 0.3,
      blendTime: 0.1,
      minZoomImageRatio: 0.5,
      maxZoomPixelRatio: 4,
    });
    viewerRef.current = viewer;

    // Inject overlay canvas into OSD's own canvas container
    const overlayCanvas = document.createElement('canvas');
    overlayCanvas.style.position = 'absolute';
    overlayCanvas.style.top = '0';
    overlayCanvas.style.left = '0';
    overlayCanvas.style.width = '100%';
    overlayCanvas.style.height = '100%';
    overlayCanvas.style.pointerEvents = 'none';
    overlayCanvas.style.zIndex = '1000';
    (viewer.canvas as HTMLElement).appendChild(overlayCanvas);
    canvasRef.current = overlayCanvas;

    // Inject marquee canvas (above polygon overlay)
    const marqueeCanvas = document.createElement('canvas');
    marqueeCanvas.style.position = 'absolute';
    marqueeCanvas.style.top = '0';
    marqueeCanvas.style.left = '0';
    marqueeCanvas.style.width = '100%';
    marqueeCanvas.style.height = '100%';
    marqueeCanvas.style.pointerEvents = 'none';
    marqueeCanvas.style.zIndex = '1001';
    (viewer.canvas as HTMLElement).appendChild(marqueeCanvas);
    marqueeCanvasRef.current = marqueeCanvas;

    // Inject brush cursor canvas (same z-level as marquee — mutually exclusive)
    const brushCursorCanvas = document.createElement('canvas');
    brushCursorCanvas.style.position = 'absolute';
    brushCursorCanvas.style.top = '0';
    brushCursorCanvas.style.left = '0';
    brushCursorCanvas.style.width = '100%';
    brushCursorCanvas.style.height = '100%';
    brushCursorCanvas.style.pointerEvents = 'none';
    brushCursorCanvas.style.zIndex = '1001';
    (viewer.canvas as HTMLElement).appendChild(brushCursorCanvas);
    brushCursorCanvasRef.current = brushCursorCanvas;

    // ── Brush cursor rendering ──────────────────────────────────────────
    const osdCanvasEl = viewer.canvas as HTMLElement;
    function drawBrushCursorAtPoint(screenX: number, screenY: number) {
      const bCanvas = brushCursorCanvasRef.current;
      if (!bCanvas) return;
      const mode = clickModeRef.current;
      
      if (mode === 'split') {
        // Don't clear during a split drag — canvas-drag draws the preview line
        if (!isPaintingRef.current) {
          const ctx = bCanvas.getContext('2d');
          if (ctx) ctx.clearRect(0, 0, bCanvas.width, bCanvas.height);
        }
        return;
      }

      if (mode === 'magic-wand' || (mode !== 'brush' && mode !== 'eraser')) {
        const ctx = bCanvas.getContext('2d');
        if (ctx) ctx.clearRect(0, 0, bCanvas.width, bCanvas.height);
        return;
      }

      const v = viewerRef.current;
      if (!v || !v.isOpen()) return;

      const w = osdCanvasEl.clientWidth;
      const h = osdCanvasEl.clientHeight;
      if (bCanvas.width !== w || bCanvas.height !== h) {
        bCanvas.width = w;
        bCanvas.height = h;
      }

      const ctx = bCanvas.getContext('2d');
      if (!ctx) return;
      ctx.clearRect(0, 0, w, h);

      // Convert brush radius from image pixels to screen pixels
      const tiledImage = v.world.getItemAt(0);
      if (!tiledImage) return;
      const brushRadius = brushSizeRef.current / 2;

      // Convert screen position to image coordinates
      const mouseWebPoint = new OpenSeadragon.Point(screenX, screenY);
      const mouseVpPoint = v.viewport.pointFromPixel(mouseWebPoint, true);
      const mouseImgPoint = v.viewport.viewportToImageCoordinates(mouseVpPoint);

      // Compute screen radius: offset by brush radius in image space and measure screen distance
      const offsetImgPoint = new OpenSeadragon.Point(mouseImgPoint.x + brushRadius, mouseImgPoint.y);
      const offsetVpPoint = v.viewport.imageToViewportCoordinates(offsetImgPoint);
      const offsetScreenPoint = v.viewport.pixelFromPoint(offsetVpPoint, true);
      const centerVpPoint = v.viewport.imageToViewportCoordinates(new OpenSeadragon.Point(mouseImgPoint.x, mouseImgPoint.y));
      const centerScreenPoint = v.viewport.pixelFromPoint(centerVpPoint, true);
      const screenRadius = Math.abs(offsetScreenPoint.x - centerScreenPoint.x);

      const color = mode === 'brush' ? 'rgba(34, 197, 94,' : 'rgba(239, 68, 68,';

      ctx.beginPath();
      ctx.arc(screenX, screenY, screenRadius, 0, 2 * Math.PI);
      ctx.strokeStyle = color + '0.8)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 3]);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = color + '0.15)';
      ctx.fill();
    }

    function onMouseMove(e: MouseEvent) {
      const rect = osdCanvasEl.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;
      drawBrushCursorAtPoint(mouseX, mouseY);
    }

    function clearBrushCursor() {
      const bCanvas = brushCursorCanvasRef.current;
      if (bCanvas) {
        const ctx = bCanvas.getContext('2d');
        if (ctx) ctx.clearRect(0, 0, bCanvas.width, bCanvas.height);
      }
    }

    osdCanvasEl.addEventListener('mousemove', onMouseMove);
    osdCanvasEl.addEventListener('mouseleave', clearBrushCursor);

    // ── Image size helper ───────────────────────────────────────────────
    // Returns the image dimensions from the backend result when available,
    // or falls back to the OSD tiled-image content size.  This allows
    // manual tools (brush, eraser, magic wand) to work before auto-detection
    // has been run and result?.image_size is still null.
    function getEffectiveSize(): { width: number; height: number } | null {
      if (imageSizeRef.current) return imageSizeRef.current;
      const tImg = viewer.world.getItemAt(0);
      if (!tImg) return null;
      const s = tImg.getContentSize();
      if (!s || !s.x || !s.y) return null;
      return { width: s.x, height: s.y };
    }

    // ── Paint stamp helper ──────────────────────────────────────────────
    function applyPaintStamp(imgX: number, imgY: number, mode: 'brush' | 'eraser') {
      const currentGaps = gapsRef.current;
      const size = getEffectiveSize();
      if (!size) return;
      const brushRadius = brushSizeRef.current / 2;

      let newGaps: Gap[];
      if (mode === 'brush') {
        newGaps = applyBrush(currentGaps, { x: imgX, y: imgY }, brushRadius, size.width, size.height);
      } else {
        const selectedIds = Array.from(selectedRef.current);
        newGaps = applyEraser(currentGaps, { x: imgX, y: imgY }, brushRadius, size.width, size.height, selectedIds);
      }

      // Optimistic update to prevent stale data on rapid stamps
      gapsRef.current = newGaps;
      onGapsModifiedRef.current?.(newGaps);
    }

    viewer.addHandler('open', () => {
      setTilesReady(true);
      stopTimer();
      scheduleFullRedraw();
    });

    // ── DZI availability polling ─────────────────────────────────────────────
    // OSD's open-failed handler is unreliable for repeated retries, so we poll
    // the DZI URL directly with HEAD requests until the tile server responds 200.
    let cleaned = false;
    const POLL_INTERVAL_MS = 3000;
    const POLL_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
    const pollStart = Date.now();

    function scheduleDziPoll() {
      const dziUrl = getDziUrl(stem);
      retryRef.current = setTimeout(async () => {
        if (cleaned) return;
        if (Date.now() - pollStart > POLL_TIMEOUT_MS) {
          setTileError('Image tiles took too long to load. Please try again.');
          stopTimer();
          return;
        }
        try {
          const res = await fetch(dziUrl, { method: 'HEAD' });
          if (cleaned) return;
          if (res.ok) {
            viewer.open(dziUrl as unknown as OpenSeadragon.TileSourceSpecifier);
          } else {
            scheduleDziPoll();
          }
        } catch {
          if (!cleaned) scheduleDziPoll();
        }
      }, POLL_INTERVAL_MS);
    }
    scheduleDziPoll();

    // ── Animation tracking for LOD ──────────────────────────────────────
    viewer.addHandler('animation-start', () => { animatingRef.current = true; });
    viewer.addHandler('animation-finish', () => {
      animatingRef.current = false;
      scheduleFullRedraw();
    });

    // Throttled redraws during viewport changes
    viewer.addHandler('update-viewport', scheduleRedraw);
    viewer.addHandler('resize', scheduleFullRedraw);

    // Watch for container size changes (e.g. panel transitions)
    const resizeObserver = new ResizeObserver(() => {
      if (viewerRef.current) {
        // We must tell OSD to re-check its container size
        viewerRef.current.forceRedraw();
        scheduleFullRedraw();
      }
    });
    if (containerRef.current) resizeObserver.observe(containerRef.current);

    // Canvas click handler for gap selection
    viewer.addHandler('canvas-click', function(event) {
      if (!viewerRef.current || !viewerRef.current.isOpen()) return;

      const currentClickMode = clickModeRef.current;
      if (currentClickMode === 'pan') return;
      // Brush/eraser/split/object-select handled by canvas-press/drag/release
      if (currentClickMode === 'brush' || currentClickMode === 'eraser' || currentClickMode === 'split' || currentClickMode === 'object-select') {
        event.preventDefaultAction = true;
        return;
      }

      // ── Magic Wand ──────────────────────────────────────────────────────
      if (currentClickMode === 'magic-wand') {
        event.preventDefaultAction = true;
        const v = viewerRef.current;
        const size = getEffectiveSize();
        if (!size) return;

        const polygon = executeMagicWand(v, event.position, wandToleranceRef.current);
        if (!polygon) return;

        const currentGaps = gapsRef.current;
        const newGaps = applyPolygon(currentGaps, polygon, size.width, size.height);
        gapsRef.current = newGaps;
        onGapsModifiedRef.current?.(newGaps);
        onInfoToastRef.current?.('Magic Wand applied');
        scheduleFullRedraw();
        return;
      }

      const viewportPoint = viewerRef.current.viewport.pointFromPixel(event.position, true);
      const tiledImage = viewerRef.current.world.getItemAt(0);
      if (!tiledImage) return;
      const imgSize = tiledImage.getContentSize();
      const imgPoint = viewerRef.current.viewport.viewportToImageCoordinates(viewportPoint);
      const x = imgPoint.x, y = imgPoint.y;

      const currentGaps = gapsRef.current;

      let found = null;
      for (let gi = 0; gi < currentGaps.length; gi++) {
        const gap = currentGaps[gi];
        const coords = getCoords(gap);
        if (!coords) continue;
        // If normalized, denormalize
        const isNorm = coords.every(v => v >= 0 && v <= 1);
        const poly = isNorm ? coords.map((v, i) => v * (i % 2 === 0 ? imgSize.x : imgSize.y)) : coords;
        if (isPointInPolygon([x, y], poly)) {
          found = gi;
          break;
        }
      }

      if (currentClickMode === 'select') {
        if (found !== null) {
          onSelectGapRef.current(found, 'select');
          event.preventDefaultAction = true;
        }
        // In 'select' mode, clicking outside does nothing to current selection
      } else {
        // Deselect mode
        if (found !== null) {
          onSelectGapRef.current(found, 'deselect');
          event.preventDefaultAction = true;
        } else {
          // Clicking anywhere outside clears selection
          onSelectGapRef.current(null, 'clear');
        }
      }
    });

    // ── Marquee drag handlers for batch select/deselect ──────────────────
    // ── Brush/eraser paint handlers ──────────────────────────────────────
    viewer.addHandler('canvas-press', function(event: any) {
      const mode = clickModeRef.current;
      if (mode === 'pan') return;

      // Magic-wand is handled entirely in canvas-click — prevent OSD panning here
      if (mode === 'magic-wand') {
        event.preventDefaultAction = true;
        return;
      }

      if (!viewerRef.current || !viewerRef.current.isOpen()) return;
      const tiledImage = viewerRef.current.world.getItemAt(0);
      if (!tiledImage) return;

      const viewportPoint = viewerRef.current.viewport.pointFromPixel(event.position, true);
      const imgPoint = viewerRef.current.viewport.viewportToImageCoordinates(viewportPoint);

      if (mode === 'brush' || mode === 'eraser') {
        isPaintingRef.current = true;
        lastPaintImgRef.current = { x: imgPoint.x, y: imgPoint.y };
        applyPaintStamp(imgPoint.x, imgPoint.y, mode);
        scheduleFullRedraw();
        event.preventDefaultAction = true;
        return;
      }

      if (mode === 'split') {
        isPaintingRef.current = true;
        lastPaintImgRef.current = { x: imgPoint.x, y: imgPoint.y };
        event.preventDefaultAction = true;
        return;
      }

      marqueeStateRef.current = {
        isDragging: true,
        startImg: { x: imgPoint.x, y: imgPoint.y },
        currentImg: { x: imgPoint.x, y: imgPoint.y },
      };

      // Prevent OSD panning
      event.preventDefaultAction = true;
    });

    viewer.addHandler('canvas-drag', function(event: any) {
      const mode = clickModeRef.current;

      // Handle split drag — draw preview line
      if (mode === 'split' && isPaintingRef.current) {
        const v = viewerRef.current;
        if (!v || !v.isOpen()) return;

        const viewportPoint = v.viewport.pointFromPixel(event.position, true);
        const imgPoint = v.viewport.viewportToImageCoordinates(viewportPoint);
        const startPt = lastPaintImgRef.current;
        if (!startPt) return;

        // Draw the split preview line on the brush cursor canvas
        const bCanvas = brushCursorCanvasRef.current;
        if (bCanvas) {
          const osdCanvas = v.canvas as HTMLElement;
          const w = osdCanvas.clientWidth;
          const h = osdCanvas.clientHeight;
          if (bCanvas.width !== w || bCanvas.height !== h) {
            bCanvas.width = w;
            bCanvas.height = h;
          }

          const ctx = bCanvas.getContext('2d');
          if (ctx) {
            ctx.clearRect(0, 0, w, h);

            // Convert start and current image points to screen pixels
            const startVp = v.viewport.imageToViewportCoordinates(
              new OpenSeadragon.Point(startPt.x, startPt.y),
            );
            const endVp = v.viewport.imageToViewportCoordinates(
              new OpenSeadragon.Point(imgPoint.x, imgPoint.y),
            );
            const startPx = v.viewport.pixelFromPoint(startVp, true);
            const endPx = v.viewport.pixelFromPoint(endVp, true);

            ctx.beginPath();
            ctx.moveTo(startPx.x, startPx.y);
            ctx.lineTo(endPx.x, endPx.y);
            ctx.strokeStyle = 'rgba(245, 158, 11, 0.9)';
            ctx.lineWidth = 2;
            ctx.setLineDash([6, 4]);
            ctx.stroke();
            ctx.setLineDash([]);
          }
        }

        event.preventDefaultAction = true;
        return;
      }

      // Handle brush/eraser drag painting
      if ((mode === 'brush' || mode === 'eraser') && isPaintingRef.current) {
        const v = viewerRef.current;
        if (!v || !v.isOpen()) return;

        // Update visual cursor position during drag
        drawBrushCursorAtPoint(event.position.x, event.position.y);

        const viewportPoint = v.viewport.pointFromPixel(event.position, true);
        const imgPoint = v.viewport.viewportToImageCoordinates(viewportPoint);
        const last = lastPaintImgRef.current;
        const brushRadius = brushSizeRef.current / 2;
        const minDist = brushRadius * 0.5;

        if (last) {
          const dx = imgPoint.x - last.x;
          const dy = imgPoint.y - last.y;
          const dist = Math.hypot(dx, dy);

          if (dist >= minDist) {
            // Interpolate stamps along the path for smooth coverage
            const steps = Math.ceil(dist / minDist);
            for (let s = 1; s <= steps; s++) {
              const t = s / steps;
              const ix = last.x + dx * t;
              const iy = last.y + dy * t;
              applyPaintStamp(ix, iy, mode);
            }
            lastPaintImgRef.current = { x: imgPoint.x, y: imgPoint.y };
            scheduleFullRedraw();
          }
        }

        event.preventDefaultAction = true;
        return;
      }

      if (!marqueeStateRef.current.isDragging) return;

      if (mode === 'pan') {
        marqueeStateRef.current.isDragging = false;
        return;
      }

      const v = viewerRef.current;
      if (!v || !v.isOpen()) return;

      const viewportPoint = v.viewport.pointFromPixel(event.position, true);
      const imgPoint = v.viewport.viewportToImageCoordinates(viewportPoint);
      marqueeStateRef.current.currentImg = { x: imgPoint.x, y: imgPoint.y };

      // Draw marquee rectangle on the dedicated marquee canvas
      const mCanvas = marqueeCanvasRef.current;
      if (!mCanvas) return;

      const osdCanvas = v.canvas as HTMLElement;
      const w = osdCanvas.clientWidth;
      const h = osdCanvas.clientHeight;
      if (mCanvas.width !== w || mCanvas.height !== h) {
        mCanvas.width = w;
        mCanvas.height = h;
      }

      const ctx = mCanvas.getContext('2d');
      if (!ctx) return;
      ctx.clearRect(0, 0, w, h);

      const { startImg, currentImg } = marqueeStateRef.current;
      const startVp = v.viewport.imageToViewportCoordinates(
        new OpenSeadragon.Point(startImg.x, startImg.y),
      );
      const endVp = v.viewport.imageToViewportCoordinates(
        new OpenSeadragon.Point(currentImg.x, currentImg.y),
      );
      const startPx = v.viewport.pixelFromPoint(startVp, true);
      const endPx = v.viewport.pixelFromPoint(endVp, true);

      const rx = Math.min(startPx.x, endPx.x);
      const ry = Math.min(startPx.y, endPx.y);
      const rw = Math.abs(endPx.x - startPx.x);
      const rh = Math.abs(endPx.y - startPx.y);

      if (mode === 'object-select') {
        ctx.fillStyle = 'rgba(20, 184, 166, 0.2)';
        ctx.strokeStyle = 'rgba(20, 184, 166, 1)';
      } else if (mode === 'select') {
        ctx.fillStyle = 'rgba(59, 130, 246, 0.2)';
        ctx.strokeStyle = 'rgba(59, 130, 246, 1)';
      } else {
        ctx.fillStyle = 'rgba(239, 68, 68, 0.2)';
        ctx.strokeStyle = 'rgba(239, 68, 68, 1)';
      }
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 3]);
      ctx.fillRect(rx, ry, rw, rh);
      ctx.strokeRect(rx, ry, rw, rh);
      ctx.setLineDash([]);

      event.preventDefaultAction = true;
    });

    viewer.addHandler('canvas-release', function(event: any) {
      // End brush/eraser painting
      if (isPaintingRef.current) {
        const mode = clickModeRef.current;

        // Handle split release — apply the cut
        if (mode === 'split' && lastPaintImgRef.current) {
          const v = viewerRef.current;
          if (v && v.isOpen()) {
            const viewportPoint = v.viewport.pointFromPixel(event.position, true);
            const endImgPoint = v.viewport.viewportToImageCoordinates(viewportPoint);
            const startPt = lastPaintImgRef.current;

            // Only apply if the user dragged a meaningful distance
            const dist = Math.hypot(endImgPoint.x - startPt.x, endImgPoint.y - startPt.y);
            if (dist > 1) {
              const size = imageSizeRef.current;
              if (size) {
                const currentGaps = gapsRef.current;
                const newGaps = applySplit(
                  currentGaps,
                  startPt,
                  { x: endImgPoint.x, y: endImgPoint.y },
                  size.width,
                  size.height,
                );
                gapsRef.current = newGaps;
                onGapsModifiedRef.current?.(newGaps);
                scheduleFullRedraw();
              }
            }
          }

          // Clear the split preview line
          const bCanvas = brushCursorCanvasRef.current;
          if (bCanvas) {
            const ctx = bCanvas.getContext('2d');
            if (ctx) ctx.clearRect(0, 0, bCanvas.width, bCanvas.height);
          }
        }

        isPaintingRef.current = false;
        lastPaintImgRef.current = null;
        return;
      }

      if (!marqueeStateRef.current.isDragging) return;
      marqueeStateRef.current.isDragging = false;

      // Clear marquee canvas immediately
      const mCanvas = marqueeCanvasRef.current;
      if (mCanvas) {
        const ctx = mCanvas.getContext('2d');
        if (ctx) ctx.clearRect(0, 0, mCanvas.width, mCanvas.height);
      }

      const mode = clickModeRef.current;
      if (mode === 'pan') return;

      const v = viewerRef.current;
      if (!v || !v.isOpen()) return;

      // Skip tiny drags — let canvas-click handle single-gap clicks
      const { startImg, currentImg } = marqueeStateRef.current;
      const startVp = v.viewport.imageToViewportCoordinates(
        new OpenSeadragon.Point(startImg.x, startImg.y),
      );
      const endVp = v.viewport.imageToViewportCoordinates(
        new OpenSeadragon.Point(currentImg.x, currentImg.y),
      );
      const startPx = v.viewport.pixelFromPoint(startVp, true);
      const endPx = v.viewport.pixelFromPoint(endVp, true);
      const screenDist = Math.hypot(endPx.x - startPx.x, endPx.y - startPx.y);
      if (screenDist < 5) return;

      // Object Select — emit bbox to parent and let AnalysisView call the API
      if (mode === 'object-select') {
        const x = Math.round(Math.min(startImg.x, currentImg.x));
        const y = Math.round(Math.min(startImg.y, currentImg.y));
        const width = Math.round(Math.abs(currentImg.x - startImg.x));
        const height = Math.round(Math.abs(currentImg.y - startImg.y));
        if (width > 0 && height > 0) {
          onObjectSelectBboxRef.current?.({ x, y, width, height });
        }
        return;
      }

      // Bounding box in image coordinates
      const minX = Math.min(startImg.x, currentImg.x);
      const maxX = Math.max(startImg.x, currentImg.x);
      const minY = Math.min(startImg.y, currentImg.y);
      const maxY = Math.max(startImg.y, currentImg.y);

      const currentGaps = gapsRef.current;
      const tiledImage = v.world.getItemAt(0);
      if (!tiledImage) return;
      const imgSize = tiledImage.getContentSize();

      const matchedIds: number[] = [];

      for (let gi = 0; gi < currentGaps.length; gi++) {
        const gap = currentGaps[gi];
        const coords = getCoords(gap);
        if (!coords) continue;

        const isNorm = coords.every(v => v >= 0 && v <= 1);

        // Check centroid first
        const centroid = gap.centroid_norm;
        if (centroid) {
          const cx = centroid[0] * imgSize.x;
          const cy = centroid[1] * imgSize.y;
          if (cx >= minX && cx <= maxX && cy >= minY && cy <= maxY) {
            matchedIds.push(gi);
            continue;
          }
        }

        // Check polygon vertices
        for (let i = 0; i < coords.length; i += 2) {
          const vx = isNorm ? coords[i] * imgSize.x : coords[i];
          const vy = isNorm ? coords[i + 1] * imgSize.y : coords[i + 1];
          if (vx >= minX && vx <= maxX && vy >= minY && vy <= maxY) {
            matchedIds.push(gi);
            break;
          }
        }
      }

      if (matchedIds.length > 0) {
        onSelectGapRef.current(matchedIds, mode === 'select' ? 'select' : 'deselect');
      }
    });

    return () => {
      cleaned = true;
      cancelAnimationFrame(rafIdRef.current);
      if (retryRef.current) clearTimeout(retryRef.current);
      stopTimer();
      resizeObserver.disconnect();
      osdCanvasEl.removeEventListener('mousemove', onMouseMove);
      osdCanvasEl.removeEventListener('mouseleave', clearBrushCursor);
      if (brushCursorCanvasRef.current && brushCursorCanvasRef.current.parentNode) {
        brushCursorCanvasRef.current.parentNode.removeChild(brushCursorCanvasRef.current);
      }
      brushCursorCanvasRef.current = null;
      if (marqueeCanvasRef.current && marqueeCanvasRef.current.parentNode) {
        marqueeCanvasRef.current.parentNode.removeChild(marqueeCanvasRef.current);
      }
      marqueeCanvasRef.current = null;
      if (canvasRef.current && canvasRef.current.parentNode) {
        canvasRef.current.parentNode.removeChild(canvasRef.current);
      }
      canvasRef.current = null;
      viewer.destroy();
      viewerRef.current = null;
    };
  }, [stem, startTimer, stopTimer, scheduleRedraw, scheduleFullRedraw, retrySignal]);

  // Redraw whenever gap data or visibility changes
  useEffect(() => {
    scheduleFullRedraw();
  }, [gaps, hiddenGapIndices, selectedGapIds, hideUnselected, isOutlineOnly, outlineColor, fillColor, selectedColor, scheduleFullRedraw]);

  // Safely handle fullscreen transitions — stagger redraws to let the DOM settle
  // before OSD reads container dimensions.
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;

    const timeouts = [50, 200, 500].map(delay =>
      setTimeout(() => {
        if (!viewerRef.current) return;
        viewerRef.current.forceRedraw();
        scheduleFullRedraw();
      }, delay),
    );

    return () => timeouts.forEach(clearTimeout);
  }, [isFullscreen, scheduleFullRedraw]);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;

    const timeouts = [0, 180, 320].map(delay =>
      setTimeout(() => {
        if (!viewerRef.current) return;
        viewerRef.current.forceRedraw();
        scheduleFullRedraw();
      }, delay),
    );

    return () => timeouts.forEach(clearTimeout);
  }, [layoutSignal, scheduleFullRedraw]);

  // Apply grayscale only to OSD's drawing surface, not our overlay
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    const drawerCanvas = viewer.drawer?.canvas as HTMLElement | undefined;
    if (drawerCanvas) {
      drawerCanvas.style.filter = grayscale ? 'grayscale(1)' : 'none';
      drawerCanvas.style.transition = 'filter 0.4s ease';
    }
  }, [grayscale]);

  // Minimap toggle effect
  useEffect(() => {
    const viewer = viewerRef.current;
    if (viewer && (viewer as any).navigator) {
      (viewer as any).navigator.element.style.display = showMinimap ? 'block' : 'none';
    }
  }, [showMinimap]);

  // Update cursor based on clickMode
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    const canvas = viewer.canvas as HTMLElement;
    if (clickMode === 'pan') {
      canvas.style.cursor = 'grab';
    } else if (clickMode === 'brush' || clickMode === 'eraser') {
      canvas.style.cursor = 'none';
    } else if (clickMode === 'magic-wand') {
      canvas.style.cursor = 'cell';
    } else if (clickMode === 'object-select') {
      canvas.style.cursor = 'crosshair';
    } else {
      canvas.style.cursor = 'crosshair';
    }
  }, [clickMode]);

  return (
    <div className="absolute inset-0 w-full h-full bg-black overflow-hidden">

      {/* OSD container — no filter here; grayscale applied to drawer canvas directly */}
      <div
        ref={containerRef}
        className="absolute inset-0 w-full h-full"
      />

      {/* Polygon overlay canvas is injected programmatically into viewer.canvas */}

      {/* Loading / error overlay */}
      {!tilesReady && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-gray-950 z-10">
          {tileError ? (
            <>
              <svg className="w-8 h-8 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round"
                      d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
              </svg>
              <p className="text-sm text-gray-300">{tileError}</p>
              <button
                onClick={() => { setRetrySignal(s => s + 1); }}
                className="px-4 py-1.5 text-sm bg-blue-600 hover:bg-blue-500 text-white rounded-md"
              >
                Try Again
              </button>
            </>
          ) : (
            <>
              <svg className="w-8 h-8 animate-spin text-blue-400" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10"
                        stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              <p className="text-sm text-gray-400">Preparing image tiles…</p>
              <p className="text-xs text-gray-600">
                {elapsed < 10
                  ? 'This may take a moment for large images'
                  : `Still working… ${elapsed}s elapsed`}
              </p>
            </>
          )}
        </div>
      )}

    </div>
  );
}
