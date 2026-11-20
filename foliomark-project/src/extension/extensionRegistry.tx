import JSZip from 'jszip';
import type { ExtensionFileEntry } from '../types/annotation';

import manifestRaw from '../../extension/manifest.json?raw';
import backgroundRaw from '../../extension/background.js?raw';
import contentRaw from '../../extension/content.js?raw';
import contentCssRaw from '../../extension/styles/content.css?raw';
import sidebarHtmlRaw from '../../extension/sidebar/sidebar.html?raw';
import sidebarCssRaw from '../../extension/sidebar/sidebar.css?raw';
import sidebarJsRaw from '../../extension/sidebar/sidebar.js?raw';
import readmeRaw from '../../extension/README.md?raw';

import icon16Url from '../../extension/icons/icon16.png?url';
import icon48Url from '../../extension/icons/icon48.png?url';
import icon128Url from '../../extension/icons/icon128.png?url';
import selfRaw from './extensionRegistry.ts?raw';

const ROOT_FILE_LOADERS = import.meta.glob<string>(
  [
    '/package.json',
    '/tsconfig.json',
    '/vite.config.ts',
    '/index.html',
    '/.gitignore',
    '/.env.example',
    '/metadata.json',
    '/.github/workflows/deploy.yml',
  ],
  {
    query: '?raw',
    import: 'default',
  }
);

const SRC_FILE_LOADERS = import.meta.glob<string>('/src/**/*.{ts,tsx,css}', {
  query: '?raw',
  import: 'default',
});

export const EXTENSION_FILES: ExtensionFileEntry[] = [
  {
    path: 'manifest.json',
    name: 'manifest.json',
    language: 'json',
    description: 'Manifest V3 declaration with service worker, sidePanel, activeTab, storage, scripting, and <all_urls>.',
    content: manifestRaw,
  },
  {
    path: 'background.js',
    name: 'background.js',
    language: 'javascript',
    description: 'Service worker managing tab changes, keyboard commands, side panel toggle, and message routing.',
    content: backgroundRaw,
  },
  {
    path: 'content.js',
    name: 'content.js',
    language: 'javascript',
    description: 'Core content engine: Shadow DOM toolbar, free-form text boxes, Pointer Events ink canvas, highlights, and IndexedDB.',
    content: contentRaw,
  },
  {
    path: 'styles/content.css',
    name: 'styles/content.css',
    language: 'css',
    description: 'Scoped highlight colors, draggable text box chrome, ink overlay canvas, and @media print export rules.',
    content: contentCssRaw,
  },
  {
    path: 'sidebar/sidebar.html',
    name: 'sidebar/sidebar.html',
    language: 'html',
    description: 'Chrome Side Panel HTML layout with search, URL scope toggle, and composite print view.',
    content: sidebarHtmlRaw,
  },
  {
    path: 'sidebar/sidebar.css',
    name: 'sidebar/sidebar.css',
    language: 'css',
    description: 'Side panel layout styling and standalone report @media print formatting.',
    content: sidebarCssRaw,
  },
  {
    path: 'sidebar/sidebar.js',
    name: 'sidebar/sidebar.js',
    language: 'javascript',
    description: 'Side panel controller syncing chrome.storage.local + IndexedDB ink previews and triggering PDF export.',
    content: sidebarJsRaw,
  },
  {
    path: 'README.md',
    name: 'README.md',
    language: 'markdown',
    description: 'Step-by-step instructions to load the unpacked extension into Chrome or Microsoft Edge.',
    content: readmeRaw,
  },
];

export async function downloadExtensionZip(): Promise<void> {
  const zip = new JSZip();
  const root = zip.folder('foliomark-extension');
  if (!root) return;

  for (const file of EXTENSION_FILES) {
    root.file(file.path, file.content);
  }

  const iconPairs: Array<[string, string]> = [
    ['icons/icon16.png', icon16Url],
    ['icons/icon48.png', icon48Url],
    ['icons/icon128.png', icon128Url],
  ];

  await Promise.all(
    iconPairs.map(async ([path, url]) => {
      const res = await fetch(url);
      const buf = await res.arrayBuffer();
      root.file(path, buf);
    })
  );

  const blob = await zip.generateAsync({
    type: 'blob',
    mimeType: 'application/zip',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
    platform: 'DOS',
  });
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = 'foliomark-mv3-extension.zip';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 1500);
}

export async function downloadFullProjectZip(): Promise<void> {
  const zip = new JSZip();

  await Promise.all(
    Object.entries(ROOT_FILE_LOADERS).map(async ([absPath, load]) => {
      const content = await load();
      const relPath = absPath.replace(/^\/+/, '');
      zip.file(relPath, content);
    })
  );

  await Promise.all(
    Object.entries(SRC_FILE_LOADERS).map(async ([absPath, load]) => {
      const content = await load();
      const relPath = absPath.replace(/^\/+/, '');
      zip.file(relPath, content);
    })
  );
  zip.file('src/extension/extensionRegistry.ts', selfRaw);

  for (const file of EXTENSION_FILES) {
    zip.file(`extension/${file.path}`, file.content);
  }

  const iconPairs: Array<[string, string]> = [
    ['extension/icons/icon16.png', icon16Url],
    ['extension/icons/icon48.png', icon48Url],
    ['extension/icons/icon128.png', icon128Url],
  ];

  await Promise.all(
    iconPairs.map(async ([path, url]) => {
      const res = await fetch(url);
      const buf = await res.arrayBuffer();
      zip.file(path, buf);
    })
  );

  const blob = await zip.generateAsync({
    type: 'blob',
    mimeType: 'application/zip',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
    platform: 'DOS',
  });
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = 'foliomark-project.zip';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 1500);
}
