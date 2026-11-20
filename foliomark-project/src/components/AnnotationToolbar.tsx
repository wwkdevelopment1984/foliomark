import React, { useEffect, useRef, useState } from 'react';
import {
  Camera,
  ChevronDown,
  Crop,
  Eraser,
  FileText,
  Globe,
  Highlighter,
  Monitor,
  MousePointer2,
  PanelRight,
  PenTool,
  Trash2,
  Type,
  Undo2,
  Upload,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import type { AnnotationTool, DocumentKind, TextBoxBgStyle } from '../types/annotation';

interface AnnotationToolbarProps {
  docKind: DocumentKind;
  onSwitchDocKind: (kind: DocumentKind) => void;
  onUploadPdf: (file: File) => void;
  activeTool: AnnotationTool;
  onSelectTool: (tool: AnnotationTool) => void;
  toolColors: Record<AnnotationTool, string>;
  onChangeToolColor: (color: string) => void;
  strokeWidth: number;
  onChangeStrokeWidth: (w: number) => void;
  defaultTextBg: TextBoxBgStyle;
  onChangeDefaultTextBg: (bg: TextBoxBgStyle) => void;
  zoom: number;
  onChangeZoom: (zoom: number) => void;
  canUndoInk: boolean;
  onUndoInk: () => void;
  onClearDocument: () => void;
  onCaptureStudioFull: () => void;
  onCaptureStudioArea: () => void;
  onCaptureDisplay: () => void;
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
}

const COLOR_SWATCHES = [
  { hex: '#0f172a', name: 'Ink Black' },
  { hex: '#475569', name: 'Slate Gray' },
  { hex: '#1d4ed8', name: 'Cobalt Blue' },
  { hex: '#0284c7', name: 'Sky Blue' },
  { hex: '#0d9488', name: 'Teal' },
  { hex: '#15803d', name: 'Forest Green' },
  { hex: '#4ade80', name: 'Mint Highlighter' },
  { hex: '#facc15', name: 'Canary Yellow' },
  { hex: '#f59e0b', name: 'Warm Amber' },
  { hex: '#f97316', name: 'Coral Orange' },
  { hex: '#dc2626', name: 'Crimson Red' },
  { hex: '#e11d48', name: 'Rose Pink' },
  { hex: '#7c3aed', name: 'Violet' },
];

export const AnnotationToolbar: React.FC<AnnotationToolbarProps> = ({
  docKind,
  onSwitchDocKind,
  onUploadPdf,
  activeTool,
  onSelectTool,
  toolColors,
  onChangeToolColor,
  strokeWidth,
  onChangeStrokeWidth,
  defaultTextBg,
  onChangeDefaultTextBg,
  zoom,
  onChangeZoom,
  canUndoInk,
  onUndoInk,
  onClearDocument,
  onCaptureStudioFull,
  onCaptureStudioArea,
  onCaptureDisplay,
  sidebarOpen,
  onToggleSidebar,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const captureMenuRef = useRef<HTMLDivElement>(null);
  const colorMenuRef = useRef<HTMLDivElement>(null);
  const [captureMenuOpen, setCaptureMenuOpen] = useState(false);
  const [colorMenuOpen, setColorMenuOpen] = useState(false);

  useEffect(() => {
    if (!captureMenuOpen && !colorMenuOpen) return;
    const onDocClick = (e: MouseEvent) => {
      if (captureMenuRef.current && !captureMenuRef.current.contains(e.target as Node)) {
        setCaptureMenuOpen(false);
      }
      if (colorMenuRef.current && !colorMenuRef.current.contains(e.target as Node)) {
        setColorMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [captureMenuOpen, colorMenuOpen]);

  const tools: Array<{
    id: AnnotationTool;
    label: string;
    shortcut: string;
    hasColor: boolean;
    icon: React.ReactNode;
  }> = [
    { id: 'select', label: 'Select', shortcut: 'V', hasColor: false, icon: <MousePointer2 className="w-3.5 h-3.5" /> },
    { id: 'text', label: 'Text Box', shortcut: 'T', hasColor: true, icon: <Type className="w-3.5 h-3.5" /> },
    { id: 'pen', label: 'Pen', shortcut: 'P', hasColor: true, icon: <PenTool className="w-3.5 h-3.5" /> },
    { id: 'marker', label: 'Ink Mark', shortcut: 'M', hasColor: true, icon: <Highlighter className="w-3.5 h-3.5" /> },
    { id: 'eraser', label: 'Eraser', shortcut: 'E', hasColor: false, icon: <Eraser className="w-3.5 h-3.5" /> },
  ];

  const activeColor = toolColors[activeTool];
  const showColorControls =
    activeTool === 'text' || activeTool === 'pen' || activeTool === 'marker';

  return (
    <div className="no-print bg-white border-b border-slate-200 px-4 lg:px-6 py-2 flex flex-wrap items-center justify-between gap-3 shrink-0">
      {/* Document Mode Switcher + Local PDF Upload */}
      <div className="flex items-center gap-2">
        <div className="flex items-center p-0.5 bg-slate-100 rounded-lg border border-slate-200/80">
          <button
            type="button"
            onClick={() => onSwitchDocKind('web')}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              docKind === 'web'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Globe className="w-3.5 h-3.5" aria-hidden="true" />
            Web Page
          </button>
          <button
            type="button"
            onClick={() => onSwitchDocKind('pdf')}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              docKind === 'pdf'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <FileText className="w-3.5 h-3.5" aria-hidden="true" />
            PDF File
          </button>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept="application/pdf,.pdf"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) {
              onUploadPdf(file);
              e.target.value = '';
            }
          }}
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
        >
          <Upload className="w-3.5 h-3.5" aria-hidden="true" />
          Load PDF
        </button>
      </div>

      {/* Core Annotation Tools & Per-Tool Color Swatches */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center p-0.5 bg-slate-100 rounded-lg border border-slate-200/80">
          {tools.map((t) => {
            const isActive = activeTool === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => {
                  if (isActive && t.hasColor) {
                    setColorMenuOpen((v) => !v);
                  } else {
                    onSelectTool(t.id);
                    setColorMenuOpen(false);
                  }
                }}
                title={`${t.label} (${t.shortcut})`}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  isActive
                    ? 'bg-blue-700 text-white shadow-xs'
                    : 'text-slate-700 hover:text-slate-900 hover:bg-white/70'
                }`}
              >
                {t.icon}
                <span>{t.label}</span>
                {t.hasColor && (
                  <span
                    className="w-2.5 h-2.5 rounded-[2px] border border-white/60 shrink-0"
                    style={{ backgroundColor: toolColors[t.id] }}
                    aria-hidden="true"
                  />
                )}
              </button>
            );
          })}
        </div>

        {/* Compact Color & Stroke Popover for the Currently Selected Tool */}
        {showColorControls && (
          <div className="flex items-center gap-2 pl-2 border-l border-slate-200">
            <div ref={colorMenuRef} className="relative">
              <button
                type="button"
                onClick={() => setColorMenuOpen((v) => !v)}
                title={`Choose ${activeTool === 'marker' ? 'Ink Mark' : activeTool === 'pen' ? 'Pen' : 'Text Box'} Color`}
                aria-label="Choose active tool color"
                aria-expanded={colorMenuOpen}
                className={`inline-flex items-center gap-1.5 h-7 px-2 text-xs font-medium border rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  colorMenuOpen
                    ? 'bg-slate-900 text-white border-slate-900'
                    : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                }`}
              >
                <span
                  className="w-3.5 h-3.5 rounded-full border border-slate-300 shrink-0"
                  style={{ backgroundColor: activeColor }}
                />
                <span>Color</span>
                <ChevronDown className="w-3 h-3 opacity-75" />
              </button>

              {colorMenuOpen && (
                <div className="absolute left-0 top-full mt-1.5 w-60 bg-white border border-slate-200 rounded-lg shadow-lg p-3 z-50">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[11px] font-semibold text-slate-600">
                      {activeTool === 'marker'
                        ? 'Ink Mark Color'
                        : activeTool === 'pen'
                        ? 'Pen Color'
                        : 'Text Box Color'}
                    </span>
                    <span className="text-[10px] font-mono text-slate-400">
                      {activeColor.toLowerCase()}
                    </span>
                  </div>
                  <div
                    className="grid grid-cols-7 gap-1.5 mb-2.5"
                    role="group"
                    aria-label="Active tool color palette"
                  >
                    {COLOR_SWATCHES.map((swatch) => (
                      <button
                        key={swatch.hex}
                        type="button"
                        title={swatch.name}
                        onClick={() => {
                          onChangeToolColor(swatch.hex);
                          setColorMenuOpen(false);
                        }}
                        className={`w-5 h-5 rounded-full border transition-transform cursor-pointer ${
                          activeColor.toLowerCase() === swatch.hex
                            ? 'ring-2 ring-blue-700 ring-offset-1 scale-110 border-white'
                            : 'border-slate-300 hover:scale-110'
                        }`}
                        style={{ backgroundColor: swatch.hex }}
                        aria-label={`Set ${activeTool} color to ${swatch.name}`}
                      />
                    ))}
                  </div>
                  <div className="flex items-center justify-between pt-2 border-t border-slate-100">
                    <span className="text-[11px] text-slate-600">Custom color</span>
                    <input
                      type="color"
                      value={activeColor}
                      onChange={(e) => onChangeToolColor(e.target.value)}
                      title="Custom Color Picker"
                      aria-label="Custom color picker"
                      className="w-6 h-6 p-0 border border-slate-300 rounded cursor-pointer bg-transparent"
                    />
                  </div>
                </div>
              )}
            </div>

            {activeTool === 'text' ? (
              <select
                value={defaultTextBg}
                onChange={(e) => onChangeDefaultTextBg(e.target.value as TextBoxBgStyle)}
                aria-label="Default text box background"
                className="h-7 px-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-md focus-visible:outline-2 focus-visible:outline-blue-700 cursor-pointer"
              >
                <option value="transparent">Transparent</option>
                <option value="paper">Paper Fill</option>
                <option value="warm">Warm Note</option>
                <option value="mint">Mint Note</option>
                <option value="sky">Sky Note</option>
                <option value="rose">Rose Note</option>
                <option value="slate">Dark Fill</option>
              </select>
            ) : (
              <label className="flex items-center gap-1.5 text-xs text-slate-600">
                <span className="sr-only">Stroke Width</span>
                <input
                  type="range"
                  min={1}
                  max={20}
                  value={strokeWidth}
                  onChange={(e) => onChangeStrokeWidth(Number(e.target.value))}
                  className="w-16 accent-blue-700 cursor-pointer"
                />
                <span className="font-mono text-[11px] tabular-nums w-7 text-right">
                  {strokeWidth}px
                </span>
              </label>
            )}
          </div>
        )}
      </div>

      {/* Zoom, Undo, Clear, Sidebar Toggle */}
      <div className="flex items-center gap-1.5">
        <div className="flex items-center border border-slate-200 rounded-lg bg-white">
          <button
            type="button"
            onClick={() => onChangeZoom(Math.max(0.6, Number((zoom - 0.1).toFixed(2))))}
            title="Zoom Out"
            className="p-1.5 text-slate-600 hover:text-slate-900 hover:bg-slate-50 rounded-l-lg cursor-pointer"
          >
            <ZoomOut className="w-3.5 h-3.5" />
          </button>
          <span className="px-2 text-xs font-mono tabular-nums text-slate-700 min-w-[46px] text-center">
            {Math.round(zoom * 100)}%
          </span>
          <button
            type="button"
            onClick={() => onChangeZoom(Math.min(1.8, Number((zoom + 0.1).toFixed(2))))}
            title="Zoom In"
            className="p-1.5 text-slate-600 hover:text-slate-900 hover:bg-slate-50 rounded-r-lg cursor-pointer"
          >
            <ZoomIn className="w-3.5 h-3.5" />
          </button>
        </div>

        <button
          type="button"
          onClick={onUndoInk}
          disabled={!canUndoInk}
          title="Undo last ink stroke"
          className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer whitespace-nowrap shrink-0"
        >
          <Undo2 className="w-3.5 h-3.5" />
          Undo
        </button>

        <button
          type="button"
          onClick={onClearDocument}
          title="Clear annotations on current document"
          className="p-1.5 text-slate-500 hover:text-red-600 bg-white border border-slate-200 rounded-lg hover:bg-red-50 transition-colors cursor-pointer"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>

        <div ref={captureMenuRef} className="relative">
          <button
            type="button"
            onClick={() => setCaptureMenuOpen((v) => !v)}
            title="Capture whole screen or selected area as PNG / JPG"
            className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium border rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              captureMenuOpen
                ? 'bg-slate-900 text-white border-slate-900'
                : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
            }`}
          >
            <Camera className="w-3.5 h-3.5" />
            <span>Capture</span>
            <ChevronDown className="w-3 h-3 opacity-75" />
          </button>

          {captureMenuOpen && (
            <div className="absolute right-0 top-full mt-1.5 w-56 bg-white border border-slate-200 rounded-lg shadow-lg p-1 z-50">
              <button
                type="button"
                onClick={() => {
                  setCaptureMenuOpen(false);
                  onCaptureStudioFull();
                }}
                className="w-full flex items-center justify-between px-2.5 py-2 text-xs font-medium text-slate-800 hover:bg-slate-100 rounded-md cursor-pointer"
              >
                <span className="inline-flex items-center gap-2">
                  <Camera className="w-3.5 h-3.5 text-slate-500" />
                  Whole Studio View
                </span>
                <span className="text-[10px] font-mono text-slate-400">PNG / JPG</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setCaptureMenuOpen(false);
                  onCaptureStudioArea();
                }}
                className="w-full flex items-center justify-between px-2.5 py-2 text-xs font-medium text-slate-800 hover:bg-slate-100 rounded-md cursor-pointer"
              >
                <span className="inline-flex items-center gap-2">
                  <Crop className="w-3.5 h-3.5 text-slate-500" />
                  Select Area
                </span>
                <span className="text-[10px] font-mono text-slate-400">Drag Box</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setCaptureMenuOpen(false);
                  onCaptureDisplay();
                }}
                className="w-full flex items-center justify-between px-2.5 py-2 text-xs font-medium text-slate-800 hover:bg-slate-100 rounded-md cursor-pointer"
              >
                <span className="inline-flex items-center gap-2">
                  <Monitor className="w-3.5 h-3.5 text-slate-500" />
                  Whole Screen / Tab
                </span>
                <span className="text-[10px] font-mono text-slate-400">Display</span>
              </button>
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={onToggleSidebar}
          title={sidebarOpen ? 'Hide Sidebar Dashboard' : 'Show Sidebar Dashboard'}
          className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium border rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
            sidebarOpen
              ? 'bg-slate-900 text-white border-slate-900'
              : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
          }`}
        >
          <PanelRight className="w-3.5 h-3.5" />
          Sidebar
        </button>
      </div>
    </div>
  );
};
