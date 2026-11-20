import React, { useEffect, useRef } from 'react';
import type { AnnotationTool, InkStroke } from '../types/annotation';

interface InkCanvasProps {
  width: number;
  height: number;
  zoom: number;
  docId: string;
  pageNumber?: number;
  activeTool: AnnotationTool;
  inkColor: string;
  strokeWidth: number;
  strokes: InkStroke[];
  onAddStroke: (stroke: InkStroke) => void;
  onEraseStrokeIds: (ids: string[]) => void;
}

// Explicit 32x32 centered crosshair cursor (hotspot exactly at 16,16)
const CENTERED_CROSSHAIR_CURSOR = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='32' height='32' viewBox='0 0 32 32'%3E%3Cpath d='M16 4v24M4 16h24' stroke='%23ffffff' stroke-width='3' stroke-linecap='round'/%3E%3Cpath d='M16 4v24M4 16h24' stroke='%230f172a' stroke-width='1.5' stroke-linecap='round'/%3E%3Ccircle cx='16' cy='16' r='2' fill='%231d4ed8'/%3E%3C/svg%3E") 16 16, crosshair`;

function drawStrokeOnCtx(ctx: CanvasRenderingContext2D, stroke: InkStroke, zoom: number): void {
  const pts = stroke.points;
  if (!pts || pts.length === 0) return;

  ctx.save();
  ctx.globalAlpha = stroke.opacity;
  ctx.strokeStyle = stroke.color;
  ctx.fillStyle = stroke.color;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  if (pts.length === 1) {
    const pt = pts[0];
    const radius = Math.max(1, (stroke.width * zoom * (stroke.tool === 'marker' ? 1 : 0.6 + pt.p * 0.8)) / 2);
    ctx.beginPath();
    ctx.arc(pt.x * zoom, pt.y * zoom, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    return;
  }

  // Draw entire stroke as ONE continuous path so translucent marker ink never overlaps/beads at joints
  ctx.beginPath();
  ctx.moveTo(pts[0].x * zoom, pts[0].y * zoom);

  if (pts.length === 2) {
    ctx.lineTo(pts[1].x * zoom, pts[1].y * zoom);
  } else {
    for (let i = 1; i < pts.length - 1; i++) {
      const curr = pts[i];
      const next = pts[i + 1];
      const midX = ((curr.x + next.x) / 2) * zoom;
      const midY = ((curr.y + next.y) / 2) * zoom;
      ctx.quadraticCurveTo(curr.x * zoom, curr.y * zoom, midX, midY);
    }
    const last = pts[pts.length - 1];
    ctx.lineTo(last.x * zoom, last.y * zoom);
  }

  const avgPressure =
    stroke.tool === 'marker'
      ? 1
      : 0.65 + (pts.reduce((acc, pt) => acc + pt.p, 0) / pts.length) * 0.7;
  ctx.lineWidth = Math.max(1, stroke.width * zoom * avgPressure);
  ctx.stroke();

  ctx.restore();
}

function distToSegment(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(px - x1, py - y1);
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lenSq));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

