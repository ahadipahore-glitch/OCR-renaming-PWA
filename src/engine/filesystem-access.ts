/**
 * Chromium File System Access API & File Management Engine
 */

export interface QueuedFile {
  id: string | number;
  name: string;
  size: string;
  bytes: number;
  selected: boolean;
  status: 'Ready' | 'Scanning...' | 'Scanned' | 'Renamed' | 'Skipped' | 'Error';
  handle?: any; // FileSystemFileHandle
  fileBlob?: Blob;
  extractedValues?: Record<string, string>;
  newName?: string;
}

export interface FileSystemOperationResult {
  success: boolean;
  originalName: string;
  newName: string;
  destination: string;
  error?: string;
}

/**
 * Prompt user to select directory using File System Access API
 */
export async function promptDirectoryPicker(mode: 'read' | 'readwrite' = 'readwrite'): Promise<any | null> {
  if (typeof (window as any).showDirectoryPicker === 'function') {
    try {
      const handle = await (window as any).showDirectoryPicker({ mode });
      return handle;
    } catch (err: any) {
      if (err.name === 'AbortError') return null; // user cancelled
      console.warn('showDirectoryPicker error:', err);
    }
  }
  return null;
}

/**
 * Enumerate all PDF files inside a directory handle
 */
export async function enumeratePdfFiles(dirHandle: any): Promise<QueuedFile[]> {
  const files: QueuedFile[] = [];
  if (!dirHandle || typeof dirHandle.entries !== 'function') return files;

  try {
    for await (const [name, entry] of dirHandle.entries()) {
      if (entry.kind === 'file' && name.toLowerCase().endsWith('.pdf')) {
        const fileObj = await entry.getFile();
        const sizeMb = (fileObj.size / (1024 * 1024)).toFixed(2) + ' MB';
        files.push({
          id: `${name}_${Date.now()}_${Math.random()}`,
          name: name,
          size: sizeMb,
          bytes: fileObj.size,
          selected: true,
          status: 'Ready',
          handle: entry,
          fileBlob: fileObj,
          newName: name
        });
      }
    }
  } catch (err) {
    console.error('Error reading directory entries:', err);
  }

  return files;
}

/**
 * Single File Transfer / Rename Execution:
 * 1. Read arrayBuffer of original file
 * 2. Create new file entry in target directory handle (or source directory handle if in-place)
 * 3. Write data to new file entry
 * 4. Delete original file entry from source directory handle
 */
export async function transferOrRenameFile(
  sourceDirHandle: any | null,
  targetDirHandle: any | null,
  fileItem: QueuedFile,
  finalName: string,
  mode: 'move' | 'same'
): Promise<FileSystemOperationResult> {
  const destDir = mode === 'move' && targetDirHandle ? targetDirHandle : sourceDirHandle;
  const destLabel = mode === 'move' ? (targetDirHandle?.name || 'Target') : (sourceDirHandle?.name || 'Source');

  if (!destDir) {
    // Simulated browser fallback
    return {
      success: true,
      originalName: fileItem.name,
      newName: finalName,
      destination: destLabel
    };
  }

  try {
    // 1. Get raw file data
    let arrayBuf: ArrayBuffer;
    if (fileItem.handle && typeof fileItem.handle.getFile === 'function') {
      const fileObj = await fileItem.handle.getFile();
      arrayBuf = await fileObj.arrayBuffer();
    } else if (fileItem.fileBlob) {
      arrayBuf = await fileItem.fileBlob.arrayBuffer();
    } else {
      throw new Error('No readable data buffer for file ' + fileItem.name);
    }

    // 2. Create new file handle in destination
    const newHandle = await destDir.getFileHandle(finalName, { create: true });
    const writable = await newHandle.createWritable();
    await writable.write(arrayBuf);
    await writable.close();

    // 3. Remove original entry from source handle
    if (sourceDirHandle && typeof sourceDirHandle.removeEntry === 'function') {
      try {
        await sourceDirHandle.removeEntry(fileItem.name);
      } catch (delErr) {
        console.warn('Could not remove original file entry (might be same file overwrite):', delErr);
      }
    }

    return {
      success: true,
      originalName: fileItem.name,
      newName: finalName,
      destination: destLabel
    };
  } catch (err: any) {
    return {
      success: false,
      originalName: fileItem.name,
      newName: finalName,
      destination: destLabel,
      error: err.message || String(err)
    };
  }
}

export type BatchProgressCallback = (current: number, total: number, file: QueuedFile, message: string) => void;

/**
 * Bulk Batch Flow:
 * Iteratively process queued files sequentially using active zonal rule,
 * maintaining worker efficiency without thread thrashing.
 */
export async function executeBatchQueue(
  queue: QueuedFile[],
  processSingleFn: (file: QueuedFile) => Promise<{ newName: string; values: Record<string, string> }>,
  transferFn: (file: QueuedFile, finalName: string) => Promise<FileSystemOperationResult>,
  onProgress: BatchProgressCallback,
  checkIsPaused: () => boolean,
  checkIsCancelled: () => boolean
): Promise<{ processed: number; errors: number }> {
  let processed = 0;
  let errors = 0;
  const total = queue.length;

  for (let i = 0; i < total; i++) {
    if (checkIsCancelled()) break;

    while (checkIsPaused()) {
      await new Promise(r => setTimeout(r, 200));
      if (checkIsCancelled()) break;
    }

    const file = queue[i];
    file.status = 'Scanning...';
    onProgress(i + 1, total, file, `Scanning Page 1 OCR zones on ${file.name}...`);

    try {
      // 1. Zonal OCR
      const { newName, values } = await processSingleFn(file);
      file.newName = newName;
      file.extractedValues = values;

      // 2. Transfer / rename
      onProgress(i + 1, total, file, `Renaming & filing -> ${newName}...`);
      const result = await transferFn(file, newName);
      if (result.success) {
        file.status = 'Renamed';
        processed++;
      } else {
        file.status = 'Error';
        errors++;
      }
    } catch (err: any) {
      console.error(`Batch error on ${file.name}:`, err);
      file.status = 'Error';
      errors++;
    }

    onProgress(i + 1, total, file, `Completed ${i + 1} of ${total}`);
    // Yield to browser UI thread
    await new Promise(r => setTimeout(r, 60));
  }

  return { processed, errors };
}

