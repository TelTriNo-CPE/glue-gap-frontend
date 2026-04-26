declare module 'geojson' {
  export type Position = number[];

  export interface Polygon {
    type: 'Polygon';
    coordinates: Position[][];
  }

  export interface MultiPolygon {
    type: 'MultiPolygon';
    coordinates: Position[][][];
  }

  export interface Feature<G = Polygon | MultiPolygon> {
    type: 'Feature';
    geometry: G;
    properties?: Record<string, unknown> | null;
    id?: string | number;
    bbox?: number[];
  }
}
