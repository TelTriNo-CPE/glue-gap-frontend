import { useEffect, useRef, useState, useCallback } from 'react';
import OpenSeadragon from 'openseadragon';
import { getDziUrl } from '../api';
import type { Gap } from '../types';

interface Props {
  stem: string;
  gaps: Gap[];
  hiddenGapIndices: Set<number>;
  grayscale: boolean;
}

// ─── Drawing constants ────────────────────────────────────────────────────────
const STROKE_COLOR = '#ff0000';
const FILL_COLOR   = 'rgba(255, 0, 0, 0.12)';
const LINE_WIDTH   = 2;

/**
 * Extract the flat coordinate array from a gap object, trying every field name
 * the backend might use. Logs a warning if none are found.
 */
function getCoords(gap: unknown): number[] | undefined {
  if (typeof gap !== 'object' || !gap) return undefined;
  const g = gap as Record<string, unknown>;

  // Try every plausible backend field name in priority order
  for (const key of ['coordinates', 'contour', 'contour_pts', 'polygon', 'points', 'vertices']) {
    const val = g[key];
    if (Array.isArray(val) && val.length >= 6) return val as number[];
  }
  return undefined;
}

export default function OsdViewer({ stem, gaps, hiddenGapIndices, grayscale }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef    = useRef<HTMLCanvasElement>(null);
  const viewerRef    = useRef<OpenSeadragon.Viewer | null>(null);
  const retryRef     = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Reset to false whenever new gap data arrives so the diagnostic always
  // fires once per analysis result, not just once per page load.
  const diagDoneRef = useRef(false);

  const [tilesReady, setTilesReady] = useState(false);
  const [elapsed,    setElapsed]    = useState(0);
  const elapsedRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const gapsRef   = useRef<Gap[]>(gaps);
  const hiddenRef = useRef<Set<number>>(hiddenGapIndices);

  // Reset diagnostic flag whenever new gap data arrives so we get a fresh log
  useEffect(() => {
    gapsRef.current = gaps;
    if (gaps.length > 0) diagDoneRef.current = false;
  }, [gaps]);

  useEffect(() => { hiddenRef.current = hiddenGapIndices; }, [hiddenGapIndices]);

  const startTimer = useCallback(() => {
    setElapsed(0);
    elapsedRef.current = setInterval(() => setElapsed(s => s + 1), 1000);
  }, []);

  const stopTimer = useCallback(() => {
    if (elapsedRef.current) { clearInterval(elapsedRef.current); elapsedRef.current = null; }
  }, []);

  // ── Core draw function — stable, reads live state from refs ──────────────
  const drawPolygons = useCallback(() => {
    const viewer = viewerRef.current;
    const canvas = canvasRef.current;

    if (!viewer || !canvas || !viewer.isOpen()) return;

    const tiledImage = viewer.world.getItemAt(0);
    if (!tiledImage) return;

    // Size the canvas backing buffer to its CSS layout size
    const w = canvas.offsetWidth;
    const h = canvas.offsetHeight;
    if (w === 0 || h === 0) {
      console.warn('[GlueGap] Canvas has zero dimensions — skipping draw.');
      return;
    }
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width  = w;
      canvas.height = h;
    }

    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, w, h);

    const currentGaps   = gapsRef.current;
    const currentHidden = hiddenRef.current;
    if (currentGaps.length === 0) return;

    // ── One-shot diagnostic — fires once per analysis result ─────────────
    if (!diagDoneRef.current) {
      diagDoneRef.current = true;

      const first = currentGaps[0] as Record<string, unknown>;
      console.group('[GlueGap] Polygon draw diagnostic');
      console.log('Gap object keys :', Object.keys(first));
      console.log('Gap count       :', currentGaps.length);
      console.log('Canvas size     :', `${w} × ${h}`);

      const coords = getCoords(first);
      if (coords) {
        console.log('Coord field found, first 8 values:', coords.slice(0, 8));
        try {
          const vpPt = tiledImage.imageToViewportCoordinates(coords[0], coords[1]);
          const px   = viewer.viewport.viewportToViewerElementCoordinates(vpPt);
          console.log(
            `Coord pipeline  : img(${coords[0]}, ${coords[1]})` +
            ` → vp(${vpPt.x.toFixed(4)}, ${vpPt.y.toFixed(4)})` +
            ` → screen(${px.x.toFixed(1)}, ${px.y.toFixed(1)})`,
          );
          const inBounds = px.x >= 0 && px.x <= w && px.y >= 0 && px.y <= h;
          console.log('First point in canvas bounds?', inBounds);
        } catch (e) {
          console.error('Coord conversion threw:', e);
        }
      } else {
        console.warn('⚠ No coordinate array found. Tried: coordinates, contour, contour_pts, polygon, points, vertices');
        console.log('Raw first gap (truncated):', JSON.stringify(first).slice(0, 400));
      }
      console.groupEnd();
    }
    // ─────────────────────────────────────────────────────────────────────

    ctx.strokeStyle = STROKE_COLOR;
    ctx.fillStyle   = FILL_COLOR;
    ctx.lineWidth   = LINE_WIDTH;
    ctx.lineJoin    = 'round';

    let drawn = 0;
    let skippedNoCoords = 0;

    for (let gi = 0; gi < currentGaps.length; gi++) {
      if (currentHidden.has(gi)) continue;

      const coords = getCoords(currentGaps[gi]);
      if (!coords) { skippedNoCoords++; continue; }

      try {
        ctx.beginPath();
        for (let i = 0; i < coords.length; i += 2) {
          const vpPt = tiledImage.imageToViewportCoordinates(coords[i], coords[i + 1]);
          const px   = viewer.viewport.viewportToViewerElementCoordinates(vpPt);
          if (i === 0) ctx.moveTo(px.x, px.y);
          else         ctx.lineTo(px.x, px.y);
        }
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        drawn++;
      } catch {
        // Skip individual polygons that fail coordinate conversion
      }
    }

    // ── Visible fallback: if we have gaps but drew nothing, show a banner ──
    if (drawn === 0 && currentGaps.length > 0) {
      const msg = skippedNoCoords === currentGaps.length
        ? `⚠ ${currentGaps.length} gaps loaded but no coordinate field found — check console`
        : `⚠ ${currentGaps.length} gaps loaded but 0 polygons drawn — check console`;

      ctx.save();
      ctx.fillStyle   = 'rgba(220,38,38,0.85)';
      ctx.strokeStyle = '#fff';
      ctx.lineWidth   = 1;
      const pad = 12;
      const bh  = 36;
      ctx.fillRect(0, 0, w, bh);
      ctx.fillStyle = '#fff';
      ctx.font      = 'bold 13px ui-sans-serif, sans-serif';
      ctx.textBaseline = 'middle';
      ctx.fillText(msg, pad, bh / 2);
      ctx.restore();

      console.error(`[GlueGap] ${msg}`);
    }
  }, []); // stable — reads live data from refs

  // ── Viewer init ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current) return;

    setTilesReady(false);
    startTimer();

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

    viewer.addHandler('open', () => {
      setTilesReady(true);
      stopTimer();
      drawPolygons();
    });

    viewer.addHandler('open-failed', () => {
      retryRef.current = setTimeout(() => viewer.open(getDziUrl(stem)), 2000);
    });

    viewer.addHandler('update-viewport', drawPolygons);
    viewer.addHandler('animation',       drawPolygons);
    viewer.addHandler('resize',          drawPolygons);

    return () => {
      if (retryRef.current) clearTimeout(retryRef.current);
      stopTimer();
      viewer.destroy();
      viewerRef.current = null;
    };
  }, [stem, startTimer, stopTimer, drawPolygons]);

  // ── Redraw whenever gap data or visibility changes ────────────────────────
  useEffect(() => {
    drawPolygons();
  }, [gaps, hiddenGapIndices, drawPolygons]);

  return (
    <div className="flex-1 relative bg-black" style={{ minWidth: 0 }}>

      {/* OSD image — grayscale filter only affects tiles, not the polygon canvas */}
      <div
        ref={containerRef}
        className="absolute inset-0"
        style={{
          filter: grayscale ? 'grayscale(1)' : 'none',
          transition: 'filter 0.4s ease',
        }}
      />

      {/*
        Polygon canvas — sibling of OSD container so grayscale filter doesn't
        affect polygon colours. z-index 1 puts it above OSD (z:auto) but below
        the loading overlay (z-10). pointer-events:none lets OSD handle input.
      */}
      <canvas
        ref={canvasRef}
        className="absolute inset-0"
        style={{ zIndex: 1, pointerEvents: 'none' }}
      />

      {/* Loading overlay — z-10 keeps it above the polygon canvas */}
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
