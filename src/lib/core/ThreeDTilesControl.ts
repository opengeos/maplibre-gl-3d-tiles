import type { IControl, Map as MapLibreMap } from 'maplibre-gl';
import { ThreeDTilesLayer } from './ThreeDTilesLayer';
import { parseRequestHeaders, serializeRequestHeaders } from '../utils/helpers';
import type {
  LoadedTilesetMetadata,
  ThreeDTilesControlEvent,
  ThreeDTilesControlEventHandler,
  ThreeDTilesControlOptions,
  ThreeDTilesControlPosition,
  ThreeDTilesItemState,
  ThreeDTilesLoadOptions,
  ThreeDTilesState,
} from './types';

const THREE_VERSION = '0.184.0';
const DEFAULT_TILESET_URL = 'https://pelican-public.s3.amazonaws.com/3dtiles/agi-hq/tileset.json';
const DEFAULT_DRACO_PATH = `https://unpkg.com/three@${THREE_VERSION}/examples/jsm/libs/draco/`;
const DEFAULT_KTX2_PATH = `https://unpkg.com/three@${THREE_VERSION}/examples/jsm/libs/basis/`;

/** Smallest user-resized panel footprint. */
const PANEL_MIN_WIDTH = 260;
const PANEL_MIN_HEIGHT = 180;
/** Breathing room kept between a resized panel and the map edges. */
const PANEL_EDGE_MARGIN = 12;

type ResolvedThreeDTilesControlOptions = Required<
  Omit<ThreeDTilesControlOptions, 'beforeId' | 'requestHeaders'>
> &
  Pick<ThreeDTilesControlOptions, 'beforeId' | 'requestHeaders'>;

const DEFAULT_OPTIONS: ResolvedThreeDTilesControlOptions = {
  collapsed: true,
  position: 'top-right',
  title: '3D Tiles',
  panelWidth: 360,
  className: '',
  collapseOnClickOutside: true,
  layerId: 'maplibre-gl-3d-tiles',
  sampleData: [],
  sampleDataLabel: 'Load sample data...',
  tilesetUrl: DEFAULT_TILESET_URL,
  layerName: '3D Tiles',
  beforeId: undefined,
  altitudeOffset: -300,
  flyToOnLoad: true,
  opacity: 1,
  visible: true,
  dracoDecoderPath: DEFAULT_DRACO_PATH,
  ktx2TranscoderPath: DEFAULT_KTX2_PATH,
};

type EventHandlersMap = globalThis.Map<
  ThreeDTilesControlEvent,
  Set<ThreeDTilesControlEventHandler>
>;

export { DEFAULT_TILESET_URL };

export class ThreeDTilesControl implements IControl {
  private _map?: MapLibreMap;
  private _mapContainer?: HTMLElement;
  private _container?: HTMLElement;
  private _panel?: HTMLElement;
  private _content?: HTMLElement;
  private _layerNameInput?: HTMLInputElement;
  private _urlInput?: HTMLInputElement;
  private _headersInput?: HTMLTextAreaElement;
  private _beforeIdInput?: HTMLInputElement;
  private _altitudeInput?: HTMLInputElement;
  private _flyToCheckbox?: HTMLInputElement;
  private _visibleCheckbox?: HTMLInputElement;
  private _statusElement?: HTMLElement;
  private _tilesetList?: HTMLElement;
  private _loadButton?: HTMLButtonElement;
  private _removeAllButton?: HTMLButtonElement;
  private _options: ResolvedThreeDTilesControlOptions;
  private _state: ThreeDTilesState;
  private _layers = new globalThis.Map<string, ThreeDTilesLayer>();
  private _eventHandlers: EventHandlersMap = new globalThis.Map();
  private _resizeHandler: (() => void) | null = null;
  private _mapResizeHandler: (() => void) | null = null;
  private _clickOutsideHandler: ((e: MouseEvent) => void) | null = null;
  private _tilesetCounter = 0;
  // User-chosen panel size from the resize handles, reapplied by
  // _updatePanelPosition so repositioning (map/window resize) keeps it.
  // null means auto (the panel sizes to its content).
  private _userWidth: number | null = null;
  private _userHeight: number | null = null;
  // Active drag teardown, so onRemove can detach mid-resize.
  private _resizeDragCleanup: (() => void) | null = null;

  constructor(options?: ThreeDTilesControlOptions) {
    this._options = { ...DEFAULT_OPTIONS, ...options };
    this._state = {
      collapsed: this._options.collapsed,
      panelWidth: this._options.panelWidth,
      tilesetUrl: this._options.tilesetUrl,
      layerName: this._options.layerName,
      beforeId: this._options.beforeId,
      altitudeOffset: this._options.altitudeOffset,
      flyToOnLoad: this._options.flyToOnLoad,
      opacity: this._options.opacity,
      visible: this._options.visible,
      requestHeaders: this._options.requestHeaders,
      status: 'idle',
      tilesets: [],
    };
  }

  onAdd(map: MapLibreMap): HTMLElement {
    this._map = map;
    this._mapContainer = map.getContainer();
    this._container = this._createContainer();
    this._panel = this._createPanel();
    this._mapContainer.appendChild(this._panel);
    this._setupEventListeners();

    if (!this._state.collapsed) {
      this._panel.classList.add('expanded');
      requestAnimationFrame(() => this._updatePanelPosition());
    }

    return this._container;
  }

