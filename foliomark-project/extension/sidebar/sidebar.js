/**
 * FolioMark Side Panel Dashboard Logic
 * Manages annotation listing across URLs, search & filtering, live sync with
 * chrome.storage.local + IndexedDB ink snapshots, and Export-to-PDF printing.
 */

const STORAGE_PREFIX = 'fm_page_';
const IDB_NAME = 'foliomark_ink_db';
const IDB_STORE = 'ink_layers';

let activeTabUrlKey = '';
let activeTabTitle = '';
let scope = 'current'; // 'current' | 'all'
let filterType = 'all'; // 'all' | 'textbox' | 'highlight' | 'ink'
let searchQuery = '';

function normalizeUrl(href) {
  try {
    const u = new URL(href);
    return `${u.origin}${u.pathname}`;
  } catch {
    return (href || '').split('#')[0].split('?')[0];
  }
}

async function getAllInkLayers() {
  return new Promise((resolve) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(IDB_STORE)) {
        req.result.createObjectStore(IDB_STORE, { keyPath: 'urlKey' });
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      const tx = db.transaction(IDB_STORE, 'readonly');
      const store = tx.objectStore(IDB_STORE);
      const allReq = store.getAll();
      allReq.onsuccess = () => resolve(allReq.result || []);
      allReq.onerror = () => resolve([]);
    };
    req.onerror = () => resolve([]);
  });
}

async function loadAllPages() {
  const storageItems = await chrome.storage.local.get(null);
  const inkLayers = await getAllInkLayers();
  const inkMap = new Map(inkLayers.map((layer) => [layer.urlKey, layer]));

  const pages = [];
  const seenKeys = new Set();

  for (const [k, val] of Object.entries(storageItems)) {
    if (!k.startsWith(STORAGE_PREFIX) || !val) continue;
    const urlKey = val.urlKey || k.slice(STORAGE_PREFIX.length);
    seenKeys.add(urlKey);
    const ink = inkMap.get(urlKey);
    pages.push({
      urlKey,
      title: val.title || urlKey,
      textBoxes: val.textBoxes || [],
      highlights: val.highlights || [],
      strokes: ink?.strokes || [],
      snapshotDataUrl: ink?.snapshotDataUrl || null,
    });
  }

  for (const [urlKey, ink] of inkMap.entries()) {
    if (!seenKeys.has(urlKey) && (ink.strokes || []).length > 0) {
      pages.push({
        urlKey,
        title: urlKey,
        textBoxes: [],
        highlights: [],
        strokes: ink.strokes,
        snapshotDataUrl: ink.snapshotDataUrl || null,
      });
    }
  }

  return pages;
}

