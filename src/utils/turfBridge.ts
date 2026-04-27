import * as turf from '@turf/turf';
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
  let merged: Feature<Polygon | MultiPolygon> = circle;
  for (const idx of overlappingIndices) {
    try {
      const result = turf.union(
        turf.featureCollection([merged as Feature<Polygon>, turfGaps[idx]]),
      );
      if (result) merged = result as Feature<Polygon | MultiPolygon>;
    } catch {
      // Skip failed union
    }
  }

  // Build new gap array: non-overlapping gaps stay, overlapping replaced by merged
  const overlappingSet = new Set(overlappingIndices);
  const result: Gap[] = [];

  for (let i = 0; i < gaps.length; i++) {
    if (!overlappingSet.has(i)) {
      result.push(gaps[i]);
    }
  }

  // Extract polygons from merged result
  const extracted = extractPolygons(merged, imgW, imgH, 'manual');
  result.push(...extracted);

  return result;
}

/**
 * Apply an eraser stamp: subtract the circle from any overlapping gaps.
 * Fully erased gaps are removed. MultiPolygon results are split.
 */
export function applyEraser(
  gaps: Gap[],
  center: { x: number; y: number },
  radius: number,
  imgW: number,
  imgH: number,
  selectedIds: number[],
  minArea = 4,
): Gap[] {
  const circle = createPixelCircle(center.x, center.y, radius);
  const result: Gap[] = [];
  const hasSelection = selectedIds.length > 0;

  for (let i = 0; i < gaps.length; i++) {
    // If there's a selection, only erase from selected gaps
    if (hasSelection && !selectedIds.includes(i)) {
      result.push(gaps[i]);
      continue;
    }

    const turfGap = gapToTurfPolygon(gaps[i], imgW, imgH);

    let intersects = false;
    try {
      intersects = turf.booleanIntersects(turfGap, circle);
    } catch {
      // If test fails, keep gap unchanged
      result.push(gaps[i]);
      continue;
    }

    if (!intersects) {
      result.push(gaps[i]);
      continue;
    }

    try {
      const diff = turf.difference(turf.featureCollection([turfGap, circle]));
      if (!diff) {
        // Fully erased — gap removed
        continue;
      }

      const extracted = extractPolygons(diff as Feature<Polygon | MultiPolygon>, imgW, imgH, 'manual');
      // Filter out tiny fragments
      for (const gap of extracted) {
        if (gap.area_px >= minArea) {
          result.push(gap);
        }
      }
    } catch {
      // If difference fails, keep gap unchanged
      result.push(gaps[i]);
    }
  }

  return result;
}

// ─── Magic Wand polygon union ────────────────────────────────────────────────

/**
 * Union a pre-computed polygon (e.g. from the magic wand tool) into the gap list.
 *
 * Behaviour:
 *  - If the polygon overlaps one or more existing gaps they are all merged into
 *    a single gap (same union logic as applyBrush).
 *  - If the polygon does not overlap any existing gap it is appended as a brand
 *    new gap.
 */
export function applyPolygon(
  gaps: Gap[],
  polygon: Feature<Polygon>,
  imgW: number,
  imgH: number,
  source: 'auto' | 'manual' = 'manual',
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
      // Skip gaps that fail the intersection test
    }
  }

  if (overlappingIndices.length === 0) {
    // No overlap — add as a new independent gap
    return [...gaps, turfPolygonToGap(polygon, imgW, imgH, source)];
  }

  // Union the magic-wand polygon with all overlapping gaps
  let merged: Feature<Polygon | MultiPolygon> = polygon;
  for (const idx of overlappingIndices) {
    try {
      const result = turf.union(
        turf.featureCollection([merged as Feature<Polygon>, turfGaps[idx]]),
      );
      if (result) merged = result as Feature<Polygon | MultiPolygon>;
    } catch {
      // Skip failed union step
    }
  }

  // Rebuild gap array: keep non-overlapping gaps, add merged result
  const overlappingSet = new Set(overlappingIndices);
  const result: Gap[] = [];
  for (let i = 0; i < gaps.length; i++) {
    if (!overlappingSet.has(i)) result.push(gaps[i]);
  }
  result.push(...extractPolygons(merged, imgW, imgH, source));
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

    try {
      const diff = turf.difference(turf.featureCollection([turfGap, splitter]));
      if (!diff) {
        // Fully consumed by the sliver (unlikely but possible for tiny gaps)
        continue;
      }

      const extracted = extractPolygons(diff as Feature<Polygon | MultiPolygon>, imgW, imgH, 'manual');
      for (const gap of extracted) {
        if (gap.area_px >= minArea) {
          result.push(gap);
        }
      }
    } catch {
      // If difference fails, keep gap unchanged
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
