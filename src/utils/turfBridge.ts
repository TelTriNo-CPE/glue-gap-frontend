import * as turf from '@turf/turf';
import polygonClipping from 'polygon-clipping';
import type { Feature, Polygon, Position } from 'geojson';
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
export function createPixelCircle(cx: number, cy: number, radius: number, steps = 32): Feature<Polygon> {
  const ring: Position[] = [];
  for (let i = 0; i <= steps; i++) {
    const angle = (2 * Math.PI * i) / steps;
    ring.push([cx + radius * Math.cos(angle), cy + radius * Math.sin(angle)]);
  }
  // Explicitly close with the exact starting coordinates to prevent float mismatch
  ring[ring.length - 1] = [ring[0][0], ring[0][1]];
  return turf.polygon([ring]);
}

// ─── Geometry cleanup helpers ─────────────────────────────────────────────────

/**
 * Round + deduplicate a single ring. Returns null if the result has fewer than
 * 4 points (3 unique + closure), which means the ring is degenerate.
 */
function cleanRing(
  ring: polygonClipping.Ring,
  precision: number,
): [number, number][] | null {
  const scale = Math.pow(10, precision);

  // Round each vertex
  const rounded: [number, number][] = ring.map(
    ([x, y]) => [Math.round(x * scale) / scale, Math.round(y * scale) / scale]
  );

  // Remove duplicate consecutive vertices
  const out: [number, number][] = [];
  for (const pt of rounded) {
    const prev = out.length > 0 ? out[out.length - 1] : null;
    if (!prev || pt[0] !== prev[0] || pt[1] !== prev[1]) {
      out.push(pt);
    }
  }

  // Ensure closure
  if (out.length > 0) {
    const first = out[0];
    const last = out[out.length - 1];
    if (first[0] !== last[0] || first[1] !== last[1]) {
      out.push([first[0], first[1]]);
    }
  }

  // Minimum valid polygon ring: 3 unique vertices + 1 closing vertex = 4 points
  return out.length >= 4 ? out : null;
}

/**
 * Clean a polygon's coordinate rings to prepare for reliable boolean operations.
 *
 * AI-detected polygons (OpenCV contours) often contain duplicate vertices,
 * sub-pixel floating-point noise, and self-intersections that silently break
 * polygon-clipping's sweep-line algorithm.
 *
 * Strategy:
 *   1. Try 2dp precision → deduplicate → self-union ("buffer 0" pixel-space analog)
 *   2. If that fails, try 1dp → deduplicate → self-union
 *   3. If that fails, return the original rings unchanged (attempt the operation anyway)
 *
 * Returns an array of clean simple polygon ring-sets. Self-intersecting input
 * may produce >1 output polygon.
 */
function cleanGapRings(rings: polygonClipping.Polygon): polygonClipping.Polygon[] {
  for (const precision of [2, 1]) {
    const cleaned: polygonClipping.Polygon = [];
    let anyDegenerate = false;

    for (const ring of rings) {
      const cleanedRing = cleanRing(ring, precision);
      if (cleanedRing === null) {
        anyDegenerate = true;
      } else {
        cleaned.push(cleanedRing);
      }
    }

    // If all rings collapsed, skip to next precision level
    if (cleaned.length === 0) {
      anyDegenerate = true;
    }

    if (!anyDegenerate || cleaned.length > 0) {
      // Attempt self-union to fix self-intersections
      try {
        const selfUnioned = polygonClipping.union(cleaned as any);
        if (selfUnioned.length > 0) return selfUnioned;
      } catch {
        // Self-union failed; fall through
      }

      // Self-union failed but cleaned rings are still better than nothing
      if (cleaned.length > 0) return [cleaned];
    }
  }

  // All cleaning failed — return original rings and hope for the best
  return [rings];
}

/**
 * Clean a single polygon (eraser circle union piece): round + deduplicate.
 * Uses 2dp precision. Returns the polygon unchanged on failure.
 */