async function renderDashboard() {
  const pages = await loadAllPages();
  const targetPages =
    scope === 'current'
      ? pages.filter((p) => p.urlKey === activeTabUrlKey)
      : pages;

  const listEl = document.getElementById('sb-list');
  const countsEl = document.getElementById('sb-counts');
  listEl.innerHTML = '';

  const entries = [];
  for (const page of targetPages) {
    for (const box of page.textBoxes) {
      entries.push({ kind: 'textbox', page, id: box.id, data: box, ts: box.createdAt || 0 });
    }
    for (const hl of page.highlights) {
      entries.push({ kind: 'highlight', page, id: hl.id, data: hl, ts: hl.createdAt || 0 });
    }
    if (page.strokes.length > 0) {
      entries.push({
        kind: 'ink',
        page,
        id: `ink_${page.urlKey}`,
        data: { count: page.strokes.length, snapshotDataUrl: page.snapshotDataUrl },
        ts: Date.now(),
      });
    }
  }

  const q = searchQuery.trim().toLowerCase();
  const filtered = entries.filter((entry) => {
    if (filterType !== 'all' && entry.kind !== filterType) return false;
    if (!q) return true;
    const haystack = [
      entry.page.title,
      entry.page.urlKey,
      entry.data.text || '',
      entry.data.quote || '',
      entry.data.note || '',
    ]
      .join(' ')
      .toLowerCase();
    return haystack.includes(q);
  });

  countsEl.textContent = `${filtered.length} annotation${filtered.length === 1 ? '' : 's'}`;

  if (filtered.length === 0) {
    listEl.innerHTML = `
      <div class="sb-empty">
        No annotations found for this filter.<br />
        Click <strong>+ Add Text Box</strong>, use <strong>Pen Mode</strong>, or select text on the page to annotate.
      </div>
    `;
    return;
  }

  for (const item of filtered) {
    const card = document.createElement('article');
    card.className = 'sb-card';

    const label =
      item.kind === 'textbox'
        ? `Text Box · (${Math.round(item.data.x)}, ${Math.round(item.data.y)})`
        : item.kind === 'highlight'
          ? `Highlight · ${item.data.color}`
          : `Ink Layer · ${item.data.count} strokes`;

    const bodyText =
      item.kind === 'textbox'
        ? item.data.text || '(Empty text box)'
        : item.kind === 'highlight'
          ? `"${item.data.quote}"`
          : `Freehand drawing canvas on ${item.page.title}`;

    card.innerHTML = `
      <div class="sb-card-meta">
        <span>${label}</span>
        <span>${new URL(item.page.urlKey).hostname || 'Page'}</span>
      </div>
      <div class="sb-card-body"></div>
      ${item.kind === 'highlight' && item.data.note ? `<div class="sb-card-note"></div>` : ''}
      ${item.kind === 'ink' && item.data.snapshotDataUrl ? `<img src="${item.data.snapshotDataUrl}" alt="Ink preview" style="max-height:90px;object-fit:contain;border:1px solid #e2e8f0;border-radius:4px;" />` : ''}
      <div class="sb-card-actions">
        ${item.kind !== 'ink' ? '<button class="sb-action" data-jump>Jump</button>' : ''}
        <button class="sb-action danger" data-delete>Delete</button>
      </div>
    `;

    card.querySelector('.sb-card-body').textContent = bodyText;
    if (item.kind === 'highlight' && item.data.note) {
      card.querySelector('.sb-card-note').textContent = item.data.note;
    }

    const jumpBtn = card.querySelector('[data-jump]');
    if (jumpBtn) {
      jumpBtn.addEventListener('click', () => {
        chrome.runtime.sendMessage({
          type: 'FM_RELAY_TO_ACTIVE_TAB',
          payload: { type: 'FM_SCROLL_TO_ANNOTATION', id: item.id },
        });
      });
    }

    card.querySelector('[data-delete]').addEventListener('click', () => {
      chrome.runtime.sendMessage(
        {
          type: 'FM_RELAY_TO_ACTIVE_TAB',
          payload: {
            type: 'FM_DELETE_ANNOTATION',
            kind: item.kind === 'ink' ? 'clear-ink' : item.kind,
            id: item.id,
          },
        },
        () => renderDashboard()
      );
    });

    listEl.appendChild(card);
  }
}

async function printStandaloneReport() {
  const pages = await loadAllPages();
  const composite = document.getElementById('sb-print-composite');
  composite.innerHTML = `
    <h1 style="font-size:20px;margin:0 0 6px 0;">FolioMark Annotation Export</h1>
    <p style="font-size:12px;color:#475569;margin:0 0 18px 0;">Generated ${new Date().toLocaleString()}</p>
  `;

  for (const p of pages) {
    const sec = document.createElement('div');
    sec.style.cssText = 'margin-bottom:24px;padding-bottom:16px;border-bottom:1px solid #cbd5e1;';
    sec.innerHTML = `<h2 style="font-size:15px;margin:0 0 8px 0;">${p.title}</h2><div style="font-size:11px;color:#64748b;margin-bottom:10px;">${p.urlKey}</div>`;

    p.textBoxes.forEach((b) => {
      const div = document.createElement('div');
      div.style.cssText = 'padding:8px 10px;border:1px solid #cbd5e1;border-radius:6px;margin-bottom:6px;font-size:13px;';
      div.textContent = `[Text Box @ ${Math.round(b.x)},${Math.round(b.y)}] ${b.text}`;
      sec.appendChild(div);
    });

    p.highlights.forEach((h) => {
      const div = document.createElement('div');
      div.style.cssText = 'padding:8px 10px;background:#fef9c3;border-radius:6px;margin-bottom:6px;font-size:13px;';
      div.textContent = `"${h.quote}"${h.note ? ` — Note: ${h.note}` : ''}`;
      sec.appendChild(div);
    });

    if (p.snapshotDataUrl) {
      const img = document.createElement('img');
      img.src = p.snapshotDataUrl;
      img.className = 'sb-print-snapshot';
      sec.appendChild(img);
    }

    composite.appendChild(sec);
  }

  window.print();
}

