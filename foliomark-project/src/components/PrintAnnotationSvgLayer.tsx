import React from 'react';
import {
  HIGHLIGHT_PALETTE,
  type HighlightAnnotation,
  type InkPoint,
  type InkStroke,
  type TextBoxAnnotation,
  type TextBoxBgStyle,
} from '../types/annotation';

interface PrintAnnotationSvgLayerProps {
  baseWidth: number;
  baseHeight: number;
  highlights: HighlightAnnotation[];
  strokes: InkStroke[];
  textBoxes: TextBoxAnnotation[];
  includeTextBoxes?: boolean;
}

const TEXT_BG_FILL: Record<TextBoxBgStyle, string | null> = {
  transparent: null,
  paper: 'rgba(255, 255, 255, 0.95)',
  warm: 'rgba(255, 251, 235, 0.95)',
  mint: 'rgba(236, 253, 245, 0.95)',
  sky: 'rgba(240, 249, 255, 0.95)',
  rose: 'rgba(255, 241, 242, 0.95)',
  slate: 'rgba(15, 23, 42, 0.95)',
};

const TEXT_FONT_FAMILY = "'DM Sans', system-ui, -apple-system, sans-serif";
const MAX_TEXTBOX_CONTENT_WIDTH = 436;

let measureCtx: CanvasRenderingContext2D | null = null;

function getMeasureContext(): CanvasRenderingContext2D | null {
  if (typeof document === 'undefined') return null;
  if (!measureCtx) {
    const canvas = document.createElement('canvas');
    measureCtx = canvas.getContext('2d');
  }
  return measureCtx;
}

function wrapTextForSvg(
  text: string,
  fontSize: number
): { lines: string[]; maxLineWidth: number } {
  const ctx = getMeasureContext();
  if (ctx) {
    ctx.font = `${fontSize}px ${TEXT_FONT_FAMILY}`;
  }
  const measure = (str: string) =>
    ctx ? ctx.measureText(str).width : str.length * fontSize * 0.56;

  const lines: string[] = [];
  let maxLineWidth = 0;

  for (const para of text.split('\n')) {
    if (!para) {
      lines.push('');
      continue;
    }
    const tokens = para.split(/(\s+)/);
    let currentLine = '';

    for (const token of tokens) {
      const candidate = currentLine + token;
      if (measure(candidate) > MAX_TEXTBOX_CONTENT_WIDTH && currentLine.trim()) {
        const trimmed = currentLine.trimEnd();
        lines.push(trimmed);
        maxLineWidth = Math.max(maxLineWidth, measure(trimmed));
        currentLine = token.trimStart();
      } else {
        currentLine = candidate;
      }
    }

    if (currentLine) {
      lines.push(currentLine);
      maxLineWidth = Math.max(maxLineWidth, measure(currentLine));
    }
  }

  return { lines, maxLineWidth };
}

function buildInkPathD(pts: InkPoint[]): string {
  if (pts.length === 0) return '';
  const parts: string[] = [`M ${pts[0].x.toFixed(2)} ${pts[0].y.toFixed(2)}`];

  if (pts.length === 2) {
    parts.push(`L ${pts[1].x.toFixed(2)} ${pts[1].y.toFixed(2)}`);
    return parts.join(' ');
  }

  for (let i = 1; i < pts.length - 1; i++) {
    const curr = pts[i];
    const next = pts[i + 1];
    const midX = (curr.x + next.x) / 2;
    const midY = (curr.y + next.y) / 2;
    parts.push(
      `Q ${curr.x.toFixed(2)} ${curr.y.toFixed(2)} ${midX.toFixed(2)} ${midY.toFixed(2)}`
    );
  }

  const last = pts[pts.length - 1];
  parts.push(`L ${last.x.toFixed(2)} ${last.y.toFixed(2)}`);
  return parts.join(' ');
}

function renderStrokeSvgElement(stroke: InkStroke) {
  const pts = stroke.points || [];
  if (pts.length === 0) return null;

  if (pts.length === 1) {
    const pt = pts[0];
    const radius = Math.max(
      1,
      (stroke.width * (stroke.tool === 'marker' ? 1 : 0.6 + pt.p * 0.8)) / 2
    );
    return (
      <circle
        key={stroke.id}
        cx={pt.x}
        cy={pt.y}
        r={radius}
        fill={stroke.color}
        fillOpacity={stroke.opacity}
      />
    );
  }

  const avgPressure =
    stroke.tool === 'marker'
      ? 1
      : 0.65 + (pts.reduce((acc, pt) => acc + pt.p, 0) / pts.length) * 0.7;
  const strokeW = Math.max(1, stroke.width * avgPressure);

  return (
    <path
      key={stroke.id}
      d={buildInkPathD(pts)}
      fill="none"
      stroke={stroke.color}
      strokeWidth={strokeW}
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeOpacity={stroke.opacity}
    />
  );
}

