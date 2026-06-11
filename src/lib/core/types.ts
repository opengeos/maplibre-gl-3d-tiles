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

export interface ThreeDTilesControlOptions extends Partial<ThreeDTilesLoadOptions>, Partial<ThreeDTilesDecoderOptions> {
  collapsed?: boolean;
  position?: ThreeDTilesControlPosition;
  title?: string;
  panelWidth?: number;
  className?: string;
  collapseOnClickOutside?: boolean;
  layerId?: string;
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
