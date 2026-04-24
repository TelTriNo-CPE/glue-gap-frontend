import { useEffect, useRef, useState, useCallback } from 'react';
import OpenSeadragon from 'openseadragon';
import { getDziUrl } from '../api';
import type { Gap } from '../types';

interface Props {
  stem: string;
  gaps: Gap[];
  hiddenGapIndices: Set<number>;
  hideUnselected: boolean;
  isOutlineOnly: boolean;
  showMinimap: boolean;
  isFullscreen: boolean;
  clickMode: 'select' | 'deselect';
  grayscale: boolean;
  selectedGapIds: Set<number>;
  onSelectGap: (id: number | null, mode?: 'select' | 'deselect' | 'toggle' | 'clear') => void;
  onVisibleGapsChange?: (visibleIds: Set<number>) => void;
}

// ─── Drawing constants ────────────────────────────────────────────────────────
const STROKE_COLOR = '#ff0000';
const FILL_COLOR   = 'rgba(255, 0, 0, 0.12)';
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

export default function OsdViewer({ stem, gaps, hiddenGapIndices, hideUnselected, isOutlineOnly, showMinimap, isFullscreen, clickMode, grayscale, selectedGapIds, onSelectGap, onVisibleGapsChange }: Props) {
  const containerRef  = useRef<HTMLDivElement>(null);
  const canvasRef     = useRef<HTMLCanvasElement | null>(null);
  const viewerRef     = useRef<OpenSeadragon.Viewer | null>(null);
  const retryRef      = useRef<ReturnType<typeof setTimeout> | null>(null);
  const animatingRef  = useRef(false);
  const rafIdRef      = useRef(0);

  const [tilesReady, setTilesReady] = useState(false);
  const [elapsed,    setElapsed]    = useState(0);
  const elapsedRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const gapsRef       = useRef<Gap[]>(gaps);
  const hiddenRef     = useRef<Set<number>>(hiddenGapIndices);
  const selectedRef   = useRef<Set<number>>(selectedGapIds);
  const hideUnselectedRef = useRef<boolean>(hideUnselected);
  const isOutlineOnlyRef = useRef<boolean>(isOutlineOnly);
  const clickModeRef  = useRef<'select' | 'deselect'>(clickMode);
  const onVisibleGapsChangeRef = useRef(onVisibleGapsChange);
  const lastVisibleGapsRef = useRef<Set<number>>(new Set());

  useEffect(() => { gapsRef.current = gaps; }, [gaps]);
  useEffect(() => { hiddenRef.current = hiddenGapIndices; }, [hiddenGapIndices]);
  useEffect(() => { selectedRef.current = selectedGapIds; }, [selectedGapIds]);
  useEffect(() => { hideUnselectedRef.current = hideUnselected; }, [hideUnselected]);
  useEffect(() => { isOutlineOnlyRef.current = isOutlineOnly; }, [isOutlineOnly]);
  useEffect(() => { clickModeRef.current = clickMode; }, [clickMode]);
  useEffect(() => { onVisibleGapsChangeRef.current = onVisibleGapsChange; }, [onVisibleGapsChange]);

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

    // Image dimensions for denormalization
    const imgSize = tiledImage.getContentSize();
    const imgW = imgSize.x;
    const imgH = imgSize.y;

    // ── 2. Context state batching: set styles ONCE before the loop ──────
    ctx.strokeStyle = STROKE_COLOR;
    ctx.lineWidth   = LINE_WIDTH;
    ctx.fillStyle   = FILL_COLOR;
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
          ctx.strokeStyle = '#FFD600';
          ctx.lineWidth = isOutlineOnly ? 6 : 4;
          ctx.stroke();
          if (!isOutlineOnly) {
            ctx.fillStyle = 'rgba(255, 255, 0, 0.4)';
            ctx.fill();
          }
          ctx.restore();
        } else {
          ctx.stroke();
          if (!isOutlineOnly) {
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
      tileSources: getDziUrl(stem),
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

    viewer.addHandler('open', () => {
      setTilesReady(true);
      stopTimer();
      scheduleFullRedraw();
    });

    viewer.addHandler('open-failed', () => {
      retryRef.current = setTimeout(() => viewer.open(getDziUrl(stem) as unknown as OpenSeadragon.TileSourceSpecifier), 2000);
    });

    // ── Animation tracking for LOD ──────────────────────────────────────
    viewer.addHandler('animation-start', () => { animatingRef.current = true; });
    viewer.addHandler('animation-finish', () => {
      animatingRef.current = false;
      scheduleFullRedraw();
    });

    // Throttled redraws during viewport changes
    viewer.addHandler('update-viewport', scheduleRedraw);
    viewer.addHandler('resize', scheduleFullRedraw);

    // Canvas click handler for gap selection
    viewer.addHandler('canvas-click', function(event) {
      if (!viewerRef.current || !viewerRef.current.isOpen()) return;
      const viewportPoint = viewerRef.current.viewport.pointFromPixel(event.position, true);
      const tiledImage = viewerRef.current.world.getItemAt(0);
      if (!tiledImage) return;
      const imgSize = tiledImage.getContentSize();
      const imgPoint = viewerRef.current.viewport.viewportToImageCoordinates(viewportPoint);
      const x = imgPoint.x, y = imgPoint.y;

      const currentGaps = gapsRef.current;
      const currentClickMode = clickModeRef.current;

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
          onSelectGap(found, 'select');
          event.preventDefaultAction = true;
        }
        // In 'select' mode, clicking outside does nothing to current selection
      } else {
        // Deselect mode
        if (found !== null) {
          onSelectGap(found, 'deselect');
          event.preventDefaultAction = true;
        } else {
          // Clicking anywhere outside clears selection
          onSelectGap(null, 'clear');
        }
      }
    });

    return () => {
      cancelAnimationFrame(rafIdRef.current);
      if (retryRef.current) clearTimeout(retryRef.current);
      stopTimer();
      if (canvasRef.current && canvasRef.current.parentNode) {
        canvasRef.current.parentNode.removeChild(canvasRef.current);
      }
      canvasRef.current = null;
      viewer.destroy();
      viewerRef.current = null;
    };
  }, [stem, startTimer, stopTimer, scheduleRedraw, scheduleFullRedraw]);

  // Redraw whenever gap data, visibility or fullscreen changes
  useEffect(() => {
    // Force OSD to update its layout when exiting/entering fullscreen
    if (viewerRef.current) {
      viewerRef.current.forceRedraw();
    }
    
    // Use a small timeout to let the DOM settle after fullscreen transition
    const t = setTimeout(() => {
      scheduleFullRedraw();
    }, 150);
    
    return () => clearTimeout(t);
  }, [gaps, hiddenGapIndices, selectedGapIds, hideUnselected, isOutlineOnly, isFullscreen, scheduleFullRedraw]);

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

  return (
    <div className="flex-1 relative bg-black" style={{ minWidth: 0 }}>

      {/* OSD container — no filter here; grayscale applied to drawer canvas directly */}
      <div
        ref={containerRef}
        className="absolute inset-0"
      />

      {/* Polygon overlay canvas is injected programmatically into viewer.canvas */}

      {/* Loading overlay */}
      {!tilesReady && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-gray-950 z-10">
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
        </div>
      )}

    </div>
  );
}

