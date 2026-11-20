import React, { useEffect, useRef, useState } from 'react';
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

interface WebDocumentSurfaceProps {
  docId: string;
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
  onSpawnTextBox: (x: number, y: number) => void;
  onUpdateTextBox: (id: string, patch: Partial<TextBoxAnnotation>) => void;
  onDeleteTextBox: (id: string) => void;
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

const BASE_WIDTH = 816;
const HIGHLIGHT_KEYS = Object.keys(HIGHLIGHT_PALETTE) as HighlightColor[];

export const WebDocumentSurface: React.FC<WebDocumentSurfaceProps> = ({
  docId,
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
  const sheetRef = useRef<HTMLDivElement>(null);
  const [sheetHeight, setSheetHeight] = useState(1120);
  const [selectionMenu, setSelectionMenu] = useState<{
    x: number;
    y: number;
    quote: string;
    rects: Array<{ left: number; top: number; width: number; height: number }>;
  } | null>(null);
  const [activeHighlightId, setActiveHighlightId] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState('');

  useEffect(() => {
    const el = sheetRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setSheetHeight(Math.max(1056, el.scrollHeight));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [zoom]);

  const activeHighlight = highlights.find((h) => h.id === activeHighlightId) || null;

  const handleSheetClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (activeTool !== 'text') {
      if (!(e.target as HTMLElement).closest('[data-highlight-overlay]')) {
        setActiveHighlightId(null);
      }
      return;
    }
    const sheet = sheetRef.current;
    if (!sheet) return;
    const rect = sheet.getBoundingClientRect();
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
    const sheet = sheetRef.current;
    if (!sheet) return;
    const range = sel.getRangeAt(0);
    if (!sheet.contains(range.commonAncestorContainer)) {
      setSelectionMenu(null);
      return;
    }

    const sheetRect = sheet.getBoundingClientRect();
    const clientRects = Array.from(range.getClientRects()).filter(
      (r) => r.width > 1 && r.height > 1
    );
    if (clientRects.length === 0) return;

    const normalizedRects = clientRects.map((r) => ({
      left: (r.left - sheetRect.left) / zoom,
      top: (r.top - sheetRect.top) / zoom,
      width: r.width / zoom,
      height: r.height / zoom,
    }));

    const first = clientRects[0];
    setSelectionMenu({
      x: Math.max(16, (first.left - sheetRect.left) / zoom),
      y: Math.max(12, (first.top - sheetRect.top) / zoom - 44),
      quote: sel.toString().trim(),
      rects: normalizedRects,
    });
  };

  const applyHighlightColor = (color: HighlightColor) => {
    if (!selectionMenu) return;
    onAddHighlight(selectionMenu.quote, color, selectionMenu.rects);
    window.getSelection()?.removeAllRanges();
    setSelectionMenu(null);
  };

  return (
    <div className="flex flex-col items-center py-8 px-4 print:py-0 print:px-0">
      <div
        ref={sheetRef}
        onClick={handleSheetClick}
        onMouseUp={handleMouseUp}
        style={{
          width: `${BASE_WIDTH * zoom}px`,
          minHeight: `${1080 * zoom}px`,
        }}
        className={`print-page-sheet relative bg-white border border-slate-200 shadow-sm rounded-sm overflow-visible ${
          activeTool === 'text' ? 'cursor-text' : ''
        }`}
      >
        {/* Scaled Editorial Web Page Content */}
        <article
          style={{
            width: `${BASE_WIDTH}px`,
            transform: `scale(${zoom})`,
            transformOrigin: 'top left',
          }}
          className="px-14 py-12 select-text"
        >
          <div className="flex items-center gap-2 text-xs text-slate-500 mb-4">
            <span>Architecture Monograph</span>
            <span aria-hidden="true">·</span>
            <span>Web Capture</span>
            <span aria-hidden="true">·</span>
            <span>6 min read</span>
          </div>

          <h1 className="font-display text-3xl font-bold tracking-tight text-slate-900 leading-tight mb-4 max-w-2xl">
            Designing Zero-Latency Annotation Layers for Modern Browsers
          </h1>

          <p className="font-editorial text-[17px] leading-relaxed text-slate-700 mb-8">
            Web pages and embedded PDFs present fundamentally different rendering trees, yet users
            expect a unified annotation surface: click anywhere to type free-form text, ink smoothly
            with a mouse or stylus, highlight key passages, and export a clean printable PDF.
          </p>

          <div className="border-t border-slate-200 pt-6 mb-8">
            <h2 className="font-display text-lg font-semibold text-slate-900 mb-3">
              01. Free-Form Keyboard Placement Anywhere on the Canvas
            </h2>
            <p className="font-editorial text-[15.5px] leading-relaxed text-slate-700 mb-4">
              Traditional annotation tools trap user notes inside rigid sidebar comment threads. By
              switching to the <strong>Text Box</strong> tool and clicking anywhere on this page,
              you spawn an inline, draggable text stamp anchored directly at normalized document
              coordinates. Grab the box border or handle to move it anywhere across the page or
              into the margins.
            </p>
          </div>

          {/* Interactive Architecture Table */}
          <div className="mb-8 border border-slate-200 rounded-lg overflow-hidden">
            <div className="bg-slate-50 px-4 py-2.5 border-b border-slate-200 flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-800">
                Table 1. Storage &amp; Event Pipeline Comparison
              </span>
              <span className="text-[11px] font-mono text-slate-500 tabular-nums">
                MV3 Runtime Spec
              </span>
            </div>
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500 bg-white">
                  <th className="py-2.5 px-4 font-semibold">Annotation Layer</th>
                  <th className="py-2.5 px-4 font-semibold">Input Mechanism</th>
                  <th className="py-2.5 px-4 font-semibold">Persistence Tier</th>
                  <th className="py-2.5 px-4 font-semibold text-right">Sync Latency</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700">
                <tr>
                  <td className="py-2.5 px-4 font-medium text-slate-900">Free-Form Text Boxes</td>
                  <td className="py-2.5 px-4">Click + Keyboard Input</td>
                  <td className="py-2.5 px-4 font-mono text-[11px]">chrome.storage.local</td>
                  <td className="py-2.5 px-4 text-right font-mono tabular-nums">4 ms</td>
                </tr>
                <tr>
                  <td className="py-2.5 px-4 font-medium text-slate-900">Stylus &amp; Mouse Ink</td>
                  <td className="py-2.5 px-4">PointerEvents + Pressure</td>
                  <td className="py-2.5 px-4 font-mono text-[11px]">IndexedDB (Vector + PNG)</td>
                  <td className="py-2.5 px-4 text-right font-mono tabular-nums">12 ms</td>
                </tr>
                <tr>
                  <td className="py-2.5 px-4 font-medium text-slate-900">Text Highlights</td>
                  <td className="py-2.5 px-4">Selection Range + TreeWalker</td>
                  <td className="py-2.5 px-4 font-mono text-[11px]">chrome.storage.local</td>
                  <td className="py-2.5 px-4 text-right font-mono tabular-nums">6 ms</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="mb-8">
            <h2 className="font-display text-lg font-semibold text-slate-900 mb-3">
              02. Pointer Events Inking &amp; Touch Screen Ergonomics
            </h2>
            <p className="font-editorial text-[15.5px] leading-relaxed text-slate-700 mb-4">
              Active drawing canvases bind <code className="font-mono text-xs bg-slate-100 px-1.5 py-0.5 rounded">pointerdown</code>,{' '}
              <code className="font-mono text-xs bg-slate-100 px-1.5 py-0.5 rounded">pointermove</code>, and{' '}
              <code className="font-mono text-xs bg-slate-100 px-1.5 py-0.5 rounded">pointerup</code> alongside{' '}
              <code className="font-mono text-xs bg-slate-100 px-1.5 py-0.5 rounded">touch-action: none</code>.
              Highlighter ink uses multiply compositing so underlying black text remains crisp and
              completely legible beneath any highlight color.
            </p>
          </div>

          {/* Open Sketch Box for Freehand Drawing or Text Stamping */}
          <div className="border border-dashed border-slate-300 rounded-lg p-6 bg-slate-50/50">
            <div className="text-xs font-semibold text-slate-600 mb-1">
              Sandbox Diagram Zone
            </div>
            <p className="text-xs text-slate-500 mb-16">
              Select the Pen, Ink Mark, or Text Box tool above to sketch diagrams or type labels
              directly inside this frame. Everything scales with zoom and exports to PDF.
            </p>
            <div className="flex items-center justify-between text-[11px] font-mono text-slate-400 pt-8 border-t border-slate-200/80">
              <span>Viewport Anchor: 1.0x Normalized</span>
              <span>Print Output: Composite Vector + HTML</span>
            </div>
          </div>
        </article>

        {/* Normalized Highlight Overlay Rects (mix-blend-multiply keeps underlying text crisp) */}
        <div className="print:hidden pointer-events-none absolute inset-0 z-10">
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
                title={hl.note ? `Note: ${hl.note}` : 'Click to add note or change color'}
                className={`pointer-events-auto absolute rounded-[2px] mix-blend-multiply cursor-pointer transition-all ${
                  focusedAnnotationId === hl.id ? 'ring-2 ring-blue-700 ring-offset-1' : ''
                }`}
              >
                {idx === 0 && hl.note && (
                  <span className="no-print -top-2 -right-2 absolute w-4 h-4 bg-slate-900 text-white rounded-full flex items-center justify-center shadow-xs">
                    <MessageSquare className="w-2.5 h-2.5" />
                  </span>
                )}
              </button>
            ));
          })}
        </div>

        {/* High-DPI Pointer Events Ink Canvas */}
        <InkCanvas
          width={BASE_WIDTH * zoom}
          height={sheetHeight}
          zoom={zoom}
          docId={docId}
          activeTool={activeTool}
          inkColor={inkColor}
          strokeWidth={strokeWidth}
          strokes={strokes}
          onAddStroke={onAddStroke}
          onEraseStrokeIds={onEraseStrokeIds}
        />

        {/* Free-Form Keyboard Text Boxes */}
        <TextBoxOverlay
          boxes={textBoxes}
          zoom={zoom}
          activeBoxId={activeBoxId}
          focusedAnnotationId={focusedAnnotationId}
          onFocusBox={onFocusBox}
          onUpdateBox={onUpdateTextBox}
          onDeleteBox={onDeleteTextBox}
        />

        {/* Vector SVG Print Mirror for Highlights & Ink Strokes */}
        <PrintAnnotationSvgLayer
          baseWidth={BASE_WIDTH}
          baseHeight={sheetHeight / zoom}
          highlights={highlights}
          strokes={strokes}
          textBoxes={textBoxes}
          includeTextBoxes={false}
        />

        {/* Floating Selection Highlight Popover (8 translucent color choices) */}
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
                onClick={() => applyHighlightColor(c)}
                className="w-5 h-5 rounded-full border border-slate-300 cursor-pointer hover:scale-110 transition-transform"
                style={{ backgroundColor: HIGHLIGHT_PALETTE[c].swatch }}
                aria-label={`Highlight ${HIGHLIGHT_PALETTE[c].label}`}
              />
            ))}
          </div>
        )}

        {/* Sticky Note & Recolor Popover for Clicked Highlight */}
        {activeHighlight && activeHighlight.rects?.[0] && (
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              left: `${Math.min(BASE_WIDTH * zoom - 270, activeHighlight.rects[0].left * zoom)}px`,
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
    </div>
  );
};
