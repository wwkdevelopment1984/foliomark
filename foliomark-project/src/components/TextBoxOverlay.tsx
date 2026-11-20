import React, { useEffect, useRef, useState } from 'react';
import { GripHorizontal, Trash2 } from 'lucide-react';
import type { TextBoxAnnotation, TextBoxBgStyle } from '../types/annotation';

interface TextBoxOverlayProps {
  boxes: TextBoxAnnotation[];
  zoom: number;
  activeBoxId: string | null;
  focusedAnnotationId: string | null;
  onFocusBox: (id: string | null) => void;
  onUpdateBox: (id: string, patch: Partial<TextBoxAnnotation>) => void;
  onDeleteBox: (id: string) => void;
  onDragEndScreenPoint?: (id: string, clientX: number, clientY: number) => void;
}

const BG_MAP: Record<TextBoxBgStyle, string> = {
  transparent: 'bg-transparent shadow-none',
  paper: 'bg-white/95 shadow-xs',
  warm: 'bg-amber-50/95 shadow-xs',
  mint: 'bg-emerald-50/95 shadow-xs',
  sky: 'bg-sky-50/95 shadow-xs',
  rose: 'bg-rose-50/95 shadow-xs',
  slate: 'bg-slate-900/95 shadow-sm',
};

const BG_ORDER: TextBoxBgStyle[] = [
  'transparent',
  'paper',
  'warm',
  'mint',
  'sky',
  'rose',
  'slate',
];

const BOX_TEXT_COLORS = [
  '#0f172a',
  '#1d4ed8',
  '#15803d',
  '#dc2626',
  '#7c3aed',
  '#d97706',
];

export const TextBoxOverlay: React.FC<TextBoxOverlayProps> = ({
  boxes,
  zoom,
  activeBoxId,
  focusedAnnotationId,
  onFocusBox,
  onUpdateBox,
  onDeleteBox,
  onDragEndScreenPoint,
}) => {
  return (
    <>
      {boxes.map((box) => (
        <SingleTextBox
          key={box.id}
          box={box}
          zoom={zoom}
          isActive={activeBoxId === box.id}
          isHighlighted={focusedAnnotationId === box.id}
          onFocus={() => onFocusBox(box.id)}
          onBlur={() => onFocusBox(null)}
          onUpdate={(patch) => onUpdateBox(box.id, patch)}
          onDelete={() => onDeleteBox(box.id)}
          onDragEndScreenPoint={onDragEndScreenPoint}
        />
      ))}
    </>
  );
};

interface SingleTextBoxProps {
  box: TextBoxAnnotation;
  zoom: number;
  isActive: boolean;
  isHighlighted: boolean;
  onFocus: () => void;
  onBlur: () => void;
  onUpdate: (patch: Partial<TextBoxAnnotation>) => void;
  onDelete: () => void;
  onDragEndScreenPoint?: (id: string, clientX: number, clientY: number) => void;
}

