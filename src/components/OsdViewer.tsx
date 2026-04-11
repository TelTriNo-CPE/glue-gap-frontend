import { useEffect, useRef, useState, useCallback } from 'react';
import OpenSeadragon from 'openseadragon';
import { getDziUrl } from '../api';
import type { Gap } from '../types';

interface Props {
  stem: string;
  gaps: Gap[];
  imageSize: { width: number; height: number };
  hiddenGapIndices: Set<number>;
  grayscale: boolean;
}

function addOverlays(
  viewer: OpenSeadragon.Viewer,
  gaps: Gap[],
  imageSize: { width: number; height: number }
) {
  const tiledImage = viewer.world.getItemAt(0);
  gaps.forEach((gap, index) => {
    const cx = gap.centroid_norm[0] * imageSize.width;
    const cy = gap.centroid_norm[1] * imageSize.height;
    const r = gap.equiv_radius_px;
    const rect = tiledImage.imageToViewportRectangle(cx - r, cy - r, r * 2, r * 2);
    const el = document.createElement('div');
    el.id = `gap-${index}`;
    el.style.cssText =
      'border:2px solid rgba(239,68,68,0.85);border-radius:50%;' +
      'box-sizing:border-box;pointer-events:none;';
    viewer.addOverlay({ element: el, location: rect });
  });
}

export default function OsdViewer({ stem, gaps, imageSize, hiddenGapIndices, grayscale }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<OpenSeadragon.Viewer | null>(null);
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [tilesReady, setTilesReady] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const elapsedRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const startTimer = useCallback(() => {
    setElapsed(0);
    elapsedRef.current = setInterval(() => setElapsed(s => s + 1), 1000);
  }, []);

  const stopTimer = useCallback(() => {
    if (elapsedRef.current) { clearInterval(elapsedRef.current); elapsedRef.current = null; }
  }, []);

  // Init viewer
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
      if (gaps.length > 0) addOverlays(viewer, gaps, imageSize);
    });

    viewer.addHandler('open-failed', () => {
      // Tiles still generating — retry every 2 s for fast detection
      retryRef.current = setTimeout(() => {
        viewer.open(getDziUrl(stem));
      }, 2000);
    });

    return () => {
      if (retryRef.current) clearTimeout(retryRef.current);
      stopTimer();
      viewer.destroy();
      viewerRef.current = null;
    };
  }, [stem]); // eslint-disable-line react-hooks/exhaustive-deps

  // Add overlays when gaps arrive after viewer is already open
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || !viewer.isOpen() || gaps.length === 0) return;
    viewer.clearOverlays();
    addOverlays(viewer, gaps, imageSize);
  }, [gaps, imageSize]);

  // Sync overlay visibility
  useEffect(() => {
    gaps.forEach((_, index) => {
      const el = document.getElementById(`gap-${index}`);
      if (el) el.style.display = hiddenGapIndices.has(index) ? 'none' : '';
    });
  }, [hiddenGapIndices, gaps]);

  return (
    <div className="flex-1 relative bg-black" style={{ minWidth: 0 }}>
      {/* OSD canvas */}
      <div
        ref={containerRef}
        className="absolute inset-0"
        style={{
          filter: grayscale ? 'grayscale(1)' : 'none',
          transition: 'filter 0.4s ease',
        }}
      />

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
