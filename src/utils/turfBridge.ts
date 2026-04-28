import * as turf from '@turf/turf';
import polygonClipping from 'polygon-clipping';
import type { Feature, Polygon, MultiPolygon, Position } from 'geojson';
import type { Gap } from '../types';

// ─── Coordinate helpers ──────────────────────────────────────────────────────

/**
 * Convert a Gap's flat coordinates into a turf Polygon feature in pixel space.
 */
export function gapToTurfPolygon(gap: Gap, imgW: number, imgH: number): Feature<Polygon> {
  const raw = gap.coordinates;
  const isNormalized = raw.every(v => v >= 0 && v <= 1);

  const ring: Position[] = [];
  for (let i = 0; i < raw.length; i += 2) {
    const x = isNormalized ? raw[i] * imgW : raw[i];
    const y = isNormalized ? raw[i + 1] * imgH : raw[i + 1];
    ring.push([x, y]);
  }

  // Close the ring if not already closed
  if (
    ring.length > 0 &&
    (ring[0][0] !== ring[ring.length - 1][0] || ring[0][1] !== ring[ring.length - 1][1])
  ) {
    ring.push([ring[0][0], ring[0][1]]);
  }

  return turf.polygon([ring]);
}

/**
 * Convert a turf Polygon feature back into a Gap object.
 * Uses shoelace formula for area since turf.area assumes geographic coords.
 */
export function turfPolygonToGap(feature: Feature<Polygon>, imgW: number, imgH: number, source?: 'auto' | 'manual'): Gap {
  const ring = feature.geometry.coordinates[0];

  const area = shoelaceArea(ring);
  const radius = Math.sqrt(area / Math.PI);

  // Compute centroid in pixel space, then normalize
  let cx = 0, cy = 0;
  const n = ring.length - 1; // exclude closing point
  for (let i = 0; i < n; i++) {
    cx += ring[i][0];
    cy += ring[i][1];
  }
  cx /= n;
  cy /= n;

  // Flatten ring to flat coordinate array (pixel space, not normalized)
  const coordinates: number[] = [];
  for (let i = 0; i < n; i++) {
    coordinates.push(ring[i][0], ring[i][1]);
  }

  return {
    area_px: area,
    equiv_radius_px: radius,
    centroid_norm: [cx / imgW, cy / imgH],
    coordinates,
    source,
  };
}

/**
 * Shoelace formula for polygon area in pixel space.
 */
export function shoelaceArea(ring: Position[]): number {
  let area = 0;
  const n = ring.length - 1; // exclude closing duplicate
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    area += ring[i][0] * ring[j][1];
    area -= ring[j][0] * ring[i][1];
  }
  return Math.abs(area) / 2;
}

/**
 * Create a circle polygon in pixel space using parametric coordinates.
 * Does NOT use turf.circle (which requires geographic coords).
 */
export function createPixelCircle(cx: number, cy: number, radius: number, steps = 24): Feature<Polygon> {
  const ring: Position[] = [];
  for (let i = 0; i <= steps; i++) {
    const angle = (2 * Math.PI * i) / steps;
    ring.push([cx + radius * Math.cos(angle), cy + radius * Math.sin(angle)]);
  }
  return turf.polygon([ring]);
}

// ─── Geometry cleanup helpers ─────────────────────────────────────────────────

/**
 * Clean a polygon's coordinate rings to prepare for reliable boolean operations.
 *
 * AI-detected polygons (OpenCV contours) often contain:
 *   • Duplicate consecutive vertices (from contour compression artifacts)
 *   • Near-coincident floating-point values (sub-pixel noise)
 *   • Occasional self-intersections (bow-ties, figure-8s)
 *
 * All of these silently break polygon-clipping's sweep-line algorithm.
 *
 * This function applies the "buffer 0" trick in pixel-space:
 *   1. Round to 1 decimal place → eliminates sub-pixel float noise
 *   2. Remove duplicate consecutive vertices
 *   3. Self-union → for simple polygons, returns unchanged;
 *      for self-intersecting polygons, splits into valid simple pieces
 *
 * Returns an array of clean simple polygon ring-sets (polygon-clipping.Polygon[]).
 * Self-intersecting input may produce >1 output polygon.
 */
