import React, { useEffect, useRef, useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { MessageSquare, Trash2, X } from 'lucide-react';
import {
  HIGHLIGHT_PALETTE,
  type AnnotationTool,
  type HighlightAnnotation,
  type HighlightColor,
  type InkStroke,
  type TextBoxAnnotation,
} from '../types/annotation';
import { InkCanvas } from './InkCanvas';
import { PrintAnnotationSvgLayer } from './PrintAnnotationSvgLayer';
import { TextBoxOverlay } from './TextBoxOverlay';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

const HIGHLIGHT_KEYS = Object.keys(HIGHLIGHT_PALETTE) as HighlightColor[];

interface PdfDocumentSurfaceProps {
  docId: string;
  pdfBytes: Uint8Array | null;
  zoom: number;
  activeTool: AnnotationTool;
  inkColor: string;
  strokeWidth: number;
  textBoxes: TextBoxAnnotation[];
  highlights: HighlightAnnotation[];
  strokes: InkStroke[];
  activeBoxId: string | null;
  focusedAnnotationId: string | null;
  onFocusBox: (id: string | null) => void;
  onSpawnTextBox: (x: number, y: number, pageNumber: number) => void;
  onUpdateTextBox: (id: string, patch: Partial<TextBoxAnnotation>) => void;
  onDeleteTextBox: (id: string) => void;
  onAddStroke: (stroke: InkStroke) => void;
  onEraseStrokeIds: (ids: string[]) => void;
  onAddHighlight: (
    quote: string,
    color: HighlightColor,
    rects: Array<{ left: number; top: number; width: number; height: number }>,
    pageNumber: number
  ) => void;
  onUpdateHighlight: (id: string, patch: Partial<HighlightAnnotation>) => void;
  onDeleteHighlight: (id: string) => void;
}

export const PdfDocumentSurface: React.FC<PdfDocumentSurfaceProps> = ({
  docId,
  pdfBytes,
  zoom,
  activeTool,
  inkColor,
  strokeWidth,
  textBoxes,
  highlights,
  strokes,
  activeBoxId,
  focusedAnnotationId,
  onFocusBox,
  onSpawnTextBox,
  onUpdateTextBox,
  onDeleteTextBox,
  onAddStroke,
  onEraseStrokeIds,
  onAddHighlight,
  onUpdateHighlight,
  onDeleteHighlight,
}) => {
  const [pdfDoc, setPdfDoc] = useState<pdfjsLib.PDFDocumentProxy | null>(null);
  const [numPages, setNumPages] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!pdfBytes) return;

    setLoading(true);
    setError(null);

    const copy = new Uint8Array(pdfBytes);
    const loadingTask = pdfjsLib.getDocument({ data: copy });
    loadingTask.promise
      .then((doc) => {
        if (cancelled) return;
        setPdfDoc(doc);
        setNumPages(doc.numPages);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err?.message || 'Unable to parse PDF file.');
        setLoading(false);
      });

    return () => {
      cancelled = true;
      loadingTask.destroy();
    };
  }, [pdfBytes]);

  /**
   * Allows dragging a text box seamlessly across PDF pages:
   * checks which [data-pdf-page] element contains the box on drop
   * and converts coordinates relative to that target page.
   */
  const handleCrossPageDragEnd = (boxId: string) => {
    const boxEl = document.querySelector(`[data-textbox-id="${boxId}"]`) as HTMLElement | null;
    if (!boxEl) return;

    const boxRect = boxEl.getBoundingClientRect();
    const boxCenterY = boxRect.top + 16;
    const pages = Array.from(document.querySelectorAll('[data-pdf-page]')) as HTMLElement[];
    if (pages.length === 0) return;

    let targetPageEl: HTMLElement | null = null;
    let minDistance = Infinity;

    for (const p of pages) {
      const pRect = p.getBoundingClientRect();
      if (boxCenterY >= pRect.top && boxCenterY <= pRect.bottom) {
        targetPageEl = p;
        break;
      }
      const dist = Math.min(Math.abs(boxCenterY - pRect.top), Math.abs(boxCenterY - pRect.bottom));
      if (dist < minDistance) {
        minDistance = dist;
        targetPageEl = p;
      }
    }

    if (!targetPageEl) return;
    const targetPageNum = Number(targetPageEl.dataset.pdfPage || 1);
    const currentBox = textBoxes.find((b) => b.id === boxId);
    if (!currentBox || (currentBox.pageNumber || 1) === targetPageNum) return;

    const targetRect = targetPageEl.getBoundingClientRect();
    onUpdateTextBox(boxId, {
      pageNumber: targetPageNum,
      x: Math.round((boxRect.left - targetRect.left) / zoom),
      y: Math.round((boxRect.top - targetRect.top) / zoom),
    });
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-sm text-slate-500">
        Rendering PDF pages...
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-lg mx-auto my-12 p-6 bg-white border border-red-200 rounded-lg text-sm text-red-700">
        Failed to render PDF: {error}
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-6 py-8 px-4 print:py-0 print:px-0 print:gap-0">
      {Array.from({ length: numPages }, (_, idx) => idx + 1).map((pageNumber) => {
        const pageBoxes = textBoxes.filter((b) => (b.pageNumber || 1) === pageNumber);
        const hasActiveBox = pageBoxes.some((b) => b.id === activeBoxId);

        return (
          <PdfPageView
            key={`${docId}_p${pageNumber}`}
            pdfDoc={pdfDoc!}
            docId={docId}
            pageNumber={pageNumber}
            zoom={zoom}
            elevatePage={hasActiveBox}
            activeTool={activeTool}
            inkColor={inkColor}
            strokeWidth={strokeWidth}
            textBoxes={pageBoxes}
            highlights={highlights.filter((h) => (h.pageNumber || 1) === pageNumber)}
            strokes={strokes.filter((s) => (s.pageNumber || 1) === pageNumber)}
            activeBoxId={activeBoxId}
            focusedAnnotationId={focusedAnnotationId}
            onFocusBox={onFocusBox}
            onSpawnTextBox={(x, y) => onSpawnTextBox(x, y, pageNumber)}
            onUpdateTextBox={onUpdateTextBox}
            onDeleteTextBox={onDeleteTextBox}
            onDragEndScreenPoint={(boxId) => handleCrossPageDragEnd(boxId)}
            onAddStroke={onAddStroke}
            onEraseStrokeIds={onEraseStrokeIds}
            onAddHighlight={(quote, color, rects) =>
              onAddHighlight(quote, color, rects, pageNumber)
            }
            onUpdateHighlight={onUpdateHighlight}
            onDeleteHighlight={onDeleteHighlight}
          />
        );
      })}
    </div>
  );
};