/**
 * Vector SVG annotation mirror rendered directly atop document/PDF pages.
 * Hidden on interactive screen views and activated during @media print so
 * highlights, marker ink, pen strokes, and text boxes align 1:1 with the
 * underlying rendered PDF coordinates without canvas blanking or drift.
 */
export const PrintAnnotationSvgLayer: React.FC<PrintAnnotationSvgLayerProps> = ({
  baseWidth,
  baseHeight,
  highlights,
  strokes,
  textBoxes,
  includeTextBoxes = true,
}) => {
  const safeW = Math.max(1, baseWidth);
  const safeH = Math.max(1, baseHeight);

  const markerStrokes = strokes.filter((s) => s.tool === 'marker');
  const penStrokes = strokes.filter((s) => s.tool !== 'marker');
  const visibleBoxes = includeTextBoxes
    ? textBoxes.filter((b) => b.text.trim().length > 0)
    : [];

  return (
    <svg
      data-print-annotation-svg="true"
      viewBox={`0 0 ${safeW} ${safeH}`}
      preserveAspectRatio="none"
      aria-hidden="true"
      className="hidden print:block pointer-events-none absolute inset-0 w-full h-full z-30 overflow-visible"
    >
      {/* 1. Vector Highlight Rectangles (multiply blend keeps underlying PDF text crisp) */}
      <g style={{ mixBlendMode: 'multiply' }}>
        {highlights.map((hl) => {
          const palette = HIGHLIGHT_PALETTE[hl.color] || HIGHLIGHT_PALETTE.yellow;
          return (hl.rects || []).map((r, idx) => (
            <g key={`${hl.id}_${idx}`}>
              <rect
                x={r.left}
                y={r.top}
                width={r.width}
                height={r.height}
                rx={2}
                fill={palette.fill}
              />
              <line
                x1={r.left}
                y1={r.top + r.height}
                x2={r.left + r.width}
                y2={r.top + r.height}
                stroke={palette.border}
                strokeWidth={1.5}
              />
            </g>
          ));
        })}
      </g>

      {/* 2. Translucent Highlighter Ink Strokes */}
      {markerStrokes.length > 0 && (
        <g style={{ mixBlendMode: 'multiply' }}>
          {markerStrokes.map((stroke) => renderStrokeSvgElement(stroke))}
        </g>
      )}

      {/* 3. Opaque Pen Ink Strokes */}
      {penStrokes.length > 0 && (
        <g>{penStrokes.map((stroke) => renderStrokeSvgElement(stroke))}</g>
      )}

      {/* 4. Free-Form Keyboard Text Boxes */}
      {visibleBoxes.map((box) => {
        const fontSize = box.fontSize || 15;
        const lineHeight = fontSize * 1.4;
        const { lines, maxLineWidth } = wrapTextForSvg(box.text, fontSize);
        const bgFill = TEXT_BG_FILL[box.bgStyle] || null;
        const textColor = box.bgStyle === 'slate' ? '#f8fafc' : box.color || '#0f172a';
        const boxWidth = Math.max(140, Math.min(460, Math.ceil(maxLineWidth) + 24));
        const boxHeight = Math.max(24, lines.length * lineHeight) + 12;

        return (
          <g key={box.id}>
            {bgFill && (
              <rect
                x={box.x}
                y={box.y}
                width={boxWidth}
                height={boxHeight}
                rx={6}
                fill={bgFill}
              />
            )}
            <text
              x={box.x + 10}
              y={box.y + 6 + fontSize * 0.92}
              fill={textColor}
              fontSize={fontSize}
              fontFamily={TEXT_FONT_FAMILY}
              xmlSpace="preserve"
            >
              {lines.map((line, lineIdx) => (
                <tspan
                  key={lineIdx}
                  x={box.x + 10}
                  y={box.y + 6 + lineIdx * lineHeight + fontSize * 0.92}
                >
                  {line || ' '}
                </tspan>
              ))}
            </text>
          </g>
        );
      })}
    </svg>
  );
};