async function syncActiveTab() {
  chrome.runtime.sendMessage({ type: 'FM_GET_ACTIVE_TAB' }, (info) => {
    if (info && info.url) {
      activeTabUrlKey = normalizeUrl(info.url);
      activeTabTitle = info.title || activeTabUrlKey;
      document.getElementById('sb-page-meta').textContent = `${activeTabTitle} · ${activeTabUrlKey}`;
    } else {
      document.getElementById('sb-page-meta').textContent = 'Viewing all saved annotations';
    }
    renderDashboard();
  });
}

document.getElementById('scope-current').addEventListener('click', () => {
  scope = 'current';
  document.getElementById('scope-current').classList.add('active');
  document.getElementById('scope-all').classList.remove('active');
  renderDashboard();
});

document.getElementById('scope-all').addEventListener('click', () => {
  scope = 'all';
  document.getElementById('scope-all').classList.add('active');
  document.getElementById('scope-current').classList.remove('active');
  renderDashboard();
});

document.querySelectorAll('.sb-filter').forEach((btn) => {
  btn.addEventListener('click', () => {
    filterType = btn.getAttribute('data-filter');
    document.querySelectorAll('.sb-filter').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    renderDashboard();
  });
});

document.getElementById('sb-search').addEventListener('input', (e) => {
  searchQuery = e.target.value;
  renderDashboard();
});

document.querySelectorAll('[data-set-tool]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const tool = btn.getAttribute('data-set-tool');
    chrome.runtime.sendMessage({
      type: 'FM_RELAY_TO_ACTIVE_TAB',
      payload: { type: 'FM_SET_TOOL', tool },
    });
  });
});

document.getElementById('sb-toggle-toolbar').addEventListener('click', () => {
  chrome.runtime.sendMessage({
    type: 'FM_RELAY_TO_ACTIVE_TAB',
    payload: { type: 'FM_TOGGLE_TOOLBAR' },
  });
});

document.getElementById('sb-capture-full').addEventListener('click', () => {
  chrome.runtime.sendMessage({
    type: 'FM_RELAY_TO_ACTIVE_TAB',
    payload: { type: 'FM_START_CAPTURE', mode: 'full' },
  });
});

document.getElementById('sb-capture-area').addEventListener('click', () => {
  chrome.runtime.sendMessage({
    type: 'FM_RELAY_TO_ACTIVE_TAB',
    payload: { type: 'FM_START_CAPTURE', mode: 'area' },
  });
});

document.getElementById('sb-export-pdf').addEventListener('click', () => {
  chrome.runtime.sendMessage({
    type: 'FM_RELAY_TO_ACTIVE_TAB',
    payload: { type: 'FM_TRIGGER_PRINT' },
  });
});

document.getElementById('sb-print-summary').addEventListener('click', printStandaloneReport);

chrome.runtime.onMessage.addListener((msg) => {
  if (!msg) return;
  if (msg.type === 'FM_TAB_CHANGED') {
    activeTabUrlKey = normalizeUrl(msg.url);
    activeTabTitle = msg.title || activeTabUrlKey;
    document.getElementById('sb-page-meta').textContent = `${activeTabTitle} · ${activeTabUrlKey}`;
    renderDashboard();
  } else if (msg.type === 'FM_SIDEBAR_REFRESH') {
    renderDashboard();
  }
});

syncActiveTab();
