import type {
  CustomLayerInterface,
  CustomRenderMethodInput,
  Map as MapLibreMap,
} from 'maplibre-gl';
import maplibregl from 'maplibre-gl';
import * as THREE from 'three';
import { TilesRenderer } from '3d-tiles-renderer';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';
import type { LoadedTilesetMetadata, ThreeDTilesDecoderOptions } from './types';

const MAX_METADATA_RETRIES = 120;

function requestMetadataFrame(callback: FrameRequestCallback): number {
  if (typeof globalThis.requestAnimationFrame === 'function') {
    return globalThis.requestAnimationFrame(callback);
  }
  return globalThis.setTimeout(() => callback(Date.now()), 16) as unknown as number;
}

function cancelMetadataFrame(handle: number): void {
  if (typeof globalThis.cancelAnimationFrame === 'function') {
    globalThis.cancelAnimationFrame(handle);
    return;
  }
  globalThis.clearTimeout(handle);
}

export interface ThreeDTilesLayerOptions extends ThreeDTilesDecoderOptions {
  id: string;
  tilesetUrl: string;
  altitudeOffset: number;
  opacity: number;
  visible: boolean;
  /**
   * Custom HTTP request headers applied to the tileset's fetch options, so the
   * tileset JSON and every tile request carry them (for authenticated sources).
   */
  requestHeaders?: Record<string, string>;
  onLoad?: (metadata: LoadedTilesetMetadata) => void;
  onError?: (error: Error) => void;
}

export interface EcefCoordinate {
  lng: number;
  lat: number;
  alt: number;
}

export function ecefToLngLatAlt(x: number, y: number, z: number): EcefCoordinate {
  const a = 6378137.0;
  const e2 = 6.69437999014e-3;
  const b = a * Math.sqrt(1 - e2);
  const ep2 = (a * a - b * b) / (b * b);
  const p = Math.sqrt(x * x + y * y);
  const th = Math.atan2(a * z, b * p);
  const lon = Math.atan2(y, x);
  const lat = Math.atan2(
    z + ep2 * b * Math.sin(th) ** 3,
    p - e2 * a * Math.cos(th) ** 3,
  );
  const n = a / Math.sqrt(1 - e2 * Math.sin(lat) * Math.sin(lat));
  const alt = p / Math.cos(lat) - n;

  return {
    lng: (lon * 180) / Math.PI,
    lat: (lat * 180) / Math.PI,
    alt,
  };
}

export class ThreeDTilesLayer implements CustomLayerInterface {
  id: string;
  type: 'custom' = 'custom';
  renderingMode: '3d' = '3d';

  private _options: ThreeDTilesLayerOptions;
  private _map?: MapLibreMap;
  private _scene?: THREE.Scene;
  private _camera?: THREE.PerspectiveCamera;
  private _tilesCamera?: THREE.PerspectiveCamera;
  private _renderer?: THREE.WebGLRenderer;
  private _tiles?: TilesRenderer;
  private _localTransform?: THREE.Matrix4;
  private _metadata?: LoadedTilesetMetadata;
  /**
   * Load-time anchor (the tileset bounding-sphere center as lng/lat plus its
   * unadjusted ellipsoidal altitude). Kept so the altitude offset can be
   * re-applied live without reloading the tileset.
   */
  private _anchor?: { lng: number; lat: number; alt: number };
  private _opacity: number;
  private _opacityDirty = true;
  private _visible: boolean;
  private _loadTilesetHandler?: () => void;
  private _loadErrorHandler?: (event: { error: Error }) => void;
  private _metadataRetryFrame: number | null = null;
  private _metadataRetryCount = 0;

  constructor(options: ThreeDTilesLayerOptions) {
    this.id = options.id;
    this._options = options;
    this._opacity = options.opacity;
    this._visible = options.visible;
  }

  onAdd(map: MapLibreMap, gl: WebGLRenderingContext | WebGL2RenderingContext): void {
    this._map = map;
    this._camera = new THREE.PerspectiveCamera();
    this._tilesCamera = new THREE.PerspectiveCamera();
    this._scene = new THREE.Scene();
    this._scene.add(new THREE.AmbientLight(0xffffff, 3));

    this._renderer = new THREE.WebGLRenderer({
      canvas: map.getCanvas(),
      context: gl,
      antialias: true,
    });
    this._renderer.autoClear = false;

    this._initTiles();
  }

  render(
    _gl: WebGLRenderingContext | WebGL2RenderingContext,
    args: CustomRenderMethodInput,
  ): void {
    if (
      !this._visible ||
      !this._map ||
      !this._camera ||
      !this._tilesCamera ||
      !this._renderer ||
      !this._scene ||
      !this._tiles ||
      !this._localTransform ||
      !args?.defaultProjectionData?.mainMatrix ||
      !args.projectionMatrix
    ) {
      return;
    }

    this._camera.projectionMatrix.fromArray(args.defaultProjectionData.mainMatrix);
    this._camera.projectionMatrix.multiply(this._localTransform);

    const projectionMatrix = new THREE.Matrix4().fromArray(args.projectionMatrix);
    const inverseProjectionMatrix = projectionMatrix.clone().invert();
    const viewMatrix = new THREE.Matrix4().multiplyMatrices(
      inverseProjectionMatrix,
      this._camera.projectionMatrix,
    );

    this._tilesCamera.projectionMatrix.copy(projectionMatrix);
    this._tilesCamera.matrixWorldInverse.copy(viewMatrix);
    this._tilesCamera.matrixWorld.copy(viewMatrix).invert();

    this._renderer.resetState();
    this._applyOpacity();
    this._renderer.render(this._scene, this._camera);
    this._tiles.update();
    this._map.triggerRepaint();
  }

