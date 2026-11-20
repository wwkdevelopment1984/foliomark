export type AnnotationTool = 'select' | 'text' | 'pen' | 'marker' | 'eraser';

export type HighlightColor =
  | 'yellow'
  | 'amber'
  | 'mint'
  | 'teal'
  | 'sky'
  | 'lavender'
  | 'rose'
  | 'peach';

export type TextBoxBgStyle =
  | 'transparent'
  | 'paper'
  | 'warm'
  | 'mint'
  | 'sky'
  | 'rose'
  | 'slate';

export type DocumentKind = 'web' | 'pdf';

export interface TextBoxAnnotation {
  id: string;
  docId: string;
  /** X coordinate normalized at zoom = 1.0 (in CSS px relative to page container) */
  x: number;
  /** Y coordinate normalized at zoom = 1.0 (in CSS px relative to page container) */
  y: number;
  /** Optional 1-indexed PDF page number when attached to a PDF page */
  pageNumber?: number;
  text: string;
  fontSize: number;
  color: string;
  bgStyle: TextBoxBgStyle;
  createdAt: number;
}

export interface InkPoint {
  x: number;
  y: number;
  p: number;
}

export interface InkStroke {
  id: string;
  docId: string;
  pageNumber?: number;
  tool: 'pen' | 'marker';
  color: string;
  width: number;
  opacity: number;
  points: InkPoint[];
  createdAt: number;
}

export interface HighlightAnnotation {
  id: string;
  docId: string;
  pageNumber?: number;
  quote: string;
  color: HighlightColor;
  note: string;
  /** Bounding boxes normalized at zoom = 1.0 relative to page container */
  rects?: Array<{ left: number; top: number; width: number; height: number }>;
  createdAt: number;
}

export interface DocumentMeta {
  docId: string;
  title: string;
  url: string;
  kind: DocumentKind;
  updatedAt: number;
}

export interface DocumentAnnotations {
  meta: DocumentMeta;
  textBoxes: TextBoxAnnotation[];
  highlights: HighlightAnnotation[];
  strokes: InkStroke[];
}

export interface ExtensionFileEntry {
  path: string;
  name: string;
  language: 'json' | 'javascript' | 'css' | 'html' | 'markdown';
  description: string;
  content: string;
}

export const HIGHLIGHT_PALETTE: Record<
  HighlightColor,
  { label: string; fill: string; swatch: string; border: string }
> = {
  yellow: {
    label: 'Canary Yellow',
    fill: 'rgba(254, 240, 138, 0.38)',
    swatch: '#fef08a',
    border: '#eab308',
  },
  amber: {
    label: 'Warm Amber',
    fill: 'rgba(253, 211, 77, 0.34)',
    swatch: '#fcd34d',
    border: '#d97706',
  },
  mint: {
    label: 'Mint Green',
    fill: 'rgba(134, 239, 172, 0.34)',
    swatch: '#86efac',
    border: '#16a34a',
  },
  teal: {
    label: 'Aqua Teal',
    fill: 'rgba(94, 234, 212, 0.34)',
    swatch: '#5eead4',
    border: '#0d9488',
  },
  sky: {
    label: 'Sky Blue',
    fill: 'rgba(125, 211, 252, 0.34)',
    swatch: '#7dd3fc',
    border: '#0284c7',
  },
  lavender: {
    label: 'Soft Lavender',
    fill: 'rgba(196, 181, 253, 0.34)',
    swatch: '#c4b5fd',
    border: '#7c3aed',
  },
  rose: {
    label: 'Rose Pink',
    fill: 'rgba(253, 164, 175, 0.34)',
    swatch: '#fda4af',
    border: '#e11d48',
  },
  peach: {
    label: 'Coral Peach',
    fill: 'rgba(253, 186, 116, 0.34)',
    swatch: '#fdba74',
    border: '#ea580c',
  },
};
