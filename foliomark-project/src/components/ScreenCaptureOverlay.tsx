import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, Check, ChevronDown, Copy, Crop, Download, RefreshCw, RotateCcw, Share, X } from 'lucide-react';
import {
  canUseSaveFilePicker,
  convertPngToJpgBlob,
  cropImageDataUrl,
  dataUrlToBlob,
  formatCaptureBaseName,
  saveBlobWithLocationPicker,
  triggerBlobDownload,
  type CaptureResult,
  type NormalizedCrop,
  type ViewportRect,
} from '../utils/screenCapture';

interface ScreenCaptureOverlayProps {
  selectingArea: boolean;
  captureResult: CaptureResult | null;
  captureError: string | null;
  onCancelSelect: () => void;
  onCompleteAreaSelect: (rect: ViewportRect) => void;
  onRetakeArea: () => void;
  onFallbackStudioFull: () => void;
  onClosePreview: () => void;
}

type CropHandle = 'move' | 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';
type AspectPreset = 'free' | '16:9' | '4:3' | '1:1';

const ASPECT_PRESETS: Array<{ id: AspectPreset; label: string; ratio: number | null }> = [
  { id: 'free', label: 'Free', ratio: null },
  { id: '16:9', label: '16:9', ratio: 16 / 9 },
  { id: '4:3', label: '4:3', ratio: 4 / 3 },
  { id: '1:1', label: '1:1', ratio: 1 },
];

const FULL_CROP: NormalizedCrop = { x: 0, y: 0, w: 1, h: 1 };

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

function isFullCrop(c: NormalizedCrop): boolean {
  return c.x <= 0.002 && c.y <= 0.002 && c.w >= 0.996 && c.h >= 0.996;
}

function getAspectRatioValue(preset: AspectPreset): number | null {
  return ASPECT_PRESETS.find((p) => p.id === preset)?.ratio ?? null;
}

function fitCropToAspect(
  base: NormalizedCrop,
  targetRatio: number,
  imgW: number,
  imgH: number
): NormalizedCrop {
  const normRatio = targetRatio * (imgH / Math.max(1, imgW));
  let w = base.w;
  let h = w / normRatio;
  if (h > base.h) {
    h = base.h;
    w = h * normRatio;
  }
  if (w > 1) {
    w = 1;
    h = w / normRatio;
  }
  if (h > 1) {
    h = 1;
    w = h * normRatio;
  }
  const cx = base.x + base.w / 2;
  const cy = base.y + base.h / 2;
  const x = clamp(cx - w / 2, 0, Math.max(0, 1 - w));
  const y = clamp(cy - h / 2, 0, Math.max(0, 1 - h));
  return { x, y, w, h };
}

