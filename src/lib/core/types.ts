import type { Map } from 'maplibre-gl';

export type ThreeDTilesControlPosition = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

export type ThreeDTilesStatus = 'idle' | 'loading' | 'loaded' | 'error';

export interface ThreeDTilesLoadOptions {
  tilesetUrl: string;
  layerName: string;
  beforeId?: string;
  altitudeOffset: number;
  flyToOnLoad: boolean;
  opacity: number;
  visible: boolean;
  /**
   * Custom HTTP request headers sent with every tileset and tile fetch, for
   * authenticated sources (e.g. `{ Authorization: 'ApiKey <key>' }`).
   */
  requestHeaders?: Record<string, string>;
}

export interface ThreeDTilesDecoderOptions {
  dracoDecoderPath: string;
  ktx2TranscoderPath: string;
}

/**
 * A named sample tileset offered as a one-click entry in the panel's
 * "Load sample data" dropdown. Picking it fills the Tileset URL input.
 */
export interface ThreeDTilesSampleDataset {
  /** Label shown in the dropdown (e.g. 'AGI HQ'). */
  label: string;
  /** Tileset URL filled into the input when this entry is picked. */
  url: string;
}

export interface ThreeDTilesControlOptions extends Partial<ThreeDTilesLoadOptions>, Partial<ThreeDTilesDecoderOptions> {
  collapsed?: boolean;
  position?: ThreeDTilesControlPosition;
  title?: string;
  panelWidth?: number;
  className?: string;
  collapseOnClickOutside?: boolean;
  layerId?: string;
  /**
   * Sample tilesets offered as a "Load sample data" dropdown above the
   * Tileset URL input; picking one fills the input. Omit or leave empty to
   * hide the dropdown, so the input stays clean for the user's own URLs.
   */
  sampleData?: ThreeDTilesSampleDataset[];
  /**
   * Placeholder shown in the sample-data dropdown before a selection.
   * @default 'Load sample data...'
   */
  sampleDataLabel?: string;
}

export interface ThreeDTilesItemState {
  id: string;
  layerId: string;
  layerName: string;
  beforeId?: string;
  tilesetUrl: string;
  altitudeOffset: number;
  opacity: number;
  visible: boolean;
  status: ThreeDTilesStatus;
  error?: string;
  center?: [number, number];
  altitude?: number;
  requestHeaders?: Record<string, string>;
}

export interface ThreeDTilesState {
  collapsed: boolean;
  panelWidth: number;
  tilesetUrl: string;
  layerName: string;
  beforeId?: string;
  altitudeOffset: number;
  flyToOnLoad: boolean;
  opacity: number;
  visible: boolean;
  status: ThreeDTilesStatus;
  error?: string;
  center?: [number, number];
  altitude?: number;
  requestHeaders?: Record<string, string>;
  activeTilesetId?: string;
  tilesets: ThreeDTilesItemState[];
}

export interface ThreeDTilesControlReactProps extends ThreeDTilesControlOptions {
  map: Map;
  onStateChange?: (state: ThreeDTilesState) => void;
}

export type ThreeDTilesControlEvent =
  | 'collapse'
  | 'expand'
  | 'statechange'
  | 'loadstart'
  | 'load'
  | 'error'
  | 'remove'
  | 'opacitychange'
  | 'altitudechange'
  | 'visibilitychange';

export type ThreeDTilesControlEventHandler = (event: {
  type: ThreeDTilesControlEvent;
  state: ThreeDTilesState;
}) => void;

export interface LoadedTilesetMetadata {
  center: [number, number];
  altitude: number;
  radius: number;
}