function cleanGapRings(rings: polygonClipping.Polygon): polygonClipping.Polygon[] {
  // Step 1: Round to 1 decimal place to eliminate floating-point noise
  const rounded: polygonClipping.Polygon = rings.map(ring =>
    ring.map(([x, y]) => [
      Math.round(x * 10) / 10,
      Math.round(y * 10) / 10,
    ] as [number, number])
  );

  // Step 2: Remove duplicate consecutive vertices within each ring
  const deduped: polygonClipping.Polygon = rounded.map(ring => {
    const out: [number, number][] = [];
    for (const pt of ring) {
      const prev = out.length > 0 ? out[out.length - 1] : null;
      if (!prev || pt[0] !== prev[0] || pt[1] !== prev[1]) {
        out.push(pt as [number, number]);
      }
    }
    // Ensure ring closure
    if (out.length > 0) {
      const first = out[0];
      const last = out[out.length - 1];
      if (first[0] !== last[0] || first[1] !== last[1]) {
        out.push([first[0], first[1]]);
      }
    }
    return out;
  });

  // Step 3: Self-union — the "buffer 0" equivalent in polygon-clipping space.
  // A simple polygon → returned unchanged (one polygon).
  // A self-intersecting polygon → split into valid simple pieces (≥1 polygons).
  try {
    const selfUnioned = polygonClipping.union(deduped as any);
    if (selfUnioned.length > 0) return selfUnioned;
  } catch (err) {
    console.warn('[turfBridge] cleanGapRings self-union failed:', err);
  }

  return [deduped]; // fallback: return deduplicated rings
}

/**
 * Clean the eraser stroke union polygon: round coordinates and remove duplicates.
 * The circles are already clean, but union junctions can have float artifacts.
 */
function cleanEraserRings(poly: polygonClipping.Polygon): polygonClipping.Polygon {
  return poly.map(ring => {
    const rounded = ring.map(([x, y]) => [
      Math.round(x * 10) / 10,
      Math.round(y * 10) / 10,
    ] as [number, number]);
    const out: [number, number][] = [];
    for (const pt of rounded) {
      const prev = out.length > 0 ? out[out.length - 1] : null;
      if (!prev || pt[0] !== prev[0] || pt[1] !== prev[1]) {
        out.push(pt);
      }
    }
    if (out.length > 0) {
      const first = out[0];
      const last = out[out.length - 1];
      if (first[0] !== last[0] || first[1] !== last[1]) {
        out.push([first[0], first[1]]);
      }
    }
    return out;
  });
}

/**
 * Simplify a stroke path so the union of circles stays manageable for long strokes.
 * Ensures consecutive kept points are at least `minSpacing` apart.
 * The first and last points are always preserved.
 */
function simplifyStrokePath(
  points: { x: number; y: number }[],
  minSpacing: number,
): { x: number; y: number }[] {
  if (points.length <= 2) return points;
  const result: { x: number; y: number }[] = [points[0]];
  for (let i = 1; i < points.length - 1; i++) {
    const prev = result[result.length - 1];
    if (Math.hypot(points[i].x - prev.x, points[i].y - prev.y) >= minSpacing) {
      result.push(points[i]);
    }
  }
  result.push(points[points.length - 1]);
  return result;
}

/** AABB of a polygon-clipping MultiPolygon [minX, minY, maxX, maxY]. */
function multiPolygonAabb(mp: polygonClipping.MultiPolygon): [number, number, number, number] {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const poly of mp) {
    for (const ring of poly) {
      for (const [x, y] of ring) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }
  return [minX, minY, maxX, maxY];
}

/** AABB of a polygon-clipping Polygon (Ring[]). */
function polyAabb(rings: polygonClipping.Polygon): [number, number, number, number] {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const ring of rings) {
    for (const [x, y] of ring) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  return [minX, minY, maxX, maxY];
}

function aabbsOverlap(
  [ax1, ay1, ax2, ay2]: [number, number, number, number],
  [bx1, by1, bx2, by2]: [number, number, number, number],
): boolean {
  return ax1 <= bx2 && ax2 >= bx1 && ay1 <= by2 && ay2 >= by1;
}

// ─── Brush / Eraser operations ───────────────────────────────────────────────

/**
 * Apply a brush stamp: union the circle with any overlapping gaps.
 * If nothing overlaps, creates a new gap from the circle alone.
 */
