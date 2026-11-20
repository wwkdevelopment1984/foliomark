export interface ViewportRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface CaptureResult {
  pngDataUrl: string;
  width: number;
  height: number;
  sourceLabel: string;
  mode: 'studio-full' | 'studio-area' | 'display';
}

export function formatCaptureBaseName(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `foliomark-capture-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

export function dataUrlToBlob(dataUrl: string): Blob {
  const [header, base64 = ''] = dataUrl.split(',');
  const mimeMatch = header.match(/data:([^;]+)/);
  const mimeType = mimeMatch ? mimeMatch[1] : 'image/png';
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: mimeType });
}

export function triggerBlobDownload(blob: Blob, filename: string): void {
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = filename;
  anchor.rel = 'noopener';
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  setTimeout(() => {
    anchor.remove();
    URL.revokeObjectURL(objectUrl);
  }, 4000);
}

export function downloadDataUrl(dataUrl: string, filename: string): void {
  triggerBlobDownload(dataUrlToBlob(dataUrl), filename);
}

export type SavePickerOutcome = 'saved' | 'cancelled' | 'unavailable';

interface SaveFilePickerWindow {
  showSaveFilePicker?: (options?: {
    suggestedName?: string;
    types?: Array<{
      description: string;
      accept: Record<string, string[]>;
    }>;
  }) => Promise<{
    createWritable: () => Promise<{
      write: (data: Blob) => Promise<void>;
      close: () => Promise<void>;
    }>;
  }>;
}

export function canUseSaveFilePicker(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof (window as unknown as SaveFilePickerWindow).showSaveFilePicker === 'function'
  );
}

export async function saveBlobWithLocationPicker(
  blob: Blob,
  suggestedName: string,
  format: 'png' | 'jpg'
): Promise<SavePickerOutcome> {
  const picker = (window as unknown as SaveFilePickerWindow).showSaveFilePicker;
  if (typeof picker !== 'function') {
    return 'unavailable';
  }

  try {
    const handle = await picker({
      suggestedName,
      types: [
        format === 'jpg'
          ? { description: 'JPEG Image', accept: { 'image/jpeg': ['.jpg', '.jpeg'] } }
          : { description: 'PNG Image', accept: { 'image/png': ['.png'] } },
      ],
    });
    const writable = await handle.createWritable();
    await writable.write(blob);
    await writable.close();
    return 'saved';
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      return 'cancelled';
    }
    return 'unavailable';
  }
}

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Unable to decode captured image.'));
    img.src = dataUrl;
  });
}

export async function convertPngToJpgBlob(pngDataUrl: string, quality = 0.92): Promise<Blob> {
  const img = await loadImage(pngDataUrl);
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth || img.width;
  canvas.height = img.naturalHeight || img.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable.');
  // Fill pure white so any transparent region renders crisply in JPEG
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0);

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(blob);
        } else {
          try {
            resolve(dataUrlToBlob(canvas.toDataURL('image/jpeg', quality)));
          } catch (err) {
            reject(err);
          }
        }
      },
      'image/jpeg',
      quality
    );
  });
}

export async function convertPngToJpgDataUrl(pngDataUrl: string, quality = 0.92): Promise<string> {
  const img = await loadImage(pngDataUrl);
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth || img.width;
  canvas.height = img.naturalHeight || img.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable.');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0);
  return canvas.toDataURL('image/jpeg', quality);
}

export interface NormalizedCrop {
  x: number;
  y: number;
  w: number;
  h: number;
}

export async function cropImageDataUrl(
  pngDataUrl: string,
  crop: NormalizedCrop
): Promise<{ pngDataUrl: string; width: number; height: number }> {
  const img = await loadImage(pngDataUrl);
  const naturalW = img.naturalWidth || img.width;
  const naturalH = img.naturalHeight || img.height;

  const sx = Math.max(0, Math.min(naturalW - 1, Math.round(crop.x * naturalW)));
  const sy = Math.max(0, Math.min(naturalH - 1, Math.round(crop.y * naturalH)));
  const sw = Math.max(1, Math.min(naturalW - sx, Math.round(crop.w * naturalW)));
  const sh = Math.max(1, Math.min(naturalH - sy, Math.round(crop.h * naturalH)));

  const canvas = document.createElement('canvas');
  canvas.width = sw;
  canvas.height = sh;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable.');
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);

  return {
    pngDataUrl: canvas.toDataURL('image/png'),
    width: sw,
    height: sh,
  };
}

/**
 * Captures the user's entire screen, window, or browser tab using Screen Capture API.
 */
export async function captureDisplayScreen(): Promise<CaptureResult> {
  if (!navigator.mediaDevices || typeof navigator.mediaDevices.getDisplayMedia !== 'function') {
    throw new Error(
      'Display screen capture is unavailable in this browser context. Use "Whole Studio View" or "Select Area" instead.'
    );
  }

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: false,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.toLowerCase().includes('permission') || message.toLowerCase().includes('disallowed')) {
      throw new Error(
        'Display screen capture was blocked by browser/iframe policy. Use "Whole Studio View" or "Select Area" for instant capture.'
      );
    }
    throw new Error('Screen capture was cancelled or denied.');
  }

  try {
    const video = document.createElement('video');
    video.srcObject = stream;
    video.muted = true;
    video.playsInline = true;

    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve();
      video.onerror = () => reject(new Error('Failed to read display video stream.'));
    });

    await video.play();
    await new Promise((r) => setTimeout(r, 90));

    const width = Math.max(1, video.videoWidth);
    const height = Math.max(1, video.videoHeight);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D context unavailable.');
    ctx.drawImage(video, 0, 0, width, height);

    return {
      pngDataUrl: canvas.toDataURL('image/png'),
      width,
      height,
      sourceLabel: 'Whole Display',
      mode: 'display',
    };
  } finally {
    stream.getTracks().forEach((track) => track.stop());
  }
}

function isTransparentColor(color: string): boolean {
  if (!color || color === 'transparent') return true;
  const match = color.match(/rgba?\([^)]+,\s*([0-9.]+)\s*\)/);
  if (match && Number(match[1]) === 0) return true;
  return false;
}

function drawRoundedRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

function drawWrappedTextLines(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number
) {
  const paragraphs = text.split('\n');
  let cursorY = y;
  for (const para of paragraphs) {
    if (!para) {
      cursorY += lineHeight;
      continue;
    }
    const words = para.split(/(\s+)/);
    let line = '';
    for (const token of words) {
      const candidate = line + token;
      if (ctx.measureText(candidate).width > maxWidth && line.trim()) {
        ctx.fillText(line.trimEnd(), x, cursorY);
        line = token.trimStart();
        cursorY += lineHeight;
      } else {
        line = candidate;
      }
    }
    if (line) {
      ctx.fillText(line, x, cursorY);
      cursorY += lineHeight;
    }
  }
}

/**
 * Pure Canvas 2D compositor for the FolioMark document viewport (or a user-selected area).
 * Captures HTML document text/tables, PDF rendered bitmaps, ink marker/pen layers,
 * text highlights, and non-empty keyboard text boxes without external font CORS errors.
 */
export async function captureStudioDocument(
  scrollContainer: HTMLElement,
  cropRect?: ViewportRect
): Promise<CaptureResult> {
  const containerRect = scrollContainer.getBoundingClientRect();
  const targetRect: ViewportRect = cropRect || {
    left: containerRect.left,
    top: containerRect.top,
    width: containerRect.width,
    height: containerRect.height,
  };

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const pixelWidth = Math.max(1, Math.round(targetRect.width * dpr));
  const pixelHeight = Math.max(1, Math.round(targetRect.height * dpr));

  const outCanvas = document.createElement('canvas');
  outCanvas.width = pixelWidth;
  outCanvas.height = pixelHeight;
  const ctx = outCanvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable.');

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = '#F4F5F7';
  ctx.fillRect(0, 0, targetRect.width, targetRect.height);

  const ox = targetRect.left;
  const oy = targetRect.top;

  const sheets = Array.from(scrollContainer.querySelectorAll('.print-page-sheet')) as HTMLElement[];
  const roots = sheets.length > 0 ? sheets : [scrollContainer];

  for (const sheet of roots) {
    const sRect = sheet.getBoundingClientRect();
    if (
      sRect.right < targetRect.left ||
      sRect.left > targetRect.left + targetRect.width ||
      sRect.bottom < targetRect.top ||
      sRect.top > targetRect.top + targetRect.height
    ) {
      continue;
    }

    // 1. Draw sheet card surface & border
    const sheetStyle = window.getComputedStyle(sheet);
    const sx = sRect.left - ox;
    const sy = sRect.top - oy;
    ctx.save();
    ctx.fillStyle = !isTransparentColor(sheetStyle.backgroundColor)
      ? sheetStyle.backgroundColor
      : '#ffffff';
    drawRoundedRectPath(ctx, sx, sy, sRect.width, sRect.height, parseFloat(sheetStyle.borderRadius) || 2);
    ctx.fill();
    if (parseFloat(sheetStyle.borderTopWidth) > 0 && !isTransparentColor(sheetStyle.borderTopColor)) {
      ctx.strokeStyle = sheetStyle.borderTopColor;
      ctx.lineWidth = parseFloat(sheetStyle.borderTopWidth) || 1;
      ctx.stroke();
    }
    ctx.restore();

    // 2. Draw structural boxes (table cells, callout frames, inline code pills, borders)
    const boxElements = Array.from(
      sheet.querySelectorAll('div, section, article, table, thead, tbody, tr, th, td, code, pre')
    ) as HTMLElement[];
    for (const el of boxElements) {
      if (
        el === sheet ||
        el.closest('.no-print') ||
        el.closest('.pdf-text-layer') ||
        el.closest('.annotation-textbox-chrome') ||
        el.hasAttribute('data-highlight-overlay')
      ) {
        continue;
      }
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) continue;
      const st = window.getComputedStyle(el);
      const hasBg = !isTransparentColor(st.backgroundColor);
      const topW = parseFloat(st.borderTopWidth) || 0;
      const bottomW = parseFloat(st.borderBottomWidth) || 0;
      const leftW = parseFloat(st.borderLeftWidth) || 0;
      const rightW = parseFloat(st.borderRightWidth) || 0;
      const hasFullBorder = topW > 0 && bottomW > 0 && leftW > 0 && rightW > 0;

      const x = r.left - ox;
      const y = r.top - oy;

      if (hasBg) {
        ctx.save();
        ctx.fillStyle = st.backgroundColor;
        const rad = parseFloat(st.borderRadius) || 0;
        if (rad > 0) {
          drawRoundedRectPath(ctx, x, y, r.width, r.height, rad);
          ctx.fill();
        } else {
          ctx.fillRect(x, y, r.width, r.height);
        }
        ctx.restore();
      }

      if (hasFullBorder && !isTransparentColor(st.borderTopColor)) {
        ctx.save();
        ctx.strokeStyle = st.borderTopColor;
        ctx.lineWidth = topW;
        const rad = parseFloat(st.borderRadius) || 0;
        if (rad > 0) {
          drawRoundedRectPath(ctx, x, y, r.width, r.height, rad);
          ctx.stroke();
        } else {
          ctx.strokeRect(x, y, r.width, r.height);
        }
        ctx.restore();
      } else {
        if (topW > 0 && !isTransparentColor(st.borderTopColor)) {
          ctx.fillStyle = st.borderTopColor;
          ctx.fillRect(x, y, r.width, topW);
        }
        if (bottomW > 0 && !isTransparentColor(st.borderBottomColor)) {
          ctx.fillStyle = st.borderBottomColor;
          ctx.fillRect(x, y + r.height - bottomW, r.width, bottomW);
        }
      }
    }

    // 3. Draw rendered <canvas> elements (PDF bitmap, marker ink with multiply, pen ink)
    const canvases = Array.from(sheet.querySelectorAll('canvas')) as HTMLCanvasElement[];
    for (const c of canvases) {
      if (c.closest('.no-print')) continue;
      if (c.width === 0 || c.height === 0) continue;
      const r = c.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) continue;
      const st = window.getComputedStyle(c);
      ctx.save();
      if (st.mixBlendMode === 'multiply') {
        ctx.globalCompositeOperation = 'multiply';
      }
      ctx.drawImage(c, r.left - ox, r.top - oy, r.width, r.height);
      ctx.restore();
    }

    // 4. Draw HTML document text runs accurately via Range.getClientRects()
    const walker = document.createTreeWalker(sheet, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    while ((node = walker.nextNode())) {
      const text = node.textContent;
      if (!text || !text.trim()) continue;
      const parentEl = node.parentElement;
      if (!parentEl) continue;
      if (
        parentEl.closest('.no-print') ||
        parentEl.closest('.pdf-text-layer') ||
        parentEl.closest('.annotation-textbox-chrome')
      ) {
        continue;
      }
      const st = window.getComputedStyle(parentEl);
      if (st.display === 'none' || st.visibility === 'hidden' || isTransparentColor(st.color)) {
        continue;
      }

      const range = document.createRange();
      range.selectNodeContents(node);
      const rects = Array.from(range.getClientRects()).filter((r) => r.width > 0.5 && r.height > 0.5);
      if (rects.length === 0) continue;

      ctx.save();
      ctx.fillStyle = st.color;
      ctx.font = `${st.fontStyle} ${st.fontWeight} ${st.fontSize} ${st.fontFamily}`;
      ctx.textBaseline = 'top';

      if (rects.length === 1) {
        const r = rects[0];
        ctx.fillText(text.replace(/\s+/g, ' '), r.left - ox, r.top - oy);
      } else {
        // Multi-line wrapped text node: resolve exact substring per visual line rect
        let charStart = 0;
        for (const r of rects) {
          const lineMidY = r.top + r.height / 2;
          let lineText = '';
          let i = charStart;
          while (i < text.length) {
            const chRange = document.createRange();
            chRange.setStart(node, i);
            chRange.setEnd(node, i + 1);
            const chRect = chRange.getBoundingClientRect();
            if (chRect.width === 0 && chRect.height === 0) {
              lineText += text[i];
              i++;
              continue;
            }
            if (chRect.top <= lineMidY && chRect.bottom >= lineMidY) {
              lineText += text[i];
              i++;
            } else if (chRect.top > lineMidY) {
              break;
            } else {
              lineText += text[i];
              i++;
            }
          }
          charStart = i;
          const clean = lineText.replace(/\s+/g, ' ').trim();
          if (clean) {
            ctx.fillText(clean, r.left - ox, r.top - oy);
          }
        }
      }
      ctx.restore();
    }

    // 5. Draw highlight overlay rectangles with multiply blending
    const highlights = Array.from(sheet.querySelectorAll('[data-highlight-overlay]')) as HTMLElement[];
    for (const hl of highlights) {
      const r = hl.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) continue;
      const st = window.getComputedStyle(hl);
      ctx.save();
      ctx.globalCompositeOperation = 'multiply';
      ctx.fillStyle = st.backgroundColor;
      ctx.fillRect(r.left - ox, r.top - oy, r.width, r.height);
      const bWidth = parseFloat(st.borderBottomWidth) || 0;
      if (bWidth > 0 && !isTransparentColor(st.borderBottomColor)) {
        ctx.fillStyle = st.borderBottomColor;
        ctx.fillRect(r.left - ox, r.bottom - oy - bWidth, r.width, bWidth);
      }
      ctx.restore();
    }

    // 6. Draw non-empty Free-Form Keyboard Text Boxes cleanly (without drag handles)
    const textBoxes = Array.from(sheet.querySelectorAll('.annotation-textbox-chrome')) as HTMLElement[];
    for (const boxEl of textBoxes) {
      const textarea = boxEl.querySelector('textarea');
      const value = textarea?.value || '';
      if (!value.trim()) continue;

      const boxRect = boxEl.getBoundingClientRect();
      const boxStyle = window.getComputedStyle(boxEl);
      if (!isTransparentColor(boxStyle.backgroundColor)) {
        ctx.save();
        ctx.fillStyle = boxStyle.backgroundColor;
        drawRoundedRectPath(
          ctx,
          boxRect.left - ox,
          boxRect.top - oy,
          boxRect.width,
          boxRect.height,
          parseFloat(boxStyle.borderRadius) || 6
        );
        ctx.fill();
        ctx.restore();
      }

      if (textarea) {
        const taRect = textarea.getBoundingClientRect();
        const taStyle = window.getComputedStyle(textarea);
        const padLeft = parseFloat(taStyle.paddingLeft) || 0;
        const padRight = parseFloat(taStyle.paddingRight) || 0;
        const padTop = parseFloat(taStyle.paddingTop) || 0;
        const fontSize = parseFloat(taStyle.fontSize) || 15;
        const lineHeight = parseFloat(taStyle.lineHeight) || fontSize * 1.4;

        ctx.save();
        ctx.fillStyle = taStyle.color;
        ctx.font = `${taStyle.fontStyle} ${taStyle.fontWeight} ${taStyle.fontSize} ${taStyle.fontFamily}`;
        ctx.textBaseline = 'top';
        drawWrappedTextLines(
          ctx,
          value,
          taRect.left - ox + padLeft,
          taRect.top - oy + padTop,
          Math.max(40, taRect.width - padLeft - padRight),
          lineHeight
        );
        ctx.restore();
      }
    }
  }

  return {
    pngDataUrl: outCanvas.toDataURL('image/png'),
    width: pixelWidth,
    height: pixelHeight,
    sourceLabel: cropRect ? 'Selected Area' : 'Whole Studio View',
    mode: cropRect ? 'studio-area' : 'studio-full',
  };
}
