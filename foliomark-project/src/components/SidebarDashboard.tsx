import React, { useMemo, useState } from 'react';
import {
  Crosshair,
  Highlighter,
  PenTool,
  Printer,
  Search,
  Trash2,
  Type,
} from 'lucide-react';
import type {
  DocumentAnnotations,
  HighlightAnnotation,
  TextBoxAnnotation,
} from '../types/annotation';

interface SidebarDashboardProps {
  currentDocTitle: string;
  currentDocUrl: string;
  currentDocId: string;
  textBoxes: TextBoxAnnotation[];
  highlights: HighlightAnnotation[];
  strokeCount: number;
  allSavedDocs: DocumentAnnotations[];
  onJumpToAnnotation: (id: string) => void;
  onDeleteTextBox: (id: string) => void;
  onUpdateTextBoxText: (id: string, text: string) => void;
  onUpdateHighlightNote: (id: string, note: string) => void;
  onDeleteHighlight: (id: string) => void;
  onClearInk: () => void;
  onExportPdf: () => void;
  onActivateTextTool: () => void;
}

type FilterType = 'all' | 'text' | 'highlight' | 'ink';

export const SidebarDashboard: React.FC<SidebarDashboardProps> = ({
  currentDocTitle,
  currentDocUrl,
  currentDocId,
  textBoxes,
  highlights,
  strokeCount,
  allSavedDocs,
  onJumpToAnnotation,
  onDeleteTextBox,
  onUpdateTextBoxText,
  onUpdateHighlightNote,
  onDeleteHighlight,
  onClearInk,
  onExportPdf,
  onActivateTextTool,
}) => {
  const [scope, setScope] = useState<'current' | 'all'>('current');
  const [filter, setFilter] = useState<FilterType>('all');
  const [search, setSearch] = useState('');

  const items = useMemo(() => {
    const q = search.trim().toLowerCase();

    if (scope === 'current') {
      const list: Array<{
        kind: 'text' | 'highlight' | 'ink';
        id: string;
        docTitle: string;
        metaText: string;
        primaryText: string;
        noteText?: string;
        isCurrentDoc: boolean;
      }> = [];

      if (filter === 'all' || filter === 'text') {
        textBoxes.forEach((b) => {
          list.push({
            kind: 'text',
            id: b.id,
            docTitle: currentDocTitle,
            metaText: `Text Box · ${b.pageNumber ? `P${b.pageNumber} · ` : ''}(${Math.round(b.x)}, ${Math.round(b.y)})`,
            primaryText: b.text || 'Empty text box',
            isCurrentDoc: true,
          });
        });
      }

      if (filter === 'all' || filter === 'highlight') {
        highlights.forEach((h) => {
          list.push({
            kind: 'highlight',
            id: h.id,
            docTitle: currentDocTitle,
            metaText: `Highlight · ${h.color}${h.pageNumber ? ` · P${h.pageNumber}` : ''}`,
            primaryText: h.quote,
            noteText: h.note,
            isCurrentDoc: true,
          });
        });
      }

      if ((filter === 'all' || filter === 'ink') && strokeCount > 0) {
        list.push({
          kind: 'ink',
          id: `ink_${currentDocId}`,
          docTitle: currentDocTitle,
          metaText: `Ink Canvas · ${strokeCount} stroke${strokeCount === 1 ? '' : 's'}`,
          primaryText: 'Freehand pen & marker strokes stored in IndexedDB',
          isCurrentDoc: true,
        });
      }

      return list.filter((it) => {
        if (!q) return true;
        return (
          it.primaryText.toLowerCase().includes(q) ||
          (it.noteText || '').toLowerCase().includes(q) ||
          it.metaText.toLowerCase().includes(q)
        );
      });
    }

    // All saved documents scope
    const allItems: Array<{
      kind: 'text' | 'highlight' | 'ink';
      id: string;
      docTitle: string;
      metaText: string;
      primaryText: string;
      noteText?: string;
      isCurrentDoc: boolean;
    }> = [];

    for (const doc of allSavedDocs) {
      const isCurrent = doc.meta.docId === currentDocId;
      if (filter === 'all' || filter === 'text') {
        doc.textBoxes.forEach((b) => {
          allItems.push({
            kind: 'text',
            id: b.id,
            docTitle: doc.meta.title,
            metaText: `${doc.meta.title} · (${Math.round(b.x)}, ${Math.round(b.y)})`,
            primaryText: b.text || 'Empty text box',
            isCurrentDoc: isCurrent,
          });
        });
      }
      if (filter === 'all' || filter === 'highlight') {
        doc.highlights.forEach((h) => {
          allItems.push({
            kind: 'highlight',
            id: h.id,
            docTitle: doc.meta.title,
            metaText: `${doc.meta.title} · ${h.color}`,
            primaryText: h.quote,
            noteText: h.note,
            isCurrentDoc: isCurrent,
          });
        });
      }
      if ((filter === 'all' || filter === 'ink') && doc.strokes.length > 0) {
        allItems.push({
          kind: 'ink',
          id: `ink_${doc.meta.docId}`,
          docTitle: doc.meta.title,
          metaText: `${doc.meta.title} · ${doc.strokes.length} strokes`,
          primaryText: 'Saved IndexedDB drawing layer',
          isCurrentDoc: isCurrent,
        });
      }
    }

    return allItems.filter((it) => {
      if (!q) return true;
      return (
        it.primaryText.toLowerCase().includes(q) ||
        (it.noteText || '').toLowerCase().includes(q) ||
        it.docTitle.toLowerCase().includes(q)
      );
    });
  }, [
    scope,
    filter,
    search,
    textBoxes,
    highlights,
    strokeCount,
    currentDocTitle,
    currentDocId,
    allSavedDocs,
  ]);

  return (
    <aside className="no-print w-full lg:w-80 xl:w-88 bg-white border-l border-slate-200 flex flex-col shrink-0 h-full overflow-hidden">
      {/* Sidebar Header */}
      <div className="px-4 py-3.5 border-b border-slate-200">
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-display text-sm font-semibold text-slate-900">
            Annotations
          </h2>
          <span className="text-xs font-mono tabular-nums text-slate-500">
            {textBoxes.length} text · {highlights.length} hl · {strokeCount} ink
          </span>
        </div>
        <div className="mt-1 text-xs text-slate-500 truncate" title={currentDocUrl}>
          {currentDocTitle}
        </div>
      </div>

      {/* Scope & Search Controls */}
      <div className="p-3.5 border-b border-slate-200 space-y-2.5 bg-slate-50/60">
        <div className="grid grid-cols-2 p-0.5 bg-slate-200/70 rounded-lg">
          <button
            type="button"
            onClick={() => setScope('current')}
            className={`py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer ${
              scope === 'current'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Current Document
          </button>
          <button
            type="button"
            onClick={() => setScope('all')}
            className={`py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer ${
              scope === 'all'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            All Saved ({allSavedDocs.length})
          </button>
        </div>

        <div className="relative">
          <Search
            className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none"
            aria-hidden="true"
          />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search text boxes, quotes, notes..."
            className="w-full pl-8 pr-3 py-1.5 text-xs bg-white border border-slate-200 rounded-md outline-none focus:border-blue-700"
          />
        </div>

        <div className="grid grid-cols-4 gap-1">
          {(['all', 'text', 'highlight', 'ink'] as FilterType[]).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={`py-1 text-[11px] font-medium rounded border transition-colors capitalize cursor-pointer ${
                filter === f
                  ? 'bg-blue-50 border-blue-200 text-blue-700'
                  : 'bg-white border-slate-200 text-slate-600 hover:text-slate-900'
              }`}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      {/* Annotation List */}
      <div className="flex-1 overflow-y-auto p-3.5 space-y-2.5">
        {items.length === 0 ? (
          <div className="py-10 px-4 text-center">
            <p className="text-xs text-slate-500 leading-relaxed mb-3">
              No annotations match this view yet. Click anywhere on the document with the Text Box
              tool, draw with the Pen, or highlight text.
            </p>
            <button
              type="button"
              onClick={onActivateTextTool}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-md transition-colors cursor-pointer"
            >
              <Type className="w-3.5 h-3.5" />
              Place Text Box
            </button>
          </div>
        ) : (
          items.map((item) => (
            <div
              key={item.id}
              className="p-3 bg-white border border-slate-200 rounded-lg space-y-2"
            >
              <div className="flex items-center justify-between gap-2 text-[11px] text-slate-500 font-mono tabular-nums">
                <span className="inline-flex items-center gap-1.5 truncate">
                  {item.kind === 'text' && <Type className="w-3 h-3 text-blue-700 shrink-0" />}
                  {item.kind === 'highlight' && (
                    <Highlighter className="w-3 h-3 text-amber-600 shrink-0" />
                  )}
                  {item.kind === 'ink' && <PenTool className="w-3 h-3 text-slate-700 shrink-0" />}
                  <span className="truncate">{item.metaText}</span>
                </span>
              </div>

              {item.kind === 'text' && item.isCurrentDoc ? (
                <textarea
                  value={item.primaryText === 'Empty text box' ? '' : item.primaryText}
                  onChange={(e) => onUpdateTextBoxText(item.id, e.target.value)}
                  placeholder="Type text box content..."
                  rows={2}
                  className="w-full px-2 py-1.5 text-xs text-slate-800 bg-slate-50 border border-slate-200 rounded outline-none focus:border-blue-700 resize-none"
                />
              ) : (
                <p className="text-xs text-slate-800 leading-relaxed break-words">
                  {item.kind === 'highlight' ? `"${item.primaryText}"` : item.primaryText}
                </p>
              )}

              {item.kind === 'highlight' && item.isCurrentDoc && (
                <input
                  type="text"
                  value={item.noteText || ''}
                  onChange={(e) => onUpdateHighlightNote(item.id, e.target.value)}
                  placeholder="Add sticky note..."
                  className="w-full px-2 py-1 text-xs text-slate-700 bg-slate-50 border border-slate-200 rounded outline-none focus:border-blue-700"
                />
              )}

              {item.kind === 'highlight' && !item.isCurrentDoc && item.noteText && (
                <p className="text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded px-2 py-1">
                  {item.noteText}
                </p>
              )}

              {item.isCurrentDoc && (
                <div className="flex items-center justify-end gap-3 pt-1">
                  {item.kind !== 'ink' && (
                    <button
                      type="button"
                      onClick={() => onJumpToAnnotation(item.id)}
                      className="inline-flex items-center gap-1 text-[11px] font-medium text-blue-700 hover:text-blue-800 cursor-pointer"
                    >
                      <Crosshair className="w-3 h-3" />
                      Jump
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      if (item.kind === 'text') onDeleteTextBox(item.id);
                      else if (item.kind === 'highlight') onDeleteHighlight(item.id);
                      else onClearInk();
                    }}
                    className="inline-flex items-center gap-1 text-[11px] font-medium text-red-600 hover:text-red-700 cursor-pointer"
                  >
                    <Trash2 className="w-3 h-3" />
                    Delete
                  </button>
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {/* Footer Export Action */}
      <div className="p-3.5 border-t border-slate-200 bg-white">
        <button
          type="button"
          onClick={onExportPdf}
          className="w-full inline-flex items-center justify-center gap-2 py-2 px-4 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
        >
          <Printer className="w-3.5 h-3.5" />
          Export Annotated PDF
        </button>
      </div>
    </aside>
  );
};
