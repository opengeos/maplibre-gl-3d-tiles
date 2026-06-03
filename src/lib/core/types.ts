import type { Map } from 'maplibre-gl';

export type ThreeDTilesControlPosition = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

export type ThreeDTilesStatus = 'idle' | 'loading' | 'loaded' | 'error';

export interface ThreeDTilesLoadOptions {
  tilesetUrl: string;
  altitudeOffset: number;
  flyToOnLoad: boolean;
  visible: boolean;
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
  layerId?: string;
}

export interface ThreeDTilesItemState {
  id: string;
  layerId: string;
  tilesetUrl: string;
  altitudeOffset: number;
  visible: boolean;
  status: ThreeDTilesStatus;
  error?: string;
  center?: [number, number];
  altitude?: number;
}

export interface ThreeDTilesState {
  collapsed: boolean;
  panelWidth: number;
  tilesetUrl: string;
  altitudeOffset: number;
  flyToOnLoad: boolean;
  visible: boolean;
  status: ThreeDTilesStatus;
  error?: string;
  center?: [number, number];
  altitude?: number;
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
