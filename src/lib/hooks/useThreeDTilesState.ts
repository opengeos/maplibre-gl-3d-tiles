import { useCallback, useState } from 'react';
import { DEFAULT_TILESET_URL } from '../core/ThreeDTilesControl';
import type { ThreeDTilesState } from '../core/types';

const DEFAULT_STATE: ThreeDTilesState = {
  collapsed: true,
  panelWidth: 360,
  tilesetUrl: DEFAULT_TILESET_URL,
  layerName: '3D Tiles',
  altitudeOffset: -300,
  flyToOnLoad: true,
  opacity: 1,
  visible: true,
  status: 'idle',
  tilesets: [],
};

export function useThreeDTilesState(initialState?: Partial<ThreeDTilesState>) {
  const [state, setState] = useState<ThreeDTilesState>({
    ...DEFAULT_STATE,
    ...initialState,
  });

  const setCollapsed = useCallback((collapsed: boolean) => {
    setState((prev) => ({ ...prev, collapsed }));
  }, []);

  const setPanelWidth = useCallback((panelWidth: number) => {
    setState((prev) => ({ ...prev, panelWidth }));
  }, []);

  const setTilesetUrl = useCallback((tilesetUrl: string) => {
    setState((prev) => ({ ...prev, tilesetUrl }));
  }, []);

  const setLayerName = useCallback((layerName: string) => {
    setState((prev) => ({ ...prev, layerName }));
  }, []);

  const setBeforeId = useCallback((beforeId?: string) => {
    setState((prev) => ({ ...prev, beforeId }));
  }, []);

  const setAltitudeOffset = useCallback((altitudeOffset: number) => {
    setState((prev) => ({ ...prev, altitudeOffset }));
  }, []);

  const setOpacity = useCallback((opacity: number) => {
    setState((prev) => ({ ...prev, opacity }));
  }, []);

  const setVisible = useCallback((visible: boolean) => {
    setState((prev) => ({ ...prev, visible }));
  }, []);

  const reset = useCallback(() => {
    setState({ ...DEFAULT_STATE, ...initialState });
  }, [initialState]);

  const toggle = useCallback(() => {
    setState((prev) => ({ ...prev, collapsed: !prev.collapsed }));
  }, []);

  return {
    state,
    setState,
    setCollapsed,
    setPanelWidth,
    setTilesetUrl,
    setLayerName,
    setBeforeId,
    setAltitudeOffset,
    setOpacity,
    setVisible,
    reset,
    toggle,
  };
}
