import * as turf from '@turf/turf';
import type { Feature, Polygon } from 'geojson';
import OpenSeadragon from 'openseadragon';

/** Safety cap: flood fill will not expand beyond this many pixels. */
const MAX_FILL_PIXELS = 400_000;

/** Maximum boundary vertices before downsampling kicks in. */
const MAX_BOUNDARY_VERTICES = 400;

// ─── Moore-neighborhood direction table (clockwise, starting from "left") ────
const DX8 = [-1, -1,  0,  1,  1,  1,  0, -1] as const;
const DY8 = [ 0, -1, -1, -1,  0,  1,  1,  1] as const;

// ─── Flood Fill ───────────────────────────────────────────────────────────────

/**
 * Euclidean colour distance between two RGBA pixels (alpha ignored).
 */
function colorDist(data: Uint8ClampedArray, i1: number, i2: number): number {
  const dr = data[i1]     - data[i2];
  const dg = data[i1 + 1] - data[i2 + 1];
  const db = data[i1 + 2] - data[i2 + 2];
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

/**
 * 4-connected BFS flood fill.
 * Returns a Uint8Array mask (1 = filled, 0 = background).
 * Stops early if the fill reaches MAX_FILL_PIXELS.
 */
function floodFill(
  data: Uint8ClampedArray,
  w: number,
  h: number,
  sx: number,
  sy: number,
  tolerance: number,
): Uint8Array {
  const mask = new Uint8Array(w * h);
  if (sx < 0 || sx >= w || sy < 0 || sy >= h) return mask;

  const si = (sy * w + sx) * 4;
  // Transparent seed pixel — nothing to fill
  if (data[si + 3] === 0) return mask;

  const queue: number[] = [sy * w + sx];
  mask[sy * w + sx] = 1;
  let head = 0;
  let filled = 0;

  while (head < queue.length && filled < MAX_FILL_PIXELS) {
    const flat = queue[head++];
    const x = flat % w;
    const y = (flat / w) | 0;
    filled++;

    // 4-connected neighbours
    const neighbours: [number, number][] = [
      [x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1],
    ];

    for (const [nx, ny] of neighbours) {
      if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
      const nflat = ny * w + nx;
      if (mask[nflat]) continue;
      const ni = nflat * 4;
      if (data[ni + 3] === 0) continue; // skip transparent
      if (colorDist(data, si, ni) <= tolerance) {
        mask[nflat] = 1;
        queue.push(nflat);
      }
    }
  }

  return mask;
}

// ─── Moore Boundary Tracing ───────────────────────────────────────────────────

/**
 * Return the index (0–7) in the DX8/DY8 table for the direction from
 * (fromX, fromY) to (toX, toY). Falls back to 0 if not found.
 */
function dirIndex(fromX: number, fromY: number, toX: number, toY: number): number {
  const ddx = toX - fromX;
  const ddy = toY - fromY;
  for (let d = 0; d < 8; d++) {
    if (DX8[d] === ddx && DY8[d] === ddy) return d;
  }
  return 0;
}

/**
 * Moore neighbourhood contour tracing with Jacob's stopping criterion.
 * Returns the outer boundary of the binary mask as canvas pixel coordinates.
 */
function traceBoundary(mask: Uint8Array, w: number, h: number): [number, number][] {
  // Find the topmost-leftmost filled pixel
  let startX = -1, startY = -1;
  outer:
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (mask[y * w + x]) { startX = x; startY = y; break outer; }
    }
  }
  if (startX === -1) return [];

  const boundary: [number, number][] = [[startX, startY]];

  // Initial backtrack: the pixel directly to the left of start (always outside).
  const initBx = startX - 1;
  const initBy = startY;
  let bx = initBx, by = initBy;
  let cx = startX, cy = startY;

  // Safety limit: boundary can't have more points than total pixels
  const maxIter = w * h * 2;

  for (let iter = 0; iter < maxIter; iter++) {
    const dIdx = dirIndex(cx, cy, bx, by);

    let moved = false;
    for (let d = 1; d <= 8; d++) {
      const ni = (dIdx + d) % 8;
      const nx = cx + DX8[ni];
      const ny = cy + DY8[ni];

      // Candidate new backtrack (the last non-filled neighbour we checked)
      const prevNi = (dIdx + d - 1) % 8;
      const nbx = cx + DX8[prevNi];
      const nby = cy + DY8[prevNi];

      if (nx >= 0 && nx < w && ny >= 0 && ny < h && mask[ny * w + nx]) {
        // Jacob's stopping criterion: back at start with same approach direction
        if (nx === startX && ny === startY && nbx === initBx && nby === initBy) {
          return boundary;
        }

        bx = nbx; by = nby;
        cx = nx;  cy = ny;
        boundary.push([cx, cy]);
        moved = true;
        break;
      }
    }

    // Isolated single pixel
    if (!moved) break;
  }

  return boundary;
}