  onRemove(): void {
    this.removeTileset(undefined, false);

    if (this._resizeHandler) {
      window.removeEventListener('resize', this._resizeHandler);
      this._resizeHandler = null;
    }
    if (this._mapResizeHandler && this._map) {
      this._map.off('resize', this._mapResizeHandler);
      this._mapResizeHandler = null;
    }
    if (this._clickOutsideHandler) {
      document.removeEventListener('click', this._clickOutsideHandler);
      this._clickOutsideHandler = null;
    }
    // Detach any in-flight resize drag listeners.
    this._resizeDragCleanup?.();

    this._panel?.parentNode?.removeChild(this._panel);
    this._container?.parentNode?.removeChild(this._container);

    this._map = undefined;
    this._mapContainer = undefined;
    this._container = undefined;
    this._panel = undefined;
    this._content = undefined;
    this._eventHandlers.clear();
  }

  getState(): ThreeDTilesState {
    return {
      ...this._state,
      tilesets: this._state.tilesets.map((tileset) => ({ ...tileset })),
    };
  }

  setState(newState: Partial<ThreeDTilesState>): void {
    this._state = {
      ...this._state,
      ...newState,
      tilesets: newState.tilesets
        ? newState.tilesets.map((tileset) => ({ ...tileset }))
        : this._state.tilesets,
    };
    this._syncFormFromState();
    this._updateStatus();
    this._renderTilesetList();
    this._emit('statechange');
  }

  async loadTileset(
    url = this._urlInput?.value.trim() || this._state.tilesetUrl,
    options?: Partial<ThreeDTilesLoadOptions>,
  ): Promise<string | undefined> {
    if (!this._map) return undefined;
    if (!url) {
      this._setError(new Error('Tileset URL is required.'));
      return undefined;
    }

    const altitudeOffset = options?.altitudeOffset ?? this._getAltitudeOffset();
    const flyToOnLoad = options?.flyToOnLoad ?? Boolean(this._flyToCheckbox?.checked);
    const opacity = options?.opacity ?? this._state.opacity;
    const visible = options?.visible ?? Boolean(this._visibleCheckbox?.checked);
    const layerName = options?.layerName ?? this._getLayerName();
    const beforeId = options?.beforeId ?? this._getBeforeId();
    const requestHeaders = options?.requestHeaders ?? this._getRequestHeaders();
    const id = this._createTilesetId();
    const layerId = this._createLayerId(id);
    const item: ThreeDTilesItemState = {
      id,
      layerId,
      layerName,
      beforeId,
      tilesetUrl: url,
      altitudeOffset,
      opacity,
      visible,
      requestHeaders,
      status: 'loading',
    };

    this._state = {
      ...this._state,
      tilesetUrl: url,
      layerName,
      beforeId,
      altitudeOffset,
      flyToOnLoad,
      opacity,
      visible,
      requestHeaders,
      status: 'loading',
      error: undefined,
      center: undefined,
      altitude: undefined,
      activeTilesetId: id,
      tilesets: [...this._state.tilesets, item],
    };
    this._syncFormFromState();
    this._updateStatus();
    this._renderTilesetList();
    this._emit('loadstart');
    this._emit('statechange');

    const layer = new ThreeDTilesLayer({
      id: layerId,
      tilesetUrl: url,
      altitudeOffset,
      opacity,
      visible,
      requestHeaders,
      dracoDecoderPath: this._options.dracoDecoderPath,
      ktx2TranscoderPath: this._options.ktx2TranscoderPath,
      onLoad: (metadata) => this._handleTilesetLoaded(id, metadata),
      onError: (error) => this._setError(error, id),
    });
    this._layers.set(id, layer);

    await this._waitForStyle();
    if (!this._map || !this._layers.has(id)) return undefined;
    this._map.addLayer(layer, beforeId);
    return id;
  }

  removeTileset(id?: string, emit = true): void {
    const ids = id
      ? [id]
      : [...new Set([...this._layers.keys(), ...this._state.tilesets.map((tileset) => tileset.id)])];

    ids.forEach((tilesetId) => {
      const item = this._getTileset(tilesetId);
      if (item && this._map?.getLayer(item.layerId)) {
        this._map.removeLayer(item.layerId);
      }
      this._layers.delete(tilesetId);
    });

    const removedIds = new Set(ids);
    const tilesets = this._state.tilesets.filter((tileset) => !removedIds.has(tileset.id));
    const activeTileset = this._getActiveTileset(tilesets);
    this._state = {
      ...this._state,
      status: activeTileset?.status ?? 'idle',
      error: activeTileset?.error,
      center: activeTileset?.center,
      altitude: activeTileset?.altitude,
      visible: activeTileset?.visible ?? this._state.visible,
      tilesetUrl: activeTileset?.tilesetUrl ?? this._state.tilesetUrl,
      layerName: activeTileset?.layerName ?? this._state.layerName,
      beforeId: activeTileset?.beforeId,
      altitudeOffset: activeTileset?.altitudeOffset ?? this._state.altitudeOffset,
      opacity: activeTileset?.opacity ?? this._state.opacity,
      requestHeaders: activeTileset?.requestHeaders,
      activeTilesetId: activeTileset?.id,
      tilesets,
    };
    this._syncFormFromState();
    this._updateStatus();
    this._renderTilesetList();

    if (emit) {
      this._emit('remove');
      this._emit('statechange');
    }
  }

