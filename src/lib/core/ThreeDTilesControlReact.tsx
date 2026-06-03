import { useEffect, useRef } from 'react';
import { ThreeDTilesControl } from './ThreeDTilesControl';
import type { ThreeDTilesControlReactProps } from './types';

export function ThreeDTilesControlReact({
  map,
  onStateChange,
  ...options
}: ThreeDTilesControlReactProps): null {
  const controlRef = useRef<ThreeDTilesControl | null>(null);

  useEffect(() => {
    if (!map) return;

    const control = new ThreeDTilesControl(options);
    controlRef.current = control;

    if (onStateChange) {
      control.on('statechange', (event) => {
        onStateChange(event.state);
      });
    }

    map.addControl(control, options.position || 'top-right');

    return () => {
      if (map.hasControl(control)) {
        map.removeControl(control);
      }
      controlRef.current = null;
    };
  }, [map]);

  useEffect(() => {
    const control = controlRef.current;
    if (!control) return;

    const currentState = control.getState();
    if (options.collapsed !== undefined && options.collapsed !== currentState.collapsed) {
      if (options.collapsed) {
        control.collapse();
      } else {
        control.expand();
      }
    }
  }, [options.collapsed]);

  useEffect(() => {
    const control = controlRef.current;
    if (!control || options.visible === undefined) return;
    control.setVisible(options.visible);
  }, [options.visible]);

  return null;
}