export function applyBrush(
  gaps: Gap[],
  center: { x: number; y: number },
  radius: number,
  imgW: number,
  imgH: number,
): Gap[] {
  const circle = createPixelCircle(center.x, center.y, radius);

  // Find all gaps that intersect the circle
  const overlappingIndices: number[] = [];
  const turfGaps: Feature<Polygon>[] = [];

  for (let i = 0; i < gaps.length; i++) {
    const turfGap = gapToTurfPolygon(gaps[i], imgW, imgH);
    turfGaps.push(turfGap);
    try {
      if (turf.booleanIntersects(turfGap, circle)) {
        overlappingIndices.push(i);
      }
    } catch {
      // Skip gaps that fail intersection test
    }
  }

  if (overlappingIndices.length === 0) {
    // No overlapping gaps — create a new gap from the circle
    const newGap = turfPolygonToGap(circle, imgW, imgH, 'manual');
    return [...gaps, newGap];
  }

  // Union circle + all overlapping gaps
  const toUnion = [circle.geometry.coordinates];
  for (const idx of overlappingIndices) {
    toUnion.push(turfGaps[idx].geometry.coordinates);
  }

  let mergedCoords: polygonClipping.MultiPolygon;
  try {
    mergedCoords = polygonClipping.union(...toUnion as any);
  } catch {
    // Fallback if union fails (rare with polygonClipping)
    return gaps;
  }

  // Build new gap array: non-overlapping gaps stay, overlapping replaced by merged
  const overlappingSet = new Set(overlappingIndices);
  const result: Gap[] = [];

  for (let i = 0; i < gaps.length; i++) {
    if (!overlappingSet.has(i)) {
      result.push(gaps[i]);
    }
  }

  // Extract gaps from the MultiPolygon coordinates
  for (const coords of mergedCoords) {
    try {
      const poly = turf.polygon(coords);
      result.push(turfPolygonToGap(poly, imgW, imgH, 'manual'));
    } catch { }
  }

  return result;
}

/**
 * Apply an eraser stamp: subtract the circle from any overlapping gaps.
 * Fully erased gaps are removed. MultiPolygon results are split.
 * (Legacy single-stamp version — prefer applyEraserStroke for full strokes.)
 */
export function applyEraser(
  gaps: Gap[],
  center: { x: number; y: number },
  radius: number,
  imgW: number,
  imgH: number,
  selectedIds: Set<number>,
  minArea = 4,
): Gap[] {
  return applyEraserStroke(gaps, [center], radius, imgW, imgH, selectedIds, minArea);
}

// ─── Magic Wand polygon union ────────────────────────────────────────────────

/**
 * Apply a pre-computed polygon (e.g. from magic wand, lasso, or object select)
 * to the gap list using either Union (add) or Difference (subtract) logic.
 */
export function applyPolygon(
  gaps: Gap[],
  polygon: Feature<Polygon>,
  imgW: number,
  imgH: number,
  source: 'auto' | 'manual' = 'manual',
  mode: 'add' | 'subtract' = 'add',
  minArea = 4,
): Gap[] {
  const overlappingIndices: number[] = [];
  const turfGaps: Feature<Polygon>[] = [];

  for (let i = 0; i < gaps.length; i++) {
    const tg = gapToTurfPolygon(gaps[i], imgW, imgH);
    turfGaps.push(tg);
    try {
      if (turf.booleanIntersects(tg, polygon)) {
        overlappingIndices.push(i);
      }
    } catch {
      // booleanIntersects failed on complex polygon — use AABB as fallback
      try {
        if (!turf.booleanDisjoint(
          turf.bboxPolygon(turf.bbox(tg)),
          turf.bboxPolygon(turf.bbox(polygon))
        )) {
          overlappingIndices.push(i);
        }
      } catch { }
    }
  }

  if (mode === 'subtract') {
    if (overlappingIndices.length === 0) return gaps;

    const overlappingSet = new Set(overlappingIndices);
    const result: Gap[] = [];

    for (let i = 0; i < gaps.length; i++) {
      if (!overlappingSet.has(i)) {
        result.push(gaps[i]);
        continue;
      }

      // Clean gap polygon before subtraction to fix self-intersections
      let cleanedPieces: polygonClipping.Polygon[];
      try {
        cleanedPieces = cleanGapRings(turfGaps[i].geometry.coordinates as any);
      } catch {
        cleanedPieces = [turfGaps[i].geometry.coordinates as any];
      }

      const clipper = polygon.geometry.coordinates as any;
      const resultPieces: polygonClipping.MultiPolygon = [];

      for (const cleanedRings of cleanedPieces) {
        try {
          const diffResult = polygonClipping.difference(cleanedRings, clipper);
          resultPieces.push(...diffResult);
        } catch (err) {
          console.warn(`[applyPolygon subtract] difference failed for gap ${i}:`, err);
          resultPieces.push(cleanedRings); // keep piece on failure
        }
      }

      if (resultPieces.length === 0) continue; // Fully subtracted

      for (const coords of resultPieces) {
        try {
          const poly = turf.polygon(coords as any);
          const gap = turfPolygonToGap(poly, imgW, imgH, 'manual');
          if (gap.area_px >= minArea) result.push(gap);
        } catch { }
      }
    }
    return result;
  }

  // mode === 'add' (Union)
  if (overlappingIndices.length === 0) {
    return [...gaps, turfPolygonToGap(polygon, imgW, imgH, source)];
  }

  const toUnion = [polygon.geometry.coordinates];
  for (const idx of overlappingIndices) {
    toUnion.push(turfGaps[idx].geometry.coordinates);
  }

  let mergedCoords: polygonClipping.MultiPolygon;
  try {
    mergedCoords = polygonClipping.union(...toUnion as any);
  } catch {
    return gaps;
  }

  const overlappingSet = new Set(overlappingIndices);
  const result: Gap[] = [];
  for (let i = 0; i < gaps.length; i++) {
    if (!overlappingSet.has(i)) result.push(gaps[i]);
  }

  for (const coords of mergedCoords) {
    try {
      const poly = turf.polygon(coords);
      result.push(turfPolygonToGap(poly, imgW, imgH, source));
    } catch { }
  }
  return result;
}