  setVisible(visible: boolean, id = this._state.activeTilesetId): void {
    if (!id) return;

    this._layers.get(id)?.setVisible(visible);
    this._state = {
      ...this._state,
      visible,
      tilesets: this._state.tilesets.map((tileset) =>
        tileset.id === id ? { ...tileset, visible } : tileset,
      ),
    };
    this._syncFormFromState();
    this._renderTilesetList();
    this._emit('visibilitychange');
    this._emit('statechange');
  }

  setOpacity(
    opacity: number,
    id = this._state.activeTilesetId,
    render = true,
  ): void {
    if (!id) return;

    const nextOpacity = Math.min(1, Math.max(0, opacity));
    this._layers.get(id)?.setOpacity(nextOpacity);
    this._state = {
      ...this._state,
      opacity: nextOpacity,
      tilesets: this._state.tilesets.map((tileset) =>
        tileset.id === id ? { ...tileset, opacity: nextOpacity } : tileset,
      ),
    };
    if (render) {
      this._renderTilesetList();
    }
    this._emit('opacitychange');
    this._emit('statechange');
  }

  setAltitudeOffset(
    altitudeOffset: number,
    id = this._state.activeTilesetId,
    render = true,
  ): void {
    if (!id || !Number.isFinite(altitudeOffset)) return;

    this._layers.get(id)?.setAltitudeOffset(altitudeOffset);
    this._state = {
      ...this._state,
      altitudeOffset,
      tilesets: this._state.tilesets.map((tileset) =>
        tileset.id === id ? { ...tileset, altitudeOffset } : tileset,
      ),
    };
    if (render) {
      this._renderTilesetList();
    }
    this._emit('altitudechange');
    this._emit('statechange');
  }

  flyToTileset(id = this._state.activeTilesetId): void {
    if (!id) return;
    this._layers.get(id)?.flyToTileset();
    this._state = { ...this._state, activeTilesetId: id };
    this._syncFromActiveTileset();
    this._renderTilesetList();
    this._emit('statechange');
  }

  toggle(): void {
    this._state.collapsed = !this._state.collapsed;

    if (this._panel) {
      if (this._state.collapsed) {
        this._panel.classList.remove('expanded');
        this._emit('collapse');
      } else {
        this._panel.classList.add('expanded');
        this._updatePanelPosition();
        this._emit('expand');
      }
    }

    this._emit('statechange');
  }

  expand(): void {
    if (this._state.collapsed) this.toggle();
  }

  collapse(): void {
    if (!this._state.collapsed) this.toggle();
  }

  on(event: ThreeDTilesControlEvent, handler: ThreeDTilesControlEventHandler): void {
    if (!this._eventHandlers.has(event)) {
      this._eventHandlers.set(event, new Set());
    }
    this._eventHandlers.get(event)!.add(handler);
  }

  off(event: ThreeDTilesControlEvent, handler: ThreeDTilesControlEventHandler): void {
    this._eventHandlers.get(event)?.delete(handler);
  }

  getMap(): MapLibreMap | undefined {
    return this._map;
  }

  getContainer(): HTMLElement | undefined {
    return this._container;
  }

  private _emit(event: ThreeDTilesControlEvent): void {
    const handlers = this._eventHandlers.get(event);
    if (!handlers) return;
    const eventData = { type: event, state: this.getState() };
    handlers.forEach((handler) => handler(eventData));
  }

  private _createContainer(): HTMLElement {
    const container = document.createElement('div');
    container.className = `maplibregl-ctrl maplibregl-ctrl-group three-d-tiles-control${
      this._options.className ? ` ${this._options.className}` : ''
    }`;

    const toggleBtn = document.createElement('button');
    toggleBtn.className = 'three-d-tiles-control-toggle';
    toggleBtn.type = 'button';
    toggleBtn.setAttribute('aria-label', this._options.title);
    toggleBtn.innerHTML = `
      <span class="three-d-tiles-control-icon">
        <svg viewBox="0 0 24 24" width="22" height="22" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 3 4 7.5l8 4.5 8-4.5L12 3Z"/>
          <path d="M4 7.5v9L12 21l8-4.5v-9"/>
          <path d="M12 12v9"/>
          <path d="m4 16.5 8-4.5 8 4.5"/>
        </svg>
      </span>
    `;
    toggleBtn.addEventListener('click', () => this.toggle());
    container.appendChild(toggleBtn);

    return container;
  }

  private _createPanel(): HTMLElement {
    const panel = document.createElement('div');
    panel.className = 'three-d-tiles-control-panel';
    panel.style.width = `${this._options.panelWidth}px`;

    const header = document.createElement('div');
    header.className = 'three-d-tiles-control-header';

    const title = document.createElement('span');
    title.className = 'three-d-tiles-control-title';
    title.textContent = this._options.title;

    const closeBtn = document.createElement('button');
    closeBtn.className = 'three-d-tiles-control-close';
    closeBtn.type = 'button';
    closeBtn.setAttribute('aria-label', 'Close panel');
    closeBtn.innerHTML = '&times;';
    closeBtn.addEventListener('click', () => this.collapse());

    header.appendChild(title);
    header.appendChild(closeBtn);

    this._content = document.createElement('div');
    this._content.className = 'three-d-tiles-control-content';
    this._content.appendChild(this._createForm());

    panel.appendChild(header);
    panel.appendChild(this._content);
    this._addResizeHandles(panel);

    return panel;
  }

