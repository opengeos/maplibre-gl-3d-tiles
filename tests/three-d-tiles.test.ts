import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { plugin } from '../src/geolibre';
import { DEFAULT_TILESET_URL, ThreeDTilesControl } from '../src/lib/core/ThreeDTilesControl';
import { ecefToLngLatAlt, ThreeDTilesLayer } from '../src/lib/core/ThreeDTilesLayer';

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
    addLayer: vi.fn((layer: { id: string }) => {
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

  it('updates visibility state and emits visibility events', () => {
    const control = new ThreeDTilesControl();
    const handler = vi.fn();

    control.setState({
      activeTilesetId: 'tileset-1',
      tilesets: [
        {
          id: 'tileset-1',
          layerId: 'test-3d-tiles',
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
      tilesetUrl: 'https://example.com/tileset.json',
    });

    controlsContainer.appendChild(control.onAdd(map as never));
    const id = await control.loadTileset();

    expect(id).toBe('tileset-1');
    expect(map.addLayer).toHaveBeenCalledWith(expect.objectContaining({ id: 'test-3d-tiles' }));
    expect(control.getState()).toEqual(
      expect.objectContaining({
        status: 'loading',
        tilesetUrl: 'https://example.com/tileset.json',
        activeTilesetId: 'tileset-1',
      }),
    );
    expect(control.getState().tilesets).toHaveLength(1);
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
      altitudeOffset: 10,
    });

    expect(map.addLayer).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ id: 'test-3d-tiles' }),
    );
    expect(map.addLayer).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ id: 'test-3d-tiles-tileset-2' }),
    );
    expect(control.getState().tilesets).toEqual([
      expect.objectContaining({
        id: 'tileset-1',
        layerId: 'test-3d-tiles',
        tilesetUrl: 'https://example.com/tileset-a.json',
      }),
      expect.objectContaining({
        id: 'tileset-2',
        layerId: 'test-3d-tiles-tileset-2',
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