// ─── Main entry point ─────────────────────────────────────────────────────────

/**
 * Execute the magic wand selection from a viewer click event.
 *
 * Steps:
 *  A. Map click position to drawer-canvas pixel coordinates.
 *  B. Extract ImageData via a temporary 2D canvas (works for both Canvas2D
 *     and WebGL drawers, provided tiles are same-origin).
 *  C. BFS flood fill from the seed pixel within the given tolerance.
 *  D. Trace the outer boundary using Moore neighbourhood tracing.
 *  E. Downsample and convert boundary points to image pixel coordinates.
 *  F. Build a simplified Turf Polygon and return it.
 *
 * Returns `null` if:
 *  - The drawer canvas is unavailable or tainted (CORS).
 *  - The seed pixel is transparent.
 *  - The filled region is too small (< 4 px).
 *  - The boundary has fewer than 3 points.
 */
export function executeMagicWand(
  viewer: OpenSeadragon.Viewer,
  /** Click position in viewer-element CSS pixel coordinates (from OSD event.position). */
  clickPos: OpenSeadragon.Point,
  /** Colour-similarity tolerance (Euclidean RGB distance, 0–255). */
  tolerance: number,
): Feature<Polygon> | null {

  // ── A: Map click to drawer-canvas pixel space ─────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const drawerCanvas = (viewer.drawer as any)?.canvas as HTMLCanvasElement | null;
  if (!drawerCanvas) return null;

  const viewerEl = viewer.canvas as HTMLElement;
  const elW = viewerEl.clientWidth;
  const elH = viewerEl.clientHeight;
  const cvW = drawerCanvas.width;
  const cvH = drawerCanvas.height;
  if (!elW || !elH || !cvW || !cvH) return null;

  // Scale factor: drawer canvas pixels per CSS pixel (accounts for devicePixelRatio)
  const scaleX = cvW / elW;
  const scaleY = cvH / elH;

  const px = Math.round(clickPos.x * scaleX);
  const py = Math.round(clickPos.y * scaleY);

  // Clamp to canvas bounds
  if (px < 0 || px >= cvW || py < 0 || py >= cvH) return null;

  // ── B: Read pixel data ────────────────────────────────────────────────────
  // Using a temporary 2D canvas to support both canvas2d and WebGL drawers.
  let imageData: ImageData;
  try {
    const tmp = document.createElement('canvas');
    tmp.width  = cvW;
    tmp.height = cvH;
    const tmpCtx = tmp.getContext('2d');
    if (!tmpCtx) return null;
    tmpCtx.drawImage(drawerCanvas, 0, 0);
    imageData = tmpCtx.getImageData(0, 0, cvW, cvH);
  } catch {
    // Canvas is tainted (CORS) or otherwise inaccessible
    return null;
  }

  // ── C: BFS flood fill ─────────────────────────────────────────────────────
  const mask = floodFill(imageData.data, cvW, cvH, px, py, tolerance);

  // Guard: too few pixels filled to form a meaningful polygon
  let filledCount = 0;
  for (let i = 0; i < mask.length; i++) filledCount += mask[i];
  if (filledCount < 4) return null;

  // ── D: Trace outer boundary ───────────────────────────────────────────────
  const rawBoundary = traceBoundary(mask, cvW, cvH);
  if (rawBoundary.length < 3) return null;

  // ── E: Downsample and convert to image coordinates ────────────────────────
  const step = Math.max(1, Math.ceil(rawBoundary.length / MAX_BOUNDARY_VERTICES));
  // Always include the last point so the polygon closes cleanly
  const sampled: [number, number][] = [];
  for (let i = 0; i < rawBoundary.length; i += step) sampled.push(rawBoundary[i]);
  if (sampled.length < 3) return null;

  const imageCoords: [number, number][] = sampled.map(([bx, by]) => {
    // Drawer-canvas pixel → viewer element CSS pixel → viewport → image
    const vpPt = viewer.viewport.pointFromPixel(
      new OpenSeadragon.Point(bx / scaleX, by / scaleY),
      true, // use current zoom (not target)
    );
    const imgPt = viewer.viewport.viewportToImageCoordinates(vpPt);
    return [imgPt.x, imgPt.y];
  });

  // ── F: Build Turf polygon and simplify ────────────────────────────────────
  // Close the ring
  const ring: [number, number][] = [...imageCoords, imageCoords[0]];

  let polygon: Feature<Polygon>;
  try {
    polygon = turf.polygon([ring]);
  } catch {
    return null;
  }

  // Light simplification to reduce vertex count (tolerance in image-pixel units)
  try {
    const simplified = turf.simplify(polygon, { tolerance: 1.5, highQuality: false });
    if (simplified.geometry.coordinates[0].length >= 4) {
      return simplified as Feature<Polygon>;
    }
  } catch {
    /* fall through and return the un-simplified polygon */
  }

  return polygon;
}