  onRemove(): void {
    if (this._metadataRetryFrame !== null) {
      cancelMetadataFrame(this._metadataRetryFrame);
    }
    if (this._tiles && this._loadTilesetHandler) {
      this._tiles.removeEventListener('load-tileset', this._loadTilesetHandler);
    }
    if (this._tiles && this._loadErrorHandler) {
      this._tiles.removeEventListener('load-error', this._loadErrorHandler);
    }

    this._tiles?.dispose();
    this._scene?.clear();
    this._renderer?.dispose();

    this._map = undefined;
    this._scene = undefined;
    this._camera = undefined;
    this._tilesCamera = undefined;
    this._renderer = undefined;
    this._tiles = undefined;
    this._localTransform = undefined;
    this._anchor = undefined;
    this._loadTilesetHandler = undefined;
    this._loadErrorHandler = undefined;
    this._metadataRetryFrame = null;
    this._metadataRetryCount = 0;
  }

  setVisible(visible: boolean): void {
    this._visible = visible;
    if (this._tiles) {
      this._getTilesGroup().visible = visible;
    }
    this._map?.triggerRepaint();
  }

  setOpacity(opacity: number): void {
    this._opacity = Math.min(1, Math.max(0, opacity));
    this._opacityDirty = true;
    this._applyOpacity();
    this._map?.triggerRepaint();
  }

  /**
   * Re-position the loaded tileset vertically without reloading it. The
   * placement is otherwise computed once on load, so changing the offset after
   * the fact previously required a full reload. Before the tileset has loaded
   * (no anchor yet) the value is stored and applied when `_handleTilesetLoaded`
   * runs.
   */
  setAltitudeOffset(altitudeOffset: number): void {
    this._options.altitudeOffset = altitudeOffset;
    if (!this._anchor) return;

    const { lng, lat, alt } = this._anchor;
    const adjustedAltitude = alt + altitudeOffset;
    this._updateLocalTransform([lng, lat, adjustedAltitude]);
    if (this._metadata) {
      this._metadata = { ...this._metadata, altitude: adjustedAltitude };
    }
    this._map?.triggerRepaint();
  }

  getMetadata(): LoadedTilesetMetadata | undefined {
    return this._metadata;
  }

  flyToTileset(): void {
    if (!this._map || !this._metadata) return;
    this._map.flyTo({
      center: this._metadata.center,
      zoom: 18,
      pitch: 60,
    });
  }

  private _initTiles(): void {
    if (!this._scene || !this._tilesCamera || !this._renderer) return;

    const gltfLoader = new GLTFLoader();
    const dracoLoader = new DRACOLoader();
    dracoLoader.setDecoderPath(this._options.dracoDecoderPath);
    gltfLoader.setDRACOLoader(dracoLoader);

    const ktx2Loader = new KTX2Loader();
    ktx2Loader.setTranscoderPath(this._options.ktx2TranscoderPath);
    ktx2Loader.detectSupport(this._renderer);
    gltfLoader.setKTX2Loader(ktx2Loader);

    this._tiles = new TilesRenderer(this._options.tilesetUrl);
    const requestHeaders = this._options.requestHeaders;
    if (requestHeaders && Object.keys(requestHeaders).length > 0) {
      // TilesRenderer forwards fetchOptions to every tileset/tile fetch, so
      // setting headers here authenticates the whole tileset request tree.
      this._tiles.fetchOptions = {
        ...this._tiles.fetchOptions,
        headers: { ...this._tiles.fetchOptions?.headers, ...requestHeaders },
      };
    }
    const group = this._getTilesGroup();
    group.name = this.id;
    group.visible = this._visible;
    this._scene.add(group);
    this._tiles.setCamera(this._tilesCamera);
    this._tiles.setResolutionFromRenderer(this._tilesCamera, this._renderer);
    this._tiles.manager.addHandler(/\.(gltf|glb)$/g, gltfLoader);

    this._loadTilesetHandler = () => this._handleTilesetLoaded();
    this._loadErrorHandler = (event) => this._options.onError?.(event.error);
    this._tiles.addEventListener('load-tileset', this._loadTilesetHandler);
    this._tiles.addEventListener('load-error', this._loadErrorHandler);

    this._updateLocalTransform([0, 0, 0]);
    this._applyOpacity();
  }

