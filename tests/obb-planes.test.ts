import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { OBB } from '3d-tiles-renderer';
import { lngLatAltToEcef } from '../src/lib/core/ThreeDTilesLayer';
import { updateObbPlanes } from '../src/lib/core/obbPlanes';

// Build an OBB from a 3D Tiles `box` the way 3d-tiles-renderer's
// TileBoundingVolume.setObbData does: unit axes in the transform, half-lengths
// in the box.
function obbFromTilesBox(data: number[]): OBB {
  const axes = [0, 1, 2].map((i) =>
    new THREE.Vector3(data[3 + 3 * i], data[4 + 3 * i], data[5 + 3 * i]),
  );
  const lengths = axes.map((axis) => axis.length());
  axes.forEach((axis) => axis.normalize());
  const transform = new THREE.Matrix4()
    .makeBasis(axes[0], axes[1], axes[2])
    .setPosition(data[0], data[1], data[2]);
  const obb = new OBB(
    new THREE.Box3(
      new THREE.Vector3(-lengths[0], -lengths[1], -lengths[2]),
      new THREE.Vector3(lengths[0], lengths[1], lengths[2]),
    ),
    transform,
  );
  obb.update();
  return obb;
}

function minPlaneDistance(obb: OBB, point: THREE.Vector3): number {
  return Math.min(...obb.planes.map((plane) => plane.distanceToPoint(point)));
}

// Root bounding volume of https://data.3dbag.nl/v20250903/cesium3dtiles/lod22/tileset.json.
// Its half-axes are not quite perpendicular.
const BAG_ROOT_BOX = [
  3904710.3, 358952.35, 5007965.25, -14243.23, 152479.97, 175.34, -120315.85,
  -11345.32, 93987.74, 2942.65, 270.51, 3774.08,
];

describe('updateObbPlanes', () => {
  it('keeps ground the box contains inside every culling plane of a skewed box', () => {
    const obb = obbFromTilesBox(BAG_ROOT_BOX);
    // Ground in Zeist, near the tileset center, 45 m above the ellipsoid.
    const zeist = lngLatAltToEcef(5.21675, 52.08555, 45);

    expect(obb.containsPoint(zeist)).toBe(true);
    // The patched planes (installed at import by ThreeDTilesLayer) agree with
    // containsPoint; the upstream planes put this point 170 m outside.
    expect(minPlaneDistance(obb, zeist)).toBeGreaterThan(0);
  });

  it('matches the upstream axis-as-normal planes for an orthogonal box', () => {
    const transform = new THREE.Matrix4().makeRotationFromEuler(
      new THREE.Euler(0.3, -0.7, 1.1),
    );
    transform.setPosition(10, -20, 30);
    const box = new THREE.Box3(new THREE.Vector3(-1, -2, -3), new THREE.Vector3(1, 2, 3));
    const obb = new OBB(box, transform);
    obb.update();

    // 3d-tiles-renderer's original formula: each axis is its faces' normal.
    const worldMin = box.min.clone().applyMatrix4(transform);
    const worldMax = box.max.clone().applyMatrix4(transform);
    const upstream = [
      new THREE.Vector3(0, 0, 1),
      new THREE.Vector3(0, 1, 0),
      new THREE.Vector3(1, 0, 0),
    ].flatMap((axis) => {
      const normal = axis.transformDirection(transform);
      return [
        new THREE.Plane().setFromNormalAndCoplanarPoint(normal, worldMin),
        new THREE.Plane().setFromNormalAndCoplanarPoint(normal, worldMax).negate(),
      ];
    });

    obb.planes.forEach((plane, i) => {
      expect(plane.normal.distanceTo(upstream[i].normal)).toBeLessThan(1e-9);
      expect(plane.constant).toBeCloseTo(upstream[i].constant, 9);
    });
  });
});
