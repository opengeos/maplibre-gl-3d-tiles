import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { plugin } from '../src/geolibre';
import { DEFAULT_TILESET_URL, ThreeDTilesControl } from '../src/lib/core/ThreeDTilesControl';
import {
  ecefToLngLatAlt,
  patchGltfTextureLoaderForBlob,
  ThreeDTilesLayer,
} from '../src/lib/core/ThreeDTilesLayer';

function createMockMap() {
  const mapContainer = document.createElement('div');
  mapContainer.className = 'maplibregl-map';
  document.body.appendChild(mapContainer);

  const controlsContainer = document.createElement('div');
  controlsContainer.className = 'maplibregl-ctrl-top-right';
  mapContainer.appendChild(controlsContainer);

  const layers = new Set<string>();
  const map = {
    getContainer: vi.fn(() => mapContainer),
    getCanvas: vi.fn(() => document.createElement('canvas')),
    on: vi.fn(),
    off: vi.fn(),
    once: vi.fn(() => Promise.resolve()),
    isStyleLoaded: vi.fn(() => true),
    addLayer: vi.fn((layer: { id: string }, _beforeId?: string) => {
      layers.add(layer.id);
    }),
    removeLayer: vi.fn((id: string) => {
      layers.delete(id);
    }),
    getLayer: vi.fn((id: string) => (layers.has(id) ? { id } : undefined)),
    flyTo: vi.fn(),
    triggerRepaint: vi.fn(),
  };

  return { map, mapContainer, controlsContainer };
}

describe('ecefToLngLatAlt', () => {
  it('converts the equator prime meridian from ECEF to lng/lat/alt', () => {
    const coord = ecefToLngLatAlt(6378137, 0, 0);

    expect(coord.lng).toBeCloseTo(0, 6);
    expect(coord.lat).toBeCloseTo(0, 6);
    expect(coord.alt).toBeCloseTo(0, 3);
  });

  it('converts the equator at 90 degrees east from ECEF to lng/lat/alt', () => {
    const coord = ecefToLngLatAlt(0, 6378137, 0);

    expect(coord.lng).toBeCloseTo(90, 6);
    expect(coord.lat).toBeCloseTo(0, 6);
    expect(coord.alt).toBeCloseTo(0, 3);
  });
});

describe('ThreeDTilesLayer', () => {
  it('retries metadata extraction until tileset bounds are available', () => {
    vi.useFakeTimers();

    const onLoad = vi.fn();
    const group = new THREE.Object3D();
    let attempts = 0;
    const tiles = {
      group,
      getBoundingSphere: vi.fn((sphere: THREE.Sphere) => {
        attempts += 1;
        if (attempts === 1) return false;
        sphere.center.set(6378137, 0, 0);
        sphere.radius = 100;
        return true;
      }),
      removeEventListener: vi.fn(),
    };
    const layer = new ThreeDTilesLayer({
      id: 'test-3d-tiles',
      tilesetUrl: 'https://example.com/tileset.json',
      altitudeOffset: 0,
      opacity: 1,
      visible: true,
      onLoad,
    } as never);
    const testLayer = layer as unknown as {
      _tiles: typeof tiles;
      _loadTilesetHandler: () => void;
      _handleTilesetLoaded: () => void;
    };

    const loadHandler = vi.fn();
    testLayer._tiles = tiles;
    testLayer._loadTilesetHandler = loadHandler;

    testLayer._handleTilesetLoaded();
    expect(onLoad).not.toHaveBeenCalled();

    vi.advanceTimersByTime(20);

    expect(tiles.removeEventListener).toHaveBeenCalledWith('load-tileset', loadHandler);
    expect(onLoad).toHaveBeenCalledWith(
      expect.objectContaining({
        center: [expect.closeTo(0), expect.closeTo(0)],
        altitude: expect.closeTo(0),
        radius: 100,
      }),
    );

    vi.useRealTimers();
  });
});

