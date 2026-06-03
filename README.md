# MapLibre GL 3D Tiles

A MapLibre GL JS control for rendering 3D Tiles with three.js and `3d-tiles-renderer`. It provides a standalone `IControl`, a React wrapper, Vite examples, a Docker example server, and a GeoLibre plugin bundle.

## Features

- MapLibre custom 3D layer backed by three.js
- 3D Tiles rendering through `3d-tiles-renderer`
- GLTF, Draco, and KTX2 loader support
- Collapsible MapLibre control with URL, altitude offset, visibility, load, remove, and fly-to actions
- Multiple tilesets on the same map with per-tileset visibility, fly-to, and remove actions
- TypeScript API and React wrapper
- GeoLibre plugin zip build

## Installation

```bash
npm install maplibre-gl-3d-tiles
```

## Vanilla Usage

```typescript
import maplibregl from 'maplibre-gl';
import { ThreeDTilesControl } from 'maplibre-gl-3d-tiles';
import 'maplibre-gl-3d-tiles/style.css';
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

map.on('load', () => {
  const control = new ThreeDTilesControl({
    collapsed: false,
    tilesetUrl: 'https://pelican-public.s3.amazonaws.com/3dtiles/agi-hq/tileset.json',
    altitudeOffset: -300,
  });

  map.addControl(control, 'top-right');
  void control.loadTileset();
  void control.loadTileset('https://example.com/another/tileset.json', {
    altitudeOffset: 0,
  });
});
```

## React Usage

```tsx
import { useEffect, useRef, useState } from 'react';
import maplibregl, { Map } from 'maplibre-gl';
import {
  ThreeDTilesControlReact,
  useThreeDTilesState,
} from 'maplibre-gl-3d-tiles/react';
import 'maplibre-gl-3d-tiles/style.css';

function App() {
  const mapContainer = useRef<HTMLDivElement>(null);
  const [map, setMap] = useState<Map | null>(null);
  const { state, setState } = useThreeDTilesState({ collapsed: false });

  useEffect(() => {
    if (!mapContainer.current) return;

    const mapInstance = new maplibregl.Map({
      container: mapContainer.current,
      style: 'https://tiles.openfreemap.org/styles/bright',
      center: [0, 0],
      zoom: 1,
      pitch: 60,
      maxPitch: 80,
      canvasContextAttributes: { antialias: true },
    });

    mapInstance.on('load', () => setMap(mapInstance));
    return () => mapInstance.remove();
  }, []);

  return (
    <>
      <div ref={mapContainer} style={{ width: '100%', height: '100vh' }} />
      {map && (
        <ThreeDTilesControlReact
          map={map}
          collapsed={state.collapsed}
          onStateChange={(nextState) => setState(nextState)}
        />
      )}
    </>
  );
}
```

## API

### ThreeDTilesControl

Constructor options include:

| Option | Type | Default |
| --- | --- | --- |
| `tilesetUrl` | `string` | MapLibre example tileset |
| `altitudeOffset` | `number` | `-300` |
| `flyToOnLoad` | `boolean` | `true` |
| `visible` | `boolean` | `true` |
| `layerId` | `string` | `maplibre-gl-3d-tiles` |
| `collapsed` | `boolean` | `true` |
| `panelWidth` | `number` | `360` |
| `position` | MapLibre control position | `top-right` |

Main methods:

- `loadTileset(url?, options?)`
- `removeTileset(id?)`, removes all tilesets when no id is passed
- `setVisible(visible, id?)`
- `flyToTileset(id?)`
- `getState()`
- `setState(state)`
- `toggle()`, `expand()`, `collapse()`
- `on(event, handler)`, `off(event, handler)`

Events:

```text
collapse, expand, statechange, loadstart, load, error, remove, visibilitychange
```

## Development

```bash
npm install
npm run dev
npm test
npm run build
npm run build:examples
```

## GeoLibre Plugin Bundle

```bash
npm run package:geolibre
```

This creates:

```text
geolibre-plugin/maplibre-gl-3d-tiles-0.1.0.zip
```

## Docker

```bash
docker build -t maplibre-gl-3d-tiles .
docker run -p 8080:80 maplibre-gl-3d-tiles
```

Open http://localhost:8080/maplibre-gl-3d-tiles/ to view the examples.
