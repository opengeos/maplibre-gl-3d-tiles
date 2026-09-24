import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import type { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { ThreeDTilesLayer } from '../src/lib/core/ThreeDTilesLayer';

const handlers = vi.hoisted(
  () => [] as Array<{ regex: RegExp; loader: unknown }>,
);

// The real TilesRenderer fetches the tileset on construction, so stand in for it
// and capture the glTF loader `_initTiles` hands to the loading manager.
vi.mock('3d-tiles-renderer', async () => {
  const three = await import('three');
  return {
    OBB: class {
      updatePlanes() {}
    },
    TilesRenderer: class {
      group = new three.Group();
      fetchOptions: Record<string, unknown> = {};
      manager = {
        addHandler(regex: RegExp, loader: unknown) {
          handlers.push({ regex, loader });
        },
      };
      setCamera() {}
      setResolutionFromRenderer() {}
      addEventListener() {}
      removeEventListener() {}
      dispose() {}
    },
  };
});

/**
 * Run the private `_initTiles` with the minimum scene state it reads.
 */
function initTiles(): void {
  const layer = new ThreeDTilesLayer({
    id: 'test-meshopt',
    tilesetUrl: 'https://example.com/tileset.json',
    altitudeOffset: 0,
    opacity: 1,
    visible: true,
  });
  const internals = layer as unknown as {
    _scene: THREE.Scene;
    _tilesCamera: THREE.PerspectiveCamera;
    _renderer: unknown;
    _initTiles: () => void;
  };
  internals._scene = new THREE.Scene();
  internals._tilesCamera = new THREE.PerspectiveCamera();
  internals._renderer = {
    capabilities: { isWebGL2: true },
    extensions: { has: () => false },
  };
  internals._initTiles();
}

describe('ThreeDTilesLayer glTF decoders', () => {
  it('registers a meshopt decoder so EXT_meshopt_compression tilesets load', () => {
    handlers.length = 0;
    initTiles();

    const gltfLoader = handlers.at(-1)?.loader as GLTFLoader | undefined;
    expect(gltfLoader).toBeDefined();

    // GLTFLoader throws "setMeshoptDecoder must be called before loading
    // compressed files" when a tileset requires EXT_meshopt_compression and the
    // decoder is missing or reports itself unsupported.
    const decoder = (
      gltfLoader as unknown as { meshoptDecoder: { supported: boolean } | null }
    ).meshoptDecoder;
    expect(decoder).toBeTruthy();
    expect(decoder?.supported).toBe(true);
  });

  it('still registers the DRACO and KTX2 decoders', () => {
    handlers.length = 0;
    initTiles();

    const gltfLoader = handlers.at(-1)?.loader as unknown as {
      dracoLoader: unknown;
      ktx2Loader: unknown;
    };
    expect(gltfLoader.dracoLoader).toBeTruthy();
    expect(gltfLoader.ktx2Loader).toBeTruthy();
  });
});