// ─── Merge incoming (auto-detected) gaps with existing (manual) gaps ─────────

/**
 * Merge a new set of incoming gaps (e.g. from auto-detection) into an existing
 * working set (e.g. manually drawn gaps), unioning any overlapping regions.
 *
 * Algorithm: iterate over every incoming gap and call applyPolygon() against
 * the running working array — the same union-or-append logic used by the brush
 * and magic-wand tools.  This means:
 *   • Incoming gaps that overlap existing gaps are unioned with them.
 *   • Incoming gaps that don't overlap anything are appended as new gaps.
 *   • Existing gaps untouched by any incoming gap are preserved as-is.
 *
 * If existingGaps is empty the function simply converts all incomingGaps to
 * Gap objects and returns them (fast path, no turf work needed).
 */
export function mergeIncomingGaps(
  existingGaps: Gap[],
  incomingGaps: Gap[],
  imgW: number,
  imgH: number,
): Gap[] {
  // Fast path: nothing pre-existing — just return incoming converted to pixels
  if (existingGaps.length === 0) {
    return incomingGaps.map(g => {
      try {
        return turfPolygonToGap(gapToTurfPolygon(g, imgW, imgH), imgW, imgH, 'auto');
      } catch {
        return { ...g, source: 'auto' };
      }
    });
  }

  let working: Gap[] = [...existingGaps];

  for (const incomingGap of incomingGaps) {
    let incomingPoly: Feature<Polygon>;
    try {
      incomingPoly = gapToTurfPolygon(incomingGap, imgW, imgH);
    } catch {
      // Degenerate geometry — keep as-is without merging
      working.push({ ...incomingGap, source: 'auto' });
      continue;
    }

    // Check if it overlaps any manual gaps
    const overlapsManual = working.some(g =>
      g.source === 'manual' && turf.booleanIntersects(gapToTurfPolygon(g, imgW, imgH), incomingPoly)
    );

    working = applyPolygon(working, incomingPoly, imgW, imgH, overlapsManual ? 'manual' : 'auto');
  }

  return working;
}

// ─── Split operation ────────────────────────────────────────────────────────

/**
 * Create a thin 4-point rectangle polygon around a line segment in pixel space.
 * The half-width controls how thick the "cut" sliver is.
 */
function createSplitterPolygon(
  p1: { x: number; y: number },
  p2: { x: number; y: number },
  halfWidth = 0.5,
): Feature<Polygon> {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const len = Math.hypot(dx, dy);
  if (len === 0) return turf.polygon([[[p1.x, p1.y], [p1.x, p1.y], [p1.x, p1.y], [p1.x, p1.y]]]);

  // Perpendicular unit vector
  const nx = -dy / len;
  const ny = dx / len;
  const ox = nx * halfWidth;
  const oy = ny * halfWidth;

  const ring: Position[] = [
    [p1.x + ox, p1.y + oy],
    [p2.x + ox, p2.y + oy],
    [p2.x - ox, p2.y - oy],
    [p1.x - ox, p1.y - oy],
    [p1.x + ox, p1.y + oy], // close ring
  ];

  return turf.polygon([ring]);
}

