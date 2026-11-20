# FolioMark — Manifest V3 Browser Extension

FolioMark lets you annotate any web page or PDF file with:
- **Free-form keyboard text boxes** placed anywhere on the document or PDF viewport
- **Pointer Events ink drawing** supporting mouse, touch screens, and pressure-sensitive styluses (`touch-action: none`)
- **Multi-color text highlights & sticky notes** persisted across reloads and SPA route transitions
- **Side Panel Dashboard** to search, jump to, edit, and export all annotations to PDF (`window.print()`)

## Loading the Unpacked Extension in Chrome or Edge

1. Open `chrome://extensions` (Chrome) or `edge://extensions` (Microsoft Edge).
2. Enable **Developer mode** using the toggle in the top-right corner.
3. Click **Load unpacked**.
4. Select this `extension/` folder containing `manifest.json`.
5. Pin **FolioMark** to your browser toolbar and click the icon on any webpage or PDF to open the floating toolbar and Side Panel dashboard.

### Note on Local `file://` PDFs
If you want to annotate local PDF files opened directly in Chrome/Edge (`file:///...pdf`), open the FolioMark extension **Details** page in `chrome://extensions` and toggle on **Allow access to file URLs**.
