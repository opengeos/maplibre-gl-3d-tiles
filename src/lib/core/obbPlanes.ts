import * as THREE from 'three';
import { OBB } from '3d-tiles-renderer';

type ObbInternals = {
  box: THREE.Box3;
  transform: THREE.Matrix4;
  planes: THREE.Plane[];
};

const _axes = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
const _normal = new THREE.Vector3();
const _worldMin = new THREE.Vector3();
const _worldMax = new THREE.Vector3();

// For each face pair: the axis the faces are offset along, then the two axes
// spanning the face. Ordered to match OBB.planes (z, y, x pairs).
const FACE_AXES: ReadonlyArray<readonly [number, number, number]> = [
  [2, 0, 1],
  [1, 2, 0],
  [0, 1, 2],
];

/**
 * Compute an OBB's six face planes from face normals that stay correct when
 * the box half-axes are not perpendicular.
 *
 * 3d-tiles-renderer uses each half-axis direction as the normal of the faces
 * offset along it. That only holds for orthogonal axes. Real tilesets ship
 * slightly skewed boxes: the 3DBAG root box's north half-axis leans 0.19
 * degrees toward "down", which over its 153 km half-width puts the top culling
 * plane 501 m below the real top face, under the ground. MapLibre's frustum at
 * pitch 0 ends at the ground, so it never reached that plane and the whole
 * tileset was culled when zoomed in. A face spanned by two axes has the cross
 * product of those axes as its normal, which is exact for any parallelepiped.
 *
 * Exported for testing.
 */
export function updateObbPlanes(obb: ObbInternals): void {
  const e = obb.transform.elements;
  _axes[0].set(e[0], e[1], e[2]);
  _axes[1].set(e[4], e[5], e[6]);
  _axes[2].set(e[8], e[9], e[10]);
  _worldMin.copy(obb.box.min).applyMatrix4(obb.transform);
  _worldMax.copy(obb.box.max).applyMatrix4(obb.transform);

  FACE_AXES.forEach(([offsetAxis, spanA, spanB], face) => {
    _normal.crossVectors(_axes[spanA], _axes[spanB]);
    if (_normal.lengthSq() === 0) {
      // Degenerate span (a zero-size axis); fall back to the axis itself.
      _normal.copy(_axes[offsetAxis]);
    }
    _normal.normalize();
    if (_normal.dot(_axes[offsetAxis]) < 0) _normal.negate();
    obb.planes[2 * face].setFromNormalAndCoplanarPoint(_normal, _worldMin);
    obb.planes[2 * face + 1].setFromNormalAndCoplanarPoint(_normal, _worldMax).negate();
  });
}

let patched = false;

/**
 * Route every 3d-tiles-renderer OBB through `updateObbPlanes`. Idempotent;
 * runs at import time so it is in place before any tileset parses a box.
 */
export function patchObbPlanes(): void {
  if (patched) return;
  patched = true;
  (OBB.prototype as unknown as { updatePlanes: () => void }).updatePlanes = function (
    this: ObbInternals,
  ) {
    updateObbPlanes(this);
  };
}