/**
 * Split gaps along a straight line drawn from p1 to p2 (in image pixel coordinates).
 * Any gap intersected by the line is subtracted by a thin sliver polygon.
 * MultiPolygon results are split into separate Gap objects.
 */
export function applySplit(
  gaps: Gap[],
  p1: { x: number; y: number },
  p2: { x: number; y: number },
  imgW: number,
  imgH: number,
  minArea = 4,
): Gap[] {
  const splitter = createSplitterPolygon(p1, p2);
  const result: Gap[] = [];

  for (let i = 0; i < gaps.length; i++) {
    const turfGap = gapToTurfPolygon(gaps[i], imgW, imgH);

    let intersects = false;
    try {
      intersects = turf.booleanIntersects(turfGap, splitter);
    } catch {
      result.push(gaps[i]);
      continue;
    }

    if (!intersects) {
      result.push(gaps[i]);
      continue;
    }

    // Clean gap polygon before subtraction
    let cleanedPieces: polygonClipping.Polygon[];
    try {
      cleanedPieces = cleanGapRings(turfGap.geometry.coordinates as any);
    } catch {
      cleanedPieces = [turfGap.geometry.coordinates as any];
    }

    const clipper = splitter.geometry.coordinates as any;
    const resultPieces: polygonClipping.MultiPolygon = [];

    for (const cleanedRings of cleanedPieces) {
      try {
        const diffResult = polygonClipping.difference(cleanedRings, clipper);
        resultPieces.push(...diffResult);
      } catch (err) {
        console.warn(`[applySplit] difference failed for gap ${i}:`, err);
        resultPieces.push(cleanedRings);
      }
    }

    if (resultPieces.length === 0) continue; // Fully removed

    for (const coords of resultPieces) {
      try {
        const poly = turf.polygon(coords as any);
        const gap = turfPolygonToGap(poly, imgW, imgH, 'manual');
        if (gap.area_px >= minArea) result.push(gap);
      } catch { }
    }
  }

  return result;
}

/**
 * Apply a full eraser stroke (multiple circle centers) as a single batch operation.
 *
 * Algorithm:
 *   1. Simplify the stroke path (cap circle count for performance)
 *   2. Union all eraser circles → one MultiPolygon "clipper"
 *   3. Clean the clipper's coordinate rings
 *   4. For each overlapping gap:
 *      a. Clean gap polygon (deduplicate vertices, fix self-intersections)
 *      b. AABB-check before expensive boolean test (catches false-negative booleanIntersects)
 *      c. polygonClipping.difference(cleanedGap, eraserUnion) — one call, not N
 *      d. Log and recover from failures instead of silently keeping the gap
 */