  /**
   * Adds drag handles in the panel's bottom-left and bottom-right corners.
   * Pointer drags resize the panel and the chosen size is kept (in
   * {@link _userWidth}/{@link _userHeight}) so repositioning does not reset it.
   * A custom handle is used instead of CSS `resize` (unreliable in WebKitGTK).
   *
   * @param panel - The panel element to attach handles to.
   */
  private _addResizeHandles(panel: HTMLElement): void {
    for (const side of ['left', 'right'] as const) {
      const handle = document.createElement('div');
      handle.className = `three-d-tiles-control-resize-handle three-d-tiles-control-resize-${side}`;
      handle.setAttribute('aria-hidden', 'true');
      handle.addEventListener('pointerdown', (event) =>
        this._beginResize(event, side, panel, handle),
      );
      panel.appendChild(handle);
    }
  }

  /**
   * Starts a pointer-driven resize from one of the bottom corner handles.
   *
   * The panel is first frozen to explicit left/top pixels (clearing any
   * right/bottom anchor) so the opposite edge stays put no matter which corner
   * the control sits in. The right handle then grows the panel rightward, the
   * left handle leftward; both grow it downward. Sizes are clamped to a
   * sensible minimum and to the map container.
   *
   * @param event - The pointerdown event.
   * @param side - Which corner handle started the drag.
   * @param panel - The panel element being resized.
   * @param handle - The handle element (for pointer capture).
   */
  private _beginResize(
    event: PointerEvent,
    side: 'left' | 'right',
    panel: HTMLElement,
    handle: HTMLElement,
  ): void {
    if (!this._mapContainer) return;
    event.preventDefault();
    // Keep the drag from bubbling to the document click-outside handler.
    event.stopPropagation();

    const mapRect = this._mapContainer.getBoundingClientRect();
    const rect = panel.getBoundingClientRect();
    const startX = event.clientX;
    const startY = event.clientY;
    const startWidth = rect.width;
    const startHeight = rect.height;
    const startLeft = rect.left - mapRect.left;
    const startRight = rect.right;
    const startTop = rect.top;

    // Clamp the preferred minimums to what the map can actually hold, so a
    // small map container never forces the panel past its edges.
    const minWidth = Math.min(
      PANEL_MIN_WIDTH,
      Math.max(120, mapRect.width - 2 * PANEL_EDGE_MARGIN),
    );
    const minHeight = Math.min(
      PANEL_MIN_HEIGHT,
      Math.max(120, mapRect.height - 2 * PANEL_EDGE_MARGIN),
    );

    // Pin the panel to its current rect so the size grows from the dragged
    // corner regardless of the original anchor, and drop the CSS max-size
    // caps for the duration of the drag.
    panel.style.left = `${startLeft}px`;
    panel.style.top = `${startTop - mapRect.top}px`;
    panel.style.right = '';
    panel.style.bottom = '';
    panel.style.maxWidth = 'none';
    panel.style.maxHeight = 'none';

    const onMove = (moveEvent: PointerEvent): void => {
      const dx = moveEvent.clientX - startX;
      const dy = moveEvent.clientY - startY;

      const maxHeight = Math.max(
        minHeight,
        mapRect.bottom - startTop - PANEL_EDGE_MARGIN,
      );
      const nextHeight = Math.max(
        minHeight,
        Math.min(startHeight + dy, maxHeight),
      );

      let nextWidth: number;
      let nextLeft = startLeft;
      if (side === 'right') {
        const maxWidth = Math.max(
          minWidth,
          mapRect.right - rect.left - PANEL_EDGE_MARGIN,
        );
        nextWidth = Math.max(minWidth, Math.min(startWidth + dx, maxWidth));
      } else {
        const maxWidth = Math.max(
          minWidth,
          startRight - mapRect.left - PANEL_EDGE_MARGIN,
        );
        nextWidth = Math.max(minWidth, Math.min(startWidth - dx, maxWidth));
        // Hold the right edge fixed while the left edge follows the drag.
        nextLeft = startLeft + (startWidth - nextWidth);
      }

      panel.style.width = `${nextWidth}px`;
      panel.style.height = `${nextHeight}px`;
      panel.style.left = `${nextLeft}px`;
      this._userWidth = nextWidth;
      this._userHeight = nextHeight;
    };

    const cleanup = (): void => {
      handle.releasePointerCapture?.(event.pointerId);
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('pointerup', cleanup);
      handle.removeEventListener('pointercancel', cleanup);
      this._resizeDragCleanup = null;
    };

    handle.setPointerCapture?.(event.pointerId);
    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', cleanup);
    // Touch/pen drags can end with pointercancel instead of pointerup.
    handle.addEventListener('pointercancel', cleanup);
    this._resizeDragCleanup = cleanup;
  }

