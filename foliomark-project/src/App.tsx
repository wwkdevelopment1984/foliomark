import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnnotationToolbar } from './components/AnnotationToolbar';
import { ExtensionWorkbench } from './components/ExtensionWorkbench';
import { PdfDocumentSurface } from './components/PdfDocumentSurface';
import { ScreenCaptureOverlay } from './components/ScreenCaptureOverlay';
import { SidebarDashboard } from './components/SidebarDashboard';
import { TopBar, type AppView } from './components/TopBar';
import { WebDocumentSurface } from './components/WebDocumentSurface';
import {
  captureDisplayScreen,
  captureStudioDocument,
  type CaptureResult,
  type ViewportRect,
} from './utils/screenCapture';
import type {
  AnnotationTool,
  DocumentAnnotations,
  DocumentKind,
  DocumentMeta,
  HighlightAnnotation,
  HighlightColor,
  InkStroke,
  TextBoxAnnotation,
  TextBoxBgStyle,
} from './types/annotation';
import { createSampleSpecPdfBytes } from './utils/samplePdf';
import {
  listAllAnnotatedDocuments,
  loadDocumentAnnotations,
  saveDocumentMetadata,
  saveInkStrokes,
} from './utils/storage';

const WEB_DOC_META: DocumentMeta = {
  docId: 'web:foliomark-architecture',
  title: 'Zero-Latency Annotation Layers (Web Page)',
  url: 'https://engineering.foliomark.dev/monograph',
  kind: 'web',
  updatedAt: Date.now(),
};

const SAMPLE_PDF_META: DocumentMeta = {
  docId: 'pdf:spec-2026-11.pdf',
  title: 'SPEC-2026-11 Coordinate Pipeline.pdf',
  url: 'file:///SPEC-2026-11.pdf',
  kind: 'pdf',
  updatedAt: Date.now(),
};