  private _handleTilesetLoaded(): void {
    if (!this._tiles || this._metadata) return;

    const sphere = new THREE.Sphere();
    if (!this._tiles.getBoundingSphere(sphere)) {
      this._retryTilesetMetadata();
      return;
    }

    if (this._metadataRetryFrame !== null) {
      cancelMetadataFrame(this._metadataRetryFrame);
      this._metadataRetryFrame = null;
    }
    this._metadataRetryCount = 0;

    if (this._loadTilesetHandler) {
      this._tiles.removeEventListener('load-tileset', this._loadTilesetHandler);
    }

    const center = sphere.center.clone();
    const { lng, lat, alt } = ecefToLngLatAlt(center.x, center.y, center.z);
    this._anchor = { lng, lat, alt };
    const adjustedAltitude = alt + this._options.altitudeOffset;

    this._updateLocalTransform([lng, lat, adjustedAltitude]);

    // Orient the geometry onto the local tangent plane at the anchor.
    // 3d-tiles-renderer emits world-space geometry in ECEF, so "up" is the
    // ellipsoidal normal at the anchor lng/lat, not a fixed axis. We derive the
    // East/North/Up basis from the anchor location rather than the root tile's
    // transform: for a Cesium-style tileset the root transform already equals
    // this ENU basis, while a region-based tileset (e.g. a point cloud with an
    // RTC center and an identity root transform) ships no usable rotation and
    // would otherwise be tilted by the site's colatitude.
    const lngRad = (lng * Math.PI) / 180;
    const latRad = (lat * Math.PI) / 180;
    const sinLng = Math.sin(lngRad);
    const cosLng = Math.cos(lngRad);
    const sinLat = Math.sin(latRad);
    const cosLat = Math.cos(latRad);
    // Rows map an ECEF vector into the MapLibre custom layer's model frame
    // (X = East, Y = Up, Z = -North).
    const rotationMat3 = new THREE.Matrix3().set(
      -sinLng,
      cosLng,
      0,
      cosLat * cosLng,
      cosLat * sinLng,
      sinLat,
      sinLat * cosLng,
      sinLat * sinLng,
      -cosLat,
    );
    const rotationMat4 = new THREE.Matrix4().setFromMatrix3(rotationMat3);
    const moveToOrigin = new THREE.Matrix4().makeTranslation(-center.x, -center.y, -center.z);
    const finalMatrix = new THREE.Matrix4().multiplyMatrices(rotationMat4, moveToOrigin);

    const group = this._getTilesGroup();
    group.matrix.copy(finalMatrix);
    group.matrixAutoUpdate = false;
    group.updateMatrixWorld(true);

    this._metadata = {
      center: [lng, lat],
      altitude: adjustedAltitude,
      radius: sphere.radius,
    };
    this._options.onLoad?.(this._metadata);
  }

  private _retryTilesetMetadata(): void {
    if (this._metadataRetryFrame !== null) return;

    if (this._metadataRetryCount >= MAX_METADATA_RETRIES) {
      this._options.onError?.(new Error('Unable to read 3D Tiles bounds.'));
      return;
    }

    this._metadataRetryCount += 1;
    this._metadataRetryFrame = requestMetadataFrame(() => {
      this._metadataRetryFrame = null;
      this._handleTilesetLoaded();
    });
  }

  private _updateLocalTransform(
    modelOrigin: [number, number, number],
    rotate: [number, number, number] = [Math.PI / 2, 0, 0],
  ): void {
    const modelAsMercatorCoordinate = maplibregl.MercatorCoordinate.fromLngLat(
      [modelOrigin[0], modelOrigin[1]],
      modelOrigin[2],
    );
    const rotationX = new THREE.Matrix4().makeRotationAxis(
      new THREE.Vector3(1, 0, 0),
      rotate[0],
    );
    const rotationY = new THREE.Matrix4().makeRotationAxis(
      new THREE.Vector3(0, 1, 0),
      rotate[1],
    );
    const rotationZ = new THREE.Matrix4().makeRotationAxis(
      new THREE.Vector3(0, 0, 1),
      rotate[2],
    );
    const scale = modelAsMercatorCoordinate.meterInMercatorCoordinateUnits();

    this._localTransform = new THREE.Matrix4()
      .makeTranslation(
        modelAsMercatorCoordinate.x,
        modelAsMercatorCoordinate.y,
        modelAsMercatorCoordinate.z,
      )
      .scale(new THREE.Vector3(scale, -scale, scale))
      .multiply(rotationX)
      .multiply(rotationY)
      .multiply(rotationZ);
  }

  private _applyOpacity(): void {
    if (!this._scene || (!this._opacityDirty && this._opacity >= 1)) return;

    this._scene.traverse((object) => {
      const material = (object as { material?: THREE.Material | THREE.Material[] }).material;
      const materials = Array.isArray(material) ? material : material ? [material] : [];
      for (const item of materials) {
        item.opacity = this._opacity;
        item.transparent = this._opacity < 1;
        item.needsUpdate = true;
      }
    });
    this._opacityDirty = this._opacity < 1;
  }

  private _getTilesGroup(): THREE.Object3D {
    return this._tiles!.group as unknown as THREE.Object3D;
  }
}