interface PdfPageViewProps {
  pdfDoc: pdfjsLib.PDFDocumentProxy;
  docId: string;
  pageNumber: number;
  zoom: number;
  elevatePage: boolean;
  activeTool: AnnotationTool;
  inkColor: string;
  strokeWidth: number;
  textBoxes: TextBoxAnnotation[];
  highlights: HighlightAnnotation[];
  strokes: InkStroke[];
  activeBoxId: string | null;
  focusedAnnotationId: string | null;
  onFocusBox: (id: string | null) => void;
  onSpawnTextBox: (x: number, y: number) => void;
  onUpdateTextBox: (id: string, patch: Partial<TextBoxAnnotation>) => void;
  onDeleteTextBox: (id: string) => void;
  onDragEndScreenPoint: (id: string, clientX: number, clientY: number) => void;
  onAddStroke: (stroke: InkStroke) => void;
  onEraseStrokeIds: (ids: string[]) => void;
  onAddHighlight: (
    quote: string,
    color: HighlightColor,
    rects: Array<{ left: number; top: number; width: number; height: number }>
  ) => void;
  onUpdateHighlight: (id: string, patch: Partial<HighlightAnnotation>) => void;
  onDeleteHighlight: (id: string) => void;
}

const PdfPageView: React.FC<PdfPageViewProps> = ({
  pdfDoc,
  docId,
  pageNumber,
  zoom,
  elevatePage,
  activeTool,
  inkColor,
  strokeWidth,
  textBoxes,
  highlights,
  strokes,
  activeBoxId,
  focusedAnnotationId,
  onFocusBox,
  onSpawnTextBox,
  onUpdateTextBox,
  onDeleteTextBox,
  onDragEndScreenPoint,
  onAddStroke,
  onEraseStrokeIds,
  onAddHighlight,
  onUpdateHighlight,
  onDeleteHighlight,
}) => {
  const pageContainerRef = useRef<HTMLDivElement>(null);
  const pdfCanvasRef = useRef<HTMLCanvasElement>(null);
  const textLayerRef = useRef<HTMLDivElement>(null);
  const [dims, setDims] = useState({ width: 612 * zoom, height: 792 * zoom });
  const [selectionMenu, setSelectionMenu] = useState<{
    x: number;
    y: number;
    quote: string;
    rects: Array<{ left: number; top: number; width: number; height: number }>;
  } | null>(null);
  const [activeHighlightId, setActiveHighlightId] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState('');

  useEffect(() => {
    let cancelled = false;
    let renderTask: pdfjsLib.RenderTask | null = null;

    async function renderPage() {
      const page = await pdfDoc.getPage(pageNumber);
      if (cancelled) return;

      const viewport = page.getViewport({ scale: zoom * 1.25 });
      setDims({ width: viewport.width, height: viewport.height });

      const canvas = pdfCanvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.floor(viewport.width * dpr);
      canvas.height = Math.floor(viewport.height * dpr);
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      renderTask = page.render({ canvasContext: ctx, viewport, canvas });
      await renderTask.promise;
      if (cancelled) return;

      const textLayer = textLayerRef.current;
      if (textLayer) {
        textLayer.innerHTML = '';
        textLayer.style.width = `${viewport.width}px`;
        textLayer.style.height = `${viewport.height}px`;
        const textContent = await page.getTextContent();
        if (cancelled) return;

        for (const item of textContent.items) {
          if (!('str' in item) || !item.str) continue;
          const tx = pdfjsLib.Util.transform(viewport.transform, item.transform);
          const fontHeight = Math.hypot(tx[2], tx[3]);
          const span = document.createElement('span');
          span.textContent = item.str;
          span.style.left = `${tx[4]}px`;
          span.style.top = `${tx[5] - fontHeight}px`;
          span.style.fontSize = `${fontHeight}px`;
          span.style.fontFamily = 'sans-serif';
          const angle = Math.atan2(tx[1], tx[0]);
          if (Math.abs(angle) > 0.001) {
            span.style.transform = `rotate(${angle}rad)`;
          }
          textLayer.appendChild(span);
        }
      }
    }

    renderPage().catch(() => {});

    return () => {
      cancelled = true;
      renderTask?.cancel();
    };
  }, [pdfDoc, pageNumber, zoom]);

  const activeHighlight = highlights.find((h) => h.id === activeHighlightId) || null;

  const handlePageClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (activeTool !== 'text') {
      if (!(e.target as HTMLElement).closest('[data-highlight-overlay]')) {
        setActiveHighlightId(null);
      }
      return;
    }
    const container = pageContainerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const normX = (e.clientX - rect.left) / zoom;
    const normY = (e.clientY - rect.top) / zoom;
    onSpawnTextBox(normX, normY);
  };

  const handleMouseUp = () => {
    if (activeTool !== 'select') {
      setSelectionMenu(null);
      return;
    }
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.toString().trim()) {
      setSelectionMenu(null);
      return;
    }
    const container = pageContainerRef.current;
    if (!container) return;
    const range = sel.getRangeAt(0);
    if (!container.contains(range.commonAncestorContainer)) {
      setSelectionMenu(null);
      return;
    }

    const pageRect = container.getBoundingClientRect();
    const clientRects = Array.from(range.getClientRects()).filter(
      (r) => r.width > 1 && r.height > 1
    );
    if (clientRects.length === 0) return;

    const normalizedRects = clientRects.map((r) => ({
      left: (r.left - pageRect.left) / zoom,
      top: (r.top - pageRect.top) / zoom,
      width: r.width / zoom,
      height: r.height / zoom,
    }));

    const first = clientRects[0];
    setSelectionMenu({
      x: Math.max(12, (first.left - pageRect.left) / zoom),
      y: Math.max(8, (first.top - pageRect.top) / zoom - 44),
      quote: sel.toString().trim(),
      rects: normalizedRects,
    });
  };

  const baseWidth = dims.width / zoom;
  const baseHeight = dims.height / zoom;

  return (
    <div
      ref={pageContainerRef}
      data-pdf-page={pageNumber}
      onClick={handlePageClick}
      onMouseUp={handleMouseUp}
      style={
        {
          width: `${dims.width}px`,
          height: `${dims.height}px`,
          '--pdf-print-width': `${dims.width}px`,
          '--pdf-aspect-ratio': `${baseWidth} / ${baseHeight}`,
        } as React.CSSProperties
      }
      className={`print-page-sheet pdf-print-sheet relative bg-white border border-slate-200 shadow-sm overflow-visible ${
        elevatePage ? 'z-30' : 'z-10'
      } ${activeTool === 'text' ? 'cursor-text' : ''}`}
    >
      {/* Rendered PDF Bitmap */}
      <canvas ref={pdfCanvasRef} className="block pdf-print-bitmap" />

      {/* Selectable PDF Text Layer */}
      <div ref={textLayerRef} className="pdf-text-layer z-10 print:hidden" />

      {/* Screen Highlight Rectangles (mix-blend-multiply keeps underlying PDF text razor sharp) */}
      <div className="print:hidden pointer-events-none absolute inset-0 z-15">
        {highlights.map((hl) => {
          const palette = HIGHLIGHT_PALETTE[hl.color] || HIGHLIGHT_PALETTE.yellow;
          return (hl.rects || []).map((r, idx) => (
            <button
              key={`${hl.id}_${idx}`}
              type="button"
              data-highlight-overlay
              data-annotation-id={hl.id}
              onClick={(e) => {
                e.stopPropagation();
                setActiveHighlightId(hl.id);
                setNoteDraft(hl.note || '');
              }}
              style={{
                left: `${r.left * zoom}px`,
                top: `${r.top * zoom}px`,
                width: `${r.width * zoom}px`,
                height: `${r.height * zoom}px`,
                backgroundColor: palette.fill,
                borderBottom: `1.5px solid ${palette.border}`,
              }}
              className={`pointer-events-auto absolute rounded-[2px] mix-blend-multiply cursor-pointer ${
                focusedAnnotationId === hl.id ? 'ring-2 ring-blue-700' : ''
              }`}
            >
              {idx === 0 && hl.note && (
                <span className="no-print -top-2 -right-2 absolute w-4 h-4 bg-slate-900 text-white rounded-full flex items-center justify-center">
                  <MessageSquare className="w-2.5 h-2.5" />
                </span>
              )}
            </button>
          ));
        })}
      </div>

      {/* Pointer Events Ink Layer */}
      <InkCanvas
        width={dims.width}
        height={dims.height}
        zoom={zoom}
        docId={docId}
        pageNumber={pageNumber}
        activeTool={activeTool}
        inkColor={inkColor}
        strokeWidth={strokeWidth}
        strokes={strokes}
        onAddStroke={onAddStroke}
        onEraseStrokeIds={onEraseStrokeIds}
      />

      {/* Free-Form Keyboard Text Boxes (supports cross-page drag transfer) */}
      <div className="print:hidden">
        <TextBoxOverlay
          boxes={textBoxes}
          zoom={zoom}
          activeBoxId={activeBoxId}
          focusedAnnotationId={focusedAnnotationId}
          onFocusBox={onFocusBox}
          onUpdateBox={onUpdateTextBox}
          onDeleteBox={onDeleteTextBox}
          onDragEndScreenPoint={onDragEndScreenPoint}
        />
      </div>

      {/* High-Fidelity Vector SVG Annotation Mirror for Browser-Based PDF Printing */}
      <PrintAnnotationSvgLayer
        baseWidth={baseWidth}
        baseHeight={baseHeight}
        highlights={highlights}
        strokes={strokes}
        textBoxes={textBoxes}
        includeTextBoxes={true}
      />

      {/* Page Footer Label (Hidden on Print) */}
      <div className="no-print absolute bottom-2 right-3 text-[11px] font-mono tabular-nums text-slate-400 pointer-events-none">
        Page {pageNumber}
      </div>

      {/* Selection Highlight Popover (8 translucent color choices) */}
      {selectionMenu && (
        <div
          onMouseDown={(e) => e.preventDefault()}
          onClick={(e) => e.stopPropagation()}
          style={{
            left: `${selectionMenu.x * zoom}px`,
            top: `${selectionMenu.y * zoom}px`,
          }}
          className="no-print absolute z-40 flex items-center gap-1.5 px-3 py-1.5 bg-white border border-slate-200 rounded-lg shadow-md"
        >
          <span className="text-[11px] font-medium text-slate-600 pr-1">Highlight</span>
          {HIGHLIGHT_KEYS.map((c) => (
            <button
              key={c}
              type="button"
              title={HIGHLIGHT_PALETTE[c].label}
              onClick={() => {
                onAddHighlight(selectionMenu.quote, c, selectionMenu.rects);
                window.getSelection()?.removeAllRanges();
                setSelectionMenu(null);
              }}
              className="w-5 h-5 rounded-full border border-slate-300 cursor-pointer hover:scale-110 transition-transform"
              style={{ backgroundColor: HIGHLIGHT_PALETTE[c].swatch }}
              aria-label={`Highlight ${HIGHLIGHT_PALETTE[c].label}`}
            />
          ))}
        </div>
      )}

      {/* Highlight Sticky Note & Recolor Editor */}
      {activeHighlight && activeHighlight.rects?.[0] && (
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            left: `${Math.min(dims.width - 270, activeHighlight.rects[0].left * zoom)}px`,
            top: `${(activeHighlight.rects[0].top + activeHighlight.rects[0].height) * zoom + 8}px`,
          }}
          className="no-print absolute z-40 w-68 bg-white border border-slate-200 rounded-lg shadow-lg p-3"
        >
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-slate-900">Highlight &amp; Note</span>
            <button
              type="button"
              onClick={() => setActiveHighlightId(null)}
              className="p-0.5 text-slate-400 hover:text-slate-700 cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="flex items-center gap-1.5 mb-2.5">
            {HIGHLIGHT_KEYS.map((c) => (
              <button
                key={c}
                type="button"
                title={HIGHLIGHT_PALETTE[c].label}
                onClick={() => onUpdateHighlight(activeHighlight.id, { color: c })}
                className={`w-4.5 h-4.5 rounded-full border cursor-pointer transition-transform ${
                  activeHighlight.color === c
                    ? 'ring-2 ring-blue-700 ring-offset-1 border-white scale-110'
                    : 'border-slate-300 hover:scale-110'
                }`}
                style={{ backgroundColor: HIGHLIGHT_PALETTE[c].swatch }}
                aria-label={`Change color to ${HIGHLIGHT_PALETTE[c].label}`}
              />
            ))}
          </div>

          <textarea
            value={noteDraft}
            onChange={(e) => setNoteDraft(e.target.value)}
            placeholder="Attach supplementary note..."
            rows={3}
            className="w-full p-2 text-xs text-slate-800 border border-slate-200 rounded-md outline-none focus:border-blue-700 resize-none"
          />
          <div className="flex items-center justify-between mt-2">
            <button
              type="button"
              onClick={() => {
                onDeleteHighlight(activeHighlight.id);
                setActiveHighlightId(null);
              }}
              className="inline-flex items-center gap-1 text-xs font-medium text-red-600 hover:text-red-700 cursor-pointer"
            >
              <Trash2 className="w-3 h-3" />
              Remove
            </button>
            <button
              type="button"
              onClick={() => {
                onUpdateHighlight(activeHighlight.id, { note: noteDraft });
                setActiveHighlightId(null);
              }}
              className="px-3 py-1 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-md cursor-pointer"
            >
              Save Note
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
