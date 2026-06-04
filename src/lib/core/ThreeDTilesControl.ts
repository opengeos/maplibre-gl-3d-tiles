import type { IControl, Map as MapLibreMap } from 'maplibre-gl';
import { ThreeDTilesLayer } from './ThreeDTilesLayer';
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

const DEFAULT_OPTIONS: Required<ThreeDTilesControlOptions> = {
  collapsed: true,
  position: 'top-right',
  title: '3D Tiles',
  panelWidth: 360,
  className: '',
  collapseOnClickOutside: true,
  layerId: 'maplibre-gl-3d-tiles',
  tilesetUrl: DEFAULT_TILESET_URL,
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
  private _urlInput?: HTMLInputElement;
  private _altitudeInput?: HTMLInputElement;
  private _flyToCheckbox?: HTMLInputElement;
  private _visibleCheckbox?: HTMLInputElement;
  private _statusElement?: HTMLElement;
  private _tilesetList?: HTMLElement;
  private _loadButton?: HTMLButtonElement;
  private _removeAllButton?: HTMLButtonElement;
  private _options: Required<ThreeDTilesControlOptions>;
  private _state: ThreeDTilesState;
  private _layers = new globalThis.Map<string, ThreeDTilesLayer>();
  private _eventHandlers: EventHandlersMap = new globalThis.Map();
  private _resizeHandler: (() => void) | null = null;
  private _mapResizeHandler: (() => void) | null = null;
  private _clickOutsideHandler: ((e: MouseEvent) => void) | null = null;
  private _tilesetCounter = 0;

  constructor(options?: ThreeDTilesControlOptions) {
    this._options = { ...DEFAULT_OPTIONS, ...options };
    this._state = {
      collapsed: this._options.collapsed,
      panelWidth: this._options.panelWidth,
      tilesetUrl: this._options.tilesetUrl,
      altitudeOffset: this._options.altitudeOffset,
      flyToOnLoad: this._options.flyToOnLoad,
      opacity: this._options.opacity,
      visible: this._options.visible,
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
    const id = this._createTilesetId();
    const layerId = this._createLayerId(id);
    const item: ThreeDTilesItemState = {
      id,
      layerId,
      tilesetUrl: url,
      altitudeOffset,
      opacity,
      visible,
      status: 'loading',
    };

    this._state = {
      ...this._state,
      tilesetUrl: url,
      altitudeOffset,
      flyToOnLoad,
      opacity,
      visible,
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
      dracoDecoderPath: this._options.dracoDecoderPath,
      ktx2TranscoderPath: this._options.ktx2TranscoderPath,
      onLoad: (metadata) => this._handleTilesetLoaded(id, metadata),
      onError: (error) => this._setError(error, id),
    });
    this._layers.set(id, layer);

    await this._waitForStyle();
    if (!this._map || !this._layers.has(id)) return undefined;
    this._map.addLayer(layer);
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
      altitudeOffset: activeTileset?.altitudeOffset ?? this._state.altitudeOffset,
      opacity: activeTileset?.opacity ?? this._state.opacity,
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

    return panel;
  }

  private _createForm(): HTMLElement {
    const form = document.createElement('form');
    form.className = 'three-d-tiles-form';
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      void this.loadTileset();
    });

    this._urlInput = this._createInput('Tileset URL', 'url', this._state.tilesetUrl);
    this._altitudeInput = this._createInput(
      'Altitude offset',
      'number',
      String(this._state.altitudeOffset),
    );
    this._altitudeInput.step = '1';

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

    form.appendChild(this._wrapField('Tileset URL', this._urlInput));
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

  private _wrapField(labelText: string, input: HTMLInputElement): HTMLElement {
    const label = document.createElement('label');
    label.className = 'three-d-tiles-field';
    const span = document.createElement('span');
    span.textContent = labelText;
    label.appendChild(span);
    label.appendChild(input);
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
      title.textContent = `Tileset ${index + 1}`;
      title.addEventListener('click', () => this._setActiveTileset(tileset.id));

      const url = document.createElement('span');
      url.className = 'three-d-tiles-list-url';
      url.textContent = tileset.tilesetUrl;

      const status = document.createElement('span');
      status.className = 'three-d-tiles-list-status';
      status.dataset.status = tileset.status;
      status.textContent = tileset.error ?? tileset.status;

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

    this._panel.style.top = '';
    this._panel.style.bottom = '';
    this._panel.style.left = '';
    this._panel.style.right = '';

    switch (position) {
      case 'top-left':
        this._panel.style.top = `${buttonTop + buttonRect.height + panelGap}px`;
        this._panel.style.left = `${buttonLeft}px`;
        break;
      case 'top-right':
        this._panel.style.top = `${buttonTop + buttonRect.height + panelGap}px`;
        this._panel.style.right = `${buttonRight}px`;
        break;
      case 'bottom-left':
        this._panel.style.bottom = `${buttonBottom + buttonRect.height + panelGap}px`;
        this._panel.style.left = `${buttonLeft}px`;
        break;
      case 'bottom-right':
        this._panel.style.bottom = `${buttonBottom + buttonRect.height + panelGap}px`;
        this._panel.style.right = `${buttonRight}px`;
        break;
    }
  }

  private _getAltitudeOffset(): number {
    const value = Number(this._altitudeInput?.value ?? this._state.altitudeOffset);
    return Number.isFinite(value) ? value : this._state.altitudeOffset;
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
      altitudeOffset: activeTileset.altitudeOffset,
      opacity: activeTileset.opacity,
      visible: activeTileset.visible,
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
