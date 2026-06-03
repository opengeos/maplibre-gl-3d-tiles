import { ThreeDTilesControl } from './lib/core/ThreeDTilesControl';
import type { ThreeDTilesControlPosition, ThreeDTilesState } from './lib/core/types';
import './lib/styles/plugin-control.css';

interface GeoLibreAppAPI {
  addMapControl: (
    control: ThreeDTilesControl,
    position?: ThreeDTilesControlPosition,
  ) => boolean;
  removeMapControl: (control: ThreeDTilesControl) => void;
}

interface GeoLibrePlugin {
  id: string;
  name: string;
  version: string;
  activate: (app: GeoLibreAppAPI) => boolean | void;
  deactivate: (app: GeoLibreAppAPI) => void;
  getMapControlPosition?: () => ThreeDTilesControlPosition;
  setMapControlPosition?: (
    app: GeoLibreAppAPI,
    position: ThreeDTilesControlPosition,
  ) => boolean | void;
  getProjectState?: () => unknown;
  applyProjectState?: (app: GeoLibreAppAPI, state: unknown) => boolean | void;
}

let control: ThreeDTilesControl | null = null;
let position: ThreeDTilesControlPosition = 'top-right';
let pendingState: Partial<ThreeDTilesState> | null = null;

function createControl(): ThreeDTilesControl {
  const options = {
    collapsed: pendingState?.collapsed ?? true,
    panelWidth: pendingState?.panelWidth ?? 360,
    title: '3D Tiles',
    ...(pendingState?.tilesetUrl !== undefined ? { tilesetUrl: pendingState.tilesetUrl } : {}),
    ...(pendingState?.altitudeOffset !== undefined
      ? { altitudeOffset: pendingState.altitudeOffset }
      : {}),
    ...(pendingState?.flyToOnLoad !== undefined ? { flyToOnLoad: pendingState.flyToOnLoad } : {}),
    ...(pendingState?.visible !== undefined ? { visible: pendingState.visible } : {}),
  };
  const nextControl = new ThreeDTilesControl(options);

  if (pendingState) {
    nextControl.setState(pendingState);
  }

  return nextControl;
}

function isThreeDTilesState(value: unknown): value is Partial<ThreeDTilesState> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;

  const candidate = value as Record<string, unknown>;
  if ('collapsed' in candidate && typeof candidate.collapsed !== 'boolean') return false;
  if ('panelWidth' in candidate && typeof candidate.panelWidth !== 'number') return false;
  if ('tilesetUrl' in candidate && typeof candidate.tilesetUrl !== 'string') return false;
  if ('altitudeOffset' in candidate && typeof candidate.altitudeOffset !== 'number') return false;
  if ('flyToOnLoad' in candidate && typeof candidate.flyToOnLoad !== 'boolean') return false;
  if ('visible' in candidate && typeof candidate.visible !== 'boolean') return false;
  if ('tilesets' in candidate && !Array.isArray(candidate.tilesets)) return false;
  if ('activeTilesetId' in candidate && typeof candidate.activeTilesetId !== 'string') {
    return false;
  }

  return true;
}

export const plugin: GeoLibrePlugin = {
  id: 'maplibre-gl-3d-tiles',
  name: '3D Tiles',
  version: '0.1.0',
  activate(app) {
    control = control ?? createControl();
    const added = app.addMapControl(control, position);
    if (!added) {
      control = null;
      return false;
    }
  },
  deactivate(app) {
    if (!control) return;
    pendingState = control.getState();
    app.removeMapControl(control);
    control = null;
  },
  getMapControlPosition() {
    return position;
  },
  setMapControlPosition(app, nextPosition) {
    position = nextPosition;
    if (!control) return;

    app.removeMapControl(control);
    const added = app.addMapControl(control, position);
    if (!added) {
      pendingState = control.getState();
      control = null;
      return false;
    }
  },
  getProjectState() {
    return control?.getState() ?? pendingState ?? undefined;
  },
  applyProjectState(_app, state) {
    if (!isThreeDTilesState(state)) return false;
    pendingState = state;
    control?.setState(state);
  },
};

export default plugin;
