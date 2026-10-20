import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { ThreeDTilesLayer } from '../src/lib/core/ThreeDTilesLayer';

type LayerInternals = {
  _map?: { triggerRepaint: () => void };
  _scene?: THREE.Scene;
  _camera?: THREE.PerspectiveCamera;
  _tilesCamera?: THREE.PerspectiveCamera;
  _renderer?: unknown;
  _tiles?: unknown;
  _localTransform?: THREE.Matrix4;
  _initTiles: () => void;
};

function createLayer(): { layer: ThreeDTilesLayer; internals: LayerInternals } {
  const layer = new ThreeDTilesLayer({
    id: 'test-repaint',
    tilesetUrl: 'https://example.com/tileset.json',
    altitudeOffset: 0,
    opacity: 1,
    visible: true,
  } as never);
  return { layer, internals: layer as unknown as LayerInternals };
}

const renderArgs = {
  defaultProjectionData: { mainMatrix: new THREE.Matrix4().toArray() },
  projectionMatrix: new THREE.Matrix4().toArray(),
} as never;

/** A renderer stub with what KTX2Loader and TilesRenderer read during setup. */
function createRendererStub() {
  return {
    extensions: { has: () => false },
    capabilities: { isWebGL2: true },
    getSize: (target: THREE.Vector2) => target.set(800, 600),
    getPixelRatio: () => 1,
    resetState: vi.fn(),
    render: vi.fn(),
    dispose: vi.fn(),
  };
}

describe('ThreeDTilesLayer repaint', () => {
  it('selects tiles before drawing and does not request another frame', () => {
    const { layer, internals } = createLayer();
    const triggerRepaint = vi.fn();
    const renderer = createRendererStub();
    const tiles = { group: new THREE.Group(), update: vi.fn() };

    internals._map = { triggerRepaint };
    internals._scene = new THREE.Scene();
    internals._camera = new THREE.PerspectiveCamera();
    internals._tilesCamera = new THREE.PerspectiveCamera();
    internals._renderer = renderer;
    internals._tiles = tiles;
    internals._localTransform = new THREE.Matrix4();

    layer.render({} as WebGL2RenderingContext, renderArgs);

    expect(tiles.update).toHaveBeenCalledOnce();
    expect(renderer.render).toHaveBeenCalledOnce();
    expect(tiles.update.mock.invocationCallOrder[0]).toBeLessThan(
      renderer.render.mock.invocationCallOrder[0],
    );
    expect(triggerRepaint).not.toHaveBeenCalled();
  });

  it('repaints when the tiles renderer reports a finished load, until removed', () => {
    const { layer, internals } = createLayer();
    const triggerRepaint = vi.fn();

    internals._map = { triggerRepaint };
    internals._scene = new THREE.Scene();
    internals._tilesCamera = new THREE.PerspectiveCamera();
    internals._renderer = createRendererStub();
    internals._initTiles();

    const tiles = internals._tiles as THREE.EventDispatcher<{ 'needs-update': object }>;
    tiles.dispatchEvent({ type: 'needs-update' });
    expect(triggerRepaint).toHaveBeenCalledOnce();

    layer.onRemove();
    tiles.dispatchEvent({ type: 'needs-update' });
    expect(triggerRepaint).toHaveBeenCalledOnce();
  });
});