export function applyEraserStroke(
  gaps: Gap[],
  strokePoints: { x: number; y: number }[],
  radius: number,
  imgW: number,
  imgH: number,
  selectedIds: Set<number>,
  minArea = 4,
): Gap[] {
  if (strokePoints.length === 0) return gaps;

  // Step 1: Simplify stroke — keep points at least radius*0.75 apart.
  // Circles spaced radius*0.75 apart still fully overlap, so no coverage gaps.
  const simplified = simplifyStrokePath(strokePoints, radius * 0.75);

  // Step 2: Build union of all eraser circles → one MultiPolygon clipper
  const circles = simplified.map(pt =>
    createPixelCircle(pt.x, pt.y, radius).geometry.coordinates
  );

  let eraserUnion: polygonClipping.MultiPolygon;
  try {
    eraserUnion = circles.length === 1
      ? [circles[0] as any]
      : polygonClipping.union(...(circles as any));
  } catch (err) {
    console.warn('[applyEraserStroke] Failed to build eraser union:', err);
    return gaps;
  }

  // Step 3: Clean eraser union (round + deduplicate junction artifacts)
  const cleanedEraserUnion: polygonClipping.MultiPolygon = eraserUnion.map(cleanEraserRings);

  // Pre-compute eraser AABB for fast per-gap rejection
  const eraserAabb = multiPolygonAabb(cleanedEraserUnion);

  const hasSelection = selectedIds.size > 0;
  const result: Gap[] = [];

  for (let i = 0; i < gaps.length; i++) {
    if (hasSelection && !selectedIds.has(i)) {
      result.push(gaps[i]);
      continue;
    }

    const turfGap = gapToTurfPolygon(gaps[i], imgW, imgH);

    // Step 4a: Clean gap polygon to fix self-intersections before boolean ops
    let cleanedPieces: polygonClipping.Polygon[];
    try {
      cleanedPieces = cleanGapRings(turfGap.geometry.coordinates as any);
    } catch {
      cleanedPieces = [turfGap.geometry.coordinates as any];
    }

    // Step 4b + 4c: Per-cleaned-piece: AABB check → intersect check → difference
    const pieceDiffResults: polygonClipping.MultiPolygon = [];
    let anyPieceHit = false;

    for (const cleanedRings of cleanedPieces) {
      // Fast AABB pre-check — if piece doesn't even touch eraser bounding box, skip
      const pieceAabb = polyAabb(cleanedRings);
      if (!aabbsOverlap(pieceAabb, eraserAabb)) {
        pieceDiffResults.push(cleanedRings); // keep piece
        continue;
      }

      // Intersection check using cleaned polygon
      // On failure, trust the AABB overlap and proceed to the difference anyway —
      // the difference will produce the correct geometric result either way.
      let intersects = false;
      try {
        for (const eraserPoly of cleanedEraserUnion) {
          if (turf.booleanIntersects(
            turf.polygon(cleanedRings as any),
            turf.polygon(eraserPoly as any),
          )) {
            intersects = true;
            break;
          }
        }
      } catch {
        // booleanIntersects failed on this complex polygon — AABB says they overlap
        // so assume intersection is true and let the difference decide
        intersects = true;
      }

      if (!intersects) {
        pieceDiffResults.push(cleanedRings); // keep piece
        continue;
      }

      anyPieceHit = true;

      // Step 4d: Boolean difference — subtract cleaned eraser from this piece
      try {
        const diffResult = polygonClipping.difference(
          cleanedRings,
          ...(cleanedEraserUnion as any),
        );
        pieceDiffResults.push(...diffResult);
      } catch (err) {
        console.warn(`[applyEraserStroke] difference failed for gap ${i}:`, err);
        // Keep piece unchanged on failure rather than silently dropping it
        pieceDiffResults.push(cleanedRings);
      }
    }

    if (!anyPieceHit) {
      // Eraser did not contact this gap — preserve it unchanged
      result.push(gaps[i]);
      continue;
    }

    // Convert surviving pieces back to Gap objects (filter tiny fragments)
    let hadValidOutput = false;
    for (const coords of pieceDiffResults) {
      try {
        const poly = turf.polygon(coords as any);
        const gap = turfPolygonToGap(poly, imgW, imgH, 'manual');
        if (gap.area_px >= minArea) {
          result.push(gap);
          hadValidOutput = true;
        }
      } catch { }
    }

    // If every piece was fully erased (diffResult was empty for all pieces),
    // the gap is completely removed — nothing to push, which is correct.
    // But if the difference itself kept failing and we have no valid output
    // despite anyPieceHit=true, fall back to keeping the original gap so data
    // is never silently lost.
    if (!hadValidOutput && pieceDiffResults.every(p => {
      // A kept piece (not a diff result) is still in pieceDiffResults — check if
      // any of them are non-empty to distinguish "fully erased" from "all failed"
      try { return turf.polygon(p as any) && false; } catch { return true; }
    })) {
      result.push(gaps[i]);
    }
  }

  return result;
}

/**
 * Extract individual Gap objects from a Polygon or MultiPolygon feature.
 */
function extractPolygons(feature: Feature<Polygon | MultiPolygon>, imgW: number, imgH: number, source?: 'auto' | 'manual'): Gap[] {
  const geom = feature.geometry;

  if (geom.type === 'Polygon') {
    return [turfPolygonToGap(turf.polygon(geom.coordinates), imgW, imgH, source)];
  }

  // MultiPolygon — split into separate gaps
  const results: Gap[] = [];
  for (const coords of geom.coordinates) {
    try {
      const poly = turf.polygon(coords);
      results.push(turfPolygonToGap(poly, imgW, imgH, source));
    } catch {
      // Skip invalid polygons
    }
  }
  return results;
}
