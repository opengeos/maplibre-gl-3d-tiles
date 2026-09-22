import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { ThreeDTilesLayer } from '../src/lib/core/ThreeDTilesLayer';

type LayerInternals = {
  _scene?: THREE.Scene;
  _applyEnvironment: (tileScene: THREE.Object3D) => void;
};

function createLayer(): LayerInternals {
  const layer = new ThreeDTilesLayer({
    id: 'test-environment',
    tilesetUrl: 'https://example.com/tileset.json',
    altitudeOffset: 0,
    opacity: 1,
    visible: true,
  });
  return layer as unknown as LayerInternals;
}

function createSceneWithEnvironment(): THREE.Scene {
  const scene = new THREE.Scene();
  scene.environment = new THREE.Texture();
  return scene;
}

/**
 * Build a tile scene shaped like the ones `load-model` delivers.
 */
function createTileScene(material: THREE.Material): THREE.Object3D {
  const tileScene = new THREE.Object3D();
  tileScene.add(new THREE.Mesh(new THREE.BufferGeometry(), material));
  return tileScene;
}

// `needsUpdate` is a write-only setter on three's Material: it bumps `version`,
// which is what the renderer watches to recompile the program.
describe('ThreeDTilesLayer scene environment', () => {
  it('flags a loaded tile material for recompilation so the environment applies', () => {
    const internals = createLayer();
    internals._scene = createSceneWithEnvironment();

    // A fully metallic material, which is what glTF's metallicFactor default
    // produces. It has no diffuse response, so it renders black until the
    // environment reaches it.
    const material = new THREE.MeshStandardMaterial({ metalness: 1 });
    const before = material.version;

    internals._applyEnvironment(createTileScene(material));

    expect(material.version).toBeGreaterThan(before);
  });

  it('handles a mesh carrying an array of materials', () => {
    const internals = createLayer();
    internals._scene = createSceneWithEnvironment();

    const first = new THREE.MeshStandardMaterial({ metalness: 1 });
    const second = new THREE.MeshStandardMaterial({ metalness: 1 });
    const firstBefore = first.version;
    const secondBefore = second.version;

    const tileScene = new THREE.Object3D();
    tileScene.add(new THREE.Mesh(new THREE.BufferGeometry(), [first, second]));
    internals._applyEnvironment(tileScene);

    expect(first.version).toBeGreaterThan(firstBefore);
    expect(second.version).toBeGreaterThan(secondBefore);
  });

  it('leaves materials alone when the scene has no environment', () => {
    const internals = createLayer();
    internals._scene = new THREE.Scene();

    const material = new THREE.MeshStandardMaterial({ metalness: 1 });
    const before = material.version;

    internals._applyEnvironment(createTileScene(material));

    expect(material.version).toBe(before);
  });

  it('ignores materials that are not standard materials', () => {
    const internals = createLayer();
    internals._scene = createSceneWithEnvironment();

    const material = new THREE.MeshBasicMaterial();
    const before = material.version;

    internals._applyEnvironment(createTileScene(material));

    expect(material.version).toBe(before);
  });
});
