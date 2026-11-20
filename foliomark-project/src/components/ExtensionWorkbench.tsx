import React, { useState } from 'react';
import { Check, Copy, Download, FileCode2, FolderGit2, FolderTree, Terminal } from 'lucide-react';
import {
  EXTENSION_FILES,
  downloadExtensionZip,
  downloadFullProjectZip,
} from '../extension/extensionRegistry';

interface ExtensionWorkbenchProps {
  mode: 'extension' | 'install';
}

export const ExtensionWorkbench: React.FC<ExtensionWorkbenchProps> = ({ mode }) => {
  const [selectedPath, setSelectedPath] = useState(EXTENSION_FILES[0].path);
  const [copiedPath, setCopiedPath] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [downloadingProject, setDownloadingProject] = useState(false);

  const selectedFile =
    EXTENSION_FILES.find((f) => f.path === selectedPath) || EXTENSION_FILES[0];

  const handleCopy = async () => {
    await navigator.clipboard.writeText(selectedFile.content);
    setCopiedPath(selectedFile.path);
    setTimeout(() => setCopiedPath(null), 1800);
  };

  const handleDownloadZip = async () => {
    setDownloading(true);
    try {
      await downloadExtensionZip();
    } finally {
      setDownloading(false);
    }
  };

  const handleDownloadProjectZip = async () => {
    setDownloadingProject(true);
    try {
      await downloadFullProjectZip();
    } finally {
      setDownloadingProject(false);
    }
  };

  if (mode === 'install') {
    return (
      <div className="flex-1 overflow-y-auto bg-[#F4F5F7] py-10 px-6">
        <div className="max-w-4xl mx-auto space-y-8">
          <div className="bg-white border border-slate-200 rounded-xl p-8">
            <div className="flex flex-wrap items-start justify-between gap-4 pb-6 border-b border-slate-200">
              <div>
                <h1 className="font-display text-2xl font-bold tracking-tight text-slate-900">
                  Load Unpacked Manifest V3 Extension
                </h1>
                <p className="mt-2 text-sm text-slate-600 max-w-2xl leading-relaxed">
                  Download the Chrome / Edge extension bundle to load locally, or download the
                  full GitHub Pages-ready project repository (Web Studio + Extension + Actions workflow).
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2.5">
                <button
                  type="button"
                  onClick={handleDownloadProjectZip}
                  disabled={downloadingProject}
                  className="inline-flex items-center gap-2 px-4 py-2.5 text-xs font-semibold text-slate-800 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg transition-colors cursor-pointer whitespace-nowrap shrink-0"
                >
                  <FolderGit2 className="w-4 h-4 text-slate-600" />
                  {downloadingProject ? 'Packaging Project...' : 'Download Full Project (.zip)'}
                </button>
                <button
                  type="button"
                  onClick={handleDownloadZip}
                  disabled={downloading}
                  className="inline-flex items-center gap-2 px-4 py-2.5 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-lg transition-colors cursor-pointer whitespace-nowrap shrink-0"
                >
                  <Download className="w-4 h-4" />
                  {downloading ? 'Packaging ZIP...' : 'Download Extension (.zip)'}
                </button>
              </div>
            </div>

            <div className="grid md:grid-cols-2 gap-8 pt-6">
              <div className="space-y-5">
                <h2 className="font-display text-base font-semibold text-slate-900">
                  01. Chrome &amp; Edge Installation Steps
                </h2>
                <ol className="space-y-4 text-sm text-slate-700">
                  <li className="flex gap-3">
                    <span className="font-mono text-xs font-semibold text-blue-700 pt-0.5 tabular-nums">
                      01
                    </span>
                    <span>
                      Download and unzip <code className="font-mono text-xs bg-slate-100 px-1.5 py-0.5 rounded">foliomark-mv3-extension.zip</code> to a local folder.
                    </span>
                  </li>
                  <li className="flex gap-3">
                    <span className="font-mono text-xs font-semibold text-blue-700 pt-0.5 tabular-nums">
                      02
                    </span>
                    <span>
                      Open <code className="font-mono text-xs bg-slate-100 px-1.5 py-0.5 rounded">chrome://extensions</code> (or <code className="font-mono text-xs bg-slate-100 px-1.5 py-0.5 rounded">edge://extensions</code>).
                    </span>
                  </li>
                  <li className="flex gap-3">
                    <span className="font-mono text-xs font-semibold text-blue-700 pt-0.5 tabular-nums">
                      03
                    </span>
                    <span>
                      Enable <strong>Developer mode</strong> in the upper-right corner of the extensions page.
                    </span>
                  </li>
                  <li className="flex gap-3">
                    <span className="font-mono text-xs font-semibold text-blue-700 pt-0.5 tabular-nums">
                      04
                    </span>
                    <span>
                      Click <strong>Load unpacked</strong> and select the unzipped <code className="font-mono text-xs bg-slate-100 px-1.5 py-0.5 rounded">foliomark-extension</code> directory containing <code className="font-mono text-xs bg-slate-100 px-1.5 py-0.5 rounded">manifest.json</code>.
                    </span>
                  </li>
                  <li className="flex gap-3">
                    <span className="font-mono text-xs font-semibold text-blue-700 pt-0.5 tabular-nums">
                      05
                    </span>
                    <span>
                      For local <code className="font-mono text-xs bg-slate-100 px-1.5 py-0.5 rounded">file:///...pdf</code> documents, open extension <strong>Details</strong> and enable <strong>Allow access to file URLs</strong>.
                    </span>
                  </li>
                </ol>
              </div>

              <div className="space-y-5">
                <h2 className="font-display text-base font-semibold text-slate-900">
                  02. Architecture &amp; Keyboard Shortcuts
                </h2>
                <div className="border border-slate-200 rounded-lg divide-y divide-slate-200 text-xs">
                  <div className="p-3 flex items-center justify-between">
                    <span className="font-medium text-slate-800">Toggle Toolbar &amp; Side Panel</span>
                    <kbd className="font-mono px-2 py-0.5 bg-slate-100 border border-slate-200 rounded text-slate-700">
                      Alt + Shift + A
                    </kbd>
                  </div>
                  <div className="p-3 flex items-center justify-between">
                    <span className="font-medium text-slate-800">Free-Form Text Box Tool</span>
                    <kbd className="font-mono px-2 py-0.5 bg-slate-100 border border-slate-200 rounded text-slate-700">
                      Alt + Shift + T
                    </kbd>
                  </div>
                  <div className="p-3 flex items-center justify-between">
                    <span className="font-medium text-slate-800">Pointer Events Pen Tool</span>
                    <kbd className="font-mono px-2 py-0.5 bg-slate-100 border border-slate-200 rounded text-slate-700">
                      Alt + Shift + P
                    </kbd>
                  </div>
                  <div className="p-3 flex items-center justify-between">
                    <span className="font-medium text-slate-800">Storage Backend</span>
                    <span className="font-mono text-slate-600">chrome.storage.local + IndexedDB</span>
                  </div>
                </div>

                <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-600 leading-relaxed">
                  <div className="flex items-center gap-1.5 font-semibold text-slate-900 mb-1">
                    <Terminal className="w-3.5 h-3.5 text-blue-700" />
                    Shadow DOM &amp; Print Isolation
                  </div>
                  The floating toolbar and highlight popovers render inside an isolated Shadow DOM root
                  so host site CSS never collides with FolioMark controls, while{' '}
                  <code className="font-mono bg-white px-1 rounded border border-slate-200">@media print</code>{' '}
                  strips extension chrome during PDF export.
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col lg:flex-row overflow-hidden bg-[#F4F5F7]">
      {/* File Explorer Sidebar */}
      <aside className="w-full lg:w-72 bg-white border-b lg:border-b-0 lg:border-r border-slate-200 flex flex-col shrink-0">
        <div className="p-4 border-b border-slate-200 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-900">
            <FolderTree className="w-4 h-4 text-blue-700" />
            <span>Manifest V3 Source</span>
          </div>
          <button
            type="button"
            onClick={handleDownloadZip}
            disabled={downloading}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0"
          >
            <Download className="w-3.5 h-3.5" />
            {downloading ? 'Zipping...' : 'Download ZIP'}
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {EXTENSION_FILES.map((file) => {
            const active = file.path === selectedPath;
            return (
              <button
                key={file.path}
                type="button"
                onClick={() => setSelectedPath(file.path)}
                className={`w-full text-left px-3 py-2 rounded-md text-xs font-mono transition-colors flex items-center gap-2 cursor-pointer ${
                  active
                    ? 'bg-blue-50 text-blue-800 font-semibold'
                    : 'text-slate-700 hover:bg-slate-100'
                }`}
              >
                <FileCode2 className="w-3.5 h-3.5 shrink-0 opacity-70" />
                <span className="truncate">{file.path}</span>
              </button>
            );
          })}
        </div>
      </aside>

      {/* Code Viewer */}
      <section className="flex-1 flex flex-col overflow-hidden bg-white">
        <div className="px-6 py-3.5 border-b border-slate-200 flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="font-mono text-sm font-semibold text-slate-900">
              {selectedFile.path}
            </div>
            <p className="text-xs text-slate-500 mt-0.5">{selectedFile.description}</p>
          </div>

          <button
            type="button"
            onClick={handleCopy}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg transition-colors cursor-pointer whitespace-nowrap shrink-0"
          >
            {copiedPath === selectedFile.path ? (
              <>
                <Check className="w-3.5 h-3.5 text-emerald-600" />
                Copied
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5" />
                Copy File
              </>
            )}
          </button>
        </div>

        <div className="flex-1 overflow-auto bg-slate-950 p-6">
          <pre className="font-mono text-xs leading-relaxed text-slate-200 whitespace-pre">
            <code>{selectedFile.content}</code>
          </pre>
        </div>
      </section>
    </div>
  );
};