const SingleTextBox: React.FC<SingleTextBoxProps> = ({
  box,
  zoom,
  isActive,
  isHighlighted,
  onFocus,
  onBlur,
  onUpdate,
  onDelete,
  onDragEndScreenPoint,
}) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [dragging, setDragging] = useState(false);
  const dragOrigin = useRef<{
    pointerX: number;
    pointerY: number;
    origX: number;
    origY: number;
  } | null>(null);

  useEffect(() => {
    if (isActive && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [isActive]);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.max(24, el.scrollHeight)}px`;
  }, [box.text, box.fontSize, zoom]);

  const startDrag = (e: React.PointerEvent<HTMLElement>) => {
    const target = e.target as HTMLElement;
    if (target.closest('button') || target.closest('input') || target.tagName === 'TEXTAREA') {
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragging(true);
    dragOrigin.current = {
      pointerX: e.clientX,
      pointerY: e.clientY,
      origX: box.x,
      origY: box.y,
    };
  };

  const moveDrag = (e: React.PointerEvent<HTMLElement>) => {
    if (!dragOrigin.current) return;
    const dx = (e.clientX - dragOrigin.current.pointerX) / zoom;
    const dy = (e.clientY - dragOrigin.current.pointerY) / zoom;
    onUpdate({
      x: Math.round(dragOrigin.current.origX + dx),
      y: Math.round(dragOrigin.current.origY + dy),
    });
  };

  const endDrag = (e: React.PointerEvent<HTMLElement>) => {
    if (!dragOrigin.current) return;
    dragOrigin.current = null;
    setDragging(false);
    if (onDragEndScreenPoint) {
      onDragEndScreenPoint(box.id, e.clientX, e.clientY);
    }
  };

  const cycleBg = (e: React.MouseEvent) => {
    e.stopPropagation();
    const idx = BG_ORDER.indexOf(box.bgStyle);
    const next = BG_ORDER[(idx + 1) % BG_ORDER.length];
    onUpdate({ bgStyle: next });
  };

  const textColor = box.bgStyle === 'slate' ? '#f8fafc' : box.color;

  return (
    <div
      data-textbox-id={box.id}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={startDrag}
      onPointerMove={moveDrag}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      style={{
        left: `${box.x * zoom}px`,
        top: `${box.y * zoom}px`,
      }}
      className={`annotation-textbox-chrome group absolute min-w-[140px] max-w-[460px] rounded-md border p-1 cursor-move transition-shadow ${
        !box.text.trim() ? 'print:hidden' : ''
      } ${
        BG_MAP[box.bgStyle] || BG_MAP.transparent
      } ${
        dragging
          ? 'z-50 border-blue-700 ring-2 ring-blue-700/25'
          : isActive || isHighlighted
            ? 'z-40 border-blue-700 ring-1 ring-blue-700/20'
            : 'z-30 border-transparent hover:border-dashed hover:border-blue-600/50'
      }`}
    >
      {/* Floating Drag & Format Handle (sits above box so white chrome never covers underlying page content) */}
      <div
        className={`annotation-textbox-handle absolute bottom-full left-0 mb-1 flex items-center justify-between gap-2 px-2 py-1 bg-white border border-slate-200 rounded-md shadow-sm cursor-grab active:cursor-grabbing select-none whitespace-nowrap transition-opacity ${
          isActive || dragging
            ? 'opacity-100 pointer-events-auto'
            : 'opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto'
        }`}
      >
        <div className="flex items-center gap-1 text-[11px] font-mono tabular-nums text-slate-500">
          <GripHorizontal className="w-3.5 h-3.5 text-slate-400" />
          <span>Move</span>
        </div>

        <div className="flex items-center gap-1">
          {BOX_TEXT_COLORS.map((hex) => (
            <button
              key={hex}
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onUpdate({ color: hex });
              }}
              className={`w-3 h-3 rounded-full border cursor-pointer ${
                box.color.toLowerCase() === hex
                  ? 'border-slate-900 scale-115'
                  : 'border-slate-300'
              }`}
              style={{ backgroundColor: hex }}
              title="Set text color"
              aria-label={`Set text color ${hex}`}
            />
          ))}
          <input
            type="color"
            value={box.color}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => onUpdate({ color: e.target.value })}
            title="Custom text color"
            className="w-4 h-4 p-0 border border-slate-300 rounded cursor-pointer bg-transparent"
          />
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onUpdate({ fontSize: Math.max(11, box.fontSize - 2) });
            }}
            className="px-1.5 py-0.5 text-[11px] font-medium text-slate-700 bg-white border border-slate-200 rounded hover:bg-slate-100 cursor-pointer"
            title="Decrease font size"
          >
            A-
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onUpdate({ fontSize: Math.min(34, box.fontSize + 2) });
            }}
            className="px-1.5 py-0.5 text-[11px] font-medium text-slate-700 bg-white border border-slate-200 rounded hover:bg-slate-100 cursor-pointer"
            title="Increase font size"
          >
            A+
          </button>
          <button
            type="button"
            onClick={cycleBg}
            className="px-1.5 py-0.5 text-[11px] font-medium text-slate-700 bg-white border border-slate-200 rounded hover:bg-slate-100 cursor-pointer"
            title="Cycle background color"
          >
            {box.bgStyle}
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            className="p-0.5 text-slate-400 hover:text-red-600 rounded cursor-pointer"
            title="Delete text box"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Transparent Inline Keyboard Input Area (screen) */}
      <textarea
        ref={textareaRef}
        value={box.text}
        placeholder="Type here..."
        rows={1}
        onFocus={onFocus}
        onBlur={onBlur}
        onChange={(e) => onUpdate({ text: e.target.value })}
        style={{
          fontSize: `${box.fontSize * zoom}px`,
          color: textColor,
          lineHeight: 1.4,
        }}
        className="print:hidden w-full min-w-[140px] px-1.5 py-0.5 bg-transparent resize-none outline-none font-sans placeholder:text-slate-400/80 cursor-text"
      />

      {/* Exact-metric print text mirror (prevents <textarea> print baseline shift) */}
      <div
        style={{
          fontSize: `${box.fontSize * zoom}px`,
          color: textColor,
          lineHeight: 1.4,
        }}
        className="hidden print:block w-full min-w-[140px] px-1.5 py-0.5 bg-transparent font-sans whitespace-pre-wrap break-words"
      >
        {box.text}
      </div>
    </div>
  );
};
