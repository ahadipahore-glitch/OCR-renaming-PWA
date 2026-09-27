/**
 * IndexedDB storage and Object URL management for local engine assets:
 * - tesseract-core.wasm
 * - eng.traineddata
 * - pdf.worker.min.js
 */

const DB_NAME = 'DocRenamerEngineDB';
const DB_VERSION = 1;
const STORE_NAME = 'engine_assets';

export interface StoredAsset {
  id: string; // 'wasm' | 'lang' | 'worker'
  filename: string;
  blob: Blob;
  size: number;
  updatedAt: number;
}

export function openEngineDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function storeAssetBlob(id: string, fileOrBlob: Blob, filename: string): Promise<StoredAsset> {
  const db = await openEngineDatabase();
  const assetRecord: StoredAsset = {
    id,
    filename,
    blob: fileOrBlob,
    size: fileOrBlob.size,
    updatedAt: Date.now()
  };

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const putReq = store.put(assetRecord);
    putReq.onsuccess = () => resolve(assetRecord);
    putReq.onerror = () => reject(putReq.error);
  });
}

export async function getAssetBlob(id: string): Promise<StoredAsset | null> {
  const db = await openEngineDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const req = store.get(id);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

export async function getAllStoredAssets(): Promise<Record<string, StoredAsset>> {
  const db = await openEngineDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const req = store.getAll();
    req.onsuccess = () => {
      const records: StoredAsset[] = req.result || [];
      const map: Record<string, StoredAsset> = {};
      records.forEach(r => { map[r.id] = r; });
      resolve(map);
    };
    req.onerror = () => reject(req.error);
  });
}

export interface EngineObjectUrls {
  wasmUrl: string | null;
  langUrl: string | null;
  workerUrl: string | null;
}

export interface EngineInstanceState {
  isInitialized: boolean;
  tesseractWorker: any | null;
  objectUrls: EngineObjectUrls;
  storedAssets: Record<string, StoredAsset>;
}

export const GlobalEngineState: EngineInstanceState = {
  isInitialized: false,
  tesseractWorker: null,
  objectUrls: { wasmUrl: null, langUrl: null, workerUrl: null },
  storedAssets: {}
};

declare const pdfjsLib: any;
declare const Tesseract: any;

export async function generateEngineObjectUrls(): Promise<EngineObjectUrls> {
  const assets = await getAllStoredAssets();
  GlobalEngineState.storedAssets = assets;
  
  // Revoke previous URLs if any
  if (GlobalEngineState.objectUrls.wasmUrl) URL.revokeObjectURL(GlobalEngineState.objectUrls.wasmUrl);
  if (GlobalEngineState.objectUrls.langUrl) URL.revokeObjectURL(GlobalEngineState.objectUrls.langUrl);
  if (GlobalEngineState.objectUrls.workerUrl) URL.revokeObjectURL(GlobalEngineState.objectUrls.workerUrl);

  const urls: EngineObjectUrls = {
    wasmUrl: assets['wasm'] ? URL.createObjectURL(assets['wasm'].blob) : null,
    langUrl: assets['lang'] ? URL.createObjectURL(assets['lang'].blob) : null,
    workerUrl: assets['worker'] ? URL.createObjectURL(assets['worker'].blob) : null
  };
  GlobalEngineState.objectUrls = urls;
  return urls;
}

/**
 * Bootstrap & Initialize PDF.js and Tesseract.js using IndexedDB Blobs & Object URLs
 */
export async function bootstrapEnginePipeline(
  onProgress?: (status: string, progress: number) => void
): Promise<EngineInstanceState> {
  // 1. Retrieve assets from IndexedDB
  let urls = await generateEngineObjectUrls();

  // If assets not yet in IndexedDB, seed initial placeholder/default blobs
  if (!urls.wasmUrl || !urls.langUrl || !urls.workerUrl) {
    await seedDefaultAssetsIfMissing();
    urls = await generateEngineObjectUrls();
  }

  // 2. Initialize PDF.js Global Worker
  if (typeof pdfjsLib !== 'undefined' && urls.workerUrl) {
    try {
      pdfjsLib.GlobalWorkerOptions.workerSrc = urls.workerUrl;
    } catch (e) {
      console.warn('PDF.js worker initialization error:', e);
    }
  }

  // 3. Initialize Tesseract.js Worker with local WASM and lang Blobs
  if (typeof Tesseract !== 'undefined') {
    if (!GlobalEngineState.tesseractWorker) {
      try {
        const workerOptions: any = {
          logger: (m: any) => {
            if (m.status && onProgress) {
              onProgress(m.status, m.progress || 0);
            }
          }
        };
        if (urls.wasmUrl) workerOptions.corePath = urls.wasmUrl;
        if (urls.langUrl) workerOptions.langPath = urls.langUrl;

        const worker = await Tesseract.createWorker('eng', 1, workerOptions);
        GlobalEngineState.tesseractWorker = worker;
        GlobalEngineState.isInitialized = true;
      } catch (err) {
        console.warn('Custom corePath init fallback to standard worker:', err);
        try {
          const fallbackWorker = await Tesseract.createWorker('eng', 1, {
            logger: (m: any) => {
              if (m.status && onProgress) onProgress(m.status, m.progress || 0);
            }
          });
          GlobalEngineState.tesseractWorker = fallbackWorker;
          GlobalEngineState.isInitialized = true;
        } catch (e2) {
          console.error('Failed to create Tesseract worker:', e2);
        }
      }
    }
  }

  return GlobalEngineState;
}

export async function seedDefaultAssetsIfMissing(): Promise<void> {
  const current = await getAllStoredAssets();
  
  if (!current['wasm']) {
    const dummyWasm = new Blob([new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0])], { type: 'application/wasm' });
    await storeAssetBlob('wasm', dummyWasm, 'tesseract-core.wasm');
  }
  if (!current['lang']) {
    const dummyLang = new Blob([new Uint8Array(1024)], { type: 'application/octet-stream' });
    await storeAssetBlob('lang', dummyLang, 'eng.traineddata');
  }
  if (!current['worker']) {
    const dummyWorker = new Blob(['/* PDF.js local worker stub */'], { type: 'application/javascript' });
    await storeAssetBlob('worker', dummyWorker, 'pdf.worker.min.js');
  }
}

