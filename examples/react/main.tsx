import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import maplibregl, { Map } from 'maplibre-gl';
import { ThreeDTilesControlReact, useThreeDTilesState } from '../../src/react';
import '../../src/index.css';
import 'maplibre-gl/dist/maplibre-gl.css';

function App() {
  const mapContainer = useRef<HTMLDivElement>(null);
  const [map, setMap] = useState<Map | null>(null);
  const { state, toggle, setState } = useThreeDTilesState({ collapsed: false });

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

    mapInstance.addControl(new maplibregl.NavigationControl(), 'top-right');
    mapInstance.addControl(new maplibregl.FullscreenControl(), 'top-right');
    mapInstance.addControl(new maplibregl.GlobeControl(), 'top-right');
    mapInstance.on('load', () => setMap(mapInstance));

    return () => {
      mapInstance.remove();
    };
  }, []);

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <div ref={mapContainer} style={{ width: '100%', height: '100%' }} />
      <button
        onClick={toggle}
        style={{
          position: 'absolute',
          top: 10,
          left: 10,
          zIndex: 1,
          padding: '8px 12px',
          background: '#111827',
          color: 'white',
          border: 'none',
          borderRadius: 4,
          cursor: 'pointer',
          fontWeight: 600,
        }}
      >
        {state.collapsed ? 'Expand' : 'Collapse'} 3D Tiles
      </button>
      {map && (
        <ThreeDTilesControlReact
          map={map}
          collapsed={state.collapsed}
          panelWidth={360}
          onStateChange={(nextState) => setState(nextState)}
        />
      )}
    </div>
  );
}

const root = createRoot(document.getElementById('root')!);
root.render(<App />);
