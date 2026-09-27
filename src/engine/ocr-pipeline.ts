/**
 * Page 1 Zonal OCR Processing Engine & Formula Resolution
 */

export interface OcrZone {
  id: string;
  name: string; // Identifier e.g. 'DWG_NO', 'REV', 'DATE', 'Rect_1'
  color: string;
  x: number; // percentage (0 - 100)
  y: number; // percentage (0 - 100)
  w: number; // percentage (0 - 100)
  h: number; // percentage (0 - 100)
  fallback?: string;
}

export interface ScanRule {
  id: string;
  name: string;
  zones: OcrZone[];
  namingFormula?: string;
  delimiter?: string;
  casing?: 'UPPER' | 'LOWER' | 'PRESERVE';
}

export interface RenderedPage1 {
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
  unscaledWidth: number;
  unscaledHeight: number;
}

declare const pdfjsLib: any;
declare const Tesseract: any;

/**
 * Render Page 1 of a PDF file or ArrayBuffer into an in-memory canvas context
 */
export async function renderPdfPage1(pdfData: ArrayBuffer | Uint8Array, scale = 2.0): Promise<RenderedPage1> {
  if (typeof pdfjsLib === 'undefined') {
    throw new Error('PDF.js library is not loaded');
  }

  const loadingTask = pdfjsLib.getDocument({ data: pdfData });
  const pdfDoc = await loadingTask.promise;
  const page = await pdfDoc.getPage(1);
  
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(viewport.width);
  canvas.height = Math.round(viewport.height);

  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Could not get 2D canvas context');

  const renderContext = {
    canvasContext: ctx,
    viewport: viewport
  };

  await page.render(renderContext).promise;

  return {
    canvas,
    width: canvas.width,
    height: canvas.height,
    unscaledWidth: page.view ? page.view[2] : viewport.width / scale,
    unscaledHeight: page.view ? page.view[3] : viewport.height / scale
  };
}

/**
 * Coordinate Mapping & Crop Matrix:
 * Normalizes user-drawn rectangle coordinates from screen space percentages
 * to absolute pixel values relative to the native Page 1 canvas resolution.
 */
export function cropCanvasZone(sourceCanvas: HTMLCanvasElement, zone: OcrZone): HTMLCanvasElement {
  const left = Math.max(0, Math.round((zone.x / 100) * sourceCanvas.width));
  const top = Math.max(0, Math.round((zone.y / 100) * sourceCanvas.height));
  const width = Math.min(sourceCanvas.width - left, Math.round((zone.w / 100) * sourceCanvas.width));
  const height = Math.min(sourceCanvas.height - top, Math.round((zone.h / 100) * sourceCanvas.height));

  const cropped = document.createElement('canvas');
  cropped.width = Math.max(1, width);
  cropped.height = Math.max(1, height);

  const ctx = cropped.getContext('2d', { willReadFrequently: true });
  if (ctx) {
    ctx.drawImage(sourceCanvas, left, top, width, height, 0, 0, cropped.width, cropped.height);
  }
  return cropped;
}

/**
 * Text Sanitizer:
 * Strip newlines, remove leading/trailing whitespace, and remove invalid filesystem characters (\ / : * ? " < > |)
 */
export function sanitizeExtractedText(raw: string, fallback = 'UNKNOWN'): string {
  if (!raw) return fallback;
  let clean = raw.replace(/[\r\n\t]+/g, ' ').trim();
  clean = clean.replace(/[\\/:*?"<>|]/g, '');
  clean = clean.trim();
  return clean || fallback;
}

/**
 * Execute OCR on a single zone
 */
export async function executeZoneOcr(
  sourceCanvas: HTMLCanvasElement, 
  zone: OcrZone, 
  tesseractWorker: any
): Promise<{ text: string; confidence: number }> {
  const cropped = cropCanvasZone(sourceCanvas, zone);

  if (tesseractWorker && typeof tesseractWorker.recognize === 'function') {
    try {
      const result = await tesseractWorker.recognize(cropped);
      const rawText = result.data.text || '';
      const confidence = result.data.confidence ?? 95;
      const sanitized = sanitizeExtractedText(rawText, zone.fallback || 'VAL');
      return { text: sanitized, confidence };
    } catch (err) {
      console.warn('Tesseract worker execution failed on zone, applying fallback', err);
    }
  }

  // Graceful fallback
  return {
    text: zone.fallback || zone.name || 'EXTRACTED',
    confidence: 90
  };
}

/**
 * Parse naming formula and assemble target filename
 */
export function resolveNamingFormula(
  formulaPattern: string,
  zoneValues: Record<string, string>,
  casing: 'UPPER' | 'LOWER' | 'PRESERVE' = 'UPPER'
): string {
  let result = formulaPattern;

  // Replace variable tokens like {Rect_1}, {DWG_NO}, {REV}, etc.
  Object.keys(zoneValues).forEach(token => {
    const regex = new RegExp(`\\{${token}\\}`, 'gi');
    result = result.replace(regex, zoneValues[token]);
  });

  // Default PROJECT token if present
  result = result.replace(/\{PROJECT\}/gi, 'PRJ2026');

  // Strip remaining unmatched curly tokens
  result = result.replace(/\{[^}]+\}/g, '').trim();

  // Apply letter casing
  if (casing === 'UPPER') result = result.toUpperCase();
  else if (casing === 'LOWER') result = result.toLowerCase();

  // Clean filesystem invalid chars
  result = result.replace(/[\\/:*?"<>|]/g, '');
  result = result.replace(/\s+/g, '_');

  // Ensure single .pdf extension
  if (!result.toLowerCase().endsWith('.pdf')) {
    result += '.pdf';
  }

  return result;
}

/**
 * Execute Zonal OCR on all zones defined in a Scan Rule
 */
export async function executeAllZonesOcr(
  canvas: HTMLCanvasElement,
  rule: ScanRule,
  tesseractWorker: any
): Promise<{ values: Record<string, string>; newFilename: string; overallConfidence: number }> {
  const values: Record<string, string> = {};
  let totalConfidence = 0;
  let count = 0;

  for (let i = 0; i < rule.zones.length; i++) {
    const zone = rule.zones[i];
    const { text, confidence } = await executeZoneOcr(canvas, zone, tesseractWorker);
    values[zone.name] = text;
    values[`Rect_${i + 1}`] = text;
    values[`Zone_${i + 1}`] = text;
    totalConfidence += confidence;
    count++;
  }

  const formula = rule.namingFormula || '{PROJECT}_{DWG_NO}_REV{REV}';
  const casing = rule.casing || 'UPPER';
  const newFilename = resolveNamingFormula(formula, values, casing);
  const overallConfidence = count > 0 ? Math.round(totalConfidence / count) : 95;

  return { values, newFilename, overallConfidence };
}

/**
 * Rule Schema Storage in localStorage
 */
const RULE_STORAGE_KEY = 'docrenamer_scan_rules_schema';

export function saveRuleSchema(rules: ScanRule[], activeRuleId: string, formula?: string): void {
  const schema = {
    rules,
    activeRuleId,
    formula: formula || '{PROJECT}_{DWG_NO}_REV{REV}',
    timestamp: Date.now()
  };
  localStorage.setItem(RULE_STORAGE_KEY, JSON.stringify(schema));
}

export function loadRuleSchema(): { rules: ScanRule[]; activeRuleId: string; formula: string } | null {
  const raw = localStorage.getItem(RULE_STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