function loadLayerWithCenter(
  center: THREE.Vector3,
  altitudeOffset = 0,
): { layer: ThreeDTilesLayer; group: THREE.Object3D; triggerRepaint: () => void } {
  const group = new THREE.Object3D();
  const tiles = {
    group,
    getBoundingSphere: vi.fn((sphere: THREE.Sphere) => {
      sphere.center.copy(center);
      sphere.radius = 100;
      return true;
    }),
    removeEventListener: vi.fn(),
  };
  const triggerRepaint = vi.fn();
  const layer = new ThreeDTilesLayer({
    id: 'orientation-3d-tiles',
    tilesetUrl: 'https://example.com/tileset.json',
    altitudeOffset,
    opacity: 1,
    visible: true,
  } as never);
  const internals = layer as unknown as {
    _tiles: typeof tiles;
    _map: { triggerRepaint: () => void };
    _handleTilesetLoaded: () => void;
  };
  internals._tiles = tiles;
  internals._map = { triggerRepaint };
  internals._handleTilesetLoaded();
  return { layer, group, triggerRepaint };
}

describe('ThreeDTilesLayer orientation', () => {
  // The local up direction is the ellipsoidal normal at the tileset anchor, not
  // a fixed axis. Regression guard: a region/point-cloud tileset with an
  // identity root transform was previously tilted by the site's colatitude.
  it('aligns ECEF east/up with the model frame X/Y axes away from the pole', () => {
    // A point near 45N, 0E so the bug (a pole-aligned axis swap) would tilt it ~45deg.
    const center = new THREE.Vector3(3194419.145, 0, 4487348.409);
    const { group } = loadLayerWithCenter(center);

    const { lng, lat } = ecefToLngLatAlt(center.x, center.y, center.z);
    const lngRad = (lng * Math.PI) / 180;
    const latRad = (lat * Math.PI) / 180;
    const up = new THREE.Vector3(
      Math.cos(latRad) * Math.cos(lngRad),
      Math.cos(latRad) * Math.sin(lngRad),
      Math.sin(latRad),
    );
    const east = new THREE.Vector3(-Math.sin(lngRad), Math.cos(lngRad), 0);

    const upPoint = center.clone().addScaledVector(up, 100).applyMatrix4(group.matrix);
    const eastPoint = center.clone().addScaledVector(east, 100).applyMatrix4(group.matrix);

    // 100 m straight up maps to +100 on the model Y (up) axis only.
    expect(upPoint.x).toBeCloseTo(0, 3);
    expect(upPoint.y).toBeCloseTo(100, 3);
    expect(upPoint.z).toBeCloseTo(0, 3);
    // 100 m east maps to +100 on the model X (east) axis only.
    expect(eastPoint.x).toBeCloseTo(100, 3);
    expect(eastPoint.y).toBeCloseTo(0, 3);
    expect(eastPoint.z).toBeCloseTo(0, 3);
  });

  it('repositions vertically when the altitude offset changes after load', () => {
    const center = new THREE.Vector3(6378137, 0, 0);
    const { layer, triggerRepaint } = loadLayerWithCenter(center, 0);
    const baseAltitude = layer.getMetadata()?.altitude ?? 0;

    layer.setAltitudeOffset(-250);

    expect(layer.getMetadata()?.altitude).toBeCloseTo(baseAltitude - 250, 3);
    expect(triggerRepaint).toHaveBeenCalled();
  });
});

