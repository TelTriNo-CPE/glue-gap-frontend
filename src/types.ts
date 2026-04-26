export interface Gap {
  area_px: number;
  equiv_radius_px: number;
  centroid_norm: [number, number]; // [x, y] normalised 0–1
  coordinates: number[];           // flat [x1, y1, x2, y2, …] in image pixel coordinates
}

export interface RadiusStats {
  min: number;
  max: number;
  mean: number;
  median: number;
  std: number;
}

export interface AnalysisResult {
  stem: string;
  image_size: { width: number; height: number };
  gap_count: number;
  gaps: Gap[];
  radius_stats: RadiusStats | null;
}

export interface DetectionParams {
  sensitivity: number;
  minArea: number;
}

export interface DetectionVersion {
  id: string;
  versionNumber: number;
  timestamp: Date;
  params: DetectionParams;
  result: AnalysisResult;
}

export type ClickMode = 'select' | 'deselect' | 'pan' | 'brush' | 'eraser' | 'split';
