import maplibregl from 'maplibre-gl';
import { DEFAULT_TILESET_URL, ThreeDTilesControl } from '../../src/index';
import '../../src/index.css';
import 'maplibre-gl/dist/maplibre-gl.css';

const map = new maplibregl.Map({
  container: 'map',
  style: 'https://tiles.openfreemap.org/styles/bright',
  center: [0, 0],
  zoom: 1,
  pitch: 60,
  maxPitch: 80,
  canvasContextAttributes: { antialias: true },
});

map.addControl(new maplibregl.NavigationControl(), 'top-right');
map.addControl(new maplibregl.FullscreenControl(), 'top-right');
map.addControl(new maplibregl.GlobeControl(), 'top-right');

map.on('load', () => {
  const tilesControl = new ThreeDTilesControl({
    collapsed: false,
    // Empty input; offer the tileset as an opt-in "Load sample data" entry
    // instead of prefilling the URL.
    tilesetUrl: '',
    sampleData: [{ label: 'AGI HQ', url: DEFAULT_TILESET_URL }],
  });

  map.addControl(tilesControl, 'top-left');

  tilesControl.on('load', (event) => {
    console.log('3D Tiles loaded:', event.state);
  });

  tilesControl.on('error', (event) => {
    console.error('3D Tiles error:', event.state.error);
  });
});