  private _createForm(): HTMLElement {
    const form = document.createElement('form');
    form.className = 'three-d-tiles-form';
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      void this.loadTileset();
    });

    this._layerNameInput = this._createInput('Layer name', 'text', this._state.layerName);
    this._urlInput = this._createInput('Tileset URL', 'url', this._state.tilesetUrl);
    this._headersInput = this._createTextarea(
      'Request headers',
      serializeRequestHeaders(this._state.requestHeaders),
      'Authorization: ApiKey <key>',
    );
    this._beforeIdInput = this._createInput('Before layer ID', 'text', this._state.beforeId ?? '');
    this._altitudeInput = this._createInput(
      'Altitude offset',
      'number',
      String(this._state.altitudeOffset),
    );
    this._altitudeInput.step = '1';
    // The form mirrors the active tileset (see `_syncFromActiveTileset`), so
    // editing the offset re-positions the loaded tileset live instead of only
    // taking effect on the next load. With no active tileset the value is just
    // the default for the next `loadTileset` call.
    this._altitudeInput.addEventListener('input', () => {
      const value = Number(this._altitudeInput?.value);
      if (Number.isFinite(value) && this._state.activeTilesetId) {
        this.setAltitudeOffset(value, this._state.activeTilesetId, false);
      }
    });
    this._altitudeInput.addEventListener('change', () => {
      const value = Number(this._altitudeInput?.value);
      if (Number.isFinite(value) && this._state.activeTilesetId) {
        this.setAltitudeOffset(value, this._state.activeTilesetId);
      }
    });

    this._flyToCheckbox = this._createCheckbox('Fly to tileset after load', this._state.flyToOnLoad);
    this._visibleCheckbox = this._createCheckbox('Visible on load', this._state.visible);

    this._statusElement = document.createElement('div');
    this._statusElement.className = 'three-d-tiles-status';

    this._loadButton = this._createButton('Add tileset', 'submit');
    this._removeAllButton = this._createButton('Remove all', 'button');
    this._removeAllButton.addEventListener('click', () => this.removeTileset());

    const actions = document.createElement('div');
    actions.className = 'three-d-tiles-actions two-columns';
    actions.appendChild(this._loadButton);
    actions.appendChild(this._removeAllButton);

    this._tilesetList = document.createElement('div');
    this._tilesetList.className = 'three-d-tiles-list';

    const sampleDropdown = this._createSampleDropdown();
    if (sampleDropdown) form.appendChild(sampleDropdown);
    form.appendChild(this._wrapField('Tileset URL', this._urlInput));
    form.appendChild(this._wrapField('Layer name', this._layerNameInput));
    form.appendChild(
      this._wrapField('Request headers', this._headersInput, {
        hint: 'One per line as Name: Value, for authenticated tilesets. Saved with the layer.',
      }),
    );
    form.appendChild(this._wrapField('Before layer ID', this._beforeIdInput));
    form.appendChild(this._wrapField('Altitude offset', this._altitudeInput));
    form.appendChild(this._flyToCheckbox.parentElement!);
    form.appendChild(this._visibleCheckbox.parentElement!);
    form.appendChild(actions);
    form.appendChild(this._statusElement);
    form.appendChild(this._tilesetList);
    this._updateStatus();
    this._renderTilesetList();

    return form;
  }

  private _createInput(label: string, type: string, value: string): HTMLInputElement {
    const input = document.createElement('input');
    input.className = 'three-d-tiles-input';
    input.type = type;
    input.value = value;
    input.setAttribute('aria-label', label);
    return input;
  }

  /**
   * Builds the "Load sample data" dropdown: a custom (not native `<select>`)
   * dropdown so the menu themes correctly in dark mode. Picking an entry fills
   * the Tileset URL input. Returns null when no samples are configured.
   */
  private _createSampleDropdown(): HTMLElement | null {
    const samples = this._options.sampleData;
    if (!samples || samples.length === 0) return null;

    const placeholder = this._options.sampleDataLabel;
    const triggerLabel = document.createElement('span');
    triggerLabel.className = 'three-d-tiles-sample-trigger-label';
    triggerLabel.textContent = placeholder;
    const caret = document.createElement('span');
    caret.className = 'three-d-tiles-sample-caret';
    caret.textContent = '▾';
    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'three-d-tiles-sample-trigger';
    trigger.setAttribute('aria-haspopup', 'listbox');
    trigger.setAttribute('aria-expanded', 'false');
    trigger.setAttribute('aria-label', placeholder);
    trigger.appendChild(triggerLabel);
    trigger.appendChild(caret);

    const menu = document.createElement('div');
    menu.className = 'three-d-tiles-sample-menu';
    menu.setAttribute('role', 'listbox');
    menu.hidden = true;

    let menuOpen = false;
    const setMenuOpen = (open: boolean): void => {
      menuOpen = open;
      menu.hidden = !open;
      trigger.setAttribute('aria-expanded', String(open));
      trigger.classList.toggle('open', open);
      if (open) (menu.firstElementChild as HTMLElement | null)?.focus();
    };

    for (const sample of samples) {
      const option = document.createElement('button');
      option.type = 'button';
      option.className = 'three-d-tiles-sample-option';
      option.setAttribute('role', 'option');
      option.textContent = sample.label;
      option.title = sample.url;
      option.addEventListener('click', () => {
        setMenuOpen(false);
        trigger.focus();
        if (this._urlInput) this._urlInput.value = sample.url;
      });
      menu.appendChild(option);
    }

    trigger.addEventListener('click', () => setMenuOpen(!menuOpen));

    const wrap = document.createElement('div');
    wrap.className = 'three-d-tiles-field three-d-tiles-sample-row';
    const labelSpan = document.createElement('span');
    labelSpan.textContent = 'Sample data';
    wrap.appendChild(labelSpan);
    const dropdown = document.createElement('div');
    dropdown.className = 'three-d-tiles-sample-dropdown';
    dropdown.appendChild(trigger);
    dropdown.appendChild(menu);
    wrap.appendChild(dropdown);

    // Close on Escape or when focus leaves the dropdown (no document-level
    // listener to tear down).
    wrap.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && menuOpen) {
        setMenuOpen(false);
        trigger.focus();
      }
    });
    wrap.addEventListener('focusout', (e) => {
      const next = e.relatedTarget as Node | null;
      if (!next || !wrap.contains(next)) setMenuOpen(false);
    });

    return wrap;
  }

  private _createTextarea(
    label: string,
    value: string,
    placeholder = '',
  ): HTMLTextAreaElement {
    const textarea = document.createElement('textarea');
    textarea.className = 'three-d-tiles-input three-d-tiles-textarea';
    textarea.value = value;
    textarea.rows = 2;
    textarea.placeholder = placeholder;
    textarea.spellcheck = false;
    textarea.setAttribute('aria-label', label);
    return textarea;
  }

  private _createCheckbox(label: string, checked: boolean): HTMLInputElement {
    const wrapper = document.createElement('label');
    wrapper.className = 'three-d-tiles-checkbox';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = checked;
    const text = document.createElement('span');
    text.textContent = label;
    wrapper.appendChild(input);
    wrapper.appendChild(text);
    return input;
  }

  private _wrapField(
    labelText: string,
    input: HTMLInputElement | HTMLTextAreaElement,
    options?: { hint?: string },
  ): HTMLElement {
    const label = document.createElement('label');
    label.className = 'three-d-tiles-field';
    const span = document.createElement('span');
    span.textContent = labelText;
    label.appendChild(span);
    label.appendChild(input);
    if (options?.hint) {
      const hint = document.createElement('span');
      hint.className = 'three-d-tiles-field-hint';
      hint.textContent = options.hint;
      label.appendChild(hint);
    }
    return label;
  }

  private _createButton(label: string, type: 'button' | 'submit'): HTMLButtonElement {
    const button = document.createElement('button');
    button.className = 'three-d-tiles-button';
    button.type = type;
    button.textContent = label;
    return button;
  }

  private _renderTilesetList(): void {
    if (!this._tilesetList) return;
    this._tilesetList.replaceChildren();

    if (this._state.tilesets.length === 0) {
      return;
    }

    this._state.tilesets.forEach((tileset, index) => {
      const item = document.createElement('div');
      item.className = 'three-d-tiles-list-item';
      if (tileset.id === this._state.activeTilesetId) {
        item.classList.add('active');
      }

      const meta = document.createElement('div');
      meta.className = 'three-d-tiles-list-meta';

      const title = document.createElement('button');
      title.className = 'three-d-tiles-list-title';
      title.type = 'button';
      title.textContent = tileset.layerName || `Tileset ${index + 1}`;
      title.addEventListener('click', () => this._setActiveTileset(tileset.id));

      const url = document.createElement('span');
      url.className = 'three-d-tiles-list-url';
      url.textContent = tileset.tilesetUrl;

      const status = document.createElement('span');
      status.className = 'three-d-tiles-list-status';
      status.dataset.status = tileset.status;
      status.textContent = tileset.error ?? this._formatTilesetStatus(tileset);

      meta.appendChild(title);
      meta.appendChild(url);
      meta.appendChild(status);

      const actions = document.createElement('div');
      actions.className = 'three-d-tiles-list-actions';

      const visible = document.createElement('input');
      visible.type = 'checkbox';
      visible.checked = tileset.visible;
      visible.setAttribute('aria-label', `Toggle tileset ${index + 1}`);
      visible.addEventListener('change', () => this.setVisible(visible.checked, tileset.id));

      const opacity = document.createElement('input');
      opacity.className = 'three-d-tiles-opacity';
      opacity.type = 'range';
      opacity.min = '0';
      opacity.max = '1';
      opacity.step = '0.05';
      opacity.value = String(tileset.opacity);
      opacity.setAttribute('aria-label', `Opacity for tileset ${index + 1}`);
      opacity.addEventListener('input', () => {
        this.setOpacity(Number(opacity.value), tileset.id, false);
      });
      opacity.addEventListener('change', () => {
        this.setOpacity(Number(opacity.value), tileset.id);
      });

      const flyTo = this._createSmallButton('Fly');
      flyTo.disabled = tileset.status !== 'loaded';
      flyTo.addEventListener('click', () => this.flyToTileset(tileset.id));

      const remove = this._createSmallButton('Remove');
      remove.addEventListener('click', () => this.removeTileset(tileset.id));

      actions.appendChild(visible);
      actions.appendChild(opacity);
      actions.appendChild(flyTo);
      actions.appendChild(remove);
      item.appendChild(meta);
      item.appendChild(actions);
      this._tilesetList!.appendChild(item);
    });
  }

  private _createSmallButton(label: string): HTMLButtonElement {
    const button = document.createElement('button');
    button.className = 'three-d-tiles-small-button';
    button.type = 'button';
    button.textContent = label;
    return button;
  }

  private _setupEventListeners(): void {
    if (this._options.collapseOnClickOutside) {
      this._clickOutsideHandler = (e: MouseEvent) => {
        const target = e.target as Node;
        if (
          this._container &&
          this._panel &&
          !this._container.contains(target) &&
          !this._panel.contains(target)
        ) {
          this.collapse();
        }
      };
      document.addEventListener('click', this._clickOutsideHandler);
    }

    this._resizeHandler = () => {
      if (!this._state.collapsed) this._updatePanelPosition();
    };
    window.addEventListener('resize', this._resizeHandler);

    this._mapResizeHandler = () => {
      if (!this._state.collapsed) this._updatePanelPosition();
    };
    this._map?.on('resize', this._mapResizeHandler);
  }

  private _getControlPosition(): ThreeDTilesControlPosition {
    const parent = this._container?.parentElement;
    if (!parent) return 'top-right';

    if (parent.classList.contains('maplibregl-ctrl-top-left')) return 'top-left';
    if (parent.classList.contains('maplibregl-ctrl-top-right')) return 'top-right';
    if (parent.classList.contains('maplibregl-ctrl-bottom-left')) return 'bottom-left';
    if (parent.classList.contains('maplibregl-ctrl-bottom-right')) return 'bottom-right';

    return 'top-right';
  }

  private _updatePanelPosition(): void {
    if (!this._container || !this._panel || !this._mapContainer) return;

    const button = this._container.querySelector('.three-d-tiles-control-toggle');
    if (!button) return;

    const buttonRect = button.getBoundingClientRect();
    const mapRect = this._mapContainer.getBoundingClientRect();
    const position = this._getControlPosition();
    const buttonTop = buttonRect.top - mapRect.top;
    const buttonBottom = mapRect.bottom - buttonRect.bottom;
    const buttonLeft = buttonRect.left - mapRect.left;
    const buttonRight = mapRect.right - buttonRect.right;
    const panelGap = 5;
    const edgeMargin = 10; // Breathing room between the panel and the map edge

    this._panel.style.top = '';
    this._panel.style.bottom = '';
    this._panel.style.left = '';
    this._panel.style.right = '';

    // Offset of the panel's anchored edge from the same edge of the map
    // container (top edge for top-* positions, bottom edge for bottom-*).
    const anchorOffset =
      (position === 'top-left' || position === 'top-right'
        ? buttonTop
        : buttonBottom) +
      buttonRect.height +
      panelGap;

    switch (position) {
      case 'top-left':
        this._panel.style.top = `${anchorOffset}px`;
        this._panel.style.left = `${buttonLeft}px`;
        break;
      case 'top-right':
        this._panel.style.top = `${anchorOffset}px`;
        this._panel.style.right = `${buttonRight}px`;
        break;
      case 'bottom-left':
        this._panel.style.bottom = `${anchorOffset}px`;
        this._panel.style.left = `${buttonLeft}px`;
        break;
      case 'bottom-right':
        this._panel.style.bottom = `${anchorOffset}px`;
        this._panel.style.right = `${buttonRight}px`;
        break;
    }

    // Let the panel size to its content but never spill past the map: cap it to
    // the space left between the anchor and the opposite map edge so it scrolls
    // its own content instead of being clipped by the map's overflow. The 160px
    // floor keeps the panel usable when the map is tiny.
    const available = Math.max(160, mapRect.height - anchorOffset - edgeMargin);
    this._panel.style.maxHeight = `min(80vh, 720px, ${available}px)`;
    const availableWidth = Math.max(120, mapRect.width - 2 * edgeMargin);

    // Reapply a resize the user made, clamped to the current map size, so
    // repositioning keeps their chosen dimensions instead of snapping back.
    // The lower bound guards a tiny map where `available` can go negative.
    if (this._userWidth !== null) {
      this._panel.style.width = `${Math.max(120, Math.min(this._userWidth, availableWidth))}px`;
    }
    if (this._userHeight !== null) {
      this._panel.style.height = `${Math.max(120, Math.min(this._userHeight, available))}px`;
    }
  }

  private _getAltitudeOffset(): number {
    const value = Number(this._altitudeInput?.value ?? this._state.altitudeOffset);
    return Number.isFinite(value) ? value : this._state.altitudeOffset;
  }

  private _getLayerName(): string {
    const value = this._layerNameInput?.value.trim() || this._state.layerName;
    return value || '3D Tiles';
  }

  private _getBeforeId(): string | undefined {
    const value = this._beforeIdInput?.value.trim() || this._state.beforeId;
    return value || undefined;
  }

  private _getRequestHeaders(): Record<string, string> | undefined {
    const raw = this._headersInput?.value ?? serializeRequestHeaders(this._state.requestHeaders);
    const headers = parseRequestHeaders(raw);
    return Object.keys(headers).length > 0 ? headers : undefined;
  }

  private _handleTilesetLoaded(id: string, metadata: LoadedTilesetMetadata): void {
    if (!this._layers.has(id)) return;

    this._state = {
      ...this._state,
      status: 'loaded',
      center: metadata.center,
      altitude: metadata.altitude,
      error: undefined,
      activeTilesetId: id,
      tilesets: this._state.tilesets.map((tileset) =>
        tileset.id === id
          ? {
              ...tileset,
              status: 'loaded',
              center: metadata.center,
              altitude: metadata.altitude,
              error: undefined,
            }
          : tileset,
      ),
    };
    this._syncFromActiveTileset();
    this._updateStatus();
    this._renderTilesetList();
    this._emit('load');
    this._emit('statechange');
    if (this._state.flyToOnLoad) {
      this.flyToTileset(id);
    }
  }

  private _setError(error: Error, id = this._state.activeTilesetId): void {
    this._state = {
      ...this._state,
      status: 'error',
      error: error.message,
      activeTilesetId: id,
      tilesets: this._state.tilesets.map((tileset) =>
        tileset.id === id ? { ...tileset, status: 'error', error: error.message } : tileset,
      ),
    };
    this._updateStatus();
    this._renderTilesetList();
    this._emit('error');
    this._emit('statechange');
  }

  private _syncFormFromState(): void {
    if (this._urlInput) this._urlInput.value = this._state.tilesetUrl;
    if (this._layerNameInput) this._layerNameInput.value = this._state.layerName;
    if (this._headersInput) {
      this._headersInput.value = serializeRequestHeaders(this._state.requestHeaders);
    }
    if (this._beforeIdInput) this._beforeIdInput.value = this._state.beforeId ?? '';
    if (this._altitudeInput) this._altitudeInput.value = String(this._state.altitudeOffset);
    if (this._flyToCheckbox) this._flyToCheckbox.checked = this._state.flyToOnLoad;
    if (this._visibleCheckbox) this._visibleCheckbox.checked = this._state.visible;
  }

  private _updateStatus(): void {
    if (!this._statusElement) return;
    const loadedCount = this._state.tilesets.filter((tileset) => tileset.status === 'loaded').length;
    const loadingCount = this._state.tilesets.filter((tileset) => tileset.status === 'loading').length;
    const errorCount = this._state.tilesets.filter((tileset) => tileset.status === 'error').length;
    const activeTileset = this._getActiveTileset();
    const statusText =
      activeTileset?.status === 'loaded' && activeTileset.center
        ? `${loadedCount} loaded, active at ${activeTileset.center[1].toFixed(5)}, ${activeTileset.center[0].toFixed(5)}`
        : loadingCount > 0
          ? `${loadingCount} loading, ${loadedCount} loaded`
          : errorCount > 0
            ? `${errorCount} failed, ${loadedCount} loaded`
            : loadedCount > 0
              ? `${loadedCount} loaded`
              : 'No tilesets added';

    this._statusElement.textContent = statusText;
    this._statusElement.dataset.status = activeTileset?.status ?? this._state.status;
    if (this._loadButton) this._loadButton.disabled = false;
    if (this._removeAllButton) this._removeAllButton.disabled = this._state.tilesets.length === 0;
  }

  private _setActiveTileset(id: string): void {
    this._state = { ...this._state, activeTilesetId: id };
    this._syncFromActiveTileset();
    this._syncFormFromState();
    this._updateStatus();
    this._renderTilesetList();
    this._emit('statechange');
  }

  private _syncFromActiveTileset(): void {
    const activeTileset = this._getActiveTileset();
    if (!activeTileset) return;

    this._state = {
      ...this._state,
      tilesetUrl: activeTileset.tilesetUrl,
      layerName: activeTileset.layerName,
      beforeId: activeTileset.beforeId,
      altitudeOffset: activeTileset.altitudeOffset,
      opacity: activeTileset.opacity,
      visible: activeTileset.visible,
      requestHeaders: activeTileset.requestHeaders,
      status: activeTileset.status,
      error: activeTileset.error,
      center: activeTileset.center,
      altitude: activeTileset.altitude,
    };
  }

  private _getActiveTileset(
    tilesets = this._state.tilesets,
  ): ThreeDTilesItemState | undefined {
    return (
      tilesets.find((tileset) => tileset.id === this._state.activeTilesetId) ??
      tilesets[tilesets.length - 1]
    );
  }

  private _getTileset(id: string): ThreeDTilesItemState | undefined {
    return this._state.tilesets.find((tileset) => tileset.id === id);
  }

  private _formatTilesetStatus(tileset: ThreeDTilesItemState): string {
    if (tileset.beforeId) {
      return `${tileset.status} before ${tileset.beforeId}`;
    }
    return tileset.status;
  }

  private _createTilesetId(): string {
    this._tilesetCounter += 1;
    return `tileset-${this._tilesetCounter}`;
  }

  private _createLayerId(id: string): string {
    if (
      this._state.tilesets.length === 0 &&
      this._map &&
      !this._map.getLayer(this._options.layerId)
    ) {
      return this._options.layerId;
    }

    return `${this._options.layerId}-${id}`;
  }

  private async _waitForStyle(): Promise<void> {
    if (!this._map || this._map.isStyleLoaded()) return;
    await this._map.once('style.load');
  }
}
