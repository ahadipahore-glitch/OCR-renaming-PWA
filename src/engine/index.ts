/**
 * Unified DocRenamer Offline Processing Engine
 */

import * as AssetStorage from './asset-storage.ts';
import * as OcrPipeline from './ocr-pipeline.ts';
import * as FileSystem from './filesystem-access.ts';

export { AssetStorage, OcrPipeline, FileSystem };

// Expose on window for runtime script usage in index.html
(window as any).DocRenamerEngine = {
  AssetStorage,
  OcrPipeline,
  FileSystem
};
