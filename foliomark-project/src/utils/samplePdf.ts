import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

/**
 * Generates a crisp, multi-page engineering specification PDF in memory
 * so PDF annotation mode works immediately with real selectable pdf.js text layers.
 */
export async function createSampleSpecPdfBytes(): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const fontMono = await pdfDoc.embedFont(StandardFonts.Courier);

  // Page 1
  const page1 = pdfDoc.addPage([612, 792]);
  const { height } = page1.getSize();

  page1.drawRectangle({
    x: 48,
    y: height - 92,
    width: 516,
    height: 44,
    color: rgb(0.95, 0.96, 0.98),
    borderColor: rgb(0.84, 0.87, 0.92),
    borderWidth: 1,
  });

  page1.drawText('TECHNICAL BRIEF  ·  Q4 ARCHITECTURE REVIEW', {
    x: 62,
    y: height - 67,
    size: 9,
    font: fontBold,
    color: rgb(0.11, 0.31, 0.85),
  });

  page1.drawText('Client-Side Overlay Rendering & Coordinate Persistence', {
    x: 48,
    y: height - 134,
    size: 20,
    font: fontBold,
    color: rgb(0.06, 0.09, 0.16),
  });

  page1.drawText(
    'Prepared for Browser Runtime Engineering  ·  Document ID: SPEC-2026-11',
    {
      x: 48,
      y: height - 156,
      size: 10,
      font: fontRegular,
      color: rgb(0.39, 0.45, 0.55),
    }
  );

  const p1Paragraphs = [
    '1. Executive Summary',
    'Modern web and PDF annotation pipelines must reconcile three distinct coordinate spaces: the',
    'viewport CSS pixel space, the scaled PDF page canvas, and the underlying DOM text node tree.',
    'By normalizing all free-form text stamps and pointer-event vector strokes against a canonical',
    '1.0x document scale factor, annotations remain pixel-accurate across zoom levels and reloads.',
    '',
    '2. Pointer Events & Stylus Pressure Normalization',
    'Touch screens and active styluses emit high-frequency pointermove events that often trigger',
    'unintended browser panning if touch-action CSS rules are omitted. Setting touch-action: none',
    'explicitly on the active ink canvas guarantees uninterrupted stroke capture while preserving',
    'hardware pressure telemetry (e.pressure in [0.0, 1.0]) for variable-width ink rendering.',
  ];

  let cursorY = height - 196;
  p1Paragraphs.forEach((line) => {
    const isHeading = /^\d\.\s/.test(line);
    page1.drawText(line, {
      x: 48,
      y: cursorY,
      size: isHeading ? 12.5 : 10.5,
      font: isHeading ? fontBold : fontRegular,
      color: isHeading ? rgb(0.06, 0.09, 0.16) : rgb(0.2, 0.25, 0.33),
    });
    cursorY -= isHeading ? 20 : 16;
  });

  // Diagram box on Page 1 for users to draw or stamp text onto
  page1.drawRectangle({
    x: 48,
    y: 230,
    width: 516,
    height: 155,
    color: rgb(0.98, 0.99, 1),
    borderColor: rgb(0.79, 0.84, 0.9),
    borderWidth: 1,
  });

  page1.drawText('FIGURE 1: COORDINATE PIPELINE (CLICK ANYWHERE TO ADD TEXT OR DRAW)', {
    x: 62,
    y: 364,
    size: 8.5,
    font: fontBold,
    color: rgb(0.39, 0.45, 0.55),
  });

  const boxes = [
    { x: 66, label: 'Pointer / Keyboard', sub: 'Raw clientX, clientY' },
    { x: 236, label: 'Scale Normalizer', sub: 'Divide by zoom factor' },
    { x: 406, label: 'IndexedDB / Storage', sub: 'Persist & Print Layer' },
  ];
  boxes.forEach((b) => {
    page1.drawRectangle({
      x: b.x,
      y: 268,
      width: 140,
      height: 68,
      color: rgb(1, 1, 1),
      borderColor: rgb(0.11, 0.31, 0.85),
      borderWidth: 1.2,
    });
    page1.drawText(b.label, {
      x: b.x + 12,
      y: 310,
      size: 10,
      font: fontBold,
      color: rgb(0.06, 0.09, 0.16),
    });
    page1.drawText(b.sub, {
      x: b.x + 12,
      y: 290,
      size: 8.5,
      font: fontMono,
      color: rgb(0.39, 0.45, 0.55),
    });
  });

  page1.drawText('Page 1 of 2  ·  Try highlighting any sentence above or placing a text box inside Figure 1.', {
    x: 48,
    y: 48,
    size: 9,
    font: fontRegular,
    color: rgb(0.45, 0.5, 0.6),
  });

  // Page 2
  const page2 = pdfDoc.addPage([612, 792]);
  page2.drawText('3. Storage Tiering & Print Export Pipeline', {
    x: 48,
    y: height - 72,
    size: 14,
    font: fontBold,
    color: rgb(0.06, 0.09, 0.16),
  });

  const p2Lines = [
    'Extension storage imposes strict quota constraints on chrome.storage.local for large',
    'binary blobs. Consequently, FolioMark partitions persistence into two dedicated layers:',
    '',
    '  - Metadata Tier (chrome.storage.local): Text boxes, coordinates, highlight quotes, notes.',
    '  - Vector & Raster Ink Tier (IndexedDB): High-density stroke arrays and PNG snapshots.',
    '',
    'During PDF Export (window.print), interactive toolbar chrome is stripped via @media print',
    'rules while text stamps, ink layers, and mark highlights remain aligned at exact coordinates.',
  ];

  let y2 = height - 108;
  p2Lines.forEach((line) => {
    page2.drawText(line, {
      x: 48,
      y: y2,
      size: 10.5,
      font: fontRegular,
      color: rgb(0.2, 0.25, 0.33),
    });
    y2 -= 17;
  });

  // Sign-off / Review Table on Page 2
  page2.drawRectangle({
    x: 48,
    y: 430,
    width: 516,
    height: 120,
    color: rgb(1, 1, 1),
    borderColor: rgb(0.79, 0.84, 0.9),
    borderWidth: 1,
  });

  page2.drawText('REVIEW SIGN-OFF FORM (TEST FREE-FORM TYPING & PEN SIGNATURE BELOW)', {
    x: 62,
    y: 528,
    size: 8.5,
    font: fontBold,
    color: rgb(0.39, 0.45, 0.55),
  });

  page2.drawText('Reviewer Name:', { x: 62, y: 495, size: 10, font: fontBold, color: rgb(0.2, 0.25, 0.33) });
  page2.drawLine({ start: { x: 155, y: 492 }, end: { x: 340, y: 492 }, thickness: 0.8, color: rgb(0.7, 0.75, 0.82) });

  page2.drawText('Review Date:', { x: 360, y: 495, size: 10, font: fontBold, color: rgb(0.2, 0.25, 0.33) });
  page2.drawLine({ start: { x: 435, y: 492 }, end: { x: 545, y: 492 }, thickness: 0.8, color: rgb(0.7, 0.75, 0.82) });

  page2.drawText('Ink Signature:', { x: 62, y: 455, size: 10, font: fontBold, color: rgb(0.2, 0.25, 0.33) });
  page2.drawLine({ start: { x: 155, y: 452 }, end: { x: 545, y: 452 }, thickness: 0.8, color: rgb(0.7, 0.75, 0.82) });

  page2.drawText('Page 2 of 2  ·  FolioMark Reference Specification PDF', {
    x: 48,
    y: 48,
    size: 9,
    font: fontRegular,
    color: rgb(0.45, 0.5, 0.6),
  });

  return pdfDoc.save();
}