describe('ThreeDTilesControl', () => {
  it('adds a compact button and floating panel to the map', () => {
    const { map, controlsContainer, mapContainer } = createMockMap();
    const control = new ThreeDTilesControl({ collapsed: false });

    const container = control.onAdd(map as never);
    controlsContainer.appendChild(container);

    expect(container.querySelector('.three-d-tiles-control-toggle')).toBeTruthy();
    expect(mapContainer.querySelector('.three-d-tiles-control-panel')).toBeTruthy();
    expect(control.getState().collapsed).toBe(false);
  });

  it('adds a corner resize handle to the panel', () => {
    const { map, controlsContainer, mapContainer } = createMockMap();
    const control = new ThreeDTilesControl({ collapsed: false });

    controlsContainer.appendChild(control.onAdd(map as never));

    const panel = mapContainer.querySelector('.three-d-tiles-control-panel');
    expect(panel).toBeTruthy();
    expect(panel?.querySelector('.three-d-tiles-control-resize')).toBeTruthy();
  });

  it('renders no sample dropdown by default', () => {
    const { map, controlsContainer, mapContainer } = createMockMap();
    const control = new ThreeDTilesControl({ collapsed: false });
    controlsContainer.appendChild(control.onAdd(map as never));
    expect(mapContainer.querySelector('.three-d-tiles-sample-menu')).toBeNull();
  });

  it('renders a sample dropdown that fills the URL input on selection', () => {
    const { map, controlsContainer, mapContainer } = createMockMap();
    const control = new ThreeDTilesControl({
      collapsed: false,
      tilesetUrl: '',
      sampleData: [
        { label: 'AGI HQ', url: 'https://example.com/agi/tileset.json' },
        { label: 'New York', url: 'https://example.com/ny/tileset.json' },
      ],
    });
    controlsContainer.appendChild(control.onAdd(map as never));

    const trigger = mapContainer.querySelector<HTMLButtonElement>(
      '.three-d-tiles-sample-trigger',
    )!;
    expect(
      trigger.querySelector('.three-d-tiles-sample-trigger-label')?.textContent,
    ).toBe('Load sample data...');
    const urlInput = mapContainer.querySelector<HTMLInputElement>(
      'input[aria-label="Tileset URL"]',
    )!;
    expect(urlInput.value).toBe('');

    const options = [
      ...mapContainer.querySelectorAll<HTMLButtonElement>('.three-d-tiles-sample-option'),
    ];
    expect(options.map((o) => o.textContent)).toEqual(['AGI HQ', 'New York']);

    options[1].click();
    expect(urlInput.value).toBe('https://example.com/ny/tileset.json');
  });

  it('orders URL, layer name, request headers, and before layer ID fields first', () => {
    const { map, controlsContainer } = createMockMap();
    const control = new ThreeDTilesControl({ collapsed: false });

    controlsContainer.appendChild(control.onAdd(map as never));
    const labels = [
      ...document.querySelectorAll('.three-d-tiles-field > span:first-child'),
    ].map((element) => element.textContent);

    expect(labels.slice(0, 4)).toEqual([
      'Tileset URL',
      'Layer name',
      'Request headers',
      'Before layer ID',
    ]);
  });

  it('updates visibility state and emits visibility events', () => {
    const control = new ThreeDTilesControl();
    const handler = vi.fn();

    control.setState({
      activeTilesetId: 'tileset-1',
      tilesets: [
        {
          id: 'tileset-1',
          layerId: 'test-3d-tiles',
          layerName: 'Test tileset',
          tilesetUrl: 'https://example.com/tileset.json',
          altitudeOffset: 0,
          opacity: 1,
          visible: true,
          status: 'loaded',
        },
      ],
    });
    control.on('visibilitychange', handler);
    control.setVisible(false);

    expect(control.getState().visible).toBe(false);
    expect(control.getState().tilesets[0].visible).toBe(false);
    expect(handler).toHaveBeenCalledWith({
      type: 'visibilitychange',
      state: expect.objectContaining({ visible: false }),
    });
  });

  it('updates opacity state and emits opacity events', () => {
    const control = new ThreeDTilesControl();
    const handler = vi.fn();

    control.setState({
      activeTilesetId: 'tileset-1',
      tilesets: [
        {
          id: 'tileset-1',
          layerId: 'test-3d-tiles',
          layerName: 'Test tileset',
          tilesetUrl: 'https://example.com/tileset.json',
          altitudeOffset: 0,
          opacity: 1,
          visible: true,
          status: 'loaded',
        },
      ],
    });
    control.on('opacitychange', handler);
    control.setOpacity(0.45);

    expect(control.getState().opacity).toBe(0.45);
    expect(control.getState().tilesets[0].opacity).toBe(0.45);
    expect(handler).toHaveBeenCalledWith({
      type: 'opacitychange',
      state: expect.objectContaining({ opacity: 0.45 }),
    });
  });

  it('updates altitude offset state and emits altitude events', () => {
    const control = new ThreeDTilesControl();
    const handler = vi.fn();

    control.setState({
      activeTilesetId: 'tileset-1',
      tilesets: [
        {
          id: 'tileset-1',
          layerId: 'test-3d-tiles',
          layerName: 'Test tileset',
          tilesetUrl: 'https://example.com/tileset.json',
          altitudeOffset: 0,
          opacity: 1,
          visible: true,
          status: 'loaded',
        },
      ],
    });
    control.on('altitudechange', handler);
    control.setAltitudeOffset(-512);

    expect(control.getState().altitudeOffset).toBe(-512);
    expect(control.getState().tilesets[0].altitudeOffset).toBe(-512);
    expect(handler).toHaveBeenCalledWith({
      type: 'altitudechange',
      state: expect.objectContaining({ altitudeOffset: -512 }),
    });
  });

  it('can keep the panel open when clicking outside', () => {
    const { map, controlsContainer } = createMockMap();
    const control = new ThreeDTilesControl({
      collapsed: false,
      collapseOnClickOutside: false,
    });

    controlsContainer.appendChild(control.onAdd(map as never));
    document.body.click();

    expect(control.getState().collapsed).toBe(false);
  });

  it('adds a custom layer when loading a tileset', async () => {
    const { map, controlsContainer } = createMockMap();
    const control = new ThreeDTilesControl({
      layerId: 'test-3d-tiles',
      layerName: 'Headquarters',
      tilesetUrl: 'https://example.com/tileset.json',
      beforeId: 'symbol-labels',
    });

    controlsContainer.appendChild(control.onAdd(map as never));
    const id = await control.loadTileset();

    expect(id).toBe('tileset-1');
    expect(map.addLayer).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'test-3d-tiles' }),
      'symbol-labels',
    );
    expect(control.getState()).toEqual(
      expect.objectContaining({
        status: 'loading',
        layerName: 'Headquarters',
        beforeId: 'symbol-labels',
        tilesetUrl: 'https://example.com/tileset.json',
        activeTilesetId: 'tileset-1',
      }),
    );
    expect(control.getState().tilesets).toHaveLength(1);
    expect(control.getState().tilesets[0]).toEqual(
      expect.objectContaining({
        layerName: 'Headquarters',
        beforeId: 'symbol-labels',
      }),
    );
  });

  it('parses request headers from the form field and stores them on the tileset', async () => {
    const { map, mapContainer, controlsContainer } = createMockMap();
    const control = new ThreeDTilesControl({
      layerId: 'test-3d-tiles',
      tilesetUrl: 'https://example.com/tileset.json',
    });

    controlsContainer.appendChild(control.onAdd(map as never));
    const headersField = mapContainer.querySelector(
      '.three-d-tiles-textarea',
    ) as HTMLTextAreaElement;
    headersField.value = 'Authorization: ApiKey secret\nX-Env: prod';
    await control.loadTileset();

    expect(control.getState().tilesets[0].requestHeaders).toEqual({
      Authorization: 'ApiKey secret',
      'X-Env': 'prod',
    });
    expect(control.getState().requestHeaders).toEqual({
      Authorization: 'ApiKey secret',
      'X-Env': 'prod',
    });
  });

  it('accepts request headers passed directly to loadTileset', async () => {
    const { map, controlsContainer } = createMockMap();
    const control = new ThreeDTilesControl({ layerId: 'test-3d-tiles' });

    controlsContainer.appendChild(control.onAdd(map as never));
    await control.loadTileset('https://example.com/secure.json', {
      requestHeaders: { Authorization: 'Bearer token' },
    });

    expect(control.getState().tilesets[0].requestHeaders).toEqual({
      Authorization: 'Bearer token',
    });
  });

  it('restores saved headers into the form when a tileset is initialised', () => {
    const { map, mapContainer, controlsContainer } = createMockMap();
    const control = new ThreeDTilesControl({
      requestHeaders: { Authorization: 'ApiKey persisted' },
    });

    controlsContainer.appendChild(control.onAdd(map as never));
    const headersField = mapContainer.querySelector(
      '.three-d-tiles-textarea',
    ) as HTMLTextAreaElement;

    expect(headersField.value).toBe('Authorization: ApiKey persisted');
  });

  it('omits request headers from the tileset when the field is empty', async () => {
    const { map, controlsContainer } = createMockMap();
    const control = new ThreeDTilesControl({ layerId: 'test-3d-tiles' });

    controlsContainer.appendChild(control.onAdd(map as never));
    await control.loadTileset();

    expect(control.getState().tilesets[0].requestHeaders).toBeUndefined();
  });

  it('adds multiple custom layers without replacing existing tilesets', async () => {
    const { map, controlsContainer } = createMockMap();
    const control = new ThreeDTilesControl({
      layerId: 'test-3d-tiles',
      tilesetUrl: 'https://example.com/tileset-a.json',
    });

    controlsContainer.appendChild(control.onAdd(map as never));
    await control.loadTileset();
    await control.loadTileset('https://example.com/tileset-b.json', {
      layerName: 'Second tileset',
      beforeId: 'building-labels',
      altitudeOffset: 10,
    });

    expect(map.addLayer).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ id: 'test-3d-tiles' }),
      undefined,
    );
    expect(map.addLayer).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ id: 'test-3d-tiles-tileset-2' }),
      'building-labels',
    );
    expect(control.getState().tilesets).toEqual([
      expect.objectContaining({
        id: 'tileset-1',
        layerId: 'test-3d-tiles',
        layerName: '3D Tiles',
        tilesetUrl: 'https://example.com/tileset-a.json',
      }),
      expect.objectContaining({
        id: 'tileset-2',
        layerId: 'test-3d-tiles-tileset-2',
        layerName: 'Second tileset',
        beforeId: 'building-labels',
        tilesetUrl: 'https://example.com/tileset-b.json',
        altitudeOffset: 10,
      }),
    ]);
  });

  it('removes a selected tileset while keeping the others', async () => {
    const { map, controlsContainer } = createMockMap();
    const control = new ThreeDTilesControl({
      layerId: 'test-3d-tiles',
      tilesetUrl: 'https://example.com/tileset-a.json',
    });

    controlsContainer.appendChild(control.onAdd(map as never));
    const firstId = await control.loadTileset();
    await control.loadTileset('https://example.com/tileset-b.json');
    control.removeTileset(firstId);

    expect(map.removeLayer).toHaveBeenCalledWith('test-3d-tiles');
    expect(control.getState().tilesets).toHaveLength(1);
    expect(control.getState().tilesets[0]).toEqual(
      expect.objectContaining({ id: 'tileset-2' }),
    );
  });
});