export default function App() {
  const [activeView, setActiveView] = useState<AppView>('studio');
  const [docKind, setDocKind] = useState<DocumentKind>('web');
  const [currentMeta, setCurrentMeta] = useState<DocumentMeta>(WEB_DOC_META);
  const [samplePdfBytes, setSamplePdfBytes] = useState<Uint8Array | null>(null);
  const [uploadedPdfBytes, setUploadedPdfBytes] = useState<Uint8Array | null>(null);
  const [uploadedPdfMeta, setUploadedPdfMeta] = useState<DocumentMeta | null>(null);

  const [activeTool, setActiveTool] = useState<AnnotationTool>('select');
  const [toolColors, setToolColors] = useState<Record<AnnotationTool, string>>({
    select: '#facc15',
    text: '#0f172a',
    pen: '#1d4ed8',
    marker: '#facc15',
    eraser: '#64748b',
  });
  const [strokeWidth, setStrokeWidth] = useState(3);
  const [defaultTextBg, setDefaultTextBg] = useState<TextBoxBgStyle>('transparent');
  const [zoom, setZoom] = useState(1);
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const [textBoxes, setTextBoxes] = useState<TextBoxAnnotation[]>([]);
  const [highlights, setHighlights] = useState<HighlightAnnotation[]>([]);
  const [strokes, setStrokes] = useState<InkStroke[]>([]);
  const [allSavedDocs, setAllSavedDocs] = useState<DocumentAnnotations[]>([]);

  const [activeBoxId, setActiveBoxId] = useState<string | null>(null);
  const [focusedAnnotationId, setFocusedAnnotationId] = useState<string | null>(null);
  const [selectingCaptureArea, setSelectingCaptureArea] = useState(false);
  const [captureResult, setCaptureResult] = useState<CaptureResult | null>(null);
  const [captureError, setCaptureError] = useState<string | null>(null);

  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Build sample multi-page PDF once
  useEffect(() => {
    createSampleSpecPdfBytes()
      .then((bytes) => setSamplePdfBytes(bytes))
      .catch((err) => console.warn('[FolioMark] Sample PDF init error:', err));
  }, []);

  const refreshSavedIndex = useCallback(async () => {
    const docs = await listAllAnnotatedDocuments();
    setAllSavedDocs(docs);
  }, []);

  // Hydrate annotations whenever currentMeta changes
  useEffect(() => {
    let cancelled = false;
    loadDocumentAnnotations(currentMeta).then((loaded) => {
      if (cancelled) return;
      setTextBoxes(loaded.textBoxes);
      setHighlights(loaded.highlights);
      setStrokes(loaded.strokes);
      refreshSavedIndex();
    });
    return () => {
      cancelled = true;
    };
  }, [currentMeta, refreshSavedIndex]);

  // Keyboard shortcuts for fast tool switching (V, T, P, M, E)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)
      ) {
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      const k = e.key.toLowerCase();
      if (k === 'v') setActiveTool('select');
      else if (k === 't') setActiveTool('text');
      else if (k === 'p') setActiveTool('pen');
      else if (k === 'm') setActiveTool('marker');
      else if (k === 'e') setActiveTool('eraser');
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const persistMetadata = useCallback(
    (nextBoxes: TextBoxAnnotation[], nextHighlights: HighlightAnnotation[]) => {
      saveDocumentMetadata(currentMeta, nextBoxes, nextHighlights);
      refreshSavedIndex();
    },
    [currentMeta, refreshSavedIndex]
  );

  const persistStrokes = useCallback(
    async (nextStrokes: InkStroke[]) => {
      await saveInkStrokes(currentMeta.docId, nextStrokes);
      refreshSavedIndex();
    },
    [currentMeta.docId, refreshSavedIndex]
  );

  const handleSwitchDocKind = (kind: DocumentKind) => {
    setDocKind(kind);
    setActiveBoxId(null);
    setFocusedAnnotationId(null);
    if (kind === 'web') {
      setCurrentMeta(WEB_DOC_META);
    } else {
      setCurrentMeta(uploadedPdfMeta || SAMPLE_PDF_META);
    }
  };

  const handleUploadPdf = async (file: File) => {
    const buffer = await file.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    const meta: DocumentMeta = {
      docId: `pdf:${file.name}:${file.size}`,
      title: file.name,
      url: `file:///${file.name}`,
      kind: 'pdf',
      updatedAt: Date.now(),
    };
    setUploadedPdfBytes(bytes);
    setUploadedPdfMeta(meta);
    setDocKind('pdf');
    setCurrentMeta(meta);
  };

  // Free-form keyboard text box operations
  const handleSpawnTextBox = (x: number, y: number, pageNumber?: number) => {
    const id = `txt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    const newBox: TextBoxAnnotation = {
      id,
      docId: currentMeta.docId,
      x,
      y,
      pageNumber,
      text: '',
      fontSize: 15,
      color: toolColors.text,
      bgStyle: defaultTextBg,
      createdAt: Date.now(),
    };
    const next = [...textBoxes, newBox];
    setTextBoxes(next);
    setActiveBoxId(id);
    persistMetadata(next, highlights);
  };

  const handleUpdateTextBox = (id: string, patch: Partial<TextBoxAnnotation>) => {
    const next = textBoxes.map((b) => (b.id === id ? { ...b, ...patch } : b));
    setTextBoxes(next);
    persistMetadata(next, highlights);
  };

  const handleDeleteTextBox = (id: string) => {
    const next = textBoxes.filter((b) => b.id !== id);
    setTextBoxes(next);
    if (activeBoxId === id) setActiveBoxId(null);
    persistMetadata(next, highlights);
  };

  // Ink canvas operations
  const handleAddStroke = (stroke: InkStroke) => {
    const next = [...strokes, stroke];
    setStrokes(next);
    persistStrokes(next);
  };

  const handleEraseStrokeIds = (ids: string[]) => {
    const idSet = new Set(ids);
    const next = strokes.filter((s) => !idSet.has(s.id));
    if (next.length !== strokes.length) {
      setStrokes(next);
      persistStrokes(next);
    }
  };

  const handleUndoInk = () => {
    if (strokes.length === 0) return;
    const next = strokes.slice(0, -1);
    setStrokes(next);
    persistStrokes(next);
  };

  // Highlight & sticky note operations
  const handleAddHighlight = (
    quote: string,
    color: HighlightColor,
    rects: Array<{ left: number; top: number; width: number; height: number }>,
    pageNumber?: number
  ) => {
    const id = `hl_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    const next: HighlightAnnotation[] = [
      ...highlights,
      {
        id,
        docId: currentMeta.docId,
        pageNumber,
        quote,
        color,
        note: '',
        rects,
        createdAt: Date.now(),
      },
    ];
    setHighlights(next);
    persistMetadata(textBoxes, next);
  };

  const handleUpdateHighlight = (id: string, patch: Partial<HighlightAnnotation>) => {
    const next = highlights.map((h) => (h.id === id ? { ...h, ...patch } : h));
    setHighlights(next);
    persistMetadata(textBoxes, next);
  };

  const handleDeleteHighlight = (id: string) => {
    const next = highlights.filter((h) => h.id !== id);
    setHighlights(next);
    persistMetadata(textBoxes, next);
  };

  const handleClearDocument = () => {
    setTextBoxes([]);
    setHighlights([]);
    setStrokes([]);
    persistMetadata([], []);
    persistStrokes([]);
  };

  const handleJumpToAnnotation = (id: string) => {
    setFocusedAnnotationId(id);
    const el =
      document.querySelector(`[data-textbox-id="${id}"]`) ||
      document.querySelector(`[data-annotation-id="${id}"]`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    setTimeout(() => setFocusedAnnotationId(null), 1800);
  };

  const handleExportPdf = () => {
    if (activeView !== 'studio') {
      setActiveView('studio');
      setTimeout(() => window.print(), 120);
      return;
    }
    window.print();
  };

  const handleCaptureStudioFull = async () => {
    if (!scrollContainerRef.current) return;
    setCaptureError(null);
    setActiveBoxId(null);
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    try {
      const result = await captureStudioDocument(scrollContainerRef.current);
      setCaptureResult(result);
    } catch (err) {
      setCaptureError(err instanceof Error ? err.message : 'Unable to capture view.');
    }
  };

  const handleCompleteAreaSelect = async (rect: ViewportRect) => {
    setSelectingCaptureArea(false);
    if (!scrollContainerRef.current) return;
    setCaptureError(null);
    setActiveBoxId(null);
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    try {
      const result = await captureStudioDocument(scrollContainerRef.current, rect);
      setCaptureResult(result);
    } catch (err) {
      setCaptureError(err instanceof Error ? err.message : 'Unable to capture selected area.');
    }
  };

  const handleCaptureDisplay = async () => {
    setCaptureError(null);
    try {
      const result = await captureDisplayScreen();
      setCaptureResult(result);
    } catch (err) {
      setCaptureError(
        err instanceof Error ? err.message : 'Unable to capture display screen.'
      );
    }
  };

  const activePdfBytes = useMemo(() => {
    if (currentMeta.docId === SAMPLE_PDF_META.docId) return samplePdfBytes;
    return uploadedPdfBytes || samplePdfBytes;
  }, [currentMeta.docId, samplePdfBytes, uploadedPdfBytes]);

  return (
    <div className="min-h-screen h-screen flex flex-col bg-[#F4F5F7] text-slate-900 overflow-hidden print:h-auto print:overflow-visible print:bg-white">
      <TopBar
        activeView={activeView}
        onChangeView={setActiveView}
        onExportPdf={handleExportPdf}
      />

      {activeView === 'studio' ? (
        <>
          <AnnotationToolbar
            docKind={docKind}
            onSwitchDocKind={handleSwitchDocKind}
            onUploadPdf={handleUploadPdf}
            activeTool={activeTool}
            onSelectTool={setActiveTool}
            toolColors={toolColors}
            onChangeToolColor={(color) =>
              setToolColors((prev) => ({ ...prev, [activeTool]: color }))
            }
            strokeWidth={strokeWidth}
            onChangeStrokeWidth={setStrokeWidth}
            defaultTextBg={defaultTextBg}
            onChangeDefaultTextBg={setDefaultTextBg}
            zoom={zoom}
            onChangeZoom={setZoom}
            canUndoInk={strokes.length > 0}
            onUndoInk={handleUndoInk}
            onClearDocument={handleClearDocument}
            onCaptureStudioFull={handleCaptureStudioFull}
            onCaptureStudioArea={() => {
              setCaptureError(null);
              setCaptureResult(null);
              setSelectingCaptureArea(true);
            }}
            onCaptureDisplay={handleCaptureDisplay}
            sidebarOpen={sidebarOpen}
            onToggleSidebar={() => setSidebarOpen((v) => !v)}
          />

          <div className="flex-1 flex overflow-hidden print:block print:overflow-visible">
            {/* Scrollable Document Canvas */}
            <main
              ref={scrollContainerRef}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const file = e.dataTransfer.files?.[0];
                if (file && file.type === 'application/pdf') {
                  handleUploadPdf(file);
                }
              }}
              className="print-only-container flex-1 overflow-auto relative"
            >
              {/* Subtle Contextual Mode Hint */}
              <div className="no-print sticky top-3 z-20 mx-auto w-fit px-3 py-1 bg-white/90 backdrop-blur-xs border border-slate-200 rounded-md text-[11px] text-slate-600 shadow-xs mt-3">
                {activeTool === 'select' &&
                  'Select text to highlight · Drag any text box border or handle to move it anywhere'}
                {activeTool === 'text' &&
                  'Click anywhere on the document or PDF to spawn a movable keyboard text box'}
                {activeTool === 'pen' &&
                  'Draw with mouse, touch, or pressure-sensitive stylus'}
                {activeTool === 'marker' &&
                  'Draw translucent multiply-blended ink highlights without covering text'}
                {activeTool === 'eraser' &&
                  'Click or drag across any ink stroke to erase it'}
              </div>

              {docKind === 'web' ? (
                <WebDocumentSurface
                  docId={currentMeta.docId}
                  zoom={zoom}
                  activeTool={activeTool}
                  inkColor={activeTool === 'marker' ? toolColors.marker : toolColors.pen}
                  strokeWidth={strokeWidth}
                  textBoxes={textBoxes}
                  highlights={highlights}
                  strokes={strokes}
                  activeBoxId={activeBoxId}
                  focusedAnnotationId={focusedAnnotationId}
                  onFocusBox={setActiveBoxId}
                  onSpawnTextBox={(x, y) => handleSpawnTextBox(x, y)}
                  onUpdateTextBox={handleUpdateTextBox}
                  onDeleteTextBox={handleDeleteTextBox}
                  onAddStroke={handleAddStroke}
                  onEraseStrokeIds={handleEraseStrokeIds}
                  onAddHighlight={handleAddHighlight}
                  onUpdateHighlight={handleUpdateHighlight}
                  onDeleteHighlight={handleDeleteHighlight}
                />
              ) : (
                <PdfDocumentSurface
                  docId={currentMeta.docId}
                  pdfBytes={activePdfBytes}
                  zoom={zoom}
                  activeTool={activeTool}
                  inkColor={activeTool === 'marker' ? toolColors.marker : toolColors.pen}
                  strokeWidth={strokeWidth}
                  textBoxes={textBoxes}
                  highlights={highlights}
                  strokes={strokes}
                  activeBoxId={activeBoxId}
                  focusedAnnotationId={focusedAnnotationId}
                  onFocusBox={setActiveBoxId}
                  onSpawnTextBox={(x, y, page) => handleSpawnTextBox(x, y, page)}
                  onUpdateTextBox={handleUpdateTextBox}
                  onDeleteTextBox={handleDeleteTextBox}
                  onAddStroke={handleAddStroke}
                  onEraseStrokeIds={handleEraseStrokeIds}
                  onAddHighlight={handleAddHighlight}
                  onUpdateHighlight={handleUpdateHighlight}
                  onDeleteHighlight={handleDeleteHighlight}
                />
              )}
            </main>

            {/* Right Sidebar Dashboard */}
            {sidebarOpen && (
              <SidebarDashboard
                currentDocTitle={currentMeta.title}
                currentDocUrl={currentMeta.url}
                currentDocId={currentMeta.docId}
                textBoxes={textBoxes}
                highlights={highlights}
                strokeCount={strokes.length}
                allSavedDocs={allSavedDocs}
                onJumpToAnnotation={handleJumpToAnnotation}
                onDeleteTextBox={handleDeleteTextBox}
                onUpdateTextBoxText={(id, text) => handleUpdateTextBox(id, { text })}
                onUpdateHighlightNote={(id, note) => handleUpdateHighlight(id, { note })}
                onDeleteHighlight={handleDeleteHighlight}
                onClearInk={() => {
                  setStrokes([]);
                  persistStrokes([]);
                }}
                onExportPdf={handleExportPdf}
                onActivateTextTool={() => setActiveTool('text')}
              />
            )}
          </div>
        </>
      ) : (
        <ExtensionWorkbench mode={activeView} />
      )}

      <ScreenCaptureOverlay
        selectingArea={selectingCaptureArea}
        captureResult={captureResult}
        captureError={captureError}
        onCancelSelect={() => setSelectingCaptureArea(false)}
        onCompleteAreaSelect={handleCompleteAreaSelect}
        onRetakeArea={() => {
          setCaptureResult(null);
          setCaptureError(null);
          setSelectingCaptureArea(true);
        }}
        onFallbackStudioFull={() => {
          setCaptureError(null);
          handleCaptureStudioFull();
        }}
        onClosePreview={() => {
          setCaptureResult(null);
          setCaptureError(null);
        }}
      />
    </div>
  );
}