export const InkCanvas: React.FC<InkCanvasProps> = ({
  width,
  height,
  zoom,
  docId,
  pageNumber,
  activeTool,
  inkColor,
  strokeWidth,
  strokes,
  onAddStroke,
  onEraseStrokeIds,
}) => {
  // Separate marker canvas (mix-blend-multiply) so highlighter ink never covers underlying text
  const markerCanvasRef = useRef<HTMLCanvasElement>(null);
  const penCanvasRef = useRef<HTMLCanvasElement>(null);
  const activeStrokeRef = useRef<InkStroke | null>(null);
  const isErasingRef = useRef(false);

  const isInkInteractive =
    activeTool === 'pen' || activeTool === 'marker' || activeTool === 'eraser';

  const setupAndClear = (canvas: HTMLCanvasElement | null): CanvasRenderingContext2D | null => {
    if (!canvas) return null;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const targetW = Math.max(1, Math.floor(width * dpr));
    const targetH = Math.max(1, Math.floor(height * dpr));
    if (canvas.width !== targetW || canvas.height !== targetH) {
      canvas.width = targetW;
      canvas.height = targetH;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    return ctx;
  };

  const renderAll = (draftStroke?: InkStroke | null) => {
    const markerCtx = setupAndClear(markerCanvasRef.current);
    const penCtx = setupAndClear(penCanvasRef.current);

    for (const s of strokes) {
      if (s.tool === 'marker') {
        if (markerCtx) drawStrokeOnCtx(markerCtx, s, zoom);
      } else {
        if (penCtx) drawStrokeOnCtx(penCtx, s, zoom);
      }
    }

    if (draftStroke) {
      if (draftStroke.tool === 'marker' && markerCtx) {
        drawStrokeOnCtx(markerCtx, draftStroke, zoom);
      } else if (penCtx) {
        drawStrokeOnCtx(penCtx, draftStroke, zoom);
      }
    }
  };

  useEffect(() => {
    activeStrokeRef.current = null;
    isErasingRef.current = false;
    renderAll(null);
  }, [activeTool]);

  useEffect(() => {
    renderAll(activeStrokeRef.current);
  }, [strokes, width, height, zoom]);

  const hitTestErase = (normX: number, normY: number) => {
    const hitIds = strokes
      .filter((s) => {
        const pts = s.points;
        if (!pts || pts.length === 0) return false;
        const threshold = Math.max(16, (s.width || 16) / 2 + 6) / zoom;
        if (pts.length === 1) {
          return Math.hypot(pts[0].x - normX, pts[0].y - normY) <= threshold;
        }
        for (let i = 0; i < pts.length - 1; i++) {
          if (distToSegment(normX, normY, pts[i].x, pts[i].y, pts[i + 1].x, pts[i + 1].y) <= threshold) {
            return true;
          }
        }
        return false;
      })
      .map((s) => s.id);
    if (hitIds.length > 0) {
      onEraseStrokeIds(hitIds);
    }
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isInkInteractive) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();

    const canvas = penCanvasRef.current;
    if (!canvas) return;
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      // Ignore if pointer capture is unavailable
    }

    const rect = canvas.getBoundingClientRect();
    const normX = (e.clientX - rect.left) / zoom;
    const normY = (e.clientY - rect.top) / zoom;
    const pressure = e.pointerType === 'pen' && e.pressure > 0 ? e.pressure : 0.5;

    if (activeTool === 'eraser') {
      activeStrokeRef.current = null;
      isErasingRef.current = true;
      hitTestErase(normX, normY);
      return;
    }

    const toolKind = activeTool === 'marker' ? 'marker' : 'pen';
    activeStrokeRef.current = {
      id: `ink_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      docId,
      pageNumber,
      tool: toolKind,
      color: inkColor,
      width: toolKind === 'marker' ? Math.max(strokeWidth * 3.5, 16) : strokeWidth,
      opacity: toolKind === 'marker' ? 0.35 : 1,
      points: [{ x: normX, y: normY, p: pressure }],
      createdAt: Date.now(),
    };
    renderAll(activeStrokeRef.current);
  };

  const finishPointer = (e?: React.PointerEvent<HTMLCanvasElement>) => {
    const finished = activeStrokeRef.current;
    const wasErasing = isErasingRef.current;
    activeStrokeRef.current = null;
    isErasingRef.current = false;

    const canvas = penCanvasRef.current;
    if (canvas && e?.pointerId != null) {
      try {
        if (canvas.hasPointerCapture(e.pointerId)) {
          canvas.releasePointerCapture(e.pointerId);
        }
      } catch {
        // Ignore capture release errors
      }
    }

    if (wasErasing) {
      return;
    }
    if (finished && finished.points.length > 0) {
      onAddStroke(finished);
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isInkInteractive) return;
    if (!isErasingRef.current && !activeStrokeRef.current) return;
    if (e.pointerType === 'mouse' && (e.buttons & 1) === 0) {
      finishPointer(e);
      return;
    }

    const canvas = penCanvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const normX = (e.clientX - rect.left) / zoom;
    const normY = (e.clientY - rect.top) / zoom;

    if (isErasingRef.current || activeTool === 'eraser') {
      hitTestErase(normX, normY);
      return;
    }

    if (!activeStrokeRef.current) return;
    const pressure = e.pointerType === 'pen' && e.pressure > 0 ? e.pressure : 0.5;
    activeStrokeRef.current.points.push({ x: normX, y: normY, p: pressure });
    renderAll(activeStrokeRef.current);
  };

  return (
    <>
      {/* Translucent Highlighter Ink Canvas with mix-blend-multiply so dark text remains 100% legible */}
      <canvas
        ref={markerCanvasRef}
        style={{
          width: `${width}px`,
          height: `${height}px`,
        }}
        className="print:hidden pointer-events-none absolute inset-0 z-15 mix-blend-multiply"
      />

      {/* Interactive Pen / Pointer Capture Canvas */}
      <canvas
        ref={penCanvasRef}
        style={{
          width: `${width}px`,
          height: `${height}px`,
          touchAction: isInkInteractive ? 'none' : 'auto',
          cursor: isInkInteractive ? CENTERED_CROSSHAIR_CURSOR : 'auto',
        }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={finishPointer}
        onPointerCancel={finishPointer}
        onLostPointerCapture={finishPointer}
        className={`print:hidden absolute inset-0 z-20 ${
          isInkInteractive ? 'pointer-events-auto' : 'pointer-events-none'
        }`}
      />
    </>
  );
};