describe('GeoLibre plugin', () => {
  it('uses control defaults when no project tileset state exists', () => {
    const { map, controlsContainer } = createMockMap();
    const app = {
      addMapControl: vi.fn((control: ThreeDTilesControl) => {
        controlsContainer.appendChild(control.onAdd(map as never));
        return true;
      }),
      removeMapControl: vi.fn((control: ThreeDTilesControl) => {
        control.onRemove();
      }),
    };

    plugin.applyProjectState?.(app, {});
    plugin.activate(app);

    expect(plugin.getProjectState?.()).toEqual(
      expect.objectContaining({
        tilesetUrl: DEFAULT_TILESET_URL,
        altitudeOffset: -300,
      }),
    );

    plugin.deactivate(app);
  });
});

describe('patchGltfTextureLoaderForBlob', () => {
  it('routes blob:/data: textures off the CORS path and keeps http(s) on it', () => {
    const loader = new GLTFLoader();
    patchGltfTextureLoaderForBlob(loader);

    // GLTFLoader auto-registers built-in plugins in its constructor, so ours is
    // the last one registered.
    const callbacks = (
      loader as unknown as {
        pluginCallbacks: Array<(parser: unknown) => { name?: string }>;
      }
    ).pluginCallbacks;
    const register = callbacks[callbacks.length - 1];

    const baseCalls: string[] = [];
    const base = {
      manager: new THREE.LoadingManager(),
      requestHeader: {},
      setRequestHeader() {},
      load: (url: string) => {
        baseCalls.push(url);
      },
    };

    // Running the registered plugin rewrites base.load into the dispatcher.
    const result = register({ textureLoader: base });
    expect(result.name).toBe('GEOLIBRE_blob_texture_crossorigin');

    base.load('https://example.com/tex.png');
    base.load('blob:http://tauri.localhost/abc');
    base.load('data:image/png;base64,AAAA');

    // Only the http(s) texture goes through the original (CORS) loader; the
    // same-origin object/data URLs are routed to the crossOrigin-free sibling.
    expect(baseCalls).toEqual(['https://example.com/tex.png']);
  });
});
