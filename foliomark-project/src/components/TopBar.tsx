import React from 'react';
import { Printer } from 'lucide-react';

export type AppView = 'studio' | 'extension' | 'install';

interface TopBarProps {
  activeView: AppView;
  onChangeView: (view: AppView) => void;
  onExportPdf: () => void;
}

export const TopBar: React.FC<TopBarProps> = ({
  activeView,
  onChangeView,
  onExportPdf,
}) => {
  const navItems: Array<{ id: AppView; label: string }> = [
    { id: 'studio', label: 'Studio' },
    { id: 'extension', label: 'Extension Code' },
    { id: 'install', label: 'Install Guide' },
  ];

  return (
    <header className="no-print h-14 bg-white border-b border-slate-200 px-6 flex items-center justify-between gap-8 shrink-0">
      <a
        href="#studio"
        onClick={(e) => {
          e.preventDefault();
          onChangeView('studio');
        }}
        className="font-display text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700"
      >
        FolioMark
      </a>

      <nav className="flex items-center gap-6" aria-label="Primary Navigation">
        {navItems.map((item) => {
          const isActive = activeView === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onChangeView(item.id)}
              className={`relative py-4 text-sm font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-blue-700 ${
                isActive ? 'text-slate-900' : 'text-slate-500 hover:text-slate-900'
              }`}
            >
              {item.label}
              {isActive && (
                <span className="absolute inset-x-0 bottom-0 h-0.5 bg-blue-700" />
              )}
            </button>
          );
        })}
      </nav>

      <div className="shrink-0">
        <button
          type="button"
          onClick={onExportPdf}
          className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700"
        >
          <Printer className="w-3.5 h-3.5" aria-hidden="true" />
          Export PDF
        </button>
      </div>
    </header>
  );
};
