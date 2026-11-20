import type {
  DocumentAnnotations,
  DocumentMeta,
  HighlightAnnotation,
  InkStroke,
  TextBoxAnnotation,
} from '../types/annotation';

const META_STORAGE_KEY = 'foliomark_studio_docs_v1';
const IDB_NAME = 'foliomark_studio_db';
const IDB_VERSION = 1;
const IDB_STROKES_STORE = 'ink_strokes';

interface StoredDocPayload {
  meta: DocumentMeta;
  textBoxes: TextBoxAnnotation[];
  highlights: HighlightAnnotation[];
}

function readAllStoredDocs(): Record<string, StoredDocPayload> {
  try {
    const raw = localStorage.getItem(META_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

function writeAllStoredDocs(docs: Record<string, StoredDocPayload>): void {
  try {
    localStorage.setItem(META_STORAGE_KEY, JSON.stringify(docs));
  } catch (err) {
    console.warn('[FolioMark] localStorage save failed:', err);
  }
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, IDB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_STROKES_STORE)) {
        db.createObjectStore(IDB_STROKES_STORE, { keyPath: 'docId' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

export async function loadInkStrokes(docId: string): Promise<InkStroke[]> {
  try {
    const db = await openDb();
    return await new Promise((resolve) => {
      const tx = db.transaction(IDB_STROKES_STORE, 'readonly');
      const store = tx.objectStore(IDB_STROKES_STORE);
      const req = store.get(docId);
      req.onsuccess = () => resolve(Array.isArray(req.result?.strokes) ? req.result.strokes : []);
      req.onerror = () => resolve([]);
    });
  } catch {
    return [];
  }
}

export async function saveInkStrokes(docId: string, strokes: InkStroke[]): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(IDB_STROKES_STORE, 'readwrite');
      const store = tx.objectStore(IDB_STROKES_STORE);
      store.put({ docId, strokes, updatedAt: Date.now() });
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch (err) {
    console.warn('[FolioMark] IndexedDB stroke write failed:', err);
  }
}

export async function loadAllInkMap(): Promise<Map<string, InkStroke[]>> {
  try {
    const db = await openDb();
    return await new Promise((resolve) => {
      const tx = db.transaction(IDB_STROKES_STORE, 'readonly');
      const store = tx.objectStore(IDB_STROKES_STORE);
      const req = store.getAll();
      req.onsuccess = () => {
        const map = new Map<string, InkStroke[]>();
        for (const row of req.result || []) {
          if (row?.docId) {
            map.set(row.docId, Array.isArray(row.strokes) ? row.strokes : []);
          }
        }
        resolve(map);
      };
      req.onerror = () => resolve(new Map());
    });
  } catch {
    return new Map();
  }
}

export async function loadDocumentAnnotations(meta: DocumentMeta): Promise<DocumentAnnotations> {
  const all = readAllStoredDocs();
  const existing = all[meta.docId];
  const strokes = await loadInkStrokes(meta.docId);

  return {
    meta: existing?.meta || meta,
    textBoxes: existing?.textBoxes || [],
    highlights: existing?.highlights || [],
    strokes,
  };
}

export function saveDocumentMetadata(
  meta: DocumentMeta,
  textBoxes: TextBoxAnnotation[],
  highlights: HighlightAnnotation[]
): void {
  const all = readAllStoredDocs();
  all[meta.docId] = {
    meta: { ...meta, updatedAt: Date.now() },
    textBoxes,
    highlights,
  };
  writeAllStoredDocs(all);
}

export async function listAllAnnotatedDocuments(): Promise<DocumentAnnotations[]> {
  const all = readAllStoredDocs();
  const inkMap = await loadAllInkMap();
  const docIds = new Set([...Object.keys(all), ...Array.from(inkMap.keys())]);

  const list: DocumentAnnotations[] = [];
  for (const docId of docIds) {
    const stored = all[docId];
    const strokes = inkMap.get(docId) || [];
    if (!stored && strokes.length === 0) continue;

    list.push({
      meta: stored?.meta || {
        docId,
        title: docId,
        url: docId,
        kind: docId.endsWith('.pdf') ? 'pdf' : 'web',
        updatedAt: Date.now(),
      },
      textBoxes: stored?.textBoxes || [],
      highlights: stored?.highlights || [],
      strokes,
    });
  }

  return list.sort((a, b) => b.meta.updatedAt - a.meta.updatedAt);
}