export const ScreenCaptureOverlay: React.FC<ScreenCaptureOverlayProps> = ({
  selectingArea,
  captureResult,
  captureError,
  onCancelSelect,
  onCompleteAreaSelect,
  onRetakeArea,
  onFallbackStudioFull,
  onClosePreview,
}) => {
  const [dragBox, setDragBox] = useState<ViewportRect | null>(null);
  const [filenameBase, setFilenameBase] = useState(formatCaptureBaseName);
  const [cropMode, setCropMode] = useState(false);
  const [aspectPreset, setAspectPreset] = useState<AspectPreset>('free');
  const [cropRect, setCropRect] = useState<NormalizedCrop>(FULL_CROP);
  const [committedCrop, setCommittedCrop] = useState<NormalizedCrop>(FULL_CROP);
  const [workingImage, setWorkingImage] = useState<{
    pngDataUrl: string;
    width: number;
    height: number;
  } | null>(null);
  const [pngBlobUrl, setPngBlobUrl] = useState<string | null>(null);
  const [jpgBlobUrl, setJpgBlobUrl] = useState<string | null>(null);
  const [savedFormat, setSavedFormat] = useState<'png' | 'jpg' | null>(null);
  const [clipboardStatus, setClipboardStatus] = useState<'idle' | 'copied' | 'error'>('idle');
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [askSaveLocation, setAskSaveLocation] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem('fm_ask_save_location');
      return saved === null ? true : saved === 'true';
    } catch {
      return true;
    }
  });
  const [saveNotice, setSaveNotice] = useState<string | null>(null);

  const pngBlobRef = useRef<Blob | null>(null);
  const jpgBlobRef = useRef<Blob | null>(null);
  const exportMenuRef = useRef<HTMLDivElement>(null);
  const dragOriginRef = useRef<{ x: number; y: number } | null>(null);
  const dragRectRef = useRef<ViewportRect | null>(null);

  const cropStageRef = useRef<HTMLDivElement>(null);
  const cropDragRef = useRef<{
    handle: CropHandle;
    startX: number;
    startY: number;
    orig: NormalizedCrop;
    stageW: number;
    stageH: number;
  } | null>(null);
  const latestCropRef = useRef<NormalizedCrop>(FULL_CROP);

  // Reset crop state whenever a fresh capture opens
  useEffect(() => {
    if (!captureResult) {
      setWorkingImage(null);
      setCropMode(false);
      setAspectPreset('free');
      setCropRect(FULL_CROP);
      setCommittedCrop(FULL_CROP);
      latestCropRef.current = FULL_CROP;
      pngBlobRef.current = null;
      jpgBlobRef.current = null;
      setPngBlobUrl(null);
      setJpgBlobUrl(null);
      setSavedFormat(null);
      setClipboardStatus('idle');
      setSaveNotice(null);
      setExportMenuOpen(false);
      return;
    }

    setFilenameBase(formatCaptureBaseName());
    setSavedFormat(null);
    setClipboardStatus('idle');
    setSaveNotice(null);
    setExportMenuOpen(false);
    setCropMode(false);
    setAspectPreset('free');
    setCropRect(FULL_CROP);
    setCommittedCrop(FULL_CROP);
    latestCropRef.current = FULL_CROP;
    setWorkingImage({
      pngDataUrl: captureResult.pngDataUrl,
      width: captureResult.width,
      height: captureResult.height,
    });
  }, [captureResult]);

  // Keep downloadable PNG and JPG Blob URLs in sync with the active crop
  useEffect(() => {
    if (!captureResult) return;
    let cancelled = false;
    let createdPngUrl: string | null = null;
    let createdJpgUrl: string | null = null;

    async function rebuildDownloads() {
      if (!captureResult) return;
      const baseDataUrl = captureResult.pngDataUrl;
      const activePng = isFullCrop(committedCrop)
        ? {
            pngDataUrl: baseDataUrl,
            width: captureResult.width,
            height: captureResult.height,
          }
        : await cropImageDataUrl(baseDataUrl, committedCrop);

      if (cancelled) return;
      setWorkingImage(activePng);

      const pngBlob = dataUrlToBlob(activePng.pngDataUrl);
      pngBlobRef.current = pngBlob;
      createdPngUrl = URL.createObjectURL(pngBlob);
      setPngBlobUrl(createdPngUrl);

      try {
        const jpgBlob = await convertPngToJpgBlob(activePng.pngDataUrl);
        if (cancelled) return;
        jpgBlobRef.current = jpgBlob;
        createdJpgUrl = URL.createObjectURL(jpgBlob);
        setJpgBlobUrl(createdJpgUrl);
      } catch {
        if (!cancelled) {
          jpgBlobRef.current = null;
          setJpgBlobUrl(null);
        }
      }
    }

    rebuildDownloads().catch(() => {});

    return () => {
      cancelled = true;
      if (createdPngUrl) URL.revokeObjectURL(createdPngUrl);
      if (createdJpgUrl) URL.revokeObjectURL(createdJpgUrl);
    };
  }, [captureResult, committedCrop]);

  useEffect(() => {
    if (!exportMenuOpen) return;
    const handleOutside = (e: MouseEvent) => {
      if (exportMenuRef.current && !exportMenuRef.current.contains(e.target as Node)) {
        setExportMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [exportMenuOpen]);

  useEffect(() => {
    if (!selectingArea && !captureResult && !captureError) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (selectingArea) {
          dragOriginRef.current = null;
          dragRectRef.current = null;
          setDragBox(null);
          onCancelSelect();
        } else if (exportMenuOpen) {
          setExportMenuOpen(false);
        } else if (cropMode) {
          setCropMode(false);
          setCropRect(committedCrop);
          latestCropRef.current = committedCrop;
        } else {
          onClosePreview();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectingArea, captureResult, captureError, exportMenuOpen, cropMode, committedCrop, onCancelSelect, onClosePreview]);

  // Fullscreen drag-to-capture overlay handlers
  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragOriginRef.current = { x: e.clientX, y: e.clientY };
    const initial: ViewportRect = { left: e.clientX, top: e.clientY, width: 0, height: 0 };
    dragRectRef.current = initial;
    setDragBox(initial);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragOriginRef.current) return;
    const left = Math.min(dragOriginRef.current.x, e.clientX);
    const top = Math.min(dragOriginRef.current.y, e.clientY);
    const width = Math.abs(e.clientX - dragOriginRef.current.x);
    const height = Math.abs(e.clientY - dragOriginRef.current.y);
    const next = { left, top, width, height };
    dragRectRef.current = next;
    setDragBox(next);
  };

  const finishDrag = () => {
    if (!dragOriginRef.current) return;
    const rect = dragRectRef.current;
    dragOriginRef.current = null;
    dragRectRef.current = null;
    setDragBox(null);
    if (rect && rect.width >= 10 && rect.height >= 10) {
      onCompleteAreaSelect(rect);
    } else {
      onCancelSelect();
    }
  };

  // Visual preview cropping handle drag handlers
  const startCropDrag = useCallback(
    (handle: CropHandle, e: React.PointerEvent<HTMLElement>) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      const stage = cropStageRef.current;
      if (!stage) return;
      const rect = stage.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        // Ignore if capture unavailable
      }
      cropDragRef.current = {
        handle,
        startX: e.clientX,
        startY: e.clientY,
        orig: { ...cropRect },
        stageW: rect.width,
        stageH: rect.height,
      };
    },
    [cropRect]
  );

  const moveCropDrag = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      const drag = cropDragRef.current;
      if (!drag || !captureResult) return;

      const dx = (e.clientX - drag.startX) / drag.stageW;
      const dy = (e.clientY - drag.startY) / drag.stageH;
      const minW = Math.min(0.4, Math.max(20 / captureResult.width, 0.04));
      const minH = Math.min(0.4, Math.max(20 / captureResult.height, 0.04));
      const targetRatio = getAspectRatioValue(aspectPreset);

      let { x, y, w, h } = drag.orig;
      const right = drag.orig.x + drag.orig.w;
      const bottom = drag.orig.y + drag.orig.h;

      if (drag.handle === 'move') {
        x = clamp(drag.orig.x + dx, 0, 1 - drag.orig.w);
        y = clamp(drag.orig.y + dy, 0, 1 - drag.orig.h);
      } else if (targetRatio === null) {
        if (drag.handle.includes('w')) {
          const nextX = clamp(drag.orig.x + dx, 0, right - minW);
          w = right - nextX;
          x = nextX;
        }
        if (drag.handle.includes('e')) {
          const nextRight = clamp(right + dx, drag.orig.x + minW, 1);
          w = nextRight - drag.orig.x;
        }
        if (drag.handle.includes('n')) {
          const nextY = clamp(drag.orig.y + dy, 0, bottom - minH);
          h = bottom - nextY;
          y = nextY;
        }
        if (drag.handle.includes('s')) {
          const nextBottom = clamp(bottom + dy, drag.orig.y + minH, 1);
          h = nextBottom - drag.orig.y;
        }
      } else {
        const normRatio = targetRatio * (captureResult.height / Math.max(1, captureResult.width));
        const minAllowedW = Math.max(minW, minH * normRatio);
        const minAllowedH = Math.max(minH, minW / normRatio);

        if (drag.handle.length === 2) {
          // Corner handles: anchor opposite corner and maintain exact aspect ratio within bounds
          const anchorX = drag.handle.includes('w') ? right : drag.orig.x;
          const anchorY = drag.handle.includes('n') ? bottom : drag.orig.y;
          const maxW = drag.handle.includes('w') ? anchorX : 1 - anchorX;
          const maxH = drag.handle.includes('n') ? anchorY : 1 - anchorY;
          const maxAllowedW = Math.max(minAllowedW, Math.min(maxW, maxH * normRatio));

          const rawW = drag.handle.includes('w') ? drag.orig.w - dx : drag.orig.w + dx;
          const rawH = drag.handle.includes('n') ? drag.orig.h - dy : drag.orig.h + dy;
          const candidateW = Math.abs(dx) >= Math.abs(dy) ? rawW : rawH * normRatio;

          w = clamp(candidateW, minAllowedW, maxAllowedW);
          h = w / normRatio;
          x = drag.handle.includes('w') ? anchorX - w : anchorX;
          y = drag.handle.includes('n') ? anchorY - h : anchorY;
        } else if (drag.handle === 'e' || drag.handle === 'w') {
          const anchorX = drag.handle === 'w' ? right : drag.orig.x;
          const cy = drag.orig.y + drag.orig.h / 2;
          const maxW = drag.handle === 'w' ? anchorX : 1 - anchorX;
          const maxH = Math.min(cy, 1 - cy) * 2;
          const maxAllowedW = Math.max(minAllowedW, Math.min(maxW, maxH * normRatio));

          const rawW = drag.handle === 'w' ? drag.orig.w - dx : drag.orig.w + dx;
          w = clamp(rawW, minAllowedW, maxAllowedW);
          h = w / normRatio;
          x = drag.handle === 'w' ? anchorX - w : anchorX;
          y = cy - h / 2;
        } else {
          // 'n' or 's' edge handle
          const anchorY = drag.handle === 'n' ? bottom : drag.orig.y;
          const cx = drag.orig.x + drag.orig.w / 2;
          const maxH = drag.handle === 'n' ? anchorY : 1 - anchorY;
          const maxW = Math.min(cx, 1 - cx) * 2;
          const maxAllowedH = Math.max(minAllowedH, Math.min(maxH, maxW / normRatio));

          const rawH = drag.handle === 'n' ? drag.orig.h - dy : drag.orig.h + dy;
          h = clamp(rawH, minAllowedH, maxAllowedH);
          w = h * normRatio;
          y = drag.handle === 'n' ? anchorY - h : anchorY;
          x = cx - w / 2;
        }
      }

      const nextCrop = { x, y, w, h };
      latestCropRef.current = nextCrop;
      setCropRect(nextCrop);
    },
    [captureResult, aspectPreset]
  );

  const endCropDrag = useCallback((e: React.PointerEvent<HTMLElement>) => {
    if (!cropDragRef.current) return;
    try {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
    } catch {
      // Ignore
    }
    cropDragRef.current = null;
    setCommittedCrop({ ...latestCropRef.current });
  }, []);

  const handleToggleCropMode = () => {
    if (cropMode) {
      setCommittedCrop({ ...cropRect });
      setCropMode(false);
    } else {
      setCropRect({ ...committedCrop });
      latestCropRef.current = { ...committedCrop };
      setCropMode(true);
    }
  };

  const handleSelectAspectPreset = (nextPreset: AspectPreset) => {
    setAspectPreset(nextPreset);
    const ratio = getAspectRatioValue(nextPreset);
    if (ratio === null || !captureResult) {
      return;
    }
    const base = isFullCrop(cropRect) ? FULL_CROP : cropRect;
    const fitted = fitCropToAspect(base, ratio, captureResult.width, captureResult.height);
    setCropMode(true);
    setCropRect(fitted);
    setCommittedCrop(fitted);
    latestCropRef.current = fitted;
  };

  const handleResetCrop = () => {
    setAspectPreset('free');
    setCropRect(FULL_CROP);
    setCommittedCrop(FULL_CROP);
    latestCropRef.current = FULL_CROP;
  };

  const normalizedName =
    (filenameBase.trim() || formatCaptureBaseName()).replace(/\.(png|jpe?g)$/i, '');

  const markSaved = (fmt: 'png' | 'jpg') => {
    setSavedFormat(fmt);
    setTimeout(() => {
      setSavedFormat((prev) => (prev === fmt ? null : prev));
    }, 1800);
  };

  const handleToggleAskLocation = (checked: boolean) => {
    setAskSaveLocation(checked);
    setSaveNotice(null);
    try {
      localStorage.setItem('fm_ask_save_location', String(checked));
    } catch {
      // Ignore storage error
    }
  };

  const handleSaveCaptureLink = async (
    e: React.MouseEvent<HTMLAnchorElement>,
    fmt: 'png' | 'jpg'
  ) => {
    const blob = fmt === 'jpg' ? jpgBlobRef.current : pngBlobRef.current;
    const filename = `${normalizedName}.${fmt}`;

    if (!askSaveLocation || !canUseSaveFilePicker() || !blob) {
      if (askSaveLocation && !canUseSaveFilePicker()) {
        setSaveNotice(
          'Saved to your default Downloads folder (folder picker requires Chrome/Edge in a top-level tab or Chrome "Ask where to save each file").'
        );
      }
      markSaved(fmt);
      return;
    }

    e.preventDefault();
    setSaveNotice(null);
    const outcome = await saveBlobWithLocationPicker(blob, filename, fmt);
    if (outcome === 'saved') {
      markSaved(fmt);
    } else if (outcome === 'unavailable') {
      triggerBlobDownload(blob, filename);
      markSaved(fmt);
      setSaveNotice(
        'Folder picker is blocked inside this embedded preview frame — saved to your default Downloads folder instead.'
      );
    }
  };

  const handleCopyToClipboard = async () => {
    if (!captureResult) return;
    if (
      typeof navigator === 'undefined' ||
      !navigator.clipboard ||
      typeof navigator.clipboard.write !== 'function' ||
      typeof ClipboardItem === 'undefined'
    ) {
      setClipboardStatus('error');
      return;
    }

    try {
      const sourcePng = isFullCrop(cropRect)
        ? captureResult.pngDataUrl
        : workingImage?.pngDataUrl && !cropMode
          ? workingImage.pngDataUrl
          : (await cropImageDataUrl(captureResult.pngDataUrl, cropRect)).pngDataUrl;
      const pngBlob = dataUrlToBlob(sourcePng);
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': pngBlob })]);
      setClipboardStatus('copied');
      setTimeout(() => {
        setClipboardStatus((prev) => (prev === 'copied' ? 'idle' : prev));
      }, 1800);
    } catch {
      setClipboardStatus('error');
    }
  };

  const liveCropPx = captureResult
    ? {
        w: Math.max(1, Math.round(cropRect.w * captureResult.width)),
        h: Math.max(1, Math.round(cropRect.h * captureResult.height)),
      }
    : { w: 0, h: 0 };

  const activeDisplayWidth = cropMode
    ? liveCropPx.w
    : workingImage?.width ?? captureResult?.width ?? 0;
  const activeDisplayHeight = cropMode
    ? liveCropPx.h
    : workingImage?.height ?? captureResult?.height ?? 0;
  const isTrimmed = !isFullCrop(cropRect) || !isFullCrop(committedCrop);

  return (
    <>
      {/* Fullscreen Crosshair Drag Area Selector */}
      {selectingArea && (
        <div
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={finishDrag}
          onPointerCancel={finishDrag}
          className={`fixed inset-0 z-50 cursor-crosshair select-none ${
            dragBox ? 'bg-transparent' : 'bg-slate-900/40'
          }`}
        >
          <div className="pointer-events-none fixed top-4 left-1/2 -translate-x-1/2 px-4 py-2 bg-slate-900 text-white text-xs font-medium rounded-lg shadow-lg border border-slate-700 whitespace-nowrap">
            Drag to select an area to capture · Press Esc to cancel
          </div>

          {dragBox && (
            <div
              style={{
                left: `${dragBox.left}px`,
                top: `${dragBox.top}px`,
                width: `${dragBox.width}px`,
                height: `${dragBox.height}px`,
                boxShadow: '0 0 0 9999px rgba(15, 23, 42, 0.48)',
              }}
              className="pointer-events-none fixed border-2 border-blue-600 bg-white/5"
            >
              <div className="absolute -top-7 left-0 px-2 py-0.5 bg-slate-900 text-white text-[11px] font-mono tabular-nums rounded shadow-xs whitespace-nowrap">
                {Math.round(dragBox.width)} × {Math.round(dragBox.height)} px
              </div>
            </div>
          )}
        </div>
      )}

      {/* Error Notice Modal (e.g. if getDisplayMedia blocked by iframe policy) */}
      {captureError && !captureResult && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="w-full max-w-md bg-white border border-slate-200 rounded-xl shadow-xl overflow-hidden">
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-200">
              <div className="flex items-center gap-2">
                <Camera className="w-4 h-4 text-slate-700" />
                <h2 className="text-sm font-semibold text-slate-900">Screen Capture Notice</h2>
              </div>
              <button
                type="button"
                onClick={onClosePreview}
                className="p-1 text-slate-400 hover:text-slate-700 rounded cursor-pointer"
                aria-label="Close capture notice"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-5 text-xs leading-relaxed text-slate-600">{captureError}</div>
            <div className="flex items-center justify-end gap-2 px-5 py-3 bg-slate-50 border-t border-slate-200">
              <button
                type="button"
                onClick={onClosePreview}
                className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-100 cursor-pointer whitespace-nowrap shrink-0"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={onFallbackStudioFull}
                className="px-3 py-1.5 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg cursor-pointer whitespace-nowrap shrink-0"
              >
                Capture Studio View Instead
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Capture Preview, Visual Crop Handles & Export Modal (JPG / PNG) */}
      {captureResult && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/55 p-4 lg:p-8">
          <div className="w-full max-w-4xl max-h-[92vh] flex flex-col bg-white border border-slate-200 rounded-xl shadow-2xl overflow-hidden">
            {/* Header */}
            <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5 border-b border-slate-200">
              <div>
                <h2 className="text-sm font-semibold text-slate-900">
                  {cropMode ? 'Trim Captured Area' : 'Screen Capture Ready'}
                </h2>
                <p className="text-[11px] font-mono tabular-nums text-slate-500 mt-0.5">
                  {activeDisplayWidth} × {activeDisplayHeight} px · {captureResult.sourceLabel}
                  {isTrimmed ? ' (Trimmed)' : ''}
                </p>
              </div>

              <div className="flex items-center gap-2">
                <label htmlFor="crop-aspect-select" className="sr-only">
                  Crop aspect ratio preset
                </label>
                <select
                  id="crop-aspect-select"
                  value={aspectPreset}
                  onChange={(e) => handleSelectAspectPreset(e.target.value as AspectPreset)}
                  title="Constrain crop aspect ratio"
                  className="h-8 px-2.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-blue-700 cursor-pointer"
                >
                  {ASPECT_PRESETS.map((preset) => (
                    <option key={preset.id} value={preset.id}>
                      Ratio: {preset.label}
                    </option>
                  ))}
                </select>

                {isTrimmed && (
                  <button
                    type="button"
                    onClick={handleResetCrop}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 cursor-pointer whitespace-nowrap shrink-0"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    Reset Trim
                  </button>
                )}

                <button
                  type="button"
                  onClick={handleToggleCropMode}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border rounded-lg transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                    cropMode
                      ? 'bg-blue-700 text-white border-blue-700 hover:bg-blue-800'
                      : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  {cropMode ? (
                    <>
                      <Check className="w-3.5 h-3.5" />
                      Done Cropping
                    </>
                  ) : (
                    <>
                      <Crop className="w-3.5 h-3.5" />
                      Crop Handles
                    </>
                  )}
                </button>

                {/* Dedicated Top-Right Export Button */}
                <div ref={exportMenuRef} className="relative">
                  <button
                    type="button"
                    onClick={() => setExportMenuOpen((v) => !v)}
                    title="Export capture as PNG, JPG, or copy to clipboard"
                    aria-label="Export capture"
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                      exportMenuOpen
                        ? 'bg-slate-800 text-white'
                        : 'bg-slate-900 text-white hover:bg-slate-800'
                    }`}
                  >
                    <Share className="w-3.5 h-3.5" />
                    <span>Export</span>
                    <ChevronDown className="w-3 h-3 opacity-80" />
                  </button>

                  {exportMenuOpen && (
                    <div className="absolute right-0 top-full mt-1.5 w-52 bg-white border border-slate-200 rounded-lg shadow-xl p-1 z-50">
                      {pngBlobUrl && (
                        <a
                          href={pngBlobUrl}
                          download={`${normalizedName}.png`}
                          onClick={(e) => {
                            setExportMenuOpen(false);
                            handleSaveCaptureLink(e, 'png');
                          }}
                          className="w-full flex items-center justify-between px-2.5 py-2 text-xs font-medium text-slate-800 hover:bg-slate-100 rounded-md no-underline cursor-pointer"
                        >
                          <span className="inline-flex items-center gap-2">
                            <Download className="w-3.5 h-3.5 text-slate-500" />
                            Export PNG
                          </span>
                          <span className="text-[10px] font-mono text-slate-400">.png</span>
                        </a>
                      )}
                      {jpgBlobUrl && (
                        <a
                          href={jpgBlobUrl}
                          download={`${normalizedName}.jpg`}
                          onClick={(e) => {
                            setExportMenuOpen(false);
                            handleSaveCaptureLink(e, 'jpg');
                          }}
                          className="w-full flex items-center justify-between px-2.5 py-2 text-xs font-medium text-slate-800 hover:bg-slate-100 rounded-md no-underline cursor-pointer"
                        >
                          <span className="inline-flex items-center gap-2">
                            <Download className="w-3.5 h-3.5 text-slate-500" />
                            Export JPG
                          </span>
                          <span className="text-[10px] font-mono text-slate-400">.jpg</span>
                        </a>
                      )}
                      <button
                        type="button"
                        onClick={() => {
                          setExportMenuOpen(false);
                          handleCopyToClipboard();
                        }}
                        className="w-full flex items-center justify-between px-2.5 py-2 text-xs font-medium text-slate-800 hover:bg-slate-100 rounded-md cursor-pointer"
                      >
                        <span className="inline-flex items-center gap-2">
                          <Copy className="w-3.5 h-3.5 text-slate-500" />
                          Copy to Clipboard
                        </span>
                      </button>
                    </div>
                  )}
                </div>

                <button
                  type="button"
                  onClick={onClosePreview}
                  className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg cursor-pointer"
                  aria-label="Close screen capture preview"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Preview / Interactive Visual Crop Stage */}
            <div className="flex-1 overflow-auto bg-slate-100/80 p-6 flex items-center justify-center min-h-[260px]">
              <div
                ref={cropStageRef}
                className="relative inline-block select-none border border-slate-300 bg-white shadow-sm overflow-hidden"
              >
                <img
                  src={
                    cropMode
                      ? captureResult.pngDataUrl
                      : pngBlobUrl || workingImage?.pngDataUrl || captureResult.pngDataUrl
                  }
                  alt="Captured screen preview"
                  draggable={false}
                  className="block max-w-full max-h-[54vh] pointer-events-none"
                />

                {/* 8-Handle Interactive Cropping Overlay */}
                {cropMode && (
                  <div
                    style={{
                      left: `${cropRect.x * 100}%`,
                      top: `${cropRect.y * 100}%`,
                      width: `${cropRect.w * 100}%`,
                      height: `${cropRect.h * 100}%`,
                      boxShadow: '0 0 0 9999px rgba(15, 23, 42, 0.54)',
                    }}
                    onPointerDown={(e) => startCropDrag('move', e)}
                    onPointerMove={moveCropDrag}
                    onPointerUp={endCropDrag}
                    onPointerCancel={endCropDrag}
                    className="absolute border-2 border-blue-600 cursor-move touch-none"
                  >
                    {/* Rule-of-thirds alignment guides */}
                    <div className="pointer-events-none absolute inset-0 grid grid-cols-3 grid-rows-3">
                      <div className="border-r border-b border-white/35" />
                      <div className="border-r border-b border-white/35" />
                      <div className="border-b border-white/35" />
                      <div className="border-r border-b border-white/35" />
                      <div className="border-r border-b border-white/35" />
                      <div className="border-b border-white/35" />
                      <div className="border-r border-white/35" />
                      <div className="border-r border-white/35" />
                      <div />
                    </div>

                    {/* Live pixel dimension readout */}
                    <div className="pointer-events-none absolute bottom-2 right-2 px-2 py-0.5 bg-slate-900/90 text-white text-[11px] font-mono tabular-nums rounded shadow-xs whitespace-nowrap">
                      {liveCropPx.w} × {liveCropPx.h} px
                    </div>

                    {/* Corner Handles (NW, NE, SE, SW) */}
                    <button
                      type="button"
                      aria-label="Crop top-left corner"
                      onPointerDown={(e) => startCropDrag('nw', e)}
                      onPointerMove={moveCropDrag}
                      onPointerUp={endCropDrag}
                      onPointerCancel={endCropDrag}
                      className="absolute -top-1.5 -left-1.5 w-3.5 h-3.5 bg-white border-2 border-blue-700 rounded-[2px] shadow-xs cursor-nwse-resize touch-none"
                    />
                    <button
                      type="button"
                      aria-label="Crop top-right corner"
                      onPointerDown={(e) => startCropDrag('ne', e)}
                      onPointerMove={moveCropDrag}
                      onPointerUp={endCropDrag}
                      onPointerCancel={endCropDrag}
                      className="absolute -top-1.5 -right-1.5 w-3.5 h-3.5 bg-white border-2 border-blue-700 rounded-[2px] shadow-xs cursor-nesw-resize touch-none"
                    />
                    <button
                      type="button"
                      aria-label="Crop bottom-right corner"
                      onPointerDown={(e) => startCropDrag('se', e)}
                      onPointerMove={moveCropDrag}
                      onPointerUp={endCropDrag}
                      onPointerCancel={endCropDrag}
                      className="absolute -bottom-1.5 -right-1.5 w-3.5 h-3.5 bg-white border-2 border-blue-700 rounded-[2px] shadow-xs cursor-nwse-resize touch-none"
                    />
                    <button
                      type="button"
                      aria-label="Crop bottom-left corner"
                      onPointerDown={(e) => startCropDrag('sw', e)}
                      onPointerMove={moveCropDrag}
                      onPointerUp={endCropDrag}
                      onPointerCancel={endCropDrag}
                      className="absolute -bottom-1.5 -left-1.5 w-3.5 h-3.5 bg-white border-2 border-blue-700 rounded-[2px] shadow-xs cursor-nesw-resize touch-none"
                    />

                    {/* Edge Handles (N, S, W, E) */}
                    <button
                      type="button"
                      aria-label="Crop top edge"
                      onPointerDown={(e) => startCropDrag('n', e)}
                      onPointerMove={moveCropDrag}
                      onPointerUp={endCropDrag}
                      onPointerCancel={endCropDrag}
                      className="absolute -top-1.5 left-1/2 -translate-x-1/2 w-6 h-2.5 bg-white border-2 border-blue-700 rounded-[2px] shadow-xs cursor-ns-resize touch-none"
                    />
                    <button
                      type="button"
                      aria-label="Crop bottom edge"
                      onPointerDown={(e) => startCropDrag('s', e)}
                      onPointerMove={moveCropDrag}
                      onPointerUp={endCropDrag}
                      onPointerCancel={endCropDrag}
                      className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 w-6 h-2.5 bg-white border-2 border-blue-700 rounded-[2px] shadow-xs cursor-ns-resize touch-none"
                    />
                    <button
                      type="button"
                      aria-label="Crop left edge"
                      onPointerDown={(e) => startCropDrag('w', e)}
                      onPointerMove={moveCropDrag}
                      onPointerUp={endCropDrag}
                      onPointerCancel={endCropDrag}
                      className="absolute top-1/2 -left-1.5 -translate-y-1/2 w-2.5 h-6 bg-white border-2 border-blue-700 rounded-[2px] shadow-xs cursor-ew-resize touch-none"
                    />
                    <button
                      type="button"
                      aria-label="Crop right edge"
                      onPointerDown={(e) => startCropDrag('e', e)}
                      onPointerMove={moveCropDrag}
                      onPointerUp={endCropDrag}
                      onPointerCancel={endCropDrag}
                      className="absolute top-1/2 -right-1.5 -translate-y-1/2 w-2.5 h-6 bg-white border-2 border-blue-700 rounded-[2px] shadow-xs cursor-ew-resize touch-none"
                    />
                  </div>
                )}
              </div>
            </div>

            {/* Footer Controls */}
            <div className="border-t border-slate-200 bg-white">
              {clipboardStatus === 'error' && (
                <div className="px-5 py-2 bg-amber-50 border-b border-amber-200 text-[11px] text-amber-800">
                  Clipboard image write is blocked in this browser or iframe context. Use Save PNG or Save JPG to download the image.
                </div>
              )}
              {saveNotice && (
                <div className="px-5 py-2 bg-slate-50 border-b border-slate-200 text-[11px] text-slate-600">
                  {saveNotice}
                </div>
              )}
              <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5">
                <div className="flex-1 min-w-[160px] flex items-center gap-3">
                  <div className="flex-1 min-w-[140px]">
                    <label htmlFor="capture-filename-input" className="sr-only">
                      Capture filename
                    </label>
                    <input
                      id="capture-filename-input"
                      type="text"
                      value={filenameBase}
                      onChange={(e) => setFilenameBase(e.target.value)}
                      placeholder="foliomark-capture"
                      className="w-full h-8 px-3 text-xs font-mono text-slate-800 bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-blue-700"
                    />
                  </div>
                  <label
                    className="inline-flex items-center gap-1.5 text-xs text-slate-600 cursor-pointer select-none whitespace-nowrap shrink-0"
                    title="Choose destination folder and filename when saving PNG or JPG"
                  >
                    <input
                      type="checkbox"
                      checked={askSaveLocation}
                      onChange={(e) => handleToggleAskLocation(e.target.checked)}
                      className="accent-blue-700 cursor-pointer"
                    />
                    <span>Ask where to save</span>
                  </label>
                </div>

                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={onRetakeArea}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 cursor-pointer whitespace-nowrap shrink-0"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    Select Area
                  </button>

                  <button
                    type="button"
                    onClick={handleCopyToClipboard}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 cursor-pointer whitespace-nowrap shrink-0"
                  >
                    {clipboardStatus === 'copied' ? (
                      <Check className="w-3.5 h-3.5 text-emerald-600" />
                    ) : (
                      <Copy className="w-3.5 h-3.5" />
                    )}
                    {clipboardStatus === 'copied' ? 'Copied' : 'Copy to Clipboard'}
                  </button>

                  {jpgBlobUrl ? (
                    <a
                      href={jpgBlobUrl}
                      download={`${normalizedName}.jpg`}
                      onClick={(e) => handleSaveCaptureLink(e, 'jpg')}
                      className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-slate-800 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 cursor-pointer whitespace-nowrap shrink-0 no-underline"
                    >
                      {savedFormat === 'jpg' ? (
                        <Check className="w-3.5 h-3.5 text-emerald-600" />
                      ) : (
                        <Download className="w-3.5 h-3.5" />
                      )}
                      {savedFormat === 'jpg' ? 'Saved JPG' : 'Save JPG'}
                    </a>
                  ) : (
                    <button
                      type="button"
                      disabled
                      className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-slate-400 bg-white border border-slate-200 rounded-lg whitespace-nowrap shrink-0"
                    >
                      <Download className="w-3.5 h-3.5" />
                      Save JPG
                    </button>
                  )}

                  {pngBlobUrl ? (
                    <a
                      href={pngBlobUrl}
                      download={`${normalizedName}.png`}
                      onClick={(e) => handleSaveCaptureLink(e, 'png')}
                      className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg cursor-pointer whitespace-nowrap shrink-0 no-underline"
                    >
                      {savedFormat === 'png' ? (
                        <Check className="w-3.5 h-3.5 text-emerald-400" />
                      ) : (
                        <Download className="w-3.5 h-3.5" />
                      )}
                      {savedFormat === 'png' ? 'Saved PNG' : 'Save PNG'}
                    </a>
                  ) : (
                    <button
                      type="button"
                      disabled
                      className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-white bg-slate-400 rounded-lg whitespace-nowrap shrink-0"
                    >
                      <Download className="w-3.5 h-3.5" />
                      Save PNG
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
