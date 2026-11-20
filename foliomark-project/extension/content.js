/**
 * FolioMark Content Script (Manifest V3)
 * Features:
 * 1. Shadow DOM isolated floating annotation toolbar & 8-color highlight popovers
 * 2. Free-form keyboard text boxes movable anywhere on the page or PDF viewport
 * 3. Dual-layer Pointer Events ink engine (multiply-blended highlighter + pen canvas)
 * 4. Multi-color text highlighting & sticky notes with TreeWalker Range restoration
 * 5. Dual persistence: chrome.storage.local (metadata/coords) + IndexedDB (ink strokes)
 */

(() => {
  if (window.__FOLIOMARK_INITIALIZED__) return;
  window.__FOLIOMARK_INITIALIZED__ = true;

  const STORAGE_PREFIX = 'fm_page_';
  const TOOLBAR_POS_KEY = 'foliomark_toolbar_pos';
  const IDB_NAME = 'foliomark_ink_db';
  const IDB_VERSION = 1;
  const IDB_STORE = 'ink_layers';

  const TOOLBAR_SWATCHES = [
    '#0f172a',
    '#1d4ed8',
    '#0284c7',
    '#15803d',
    '#4ade80',
    '#facc15',
    '#f59e0b',
    '#dc2626',
    '#e11d48',
    '#7c3aed',
  ];

  const HIGHLIGHT_SWATCHES = [
    { key: 'yellow', hex: '#fef08a', title: 'Canary Yellow' },
    { key: 'amber', hex: '#fcd34d', title: 'Warm Amber' },
    { key: 'mint', hex: '#86efac', title: 'Mint Green' },
    { key: 'teal', hex: '#5eead4', title: 'Aqua Teal' },
    { key: 'sky', hex: '#7dd3fc', title: 'Sky Blue' },
    { key: 'lavender', hex: '#c4b5fd', title: 'Soft Lavender' },
    { key: 'rose', hex: '#fda4af', title: 'Rose Pink' },
    { key: 'peach', hex: '#fdba74', title: 'Coral Peach' },
  ];

  const state = {
    urlKey: normalizeUrl(window.location.href),
    toolbarVisible: true,
    activeTool: 'select', // 'select' | 'text' | 'pen' | 'marker' | 'eraser'
    toolColors: {
      select: '#facc15',
      text: '#0f172a',
      pen: '#1d4ed8',
      marker: '#facc15',
      eraser: '#64748b',
    },
    strokeWidth: 3,
    textFontSize: 15,
    textBg: 'transparent', // 'transparent' | 'paper' | 'warm' | 'mint' | 'sky' | 'rose' | 'slate'
    textBoxes: [],
    highlights: [],
    strokes: [],
    isPdfContext: detectPdfContext(),
  };

  let shadowRoot = null;
  let toolbarEl = null;
  let captureMenuEl = null;
  let styleMenuEl = null;
  let captureOverlayEl = null;
  let capturePreviewEl = null;
  let currentCapture = null;
  let selectionPopoverEl = null;
  let notePopoverEl = null;
  let canvasLayerEl = null;
  let markerCanvas = null;
  let markerCtx = null;
  let inkCanvas = null;
  let inkCtx = null;
  let currentStroke = null;
  let pendingSelectionRange = null;
  let dbPromise = null;
  let mutationTimer = null;
  let canvasDpr = 1;
  let printState = null;

  function normalizeUrl(href) {
    try {
      const u = new URL(href);
      return `${u.origin}${u.pathname}`;
    } catch {
      return href.split('#')[0].split('?')[0];
    }
  }

  function detectPdfContext() {
    if (document.contentType === 'application/pdf') return true;
    if (window.location.pathname.toLowerCase().endsWith('.pdf')) return true;
    return Boolean(document.querySelector('embed[type="application/pdf"]'));
  }

  function uid(prefix = 'fm') {
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
  }

  // -------------------- IndexedDB for Heavy Ink Strokes --------------------
  function openInkDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(IDB_NAME, IDB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(IDB_STORE)) {
          db.createObjectStore(IDB_STORE, { keyPath: 'urlKey' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }

  async function loadStrokesFromIdb(urlKey) {
    try {
      const db = await openInkDb();
      return await new Promise((resolve) => {
        const tx = db.transaction(IDB_STORE, 'readonly');
        const store = tx.objectStore(IDB_STORE);
        const req = store.get(urlKey);
        req.onsuccess = () => resolve(req.result?.strokes || []);
        req.onerror = () => resolve([]);
      });
    } catch {
      return [];
    }
  }

  async function saveStrokesToIdb(urlKey, strokes) {
    try {
      const db = await openInkDb();
      const dataUrl = inkCanvas ? inkCanvas.toDataURL('image/png') : null;
      await new Promise((resolve) => {
        const tx = db.transaction(IDB_STORE, 'readwrite');
        const store = tx.objectStore(IDB_STORE);
        store.put({
          urlKey,
          strokes,
          snapshotDataUrl: dataUrl,
          updatedAt: Date.now(),
        });
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      });
    } catch (err) {
      console.warn('[FolioMark] IndexedDB save error:', err);
    }
  }

  // -------------------- chrome.storage.local Metadata --------------------
  async function loadPageMetadata() {
    const key = STORAGE_PREFIX + state.urlKey;
    return new Promise((resolve) => {
      chrome.storage.local.get([key], (result) => {
        const data = result[key] || {};
        resolve({
          textBoxes: Array.isArray(data.textBoxes) ? data.textBoxes : [],
          highlights: Array.isArray(data.highlights) ? data.highlights : [],
        });
      });
    });
  }

  async function savePageMetadata() {
    const key = STORAGE_PREFIX + state.urlKey;
    const payload = {
      urlKey: state.urlKey,
      title: document.title || state.urlKey,
      isPdf: state.isPdfContext,
      textBoxes: state.textBoxes,
      highlights: state.highlights,
      updatedAt: Date.now(),
    };
    return new Promise((resolve) => {
      chrome.storage.local.set({ [key]: payload }, () => {
        chrome.runtime.sendMessage({
          type: 'FM_ANNOTATIONS_UPDATED',
          urlKey: state.urlKey,
        }).catch(() => {});
        resolve();
      });
    });
  }

  // -------------------- Shadow DOM Floating UI --------------------
  function mountShadowUi() {
    let host = document.getElementById('foliomark-shadow-host');
    if (host) {
      host.remove();
    }
    host = document.createElement('div');
    host.id = 'foliomark-shadow-host';
    host.style.cssText = 'position:fixed;top:0;left:0;width:0;height:0;z-index:2147483647;';
    document.documentElement.appendChild(host);
    shadowRoot = host.shadowRoot || host.attachShadow({ mode: 'open' });

    const style = document.createElement('style');
    style.textContent = `
      :host { all: initial; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
      .fm-toolbar {
        position: fixed;
        top: 12px;
        right: 12px;
        max-width: calc(100vw - 24px);
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 6px;
        padding: 6px 10px;
        background: #ffffff;
        color: #0f172a;
        border: 1px solid #cbd5e1;
        border-radius: 10px;
        box-shadow: 0 10px 28px rgba(15, 23, 42, 0.14);
        z-index: 2147483647;
        user-select: none;
        box-sizing: border-box;
      }
      .fm-toolbar.fm-hidden { display: none; }
      .fm-toolbar.fm-dragging { box-shadow: 0 18px 38px rgba(15, 23, 42, 0.22); }
      .fm-brand {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        font-size: 12px;
        font-weight: 700;
        color: #0f172a;
        padding: 4px 8px 4px 4px;
        border-right: 1px solid #e2e8f0;
        cursor: grab;
        touch-action: none;
        user-select: none;
      }
      .fm-brand:hover { color: #1d4ed8; }
      .fm-brand:active, .fm-toolbar.fm-dragging .fm-brand { cursor: grabbing; }
      .fm-grip { display: inline-flex; color: #94a3b8; flex-shrink: 0; }
      .fm-brand:hover .fm-grip { color: #64748b; }
      .fm-btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 4px;
        height: 30px;
        padding: 0 9px;
        border: 1px solid transparent;
        border-radius: 6px;
        background: transparent;
        color: #334155;
        font-size: 12px;
        font-weight: 500;
        cursor: pointer;
        white-space: nowrap;
      }
      .fm-btn:hover { background: #f1f5f9; color: #0f172a; }
      .fm-btn.active { background: #1d4ed8; color: #ffffff; }
      .fm-btn-primary { background: #0f172a; color: #ffffff; }
      .fm-btn-primary:hover { background: #1e293b; color: #ffffff; }
      .fm-sep { width: 1px; height: 20px; background: #e2e8f0; margin: 0 2px; }
      .fm-tool-swatch { width: 8px; height: 8px; border-radius: 999px; border: 1px solid rgba(15,23,42,0.22); flex-shrink: 0; }
      .fm-btn.active .fm-tool-swatch { border-color: rgba(255,255,255,0.75); }
      .fm-style-wrap { position: relative; display: inline-flex; align-items: center; }
      .fm-style-wrap.fm-hidden { display: none; }
      .fm-style-btn { display: inline-flex; align-items: center; gap: 5px; height: 30px; padding: 0 8px; border: 1px solid #cbd5e1; border-radius: 6px; background: #f8fafc; color: #0f172a; font-size: 11px; font-weight: 600; cursor: pointer; white-space: nowrap; }
      .fm-style-btn:hover { background: #f1f5f9; }
      .fm-style-chip { width: 13px; height: 13px; border-radius: 999px; border: 1px solid rgba(15,23,42,0.24); flex-shrink: 0; }
      .fm-style-menu {
        position: absolute;
        top: calc(100% + 6px);
        left: 0;
        width: 214px;
        display: none;
        flex-direction: column;
        gap: 8px;
        padding: 10px;
        background: #ffffff;
        border: 1px solid #cbd5e1;
        border-radius: 8px;
        box-shadow: 0 12px 28px rgba(15, 23, 42, 0.16);
        z-index: 2147483647;
      }
      .fm-style-menu.open { display: flex; }
      .fm-style-menu.open-up { top: auto; bottom: calc(100% + 6px); }
      .fm-style-head { display: flex; align-items: center; justify-content: space-between; font-size: 11px; font-weight: 600; color: #475569; }
      .fm-dot-row { display: grid; grid-template-columns: repeat(5, 1fr); gap: 6px; justify-items: center; }
      .fm-dot { width: 20px; height: 20px; border-radius: 999px; border: 1px solid rgba(15,23,42,0.2); cursor: pointer; padding: 0; }
      .fm-dot.active { outline: 2px solid #1d4ed8; outline-offset: 1px; }
      .fm-style-custom-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; font-size: 11px; color: #475569; }
      .fm-color-input { width: 24px; height: 22px; padding: 0; border: 1px solid #cbd5e1; border-radius: 4px; cursor: pointer; background: none; }
      .fm-style-width-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding-top: 6px; border-top: 1px solid #e2e8f0; font-size: 11px; color: #475569; }
      .fm-style-width-row.fm-hidden { display: none; }
      .fm-width-input { flex: 1; min-width: 80px; accent-color: #1d4ed8; cursor: pointer; }
      .fm-popover {
        position: fixed;
        display: none;
        flex-direction: column;
        gap: 6px;
        padding: 8px;
        background: #ffffff;
        border: 1px solid #cbd5e1;
        border-radius: 8px;
        box-shadow: 0 10px 24px rgba(15, 23, 42, 0.16);
        z-index: 2147483647;
        min-width: 210px;
      }
      .fm-popover.open { display: flex; }
      .fm-swatch-row { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
      .fm-swatch {
        width: 20px; height: 20px; border-radius: 999px; border: 1px solid rgba(15,23,42,0.2); cursor: pointer;
      }
      .fm-textarea {
        width: 220px; min-height: 68px; padding: 6px 8px; font-size: 12px;
        border: 1px solid #cbd5e1; border-radius: 6px; resize: vertical; font-family: inherit;
      }
      .fm-row-end { display: flex; justify-content: flex-end; gap: 6px; }
      .fm-capture-wrap { position: relative; display: inline-flex; }
      .fm-capture-menu {
        position: absolute;
        top: calc(100% + 6px);
        right: 0;
        min-width: 170px;
        display: none;
        flex-direction: column;
        gap: 2px;
        padding: 4px;
        background: #ffffff;
        border: 1px solid #cbd5e1;
        border-radius: 8px;
        box-shadow: 0 12px 28px rgba(15, 23, 42, 0.16);
        z-index: 2147483647;
      }
      .fm-capture-menu.open { display: flex; }
      .fm-capture-menu.open-up { top: auto; bottom: calc(100% + 6px); }
      .fm-capture-item {
        display: flex;
        align-items: center;
        justify-content: space-between;
        width: 100%;
        padding: 7px 10px;
        border: none;
        border-radius: 6px;
        background: transparent;
        color: #0f172a;
        font-size: 12px;
        font-weight: 500;
        text-align: left;
        cursor: pointer;
        white-space: nowrap;
      }
      .fm-capture-item:hover { background: #f1f5f9; }
      .fm-capture-sub { font-size: 10px; color: #64748b; font-weight: 500; margin-left: 8px; }
      .fm-capture-overlay {
        position: fixed;
        inset: 0;
        display: none;
        cursor: crosshair;
        z-index: 2147483647;
        background: rgba(15, 23, 42, 0.38);
        user-select: none;
      }
      .fm-capture-overlay.open { display: block; }
      .fm-capture-banner {
        position: fixed;
        top: 16px;
        left: 50%;
        transform: translateX(-50%);
        padding: 7px 14px;
        background: #0f172a;
        color: #f8fafc;
        border-radius: 8px;
        font-size: 12px;
        font-weight: 500;
        box-shadow: 0 10px 24px rgba(15, 23, 42, 0.25);
        pointer-events: none;
        white-space: nowrap;
      }
      .fm-capture-box {
        position: fixed;
        display: none;
        border: 2px solid #2563eb;
        background: rgba(255, 255, 255, 0.06);
        box-shadow: 0 0 0 9999px rgba(15, 23, 42, 0.48);
        pointer-events: none;
        box-sizing: border-box;
      }
      .fm-capture-dims {
        position: absolute;
        left: 0;
        top: -26px;
        padding: 2px 7px;
        border-radius: 4px;
        background: #0f172a;
        color: #ffffff;
        font-size: 11px;
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        font-variant-numeric: tabular-nums;
        white-space: nowrap;
      }
      .fm-preview-backdrop {
        position: fixed;
        inset: 0;
        display: none;
        align-items: center;
        justify-content: center;
        padding: 24px;
        background: rgba(15, 23, 42, 0.55);
        z-index: 2147483647;
      }
      .fm-preview-backdrop.open { display: flex; }
      .fm-preview-card {
        width: min(760px, 94vw);
        max-height: 90vh;
        display: flex;
        flex-direction: column;
        background: #ffffff;
        color: #0f172a;
        border: 1px solid #cbd5e1;
        border-radius: 10px;
        box-shadow: 0 24px 48px rgba(15, 23, 42, 0.24);
        overflow: hidden;
      }
      .fm-preview-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 12px 16px;
        border-bottom: 1px solid #e2e8f0;
      }
      .fm-preview-title { font-size: 14px; font-weight: 700; color: #0f172a; }
      .fm-preview-meta { font-size: 11px; color: #64748b; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-variant-numeric: tabular-nums; }
      .fm-preview-body {
        padding: 16px;
        background: #f8fafc;
        overflow: auto;
        display: flex;
        align-items: center;
        justify-content: center;
        min-height: 220px;
        max-height: 60vh;
      }
      .fm-preview-img {
        max-width: 100%;
        max-height: 55vh;
        border: 1px solid #cbd5e1;
        border-radius: 6px;
        background: #ffffff;
        box-shadow: 0 4px 16px rgba(15, 23, 42, 0.08);
      }
      .fm-preview-footer {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        padding: 12px 16px;
        border-top: 1px solid #e2e8f0;
        background: #ffffff;
      }
      .fm-filename-input {
        flex: 1;
        min-width: 160px;
        height: 32px;
        padding: 0 10px;
        border: 1px solid #cbd5e1;
        border-radius: 6px;
        font-size: 12px;
        color: #0f172a;
      }
      .fm-save-loc-toggle {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        font-size: 12px;
        color: #475569;
        cursor: pointer;
        user-select: none;
        white-space: nowrap;
      }
      .fm-save-loc-toggle input { accent-color: #1d4ed8; cursor: pointer; }
    `;
    shadowRoot.appendChild(style);

    const swatchDotsHtml = TOOLBAR_SWATCHES.map(
      (hex) =>
        `<button class="fm-dot ${hex === state.toolColors[state.activeTool] ? 'active' : ''}" data-dot-color="${hex}" style="background:${hex};" title="${hex}"></button>`
    ).join('');

    toolbarEl = document.createElement('div');
    toolbarEl.className = 'fm-toolbar';
    toolbarEl.innerHTML = `
      <span class="fm-brand" id="fm-drag-handle" title="Drag to move toolbar · Double-click to reset">
        <span class="fm-grip" aria-hidden="true">
          <svg width="10" height="14" viewBox="0 0 10 14" fill="currentColor">
            <circle cx="2.5" cy="2.5" r="1.2"/><circle cx="7.5" cy="2.5" r="1.2"/>
            <circle cx="2.5" cy="7" r="1.2"/><circle cx="7.5" cy="7" r="1.2"/>
            <circle cx="2.5" cy="11.5" r="1.2"/><circle cx="7.5" cy="11.5" r="1.2"/>
          </svg>
        </span>
        <span>FolioMark</span>
      </span>
      <button class="fm-btn active" data-tool="select" title="Select & Highlight Text">Select</button>
      <button class="fm-btn" data-tool="text" title="Click anywhere to type text (click again for color)">Text Box <span class="fm-tool-swatch" data-tool-swatch="text" style="background:${state.toolColors.text};"></span></button>
      <button class="fm-btn" data-tool="pen" title="Mouse / Stylus Pen (click again for color & size)">Pen <span class="fm-tool-swatch" data-tool-swatch="pen" style="background:${state.toolColors.pen};"></span></button>
      <button class="fm-btn" data-tool="marker" title="Multiply Highlighter Ink (click again for color & size)">Ink Mark <span class="fm-tool-swatch" data-tool-swatch="marker" style="background:${state.toolColors.marker};"></span></button>
      <button class="fm-btn" data-tool="eraser" title="Erase Ink Strokes">Eraser</button>
      <div class="fm-style-wrap fm-hidden" id="fm-style-wrap">
        <button class="fm-style-btn" id="fm-style-btn" title="Color & Stroke">
          <span class="fm-style-chip" id="fm-style-chip" style="background:${state.toolColors[state.activeTool]};"></span>
          <span id="fm-style-label"></span>
          <span style="opacity:0.65;">▾</span>
        </button>
        <div class="fm-style-menu" id="fm-style-menu">
          <div class="fm-style-head">
            <span id="fm-style-title">Color</span>
            <span id="fm-style-hex" style="font-family:monospace;font-size:10px;color:#64748b;"></span>
          </div>
          <div class="fm-dot-row">${swatchDotsHtml}</div>
          <div class="fm-style-custom-row">
            <span>Custom color</span>
            <input type="color" class="fm-color-input" id="fm-color-picker" value="${state.toolColors[state.activeTool]}" title="Custom Color" />
          </div>
          <div class="fm-style-width-row" id="fm-style-width-row">
            <span>Width</span>
            <input type="range" class="fm-width-input" id="fm-width-slider" min="1" max="18" value="${state.strokeWidth}" title="Stroke Width" />
            <span id="fm-width-val" style="font-family:monospace;min-width:28px;text-align:right;">${state.strokeWidth}px</span>
          </div>
        </div>
      </div>
      <span class="fm-sep"></span>
      <button class="fm-btn" id="fm-undo-btn" title="Undo Last Ink Stroke">Undo</button>
      <button class="fm-btn" id="fm-sidebar-btn" title="Open Side Panel Dashboard">Sidebar</button>
      <div class="fm-capture-wrap">
        <button class="fm-btn" id="fm-capture-btn" title="Capture Screen or Selected Area">Capture ▾</button>
        <div class="fm-capture-menu" id="fm-capture-menu">
          <button class="fm-capture-item" data-capture-mode="full">Whole Screen <span class="fm-capture-sub">PNG / JPG</span></button>
          <button class="fm-capture-item" data-capture-mode="area">Select Area <span class="fm-capture-sub">Drag Box</span></button>
        </div>
      </div>
      <button class="fm-btn fm-btn-primary" id="fm-print-btn" title="Export Annotated Page to PDF">Export PDF</button>
    `;
    shadowRoot.appendChild(toolbarEl);
    bindToolbarDrag();

    styleMenuEl = shadowRoot.getElementById('fm-style-menu');
    const styleBtn = shadowRoot.getElementById('fm-style-btn');

    const toggleStyleMenu = (forceState) => {
      if (!styleMenuEl) return;
      const willOpen = typeof forceState === 'boolean' ? forceState : !styleMenuEl.classList.contains('open');
      if (willOpen) {
        if (captureMenuEl) captureMenuEl.classList.remove('open');
        if (toolbarEl) {
          const barRect = toolbarEl.getBoundingClientRect();
          styleMenuEl.classList.toggle('open-up', barRect.bottom + 200 > window.innerHeight);
        }
      }
      styleMenuEl.classList.toggle('open', willOpen);
    };

    const syncActiveToolColor = (hex) => {
      state.toolColors[state.activeTool] = hex;
      const colorPicker = shadowRoot.getElementById('fm-color-picker');
      const styleChip = shadowRoot.getElementById('fm-style-chip');
      const styleHex = shadowRoot.getElementById('fm-style-hex');
      if (colorPicker) colorPicker.value = hex;
      if (styleChip) styleChip.style.background = hex;
      if (styleHex) styleHex.textContent = hex.toLowerCase();
      const toolSwatch = toolbarEl.querySelector(`[data-tool-swatch="${state.activeTool}"]`);
      if (toolSwatch) toolSwatch.style.background = hex;
      toolbarEl.querySelectorAll('[data-dot-color]').forEach((d) => {
        d.classList.toggle('active', d.getAttribute('data-dot-color').toLowerCase() === hex.toLowerCase());
      });
    };

    toolbarEl.querySelectorAll('[data-tool]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const nextTool = btn.getAttribute('data-tool');
        const supportsColor = nextTool === 'text' || nextTool === 'pen' || nextTool === 'marker';
        if (nextTool === state.activeTool && supportsColor) {
          toggleStyleMenu();
        } else {
          setActiveTool(nextTool);
          toggleStyleMenu(false);
        }
      });
    });

    styleBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleStyleMenu();
    });

    toolbarEl.querySelectorAll('[data-dot-color]').forEach((dot) => {
      dot.addEventListener('click', (e) => {
        e.stopPropagation();
        syncActiveToolColor(dot.getAttribute('data-dot-color'));
        toggleStyleMenu(false);
      });
    });

    shadowRoot.getElementById('fm-color-picker')?.addEventListener('input', (e) => {
      syncActiveToolColor(e.target.value);
    });

    shadowRoot.getElementById('fm-width-slider')?.addEventListener('input', (e) => {
      state.strokeWidth = Number(e.target.value);
      const valEl = shadowRoot.getElementById('fm-width-val');
      const labelEl = shadowRoot.getElementById('fm-style-label');
      if (valEl) valEl.textContent = `${state.strokeWidth}px`;
      if (labelEl && (state.activeTool === 'pen' || state.activeTool === 'marker')) {
        labelEl.textContent = `${state.strokeWidth}px`;
      }
    });

    shadowRoot.getElementById('fm-undo-btn').addEventListener('click', async (e) => {
      e.stopPropagation();
      if (state.strokes.length > 0) {
        state.strokes.pop();
        redrawInkCanvas();
        await saveStrokesToIdb(state.urlKey, state.strokes);
        chrome.runtime.sendMessage({ type: 'FM_ANNOTATIONS_UPDATED', urlKey: state.urlKey }).catch(() => {});
      }
    });

    shadowRoot.getElementById('fm-sidebar-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      chrome.runtime.sendMessage({ type: 'FM_OPEN_SIDE_PANEL' }).catch(() => {});
    });

    shadowRoot.getElementById('fm-print-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      toggleStyleMenu(false);
      window.print();
    });

    captureMenuEl = shadowRoot.getElementById('fm-capture-menu');
    shadowRoot.getElementById('fm-capture-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      toggleStyleMenu(false);
      const willOpen = !captureMenuEl.classList.contains('open');
      if (willOpen && toolbarEl) {
        const barRect = toolbarEl.getBoundingClientRect();
        captureMenuEl.classList.toggle('open-up', barRect.bottom + 100 > window.innerHeight);
      }
      captureMenuEl.classList.toggle('open');
    });
    captureMenuEl.querySelectorAll('[data-capture-mode]').forEach((item) => {
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        const mode = item.getAttribute('data-capture-mode');
        captureMenuEl.classList.remove('open');
        startScreenCapture(mode);
      });
    });

    const hlSwatchesHtml = HIGHLIGHT_SWATCHES.map(
      (s) =>
        `<button class="fm-swatch" data-color="${s.key}" style="background:${s.hex};" title="${s.title}"></button>`
    ).join('');

    // Selection Highlight Popover
    selectionPopoverEl = document.createElement('div');
    selectionPopoverEl.className = 'fm-popover';
    selectionPopoverEl.innerHTML = `
      <div style="font-size:11px;font-weight:600;color:#475569;">Highlight Selection</div>
      <div class="fm-swatch-row">${hlSwatchesHtml}</div>
    `;
    shadowRoot.appendChild(selectionPopoverEl);

    selectionPopoverEl.querySelectorAll('[data-color]').forEach((btn) => {
      btn.addEventListener('mousedown', (e) => e.preventDefault());
      btn.addEventListener('click', () => {
        const color = btn.getAttribute('data-color');
        if (pendingSelectionRange) {
          createHighlightFromRange(pendingSelectionRange, color);
          window.getSelection()?.removeAllRanges();
          pendingSelectionRange = null;
        }
        selectionPopoverEl.classList.remove('open');
      });
    });

    // Sticky Note & Recolor Editor Popover for Highlights
    notePopoverEl = document.createElement('div');
    notePopoverEl.className = 'fm-popover';
    notePopoverEl.innerHTML = `
      <div style="font-size:11px;font-weight:600;color:#475569;">Highlight &amp; Note</div>
      <div class="fm-swatch-row" id="fm-recolor-row">${hlSwatchesHtml}</div>
      <textarea class="fm-textarea" id="fm-note-input" placeholder="Add a sticky note..."></textarea>
      <div class="fm-row-end">
        <button class="fm-btn" id="fm-note-delete" style="color:#dc2626;">Remove</button>
        <button class="fm-btn fm-btn-primary" id="fm-note-save">Save</button>
      </div>
    `;
    shadowRoot.appendChild(notePopoverEl);

    // Interactive Area Selection Overlay
    captureOverlayEl = document.createElement('div');
    captureOverlayEl.className = 'fm-capture-overlay';
    captureOverlayEl.innerHTML = `
      <div class="fm-capture-banner">Drag to select area to capture · Press Esc to cancel</div>
      <div class="fm-capture-box" id="fm-capture-box">
        <div class="fm-capture-dims" id="fm-capture-dims">0 × 0 px</div>
      </div>
    `;
    shadowRoot.appendChild(captureOverlayEl);

    // Capture Preview & Format Export Modal (PNG / JPG)
    capturePreviewEl = document.createElement('div');
    capturePreviewEl.className = 'fm-preview-backdrop';
    capturePreviewEl.innerHTML = `
      <div class="fm-preview-card">
        <div class="fm-preview-header">
          <div>
            <div class="fm-preview-title">Screen Capture Ready</div>
            <div class="fm-preview-meta" id="fm-preview-meta">0 × 0 px</div>
          </div>
          <button class="fm-btn" id="fm-preview-close">Close</button>
        </div>
        <div class="fm-preview-body">
          <img class="fm-preview-img" id="fm-preview-img" alt="Screen capture preview" />
        </div>
        <div class="fm-preview-footer">
          <input type="text" class="fm-filename-input" id="fm-capture-filename" placeholder="foliomark-capture" />
          <label class="fm-save-loc-toggle" title="Open Save As dialog to choose folder and filename">
            <input type="checkbox" id="fm-ask-save-as" checked />
            <span>Ask where to save</span>
          </label>
          <div style="display:flex;align-items:center;gap:8px;">
            <button class="fm-btn" id="fm-capture-retake">Select Area Again</button>
            <button class="fm-btn" id="fm-save-jpg" style="border-color:#cbd5e1;">Save JPG</button>
            <button class="fm-btn fm-btn-primary" id="fm-save-png">Save PNG</button>
          </div>
        </div>
      </div>
    `;
    shadowRoot.appendChild(capturePreviewEl);

    bindCaptureOverlayEvents();
  }

  function applyToolbarPosition(left, top) {
    if (!toolbarEl) return null;
    const rect = toolbarEl.getBoundingClientRect();
    const w = rect.width || toolbarEl.offsetWidth || 320;
    const h = rect.height || toolbarEl.offsetHeight || 44;
    const maxLeft = Math.max(8, window.innerWidth - w - 8);
    const maxTop = Math.max(8, window.innerHeight - h - 8);
    const clampedLeft = Math.round(Math.max(8, Math.min(maxLeft, left)));
    const clampedTop = Math.round(Math.max(8, Math.min(maxTop, top)));
    toolbarEl.style.left = `${clampedLeft}px`;
    toolbarEl.style.top = `${clampedTop}px`;
    toolbarEl.style.right = 'auto';
    toolbarEl.style.bottom = 'auto';
    return { left: clampedLeft, top: clampedTop };
  }

  function bindToolbarDrag() {
    if (!toolbarEl) return;
    const handle = shadowRoot.getElementById('fm-drag-handle');
    let dragState = null;

    chrome.storage?.local?.get([TOOLBAR_POS_KEY], (res) => {
      const saved = res && res[TOOLBAR_POS_KEY];
      if (saved && typeof saved.left === 'number' && typeof saved.top === 'number') {
        requestAnimationFrame(() => applyToolbarPosition(saved.left, saved.top));
      }
    });

    const onPointerDown = (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      const target = e.target;
      const isHandle = handle && (target === handle || handle.contains(target));
      if (
        !isHandle &&
        target instanceof Element &&
        target.closest('button, input, select, textarea, label, .fm-capture-menu, .fm-style-menu')
      ) {
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      const rect = toolbarEl.getBoundingClientRect();
      dragState = {
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        origLeft: rect.left,
        origTop: rect.top,
        moved: false,
      };
      toolbarEl.classList.add('fm-dragging');
      try {
        toolbarEl.setPointerCapture(e.pointerId);
      } catch {}
    };

    const onPointerMove = (e) => {
      if (!dragState) return;
      const dx = e.clientX - dragState.startX;
      const dy = e.clientY - dragState.startY;
      if (!dragState.moved && Math.hypot(dx, dy) < 2) return;
      dragState.moved = true;
      applyToolbarPosition(dragState.origLeft + dx, dragState.origTop + dy);
    };

    const finishDrag = (e) => {
      if (!dragState) return;
      const wasMoved = dragState.moved;
      const pid = dragState.pointerId;
      dragState = null;
      toolbarEl.classList.remove('fm-dragging');
      try {
        if (toolbarEl.hasPointerCapture && toolbarEl.hasPointerCapture(pid)) {
          toolbarEl.releasePointerCapture(pid);
        }
      } catch {}
      if (wasMoved) {
        const rect = toolbarEl.getBoundingClientRect();
        const pos = applyToolbarPosition(rect.left, rect.top);
        if (pos) {
          chrome.storage?.local?.set({ [TOOLBAR_POS_KEY]: pos });
        }
      }
    };

    toolbarEl.addEventListener('pointerdown', onPointerDown);
    toolbarEl.addEventListener('pointermove', onPointerMove);
    toolbarEl.addEventListener('pointerup', finishDrag);
    toolbarEl.addEventListener('pointercancel', finishDrag);

    if (handle) {
      handle.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        toolbarEl.style.left = '';
        toolbarEl.style.top = '12px';
        toolbarEl.style.right = '12px';
        toolbarEl.style.bottom = '';
        chrome.storage?.local?.remove([TOOLBAR_POS_KEY]);
      });
    }

    window.addEventListener('resize', () => {
      if (toolbarEl && toolbarEl.style.left) {
        const rect = toolbarEl.getBoundingClientRect();
        applyToolbarPosition(rect.left, rect.top);
      }
    });
  }

  function formatCaptureFilenameBase() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `foliomark-capture-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  }

  function dataUrlToBlob(dataUrl) {
    const parts = dataUrl.split(',');
    const mimeMatch = (parts[0] || '').match(/data:([^;]+)/);
    const mime = mimeMatch ? mimeMatch[1] : 'image/png';
    const binary = atob(parts[1] || '');
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return new Blob([bytes], { type: mime });
  }

  function triggerBlobDownload(blobUrl, filename) {
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = filename;
    a.rel = 'noopener';
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => a.remove(), 4000);
  }

  async function saveCaptureFile(dataUrl, blobUrl, filename, btnEl, defaultLabel) {
    const askSaveAs = Boolean(shadowRoot?.getElementById('fm-ask-save-as')?.checked ?? true);
    let downloaded = false;
    let cancelled = false;
    try {
      const res = await chrome.runtime.sendMessage({
        type: 'FM_DOWNLOAD_CAPTURE',
        dataUrl,
        filename,
        saveAs: askSaveAs,
      });
      downloaded = Boolean(res && res.ok);
      cancelled = Boolean(res && res.cancelled);
    } catch {
      downloaded = false;
    }

    if (cancelled) {
      return;
    }

    if (!downloaded) {
      const fallbackUrl = blobUrl || URL.createObjectURL(dataUrlToBlob(dataUrl));
      triggerBlobDownload(fallbackUrl, filename);
    }

    if (btnEl) {
      btnEl.textContent = 'Saved ✓';
      setTimeout(() => {
        btnEl.textContent = defaultLabel;
      }, 1600);
    }
  }

  function loadImageFromDataUrl(dataUrl) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Failed to decode captured image'));
      img.src = dataUrl;
    });
  }

  async function convertPngToJpgDataUrl(pngDataUrl) {
    const img = await loadImageFromDataUrl(pngDataUrl);
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth || img.width;
    canvas.height = img.naturalHeight || img.height;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0);
    return canvas.toDataURL('image/jpeg', 0.92);
  }

  async function cropPngDataUrl(pngDataUrl, rect) {
    const img = await loadImageFromDataUrl(pngDataUrl);
    const naturalW = img.naturalWidth || img.width;
    const naturalH = img.naturalHeight || img.height;
    const scaleX = naturalW / Math.max(1, window.innerWidth);
    const scaleY = naturalH / Math.max(1, window.innerHeight);

    const sx = Math.max(0, Math.round(rect.left * scaleX));
    const sy = Math.max(0, Math.round(rect.top * scaleY));
    const sw = Math.max(1, Math.min(naturalW - sx, Math.round(rect.width * scaleX)));
    const sh = Math.max(1, Math.min(naturalH - sy, Math.round(rect.height * scaleY)));

    const canvas = document.createElement('canvas');
    canvas.width = sw;
    canvas.height = sh;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
    return {
      dataUrl: canvas.toDataURL('image/png'),
      width: sw,
      height: sh,
    };
  }

  function nextPaintFrame() {
    return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  }

  async function executeCaptureAndPreview(cropRect = null) {
    const host = document.getElementById('foliomark-shadow-host');
    document.documentElement.classList.add('fm-capturing');
    if (captureMenuEl) captureMenuEl.classList.remove('open');
    if (captureOverlayEl) captureOverlayEl.classList.remove('open');
    if (host) host.style.visibility = 'hidden';

    try {
      await nextPaintFrame();
      const response = await chrome.runtime.sendMessage({ type: 'FM_CAPTURE_VISIBLE_TAB' });
      if (!response || !response.ok || !response.dataUrl) {
        console.warn('[FolioMark] Screen capture failed:', response?.error || 'Unknown error');
        return;
      }

      let finalUrl = response.dataUrl;
      let width = 0;
      let height = 0;

      if (cropRect) {
        const cropped = await cropPngDataUrl(response.dataUrl, cropRect);
        finalUrl = cropped.dataUrl;
        width = cropped.width;
        height = cropped.height;
      } else {
        const img = await loadImageFromDataUrl(response.dataUrl);
        width = img.naturalWidth || img.width;
        height = img.naturalHeight || img.height;
      }

      if (currentCapture?.pngBlobUrl) URL.revokeObjectURL(currentCapture.pngBlobUrl);
      if (currentCapture?.jpgBlobUrl) URL.revokeObjectURL(currentCapture.jpgBlobUrl);

      const pngBlobUrl = URL.createObjectURL(dataUrlToBlob(finalUrl));
      let jpgDataUrl = null;
      let jpgBlobUrl = null;
      try {
        jpgDataUrl = await convertPngToJpgDataUrl(finalUrl);
        jpgBlobUrl = URL.createObjectURL(dataUrlToBlob(jpgDataUrl));
      } catch (_) {}

      currentCapture = {
        pngDataUrl: finalUrl,
        pngBlobUrl,
        jpgDataUrl,
        jpgBlobUrl,
        width,
        height,
      };
      const imgEl = shadowRoot.getElementById('fm-preview-img');
      const metaEl = shadowRoot.getElementById('fm-preview-meta');
      const nameInput = shadowRoot.getElementById('fm-capture-filename');
      imgEl.src = pngBlobUrl || finalUrl;
      metaEl.textContent = `${width} × ${height} px · ${cropRect ? 'Selected Area' : 'Whole Screen'}`;
      nameInput.value = formatCaptureFilenameBase();
      capturePreviewEl.classList.add('open');
    } finally {
      document.documentElement.classList.remove('fm-capturing');
      if (host) host.style.visibility = '';
    }
  }

  function startScreenCapture(mode) {
    if (capturePreviewEl) capturePreviewEl.classList.remove('open');
    if (mode === 'area') {
      const box = shadowRoot.getElementById('fm-capture-box');
      if (box) box.style.display = 'none';
      if (captureOverlayEl) {
        captureOverlayEl.style.background = 'rgba(15, 23, 42, 0.38)';
        captureOverlayEl.classList.add('open');
      }
      return;
    }
    executeCaptureAndPreview(null);
  }

  function bindCaptureOverlayEvents() {
    const boxEl = shadowRoot.getElementById('fm-capture-box');
    const dimsEl = shadowRoot.getElementById('fm-capture-dims');
    let dragStart = null;
    let currentRect = null;

    captureOverlayEl.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      captureOverlayEl.setPointerCapture(e.pointerId);
      dragStart = { x: e.clientX, y: e.clientY };
      currentRect = { left: e.clientX, top: e.clientY, width: 0, height: 0 };
      captureOverlayEl.style.background = 'transparent';
      boxEl.style.display = 'block';
      boxEl.style.left = `${e.clientX}px`;
      boxEl.style.top = `${e.clientY}px`;
      boxEl.style.width = '0px';
      boxEl.style.height = '0px';
      dimsEl.textContent = '0 × 0 px';
    });

    captureOverlayEl.addEventListener('pointermove', (e) => {
      if (!dragStart) return;
      const left = Math.min(dragStart.x, e.clientX);
      const top = Math.min(dragStart.y, e.clientY);
      const width = Math.abs(e.clientX - dragStart.x);
      const height = Math.abs(e.clientY - dragStart.y);
      currentRect = { left, top, width, height };
      boxEl.style.left = `${left}px`;
      boxEl.style.top = `${top}px`;
      boxEl.style.width = `${width}px`;
      boxEl.style.height = `${height}px`;
      dimsEl.textContent = `${Math.round(width)} × ${Math.round(height)} px`;
    });

    const finishDrag = () => {
      if (!dragStart) return;
      const rect = currentRect;
      dragStart = null;
      currentRect = null;
      boxEl.style.display = 'none';
      captureOverlayEl.classList.remove('open');
      captureOverlayEl.style.background = 'rgba(15, 23, 42, 0.38)';
      if (rect && rect.width >= 8 && rect.height >= 8) {
        executeCaptureAndPreview(rect);
      }
    };

    captureOverlayEl.addEventListener('pointerup', finishDrag);
    captureOverlayEl.addEventListener('pointercancel', () => {
      dragStart = null;
      currentRect = null;
      boxEl.style.display = 'none';
      captureOverlayEl.classList.remove('open');
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (captureOverlayEl?.classList.contains('open')) {
          dragStart = null;
          currentRect = null;
          boxEl.style.display = 'none';
          captureOverlayEl.classList.remove('open');
        } else if (capturePreviewEl?.classList.contains('open')) {
          capturePreviewEl.classList.remove('open');
        } else if (captureMenuEl?.classList.contains('open')) {
          captureMenuEl.classList.remove('open');
        } else if (styleMenuEl?.classList.contains('open')) {
          styleMenuEl.classList.remove('open');
        }
      }
    });

    document.addEventListener('click', (e) => {
      const host = document.getElementById('foliomark-shadow-host');
      const clickedOutside = !host || (e.target !== host && !host.contains(e.target));
      if (clickedOutside) {
        captureMenuEl?.classList.remove('open');
        styleMenuEl?.classList.remove('open');
      }
    });

    shadowRoot.addEventListener('click', (e) => {
      const t = e.target;
      if (styleMenuEl?.classList.contains('open') && t instanceof Element && !t.closest('#fm-style-wrap') && !t.closest('[data-tool]')) {
        styleMenuEl.classList.remove('open');
      }
      if (captureMenuEl?.classList.contains('open') && t instanceof Element && !t.closest('.fm-capture-wrap')) {
        captureMenuEl.classList.remove('open');
      }
    });

    shadowRoot.getElementById('fm-preview-close').addEventListener('click', () => {
      capturePreviewEl.classList.remove('open');
    });

    shadowRoot.getElementById('fm-capture-retake').addEventListener('click', () => {
      capturePreviewEl.classList.remove('open');
      startScreenCapture('area');
    });

    const savePngBtn = shadowRoot.getElementById('fm-save-png');
    const saveJpgBtn = shadowRoot.getElementById('fm-save-jpg');

    savePngBtn.addEventListener('click', () => {
      if (!currentCapture?.pngDataUrl) return;
      const rawName = (shadowRoot.getElementById('fm-capture-filename').value || '').trim();
      const base = (rawName || formatCaptureFilenameBase()).replace(/\.(png|jpe?g)$/i, '');
      saveCaptureFile(
        currentCapture.pngDataUrl,
        currentCapture.pngBlobUrl,
        `${base}.png`,
        savePngBtn,
        'Save PNG'
      );
    });

    saveJpgBtn.addEventListener('click', async () => {
      if (!currentCapture?.pngDataUrl) return;
      const rawName = (shadowRoot.getElementById('fm-capture-filename').value || '').trim();
      const base = (rawName || formatCaptureFilenameBase()).replace(/\.(png|jpe?g)$/i, '');
      const jpgDataUrl =
        currentCapture.jpgDataUrl || (await convertPngToJpgDataUrl(currentCapture.pngDataUrl));
      const jpgBlobUrl =
        currentCapture.jpgBlobUrl || URL.createObjectURL(dataUrlToBlob(jpgDataUrl));
      saveCaptureFile(jpgDataUrl, jpgBlobUrl, `${base}.jpg`, saveJpgBtn, 'Save JPG');
    });
  }

  function setActiveTool(tool) {
    if (currentStroke) {
      if (!currentStroke.isEraser && currentStroke.points?.length > 0) {
        state.strokes.push(currentStroke);
        saveStrokesToIdb(state.urlKey, state.strokes);
      }
      currentStroke = null;
      redrawInkCanvas();
    }
    state.activeTool = tool;
    if (toolbarEl) {
      toolbarEl.querySelectorAll('[data-tool]').forEach((btn) => {
        btn.classList.toggle('active', btn.getAttribute('data-tool') === tool);
      });
      const supportsColor = tool === 'text' || tool === 'pen' || tool === 'marker';
      const styleWrap = shadowRoot.getElementById('fm-style-wrap');
      if (styleWrap) styleWrap.classList.toggle('fm-hidden', !supportsColor);
      if (!supportsColor && styleMenuEl) styleMenuEl.classList.remove('open');

      const currentColor = state.toolColors[tool] || '#1d4ed8';
      const colorPicker = shadowRoot.getElementById('fm-color-picker');
      const styleChip = shadowRoot.getElementById('fm-style-chip');
      const styleTitle = shadowRoot.getElementById('fm-style-title');
      const styleHex = shadowRoot.getElementById('fm-style-hex');
      const styleLabel = shadowRoot.getElementById('fm-style-label');
      const widthRow = shadowRoot.getElementById('fm-style-width-row');

      if (colorPicker) colorPicker.value = currentColor;
      if (styleChip) styleChip.style.background = currentColor;
      if (styleHex) styleHex.textContent = currentColor.toLowerCase();
      if (styleTitle) {
        styleTitle.textContent =
          tool === 'marker' ? 'Ink Mark Color' : tool === 'pen' ? 'Pen Color' : 'Text Box Color';
      }
      if (styleLabel) {
        styleLabel.textContent = tool === 'pen' || tool === 'marker' ? `${state.strokeWidth}px` : '';
      }
      if (widthRow) {
        widthRow.classList.toggle('fm-hidden', tool !== 'pen' && tool !== 'marker');
      }

      toolbarEl.querySelectorAll('[data-dot-color]').forEach((dot) => {
        dot.classList.toggle(
          'active',
          dot.getAttribute('data-dot-color').toLowerCase() === currentColor.toLowerCase()
        );
      });
    }
    if (inkCanvas) {
      const isInk = tool === 'pen' || tool === 'marker' || tool === 'eraser';
      inkCanvas.classList.toggle('fm-inking-active', isInk);
    }
    document.body.style.cursor = tool === 'text' ? 'text' : '';
  }

  // -------------------- DOM Element Anchoring for Print Alignment --------------------
  function buildCssPath(el) {
    if (!(el instanceof Element)) return '';
    if (el.id) return `#${CSS.escape(el.id)}`;
    const parts = [];
    let curr = el;
    while (curr && curr.nodeType === Node.ELEMENT_NODE && curr !== document.documentElement && parts.length < 24) {
      let selector = curr.nodeName.toLowerCase();
      if (curr.id) {
        parts.unshift(`#${CSS.escape(curr.id)}`);
        break;
      }
      const parent = curr.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children).filter((c) => c.nodeName === curr.nodeName);
        if (siblings.length > 1) {
          selector += `:nth-of-type(${siblings.indexOf(curr) + 1})`;
        }
      }
      parts.unshift(selector);
      curr = parent;
    }
    return parts.join(' > ');
  }

  function captureAnchorAtPoint(clientX, clientY, layerX, layerY) {
    try {
      const layerRect = canvasLayerEl.getBoundingClientRect();
      const preferredTags = new Set([
        'P', 'LI', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
        'PRE', 'BLOCKQUOTE', 'TD', 'TH', 'FIGCAPTION',
      ]);
      const isValidHostEl = (el) =>
        el instanceof Element &&
        el !== document.documentElement &&
        el !== document.body &&
        !el.closest('#foliomark-shadow-host') &&
        !el.closest('#foliomark-canvas-layer') &&
        !el.classList.contains('fm-textbox');

      const resolveBlockTarget = (el) => {
        let curr = el;
        while (curr && curr !== document.body && curr !== document.documentElement) {
          const disp = window.getComputedStyle(curr).display;
          if (disp && disp !== 'inline') return curr;
          curr = curr.parentElement;
        }
        return el;
      };

      const pickFromPoint = (cx, cy) => {
        const stack = document.elementsFromPoint(cx, cy).filter(isValidHostEl);
        const raw =
          stack.find((el) => preferredTags.has(el.tagName)) ||
          stack.find((el) => el.getBoundingClientRect().height <= 240) ||
          stack[0] ||
          null;
        return raw ? resolveBlockTarget(raw) : null;
      };

      const isGoodAnchor = (el) =>
        Boolean(el) && (preferredTags.has(el.tagName) || el.getBoundingClientRect().height <= 240);

      let target = pickFromPoint(clientX, clientY);
      if (!isGoodAnchor(target)) {
        const offsets = [
          [14, 0], [-14, 0], [0, 10], [0, -10],
          [28, 0], [-28, 0], [0, 22], [0, -22],
          [16, 12], [-16, 12], [16, -12], [-16, -12],
        ];
        for (const [dx, dy] of offsets) {
          const probe = pickFromPoint(clientX + dx, clientY + dy);
          if (isGoodAnchor(probe)) {
            target = probe;
            break;
          }
        }
      }

      if (!target) return null;
      const selector = buildCssPath(target);
      if (!selector) return null;
      const tRect = target.getBoundingClientRect();
      return {
        selector,
        offsetX: layerX - (tRect.left - layerRect.left),
        offsetY: layerY - (tRect.top - layerRect.top),
        hostWidth: tRect.width,
        hostHeight: tRect.height,
      };
    } catch {
      return null;
    }
  }

  // -------------------- Dual Annotation Ink Engine --------------------
  function ensureAnnotationLayer() {
    canvasLayerEl = document.getElementById('foliomark-canvas-layer');
    if (!canvasLayerEl) {
      canvasLayerEl = document.createElement('div');
      canvasLayerEl.id = 'foliomark-canvas-layer';
      // Mount on <html> so <body> margins or relative positioning never offset top:0,left:0
      document.documentElement.appendChild(canvasLayerEl);
    }

    markerCanvas = document.getElementById('foliomark-marker-canvas');
    if (!markerCanvas) {
      markerCanvas = document.createElement('canvas');
      markerCanvas.id = 'foliomark-marker-canvas';
      canvasLayerEl.appendChild(markerCanvas);
    }

    inkCanvas = document.getElementById('foliomark-ink-canvas');
    if (!inkCanvas) {
      inkCanvas = document.createElement('canvas');
      inkCanvas.id = 'foliomark-ink-canvas';
      canvasLayerEl.appendChild(inkCanvas);
      bindPointerInkEvents(inkCanvas);
    }
    syncLayerDimensions();
  }

  function syncLayerDimensions() {
    if (!canvasLayerEl || !inkCanvas || !markerCanvas) return;
    if (window.matchMedia && window.matchMedia('print').matches) return;
    // Collapse overlay temporarily so it never inflates the host page's natural scrollWidth/scrollHeight
    canvasLayerEl.style.width = '0px';
    canvasLayerEl.style.height = '0px';
    markerCanvas.style.width = '0px';
    markerCanvas.style.height = '0px';
    inkCanvas.style.width = '0px';
    inkCanvas.style.height = '0px';

    const docWidth = Math.max(document.documentElement.scrollWidth, document.documentElement.clientWidth);
    const docHeight = Math.max(document.documentElement.scrollHeight, document.documentElement.clientHeight);

    canvasLayerEl.style.width = `${docWidth}px`;
    canvasLayerEl.style.height = `${docHeight}px`;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvasDpr = dpr;
    const targetW = Math.floor(docWidth * dpr);
    const targetH = Math.floor(docHeight * dpr);

    let resized = false;
    [markerCanvas, inkCanvas].forEach((c) => {
      c.style.width = `${docWidth}px`;
      c.style.height = `${docHeight}px`;
      if (c.width !== targetW || c.height !== targetH) {
        c.width = targetW;
        c.height = targetH;
        resized = true;
      }
    });

    markerCtx = markerCanvas.getContext('2d');
    inkCtx = inkCanvas.getContext('2d');
    markerCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    inkCtx.setTransform(dpr, 0, 0, dpr, 0, 0);

    if (resized) redrawInkCanvas(true);
  }

  function distToSegment(px, py, x1, y1, x2, y2) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const lenSq = dx * dx + dy * dy;
    if (lenSq === 0) return Math.hypot(px - x1, py - y1);
    const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lenSq));
    return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
  }

  function bindPointerInkEvents(canvas) {
    const finishStroke = async (e) => {
      const finished = currentStroke;
      currentStroke = null;
      if (!finished) return;

      if (e && e.pointerId != null) {
        try {
          if (canvas.hasPointerCapture && canvas.hasPointerCapture(e.pointerId)) {
            canvas.releasePointerCapture(e.pointerId);
          }
        } catch {}
      }

      if (!finished.isEraser && finished.points && finished.points.length > 0) {
        state.strokes.push(finished);
        redrawInkCanvas();
        await saveStrokesToIdb(state.urlKey, state.strokes);
        chrome.runtime.sendMessage({ type: 'FM_ANNOTATIONS_UPDATED', urlKey: state.urlKey }).catch(() => {});
      }
    };

    canvas.addEventListener('pointerdown', (e) => {
      if (state.activeTool !== 'pen' && state.activeTool !== 'marker' && state.activeTool !== 'eraser') {
        return;
      }
      if (e.pointerType === 'mouse' && e.button !== 0) {
        return;
      }
      e.preventDefault();
      try {
        canvas.setPointerCapture(e.pointerId);
      } catch {}

      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const pressure = e.pointerType === 'pen' && e.pressure > 0 ? e.pressure : 0.5;

      if (state.activeTool === 'eraser') {
        currentStroke = { isEraser: true };
        eraseStrokeAt(x, y);
        return;
      }

      currentStroke = {
        id: uid('ink'),
        tool: state.activeTool,
        color: state.toolColors[state.activeTool] || '#1d4ed8',
        width: state.activeTool === 'marker' ? Math.max(state.strokeWidth * 3.5, 16) : state.strokeWidth,
        opacity: state.activeTool === 'marker' ? 0.34 : 1,
        anchor: captureAnchorAtPoint(e.clientX, e.clientY, x, y),
        points: [{ x, y, p: pressure }],
      };
      redrawInkCanvas();
      const targetCtx = currentStroke.tool === 'marker' ? markerCtx : inkCtx;
      drawStroke(targetCtx, currentStroke);
    });

    canvas.addEventListener('pointermove', (e) => {
      if (!currentStroke) return;
      if (e.pointerType === 'mouse' && (e.buttons & 1) === 0) {
        finishStroke(e);
        return;
      }

      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      if (currentStroke.isEraser || state.activeTool === 'eraser') {
        eraseStrokeAt(x, y);
        return;
      }

      const pressure = e.pointerType === 'pen' && e.pressure > 0 ? e.pressure : 0.5;
      currentStroke.points.push({ x, y, p: pressure });
      redrawInkCanvas();
      const targetCtx = currentStroke.tool === 'marker' ? markerCtx : inkCtx;
      drawStroke(targetCtx, currentStroke);
    });

    canvas.addEventListener('pointerup', finishStroke);
    canvas.addEventListener('pointercancel', finishStroke);
    canvas.addEventListener('lostpointercapture', finishStroke);
    window.addEventListener('blur', () => {
      if (currentStroke) finishStroke();
    });
  }

  function eraseStrokeAt(x, y) {
    const before = state.strokes.length;
    state.strokes = state.strokes.filter((stroke) => {
      const pts = stroke.points || [];
      if (pts.length === 0) return false;
      const threshold = Math.max(16, (stroke.width || 16) / 2 + 6);
      if (pts.length === 1) {
        return Math.hypot(pts[0].x - x, pts[0].y - y) > threshold;
      }
      for (let i = 0; i < pts.length - 1; i++) {
        if (distToSegment(x, y, pts[i].x, pts[i].y, pts[i + 1].x, pts[i + 1].y) <= threshold) {
          return false;
        }
      }
      return true;
    });
    if (state.strokes.length !== before) {
      redrawInkCanvas();
      saveStrokesToIdb(state.urlKey, state.strokes);
      chrome.runtime.sendMessage({ type: 'FM_ANNOTATIONS_UPDATED', urlKey: state.urlKey }).catch(() => {});
    }
  }

  function getAnchorDelta(anchor, fallbackX, fallbackY) {
    if (!anchor || !anchor.selector || !canvasLayerEl) return { dx: 0, dy: 0 };
    try {
      const el = document.querySelector(anchor.selector);
      if (!el) return { dx: 0, dy: 0 };
      const layerRect = canvasLayerEl.getBoundingClientRect();
      const tRect = el.getBoundingClientRect();
      if (tRect.width === 0 && tRect.height === 0) return { dx: 0, dy: 0 };
      const anchoredX = tRect.left - layerRect.left + anchor.offsetX;
      const anchoredY = tRect.top - layerRect.top + anchor.offsetY;
      return { dx: anchoredX - fallbackX, dy: anchoredY - fallbackY };
    } catch {
      return { dx: 0, dy: 0 };
    }
  }

  function redrawInkCanvas(useAnchors = false) {
    if (!inkCtx || !inkCanvas || !markerCtx || !markerCanvas) return;
    const dpr = canvasDpr || Math.min(window.devicePixelRatio || 1, 2);
    markerCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    inkCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    markerCtx.clearRect(0, 0, markerCanvas.width / dpr, markerCanvas.height / dpr);
    inkCtx.clearRect(0, 0, inkCanvas.width / dpr, inkCanvas.height / dpr);
    for (const stroke of state.strokes) {
      let dx = 0;
      let dy = 0;
      if (useAnchors && stroke.anchor && stroke.points?.length) {
        const delta = getAnchorDelta(stroke.anchor, stroke.points[0].x, stroke.points[0].y);
        dx = delta.dx;
        dy = delta.dy;
      }
      if (stroke.tool === 'marker') {
        drawStroke(markerCtx, stroke, dx, dy);
      } else {
        drawStroke(inkCtx, stroke, dx, dy);
      }
    }
  }

  function drawStroke(ctx, stroke, dx = 0, dy = 0) {
    if (!ctx || !stroke || !stroke.points || stroke.points.length === 0) return;
    ctx.save();
    ctx.globalAlpha = stroke.opacity ?? 1;
    ctx.strokeStyle = stroke.color;
    ctx.fillStyle = stroke.color;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    const pts = stroke.points;
    if (pts.length === 1) {
      const r = (stroke.width * (stroke.tool === 'marker' ? 1 : 0.6 + pts[0].p * 0.8)) / 2;
      ctx.beginPath();
      ctx.arc(pts[0].x + dx, pts[0].y + dy, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      return;
    }

    // Draw entire stroke in ONE single path so translucent highlighter never beads/dots at segment joints
    ctx.beginPath();
    ctx.moveTo(pts[0].x + dx, pts[0].y + dy);

    if (pts.length === 2) {
      ctx.lineTo(pts[1].x + dx, pts[1].y + dy);
    } else {
      for (let i = 1; i < pts.length - 1; i++) {
        const curr = pts[i];
        const next = pts[i + 1];
        const midX = (curr.x + next.x) / 2 + dx;
        const midY = (curr.y + next.y) / 2 + dy;
        ctx.quadraticCurveTo(curr.x + dx, curr.y + dy, midX, midY);
      }
      const last = pts[pts.length - 1];
      ctx.lineTo(last.x + dx, last.y + dy);
    }

    const avgPressure =
      stroke.tool === 'marker'
        ? 1
        : 0.65 + (pts.reduce((acc, pt) => acc + pt.p, 0) / pts.length) * 0.7;
    ctx.lineWidth = Math.max(1, stroke.width * avgPressure);
    ctx.stroke();

    ctx.restore();
  }

  // -------------------- Free-Form Keyboard Text Boxes Anywhere --------------------
  function bindFreeFormTextPlacement() {
    document.addEventListener(
      'click',
      async (e) => {
        if (!chrome.runtime?.id) return;
        if (state.activeTool !== 'text') return;
        const target = e.target;
        if (
          target instanceof Element &&
          (target.closest('#foliomark-shadow-host') || target.closest('.fm-textbox'))
        ) {
          return;
        }
        e.preventDefault();
        e.stopPropagation();

        const layerRect = canvasLayerEl.getBoundingClientRect();
        const x = e.clientX - layerRect.left;
        const y = Math.max(0, e.clientY - layerRect.top - 6);
        const box = {
          id: uid('txt'),
          x,
          y,
          anchor: captureAnchorAtPoint(e.clientX, e.clientY, x, y),
          text: '',
          fontSize: state.textFontSize,
          color: state.toolColors.text,
          bgStyle: state.textBg,
          createdAt: Date.now(),
        };
        state.textBoxes.push(box);
        renderTextBox(box, true);
        await savePageMetadata();
      },
      true
    );
  }

  function applyTextBoxStyle(el, box) {
    const bgMap = {
      transparent: 'transparent',
      paper: 'rgba(255, 255, 255, 0.96)',
      warm: 'rgba(254, 249, 195, 0.96)',
      mint: 'rgba(236, 253, 245, 0.96)',
      sky: 'rgba(240, 249, 255, 0.96)',
      rose: 'rgba(255, 241, 242, 0.96)',
      slate: 'rgba(15, 23, 42, 0.94)',
    };
    el.style.background = bgMap[box.bgStyle] || bgMap.transparent;
    const editor = el.querySelector('.fm-textbox-editor');
    if (editor) {
      editor.style.background = 'transparent';
      editor.style.fontSize = `${box.fontSize || 15}px`;
      editor.style.color = box.bgStyle === 'slate' ? '#f8fafc' : box.color || '#0f172a';
    }
  }

  function renderAllTextBoxes() {
    if (!canvasLayerEl) return;
    canvasLayerEl.querySelectorAll('.fm-textbox').forEach((n) => n.remove());
    state.textBoxes.forEach((box) => renderTextBox(box, false));
  }

  function renderTextBox(box, autoFocus = false) {
    if (!canvasLayerEl) return;
    const el = document.createElement('div');
    el.className = 'fm-textbox';
    el.dataset.fmId = box.id;
    el.style.left = `${box.x}px`;
    el.style.top = `${box.y}px`;

    el.innerHTML = `
      <div class="fm-textbox-handle">
        <span>Move</span>
        <div class="fm-textbox-controls">
          <input type="color" class="fm-textbox-color" value="${box.color || '#0f172a'}" title="Text Color" style="width:18px;height:18px;padding:0;border:1px solid #cbd5e1;border-radius:4px;cursor:pointer;" />
          <button type="button" class="fm-textbox-btn" data-act="smaller">A-</button>
          <button type="button" class="fm-textbox-btn" data-act="larger">A+</button>
          <button type="button" class="fm-textbox-btn" data-act="bg">Bg</button>
          <button type="button" class="fm-textbox-btn" data-act="delete" style="color:#dc2626;">×</button>
        </div>
      </div>
      <div class="fm-textbox-editor" contenteditable="true"></div>
    `;

    const editor = el.querySelector('.fm-textbox-editor');
    const colorInput = el.querySelector('.fm-textbox-color');
    editor.textContent = box.text || '';
    applyTextBoxStyle(el, box);

    const syncEmptyState = () => {
      const isEmpty = !(editor.textContent || '').trim();
      el.classList.toggle('fm-textbox-empty', isEmpty);
      return isEmpty;
    };
    syncEmptyState();

    editor.addEventListener('focus', () => el.classList.add('fm-textbox-focused'));
    editor.addEventListener('blur', async () => {
      el.classList.remove('fm-textbox-focused');
      const isEmpty = syncEmptyState();
      if (isEmpty && editor.innerHTML !== '') {
        editor.innerHTML = '';
      }
      box.text = editor.textContent || '';
      await savePageMetadata();
    });
    editor.addEventListener('input', () => {
      box.text = editor.textContent || '';
      syncEmptyState();
    });

    colorInput.addEventListener('input', async (e) => {
      box.color = e.target.value;
      applyTextBoxStyle(el, box);
      await savePageMetadata();
    });

    // Unrestricted dragging from outer box border OR handle anywhere on the page/PDF
    let dragStart = null;
    el.addEventListener('pointerdown', (e) => {
      if (e.target.closest('button') || e.target.closest('input') || e.target.closest('.fm-textbox-editor')) {
        return;
      }
      e.preventDefault();
      el.setPointerCapture(e.pointerId);
      dragStart = { startX: e.clientX, startY: e.clientY, origX: box.x, origY: box.y };
    });
    el.addEventListener('pointermove', (e) => {
      if (!dragStart) return;
      box.x = dragStart.origX + (e.clientX - dragStart.startX);
      box.y = dragStart.origY + (e.clientY - dragStart.startY);
      el.style.left = `${box.x}px`;
      el.style.top = `${box.y}px`;
    });
    el.addEventListener('pointerup', async (e) => {
      if (!dragStart) return;
      dragStart = null;
      const boxRect = el.getBoundingClientRect();
      box.anchor = captureAnchorAtPoint(boxRect.left + 8, boxRect.top + 8, box.x, box.y);
      await savePageMetadata();
    });

    el.querySelectorAll('[data-act]').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const act = btn.getAttribute('data-act');
        if (act === 'smaller') {
          box.fontSize = Math.max(11, (box.fontSize || 15) - 2);
          applyTextBoxStyle(el, box);
        } else if (act === 'larger') {
          box.fontSize = Math.min(36, (box.fontSize || 15) + 2);
          applyTextBoxStyle(el, box);
        } else if (act === 'bg') {
          const order = ['transparent', 'paper', 'warm', 'mint', 'sky', 'rose', 'slate'];
          const next = order[(order.indexOf(box.bgStyle || 'transparent') + 1) % order.length];
          box.bgStyle = next;
          applyTextBoxStyle(el, box);
        } else if (act === 'delete') {
          state.textBoxes = state.textBoxes.filter((b) => b.id !== box.id);
          el.remove();
        }
        await savePageMetadata();
      });
    });

    canvasLayerEl.appendChild(el);
    if (autoFocus) {
      requestAnimationFrame(() => editor.focus());
    }
  }

  // -------------------- Text Selection Highlighting & Sticky Notes --------------------
  function bindTextSelectionHighlighting() {
    document.addEventListener('mouseup', () => {
      if (!chrome.runtime?.id) return;
      if (state.activeTool !== 'select') {
        selectionPopoverEl?.classList.remove('open');
        return;
      }
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || !sel.toString().trim()) {
        selectionPopoverEl?.classList.remove('open');
        return;
      }
      const range = sel.getRangeAt(0);
      if (range.commonAncestorContainer?.parentElement?.closest('#foliomark-shadow-host,.fm-textbox')) {
        return;
      }
      pendingSelectionRange = range.cloneRange();
      const rect = range.getBoundingClientRect();
      selectionPopoverEl.style.left = `${Math.max(12, Math.min(window.innerWidth - 260, rect.left))}px`;
      selectionPopoverEl.style.top = `${Math.max(12, rect.top - 56)}px`;
      selectionPopoverEl.classList.add('open');
    });

    document.addEventListener('click', (e) => {
      const mark = e.target instanceof Element ? e.target.closest('.fm-highlight') : null;
      if (mark) {
        openNotePopoverForHighlight(mark);
      } else if (!(e.target instanceof Element && e.target.closest('#foliomark-shadow-host'))) {
        notePopoverEl?.classList.remove('open');
      }
    });
  }

  async function createHighlightFromRange(range, color) {
    const id = uid('hl');
    const quote = range.toString().trim();
    if (!quote) return;

    const ok = wrapRangeWithMarks(range, id, color);
    if (!ok) return;

    state.highlights.push({
      id,
      quote,
      color,
      note: '',
      createdAt: Date.now(),
    });
    await savePageMetadata();
  }

  function wrapRangeWithMarks(range, id, color) {
    try {
      const textNodes = [];
      const root = range.commonAncestorContainer.nodeType === Node.TEXT_NODE
        ? range.commonAncestorContainer.parentNode
        : range.commonAncestorContainer;

      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
          if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
          return range.intersectsNode(node) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
        },
      });

      let current;
      while ((current = walker.nextNode())) {
        textNodes.push(current);
      }

      textNodes.forEach((node) => {
        const startOffset = node === range.startContainer ? range.startOffset : 0;
        const endOffset = node === range.endContainer ? range.endOffset : node.nodeValue.length;
        if (endOffset <= startOffset) return;

        const targetRange = document.createRange();
        targetRange.setStart(node, startOffset);
        targetRange.setEnd(node, endOffset);

        const mark = document.createElement('mark');
        mark.className = 'fm-highlight';
        mark.dataset.fmId = id;
        mark.dataset.fmColor = color;
        targetRange.surroundContents(mark);
      });
      return textNodes.length > 0;
    } catch {
      return false;
    }
  }

  function restoreHighlightsInDom() {
    if (!state.highlights.length) return;
    for (const hl of state.highlights) {
      if (document.querySelector(`.fm-highlight[data-fm-id="${hl.id}"]`)) continue;
      if (!hl.quote) continue;
      findAndWrapQuote(hl.quote, hl.id, hl.color);
    }
  }

  function findAndWrapQuote(quote, id, color) {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      if (node.parentElement?.closest('#foliomark-shadow-host,#foliomark-canvas-layer,.fm-highlight')) {
        continue;
      }
      const idx = node.nodeValue.indexOf(quote);
      if (idx !== -1) {
        const range = document.createRange();
        range.setStart(node, idx);
        range.setEnd(node, idx + quote.length);
        wrapRangeWithMarks(range, id, color);
        break;
      }
    }
  }

  function openNotePopoverForHighlight(mark) {
    const id = mark.dataset.fmId;
    const hl = state.highlights.find((item) => item.id === id);
    if (!hl) return;
    const rect = mark.getBoundingClientRect();
    notePopoverEl.style.left = `${Math.max(12, Math.min(window.innerWidth - 260, rect.left))}px`;
    notePopoverEl.style.top = `${Math.min(window.innerHeight - 190, rect.bottom + 8)}px`;

    const input = shadowRoot.getElementById('fm-note-input');
    const saveBtn = shadowRoot.getElementById('fm-note-save');
    const delBtn = shadowRoot.getElementById('fm-note-delete');
    const recolorRow = shadowRoot.getElementById('fm-recolor-row');
    input.value = hl.note || '';
    notePopoverEl.classList.add('open');

    recolorRow.querySelectorAll('[data-color]').forEach((btn) => {
      btn.onclick = async () => {
        const nextColor = btn.getAttribute('data-color');
        hl.color = nextColor;
        document.querySelectorAll(`.fm-highlight[data-fm-id="${id}"]`).forEach((m) => {
          m.dataset.fmColor = nextColor;
        });
        await savePageMetadata();
      };
    });

    saveBtn.onclick = async () => {
      hl.note = input.value;
      notePopoverEl.classList.remove('open');
      await savePageMetadata();
    };
    delBtn.onclick = async () => {
      document.querySelectorAll(`.fm-highlight[data-fm-id="${id}"]`).forEach((m) => {
        const parent = m.parentNode;
        while (m.firstChild) parent.insertBefore(m.firstChild, m);
        parent.removeChild(m);
      });
      state.highlights = state.highlights.filter((item) => item.id !== id);
      notePopoverEl.classList.remove('open');
      await savePageMetadata();
    };
  }

  // -------------------- SPA, Mutation & Print Alignment Support --------------------
  function getAnchorTargetEl(anchor) {
    if (!anchor || !anchor.selector) return null;
    try {
      return document.querySelector(anchor.selector);
    } catch {
      return null;
    }
  }

  function getSafePrintHost(anchor) {
    const startEl = getAnchorTargetEl(anchor);
    if (!startEl) return null;
    try {
      const compactPreferred = new Set([
        'P', 'LI', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
        'PRE', 'BLOCKQUOTE', 'TD', 'TH', 'FIGCAPTION',
      ]);
      let curr = startEl;
      while (curr && curr !== document.body && curr !== document.documentElement) {
        const style = window.getComputedStyle(curr);
        const tag = curr.tagName;
        const unsafeTag = tag === 'TABLE' || tag === 'THEAD' || tag === 'TBODY' || tag === 'TFOOT' || tag === 'TR';
        const isInline = style.display === 'inline';
        const clipsOverflow = style.overflowX !== 'visible' || style.overflowY !== 'visible';
        if (!unsafeTag && !isInline && (!clipsOverflow || compactPreferred.has(tag))) {
          return curr;
        }
        curr = curr.parentElement;
      }
      return null;
    } catch {
      return null;
    }
  }

  function buildSvgPathD(pts, ox, oy) {
    if (pts.length === 2) {
      return `M ${(pts[0].x - ox).toFixed(2)} ${(pts[0].y - oy).toFixed(2)} L ${(pts[1].x - ox).toFixed(2)} ${(pts[1].y - oy).toFixed(2)}`;
    }
    let d = `M ${(pts[0].x - ox).toFixed(2)} ${(pts[0].y - oy).toFixed(2)}`;
    for (let i = 1; i < pts.length - 1; i++) {
      const curr = pts[i];
      const next = pts[i + 1];
      const midX = (curr.x + next.x) / 2 - ox;
      const midY = (curr.y + next.y) / 2 - oy;
      d += ` Q ${(curr.x - ox).toFixed(2)} ${(curr.y - oy).toFixed(2)} ${midX.toFixed(2)} ${midY.toFixed(2)}`;
    }
    const last = pts[pts.length - 1];
    d += ` L ${(last.x - ox).toFixed(2)} ${(last.y - oy).toFixed(2)}`;
    return d;
  }

  function createPrintStrokeSvg(stroke, ox, oy, hostW = 0, hostH = 0) {
    const pts = stroke.points || [];
    if (pts.length === 0) return null;

    const strokeW =
      pts.length === 1
        ? stroke.width * (stroke.tool === 'marker' ? 1 : 0.6 + pts[0].p * 0.8)
        : Math.max(
            1,
            stroke.width *
              (stroke.tool === 'marker'
                ? 1
                : 0.65 + (pts.reduce((acc, pt) => acc + pt.p, 0) / pts.length) * 0.7)
          );

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const pt of pts) {
      const rx = pt.x - ox;
      const ry = pt.y - oy;
      if (rx < minX) minX = rx;
      if (ry < minY) minY = ry;
      if (rx > maxX) maxX = rx;
      if (ry > maxY) maxY = ry;
    }

    const spanX = maxX - minX;
    const spanY = maxY - minY;
    const pad = Math.ceil(strokeW + 8);
    const vx = Math.floor(minX - pad);
    const vy = Math.floor(minY - pad);
    const vw = Math.max(2, Math.ceil(spanX + pad * 2));
    const vh = Math.max(2, Math.ceil(spanY + pad * 2));
    const centerX = vx + vw / 2;
    const centerY = vy + vh / 2;

    const useResponsiveY = hostH > 12;
    const scaleMultiLine = useResponsiveY && pts.length > 1 && spanY > 36 && spanY <= hostH * 1.25;

    const leftCss =
      hostW > 20 && vx > 40
        ? `left:min(${vx}px, max(0px, calc(100% - ${Math.min(vw, 180)}px)));`
        : `left:${vx}px;`;

    let posCss = `${leftCss}top:${vy}px;width:${vw}px;height:${vh}px;`;
    if (scaleMultiLine) {
      const topPct = ((vy / hostH) * 100).toFixed(4);
      const heightPct = ((vh / hostH) * 100).toFixed(4);
      posCss = `${leftCss}top:${topPct}%;width:${vw}px;height:${heightPct}%;`;
    } else if (useResponsiveY) {
      const cyPct = ((centerY / hostH) * 100).toFixed(4);
      posCss = `${leftCss}top:calc(${cyPct}% - ${(vh / 2).toFixed(2)}px);width:${vw}px;height:${vh}px;`;
    }

    const svgNs = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNs, 'svg');
    svg.setAttribute('class', 'fm-print-ink-svg');
    svg.setAttribute('width', String(vw));
    svg.setAttribute('height', String(vh));
    svg.setAttribute('viewBox', `${vx} ${vy} ${vw} ${vh}`);
    if (scaleMultiLine) {
      svg.setAttribute('preserveAspectRatio', 'none');
    }
    svg.style.cssText = `position:absolute;${posCss}pointer-events:none;overflow:visible;z-index:2147483641;${
      stroke.tool === 'marker' ? 'mix-blend-mode:multiply;' : ''
    }`;

    const opacity = stroke.opacity ?? 1;
    if (pts.length === 1) {
      const circle = document.createElementNS(svgNs, 'circle');
      circle.setAttribute('cx', (pts[0].x - ox).toFixed(2));
      circle.setAttribute('cy', (pts[0].y - oy).toFixed(2));
      circle.setAttribute('r', (strokeW / 2).toFixed(2));
      circle.setAttribute('fill', stroke.color);
      circle.setAttribute('fill-opacity', String(opacity));
      svg.appendChild(circle);
    } else {
      const path = document.createElementNS(svgNs, 'path');
      path.setAttribute('d', buildSvgPathD(pts, ox, oy));
      path.setAttribute('fill', 'none');
      path.setAttribute('stroke', stroke.color);
      path.setAttribute('stroke-width', strokeW.toFixed(2));
      path.setAttribute('stroke-linecap', 'round');
      path.setAttribute('stroke-linejoin', 'round');
      path.setAttribute('stroke-opacity', String(opacity));
      if (scaleMultiLine) {
        path.setAttribute('vector-effect', 'non-scaling-stroke');
      }
      svg.appendChild(path);
    }

    return svg;
  }

  function applyPrintAnchors() {
    if (!canvasLayerEl || printState) return;
    const layerRect = canvasLayerEl.getBoundingClientRect();
    const touchedHosts = new Map();
    const hostMetricsCache = new Map();
    const movedBoxes = [];
    const mountedSvgs = [];

    const ensureRelativeHost = (hostEl) => {
      if (!touchedHosts.has(hostEl)) {
        const hRectSnapshot = hostEl.getBoundingClientRect();
        hostMetricsCache.set(hostEl, {
          left: hRectSnapshot.left,
          top: hRectSnapshot.top,
          width: hostEl.clientWidth || hRectSnapshot.width,
          height: hostEl.clientHeight || hRectSnapshot.height,
        });
        const computed = window.getComputedStyle(hostEl);
        touchedHosts.set(hostEl, {
          position: hostEl.style.position,
          overflow: hostEl.style.overflow,
          overflowX: hostEl.style.overflowX,
          overflowY: hostEl.style.overflowY,
        });
        if (computed.position === 'static') {
          hostEl.style.position = 'relative';
        }
        if (computed.overflowX !== 'visible' || computed.overflowY !== 'visible') {
          hostEl.style.overflow = 'visible';
        }
      }
      const cached = hostMetricsCache.get(hostEl);
      return {
        ox: cached.left - layerRect.left + (hostEl.clientLeft || 0),
        oy: cached.top - layerRect.top + (hostEl.clientTop || 0),
        hostW: cached.width,
        hostH: cached.height,
      };
    };

    const resolveAnchoredOrigin = (hostEl, anchor, drawnX, drawnY) => {
      const live = ensureRelativeHost(hostEl);
      if (!anchor || typeof anchor.offsetX !== 'number' || typeof anchor.offsetY !== 'number') {
        return live;
      }
      const anchorEl = getAnchorTargetEl(anchor);
      if (!anchorEl) return live;
      const origTargetX = drawnX - anchor.offsetX;
      const origTargetY = drawnY - anchor.offsetY;
      if (hostEl === anchorEl) {
        const useSavedW = typeof anchor.hostWidth === 'number' && anchor.hostWidth > 20;
        const useSavedH = typeof anchor.hostHeight === 'number' && anchor.hostHeight > 12;
        return {
          ox: origTargetX + (hostEl.clientLeft || 0),
          oy: origTargetY + (hostEl.clientTop || 0),
          hostW: useSavedW ? anchor.hostWidth - (hostEl.clientLeft || 0) * 2 : live.hostW,
          hostH: useSavedH ? anchor.hostHeight - (hostEl.clientTop || 0) * 2 : live.hostH,
        };
      }
      const aRect = anchorEl.getBoundingClientRect();
      const hRect = hostMetricsCache.get(hostEl) || hostEl.getBoundingClientRect();
      return {
        ox: origTargetX - (aRect.left - hRect.left) + (hostEl.clientLeft || 0),
        oy: origTargetY - (aRect.top - hRect.top) + (hostEl.clientTop || 0),
        hostW: live.hostW,
        hostH: live.hostH,
      };
    };

    for (const box of state.textBoxes) {
      const el = canvasLayerEl.querySelector(`.fm-textbox[data-fm-id="${box.id}"]`);
      if (!el) continue;
      let hostEl = getSafePrintHost(box.anchor);
      let activeAnchor = box.anchor;
      if (!hostEl) {
        const boxRect = el.getBoundingClientRect();
        activeAnchor = captureAnchorAtPoint(boxRect.left + 8, boxRect.top + 8, box.x, box.y);
        hostEl = getSafePrintHost(activeAnchor);
      }
      if (!hostEl) continue;

      const prevWidth = el.getBoundingClientRect().width;
      const { ox, oy, hostW, hostH } = resolveAnchoredOrigin(hostEl, activeAnchor, box.x, box.y);
      const localX = box.x - ox;
      const localY = box.y - oy;
      movedBoxes.push({
        el,
        origLeft: `${box.x}px`,
        origTop: `${box.y}px`,
        origWidth: el.style.width,
      });
      if (prevWidth > 0) {
        el.style.width = prevWidth < 460 ? 'max-content' : `${Math.ceil(prevWidth)}px`;
      }
      if (hostW > 20 && hostH > 12) {
        const midOffset = 8 + (box.fontSize || 15) * 0.45;
        const anchorCenterY = localY + midOffset;
        if (localX >= 0) {
          const guardW = Math.min(Math.max(Math.ceil(prevWidth || 160), 120), 260);
          el.style.left = `min(${localX.toFixed(2)}px, max(0px, calc(100% - ${guardW}px)))`;
        } else {
          el.style.left = `${localX.toFixed(2)}px`;
        }
        el.style.top = `calc(${((anchorCenterY / hostH) * 100).toFixed(4)}% - ${midOffset.toFixed(2)}px)`;
      } else {
        el.style.left = `${localX.toFixed(2)}px`;
        el.style.top = `${localY.toFixed(2)}px`;
      }
      hostEl.appendChild(el);
    }

    for (const stroke of state.strokes) {
      if (!stroke.points || stroke.points.length === 0) continue;
      let activeAnchor = stroke.anchor;
      let hostEl = getSafePrintHost(activeAnchor);
      if (!hostEl && stroke.points[0]) {
        const pt0 = stroke.points[0];
        const fallbackAnchor = captureAnchorAtPoint(
          layerRect.left + pt0.x,
          layerRect.top + pt0.y,
          pt0.x,
          pt0.y
        );
        const fallbackHost = getSafePrintHost(fallbackAnchor);
        if (fallbackHost) {
          activeAnchor = fallbackAnchor;
          hostEl = fallbackHost;
        }
      }
      const { ox, oy, hostW, hostH } = hostEl
        ? resolveAnchoredOrigin(hostEl, activeAnchor, stroke.points[0].x, stroke.points[0].y)
        : { ox: 0, oy: 0, hostW: 0, hostH: 0 };
      const svg = createPrintStrokeSvg(stroke, ox, oy, hostW, hostH);
      if (svg) {
        (hostEl || canvasLayerEl).appendChild(svg);
        mountedSvgs.push(svg);
      }
    }

    if (mountedSvgs.length > 0) {
      canvasLayerEl.classList.add('fm-print-svg-active');
    }

    printState = { touchedHosts, movedBoxes, mountedSvgs };
  }

  function restoreScreenAnchors() {
    if (!canvasLayerEl) return;
    if (printState) {
      for (const svg of printState.mountedSvgs) {
        svg.remove();
      }
      for (const item of printState.movedBoxes) {
        item.el.style.left = item.origLeft;
        item.el.style.top = item.origTop;
        item.el.style.width = item.origWidth;
        canvasLayerEl.appendChild(item.el);
      }
      for (const [hostEl, origStyles] of printState.touchedHosts.entries()) {
        if (typeof origStyles === 'string') {
          hostEl.style.position = origStyles;
        } else if (origStyles) {
          hostEl.style.position = origStyles.position;
          hostEl.style.overflow = origStyles.overflow;
          hostEl.style.overflowX = origStyles.overflowX;
          hostEl.style.overflowY = origStyles.overflowY;
        }
      }
      canvasLayerEl.classList.remove('fm-print-svg-active');
      printState = null;
    }
    redrawInkCanvas(true);
    syncLayerDimensions();
  }

  function observeDomAndNavigation() {
    const observer = new MutationObserver(() => {
      clearTimeout(mutationTimer);
      mutationTimer = setTimeout(() => {
        syncLayerDimensions();
        restoreHighlightsInDom();
      }, 250);
    });
    observer.observe(document.body || document.documentElement, { childList: true, subtree: true });

    window.addEventListener('resize', syncLayerDimensions);
    window.addEventListener('beforeprint', applyPrintAnchors);
    window.addEventListener('afterprint', restoreScreenAnchors);
    window.addEventListener('popstate', handleRouteChange);
    window.addEventListener('hashchange', handleRouteChange);
  }

  async function handleRouteChange() {
    const nextUrlKey = normalizeUrl(window.location.href);
    if (nextUrlKey === state.urlKey) return;
    state.urlKey = nextUrlKey;
    state.isPdfContext = detectPdfContext();
    await hydrateAllAnnotations();
  }

  // -------------------- Message Listeners from Background / Sidebar --------------------
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg || !msg.type) return false;

    if (msg.type === 'FM_TOGGLE_TOOLBAR') {
      state.toolbarVisible = !state.toolbarVisible;
      toolbarEl?.classList.toggle('fm-hidden', !state.toolbarVisible);
      sendResponse({ visible: state.toolbarVisible });
      return false;
    }

    if (msg.type === 'FM_SHOW_TOOLBAR') {
      state.toolbarVisible = true;
      toolbarEl?.classList.remove('fm-hidden');
      sendResponse({ visible: true });
      return false;
    }

    if (msg.type === 'FM_SET_TOOL') {
      state.toolbarVisible = true;
      toolbarEl?.classList.remove('fm-hidden');
      setActiveTool(msg.tool || 'select');
      sendResponse({ ok: true });
      return false;
    }

    if (msg.type === 'FM_SCROLL_TO_ANNOTATION') {
      const target =
        document.querySelector(`.fm-textbox[data-fm-id="${msg.id}"]`) ||
        document.querySelector(`.fm-highlight[data-fm-id="${msg.id}"]`);
      if (target) {
        target.scrollIntoView({ behavior: 'smooth', block: 'center' });
        target.classList.add('fm-flash');
        setTimeout(() => target.classList.remove('fm-flash'), 1600);
      }
      sendResponse({ found: Boolean(target) });
      return false;
    }

    if (msg.type === 'FM_DELETE_ANNOTATION') {
      (async () => {
        if (msg.kind === 'textbox') {
          state.textBoxes = state.textBoxes.filter((b) => b.id !== msg.id);
          document.querySelector(`.fm-textbox[data-fm-id="${msg.id}"]`)?.remove();
          await savePageMetadata();
        } else if (msg.kind === 'highlight') {
          document.querySelectorAll(`.fm-highlight[data-fm-id="${msg.id}"]`).forEach((m) => {
            const p = m.parentNode;
            while (m.firstChild) p.insertBefore(m.firstChild, m);
            p.removeChild(m);
          });
          state.highlights = state.highlights.filter((h) => h.id !== msg.id);
          await savePageMetadata();
        } else if (msg.kind === 'clear-ink') {
          state.strokes = [];
          redrawInkCanvas();
          await saveStrokesToIdb(state.urlKey, []);
        }
        sendResponse({ ok: true });
      })();
      return true;
    }

    if (msg.type === 'FM_TRIGGER_PRINT') {
      window.print();
      sendResponse({ ok: true });
      return false;
    }

    if (msg.type === 'FM_START_CAPTURE') {
      state.toolbarVisible = true;
      toolbarEl?.classList.remove('fm-hidden');
      startScreenCapture(msg.mode === 'area' ? 'area' : 'full');
      sendResponse({ ok: true });
      return false;
    }

    return false;
  });

  // -------------------- Initialization --------------------
  async function hydrateAllAnnotations() {
    const meta = await loadPageMetadata();
    state.textBoxes = meta.textBoxes;
    state.highlights = meta.highlights;
    state.strokes = await loadStrokesFromIdb(state.urlKey);

    renderAllTextBoxes();
    restoreHighlightsInDom();
    syncLayerDimensions();
    redrawInkCanvas(true);
  }

  async function init() {
    document.getElementById('foliomark-canvas-layer')?.remove();
    mountShadowUi();
    ensureAnnotationLayer();
    bindFreeFormTextPlacement();
    bindTextSelectionHighlighting();
    observeDomAndNavigation();
    await hydrateAllAnnotations();
  }

  init();
})();