function cleanEraserPoly(poly: polygonClipping.Polygon): polygonClipping.Polygon {
  const cleaned: polygonClipping.Polygon = [];
  for (const ring of poly) {
    const c = cleanRing(ring, 2);
    if (c !== null) cleaned.push(c);
  }
  return cleaned.length > 0 ? cleaned : poly;
}

/**
 * Simplify a stroke path so the union of circles stays manageable for long strokes.
 * Ensures consecutive kept points are at least `minSpacing` apart.
 * First and last points are always preserved.
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

/**
 * Attempt polygonClipping.difference with multiple fallback strategies.
 *
 * Returns:
 *   - polygonClipping.MultiPolygon (possibly empty []) on success — empty means fully erased
 *   - null only if every strategy throws, meaning we cannot compute a result
 *
 * IMPORTANT: An empty result [] is NOT a failure — it means the subject was
 * completely covered by the clippers and should be deleted.
 */
function tryDifference(
  subject: polygonClipping.Polygon,
  clippers: polygonClipping.MultiPolygon,
): polygonClipping.MultiPolygon | null {
  // Strategy 1: Direct difference on the (already-cleaned) subject
  try {
    return polygonClipping.difference(subject, ...(clippers as any));
  } catch (err1) {
    console.warn('[tryDifference] Strategy 1 (direct) failed:', err1);
  }

  // Strategy 2: Simplify subject via turf.simplify then retry
  // turf.simplify uses Douglas-Peucker and removes vertices within `tolerance` pixels
  try {
    const feat = turf.simplify(
      turf.polygon(subject as any),
      { tolerance: 0.5, highQuality: false, mutate: false }
    );
    const simplifiedRings = feat.geometry.coordinates as any as polygonClipping.Polygon;
    // Re-clean the simplified rings before retrying
    const reCleaned = cleanGapRings(simplifiedRings);
    for (const piece of reCleaned) {
      try {
        return polygonClipping.difference(piece, ...(clippers as any));
      } catch { }
    }
  } catch (err2) {
    console.warn('[tryDifference] Strategy 2 (simplify) failed:', err2);
  }

  // Strategy 3: Deterministic coordinate jitter to unstick coincident vertices
  // (shifts each vertex by ±0.01 px based on its index, making them no longer coincident)
  try {
    const jittered: polygonClipping.Polygon = subject.map(ring =>
      ring.map(([x, y], idx) => [
        x + (idx % 2 === 0 ? 0.01 : -0.01),
        y + (idx % 3 === 0 ? 0.01 : -0.01),
      ] as [number, number])
    );
    return polygonClipping.difference(jittered, ...(clippers as any));
  } catch (err3) {
    console.warn('[tryDifference] Strategy 3 (jitter) failed:', err3);
  }

  return null; // All strategies exhausted
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
    const newGap = turfPolygonToGap(circle, imgW, imgH, 'manual');
    return [...gaps, newGap];
  }

  const toUnion = [circle.geometry.coordinates];
  for (const idx of overlappingIndices) {
    toUnion.push(turfGaps[idx].geometry.coordinates);
  }

  let mergedCoords: polygonClipping.MultiPolygon;
  try {
    mergedCoords = polygonClipping.union(toUnion[0] as any, ...toUnion.slice(1) as any);
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
      result.push(turfPolygonToGap(poly, imgW, imgH, 'manual'));
    } catch { }
  }
  return result;
}

