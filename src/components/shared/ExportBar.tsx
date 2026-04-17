'use client';

import { Calendar, Download, Loader2 } from 'lucide-react';

interface ExportBarProps {
  onSchedule: () => void;
  onDownload: () => void;
  disabled?: boolean;
  isProcessing?: boolean;
  progress?: number;
  creditCost?: number;
}

export function ExportBar({
  onSchedule,
  onDownload,
  disabled = false,
  isProcessing = false,
  progress,
  creditCost,
}: ExportBarProps) {
  return (
    <div className="fixed bottom-0 left-0 right-0 z-40 border-t border-gray-800 bg-gray-900/95 backdrop-blur-sm lg:left-64">
      {isProcessing && progress !== undefined && (
        <div className="h-1 w-full bg-gray-800">
          <div
            className="h-full bg-gradient-to-r from-purple-500 to-pink-500 transition-all duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>
      )}
      <div className="flex items-center justify-between px-4 sm:px-6 py-3 max-w-5xl mx-auto">
        <div className="text-xs text-gray-400">
          {isProcessing ? (
            <span className="flex items-center gap-2 text-purple-300">
              <Loader2 size={14} className="animate-spin" />
              Export en cours... {progress !== undefined && `${progress}%`}
            </span>
          ) : creditCost ? (
            <span>
              Coût : <span className="font-bold text-yellow-400">{creditCost} crédits</span>
            </span>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={onSchedule}
            disabled={disabled || isProcessing}
            className="flex items-center gap-2 rounded-xl bg-gray-800 border border-gray-700 px-4 py-2.5 text-sm font-medium text-gray-200 hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
          >
            <Calendar size={16} />
            Planifier
          </button>
          <button
            onClick={onDownload}
            disabled={disabled || isProcessing}
            className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-purple-600 to-pink-600 px-4 py-2.5 text-sm font-bold text-white hover:from-purple-700 hover:to-pink-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
          >
            {isProcessing ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <Download size={16} />
            )}
            Télécharger
          </button>
        </div>
      </div>
    </div>
  );
}