/**
 * Apply an eraser stamp (legacy single-stamp entry point).
 * Delegates to applyEraserStroke.
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
      // booleanIntersects failed on complex polygon — use AABB as conservative fallback
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

      // Clean gap polygon before subtraction
      let cleanedPieces: polygonClipping.Polygon[];
      try {
        cleanedPieces = cleanGapRings(turfGaps[i].geometry.coordinates as any);
      } catch {
        cleanedPieces = [turfGaps[i].geometry.coordinates as any];
      }

      const clipper: polygonClipping.MultiPolygon = [polygon.geometry.coordinates as any];
      // Track pieces separately: kept (no intersection) vs erased (diff result)
      const keptPieces: polygonClipping.Polygon[] = [];
      const erasedPieces: polygonClipping.MultiPolygon = [];
      let diffAttempted = false;

      for (const cleanedRings of cleanedPieces) {
        const diffResult = tryDifference(cleanedRings, clipper);
        diffAttempted = true;
        if (diffResult !== null) {
          erasedPieces.push(...diffResult);
        } else {
          keptPieces.push(cleanedRings);
        }
      }

      if (!diffAttempted) {
        result.push(gaps[i]);
        continue;
      }

      // Convert surviving geometry to Gap objects
      for (const coords of [...keptPieces, ...erasedPieces]) {
        try {
          const poly = turf.polygon(coords as any);
          const gap = turfPolygonToGap(poly, imgW, imgH, 'manual');
          if (gap.area_px >= minArea) result.push(gap);
        } catch { }
      }
      // If both arrays are empty → gap was fully erased → nothing pushed → gap deleted ✓
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
    mergedCoords = polygonClipping.union(toUnion[0] as any, ...toUnion.slice(1) as any);
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

export function mergeIncomingGaps(
  existingGaps: Gap[],
  incomingGaps: Gap[],
  imgW: number,
  imgH: number,
): Gap[] {
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
      working.push({ ...incomingGap, source: 'auto' });
      continue;
    }

    const overlapsManual = working.some(g =>
      g.source === 'manual' && turf.booleanIntersects(gapToTurfPolygon(g, imgW, imgH), incomingPoly)
    );

    working = applyPolygon(working, incomingPoly, imgW, imgH, overlapsManual ? 'manual' : 'auto');
  }

  return working;
}

// ─── Split operation ────────────────────────────────────────────────────────

function createSplitterPolygon(
  p1: { x: number; y: number },
  p2: { x: number; y: number },
  halfWidth = 0.5,
): Feature<Polygon> {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const len = Math.hypot(dx, dy);
  if (len === 0) return turf.polygon([[[p1.x, p1.y], [p1.x, p1.y], [p1.x, p1.y], [p1.x, p1.y]]]);

  const nx = -dy / len;
  const ny = dx / len;
  const ox = nx * halfWidth;
  const oy = ny * halfWidth;

  const ring: Position[] = [
    [p1.x + ox, p1.y + oy],
    [p2.x + ox, p2.y + oy],
    [p2.x - ox, p2.y - oy],
    [p1.x - ox, p1.y - oy],
    [p1.x + ox, p1.y + oy],
  ];

  return turf.polygon([ring]);
}

export function applySplit(
  gaps: Gap[],
  p1: { x: number; y: number },
  p2: { x: number; y: number },
  imgW: number,
  imgH: number,
  minArea = 4,
): Gap[] {
  const splitter = createSplitterPolygon(p1, p2);
  const clipper: polygonClipping.MultiPolygon = [splitter.geometry.coordinates as any];
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

    const keptPieces: polygonClipping.Polygon[] = [];
    const splitPieces: polygonClipping.MultiPolygon = [];
    let diffAttempted = false;

    for (const cleanedRings of cleanedPieces) {
      const diffResult = tryDifference(cleanedRings, clipper);
      diffAttempted = true;
      if (diffResult !== null) {
        splitPieces.push(...diffResult);
      } else {
        keptPieces.push(cleanedRings);
      }
    }

    if (!diffAttempted) {
      result.push(gaps[i]);
      continue;
    }

    for (const coords of [...keptPieces, ...splitPieces]) {
      try {
        const poly = turf.polygon(coords as any);
        const gap = turfPolygonToGap(poly, imgW, imgH, 'manual');
        if (gap.area_px >= minArea) result.push(gap);
      } catch { }
    }
  }

  return result;
}

// ─── Eraser stroke (batch) ───────────────────────────────────────────────────

/**
 * Apply a full eraser stroke as a single batch operation.
 *
 * Data flow (per gap):
 *   keptPieces   — cleaned pieces that did NOT intersect the eraser (preserved as-is)
 *   erasedPieces — results from successful difference() calls (may be [] = fully erased)
 *   diffAttempted — true if difference() was called on ≥1 piece
 *
 * Outcome:
 *   !diffAttempted          → gap not touched, keep original (no geometry conversion)
 *   keptPieces + erasedPieces → convert to Gap objects; if both empty → gap deleted
 *   tryDifference returns null → piece kept in keptPieces (never silently dropped)
 *
 * CRITICAL: an empty erasedPieces with diffAttempted=true means complete erasure.
 *           We push nothing for that gap → it is removed from the output. ✓
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

  // Simplify stroke — circles spaced radius*0.75 apart still fully overlap
  const simplified = simplifyStrokePath(strokePoints, radius * 0.75);

  // Build union of all eraser circles
  const circles = simplified.map(pt =>
    createPixelCircle(pt.x, pt.y, radius).geometry.coordinates
  );

  let eraserUnion: polygonClipping.MultiPolygon;
  try {
    eraserUnion = circles.length === 1
      ? [circles[0] as any]
      : polygonClipping.union(circles[0] as any, ...circles.slice(1) as any);
  } catch (err) {
    console.warn('[applyEraserStroke] Failed to build eraser union:', err);
    return gaps;
  }

  // Clean eraser union (remove float artifacts at circle-junction points)
  const cleanedEraserUnion: polygonClipping.MultiPolygon = eraserUnion.map(cleanEraserPoly);

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

    // Clean gap polygon to fix self-intersections / duplicate vertices
    let cleanedPieces: polygonClipping.Polygon[];
    try {
      cleanedPieces = cleanGapRings(turfGap.geometry.coordinates as any);
    } catch {
      cleanedPieces = [turfGap.geometry.coordinates as any];
    }

    // Pieces not touched by eraser (preserved)
    const keptPieces: polygonClipping.Polygon[] = [];
    // Pieces resulting from successful difference() (may be empty = fully erased)
    const erasedPieces: polygonClipping.MultiPolygon = [];
    let diffAttempted = false;

    for (const cleanedRings of cleanedPieces) {
      // Fast AABB pre-check: if this piece's bbox doesn't touch the eraser bbox, skip
      const pieceAabb = polyAabb(cleanedRings);
      if (!aabbsOverlap(pieceAabb, eraserAabb)) {
        keptPieces.push(cleanedRings);
        continue;
      }

      // Intersection check on the cleaned polygon.
      // On failure we trust the AABB overlap and proceed to difference anyway —
      // tryDifference will produce the correct geometric answer regardless.
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
        intersects = true; // trust the AABB overlap
      }

      if (!intersects) {
        keptPieces.push(cleanedRings);
        continue;
      }

      // Attempt boolean difference with fallback strategies
      diffAttempted = true;
      const diffResult = tryDifference(cleanedRings, cleanedEraserUnion);

      if (diffResult !== null) {
        // Success. diffResult may be:
        //   []           → this piece was completely erased (correct, push nothing)
        //   [polygon...] → partial erasure, push survivors
        erasedPieces.push(...diffResult);
      } else {
        // All strategies exhausted — keep piece unchanged rather than dropping it
        console.warn(`[applyEraserStroke] All difference strategies failed for gap ${i}, keeping piece`);
        keptPieces.push(cleanedRings);
      }
    }

    if (!diffAttempted) {
      // Eraser did not contact this gap at all → keep original gap object
      // (avoids unnecessary geometry re-conversion)
      result.push(gaps[i]);
      continue;
    }

    // Convert all surviving geometry back to Gap objects
    for (const coords of [...keptPieces, ...erasedPieces]) {
      try {
        const poly = turf.polygon(coords as any);
        const gap = turfPolygonToGap(poly, imgW, imgH, 'manual');
        if (gap.area_px >= minArea) result.push(gap);
      } catch { }
    }
    // If both keptPieces and erasedPieces are empty at this point, the gap was
    // completely erased → nothing is pushed → gap is removed from the output ✓
  }

  return result;
}
