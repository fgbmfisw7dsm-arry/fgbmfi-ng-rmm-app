import React from 'react';
import { BadgeLayout } from '../types';

interface Props {
  layout: BadgeLayout;
  badgeCount: number;
  pageCount: number;
}

const LAYOUT_LABELS: Record<BadgeLayout, string> = {
  '8-up': '8-up Landscape (90×60mm)',
  '10-up': '10-up Landscape (80×55mm)',
  '6-up-portrait': '6-up Portrait (63×95mm)',
  '9-up-portrait': '9-up Portrait (55×80mm)',
  '8-up-portrait': '8-up Portrait (63×90mm)',
  '4-up-3x4': '4-up 3×4″ Portrait (76×102mm)',
};

const BadgePreview: React.FC<Props> = ({ layout, badgeCount, pageCount }) => {
  const isPortrait = layout.includes('portrait') || layout === '4-up-3x4';
  const cols = layout === '8-up' ? 2 : layout === '10-up' ? 2 : layout === '6-up-portrait' ? 3 : layout === '8-up-portrait' ? 4 : layout === '4-up-3x4' ? 2 : 3;
  const rows = layout === '8-up' ? 4 : layout === '10-up' ? 5 : layout === '6-up-portrait' ? 2 : layout === '8-up-portrait' ? 2 : layout === '4-up-3x4' ? 2 : 3;

  if (!badgeCount) return null;

  return (
    <div className="bg-white p-6 rounded-3xl shadow-sm border border-gray-100">
      <h2 className="text-[10px] font-black text-gray-400 uppercase mb-4 tracking-[0.2em]">
        Preview
      </h2>

      <div className="flex flex-col md:flex-row gap-6">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-5 h-5 bg-gray-200 rounded flex items-center justify-center">
              <svg className="w-3 h-3 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
            <span className="text-[10px] font-black text-gray-500 uppercase tracking-wider">
              {LAYOUT_LABELS[layout]}
            </span>
          </div>

          <div
            className="relative border-2 border-gray-300 mx-auto"
            style={{
              width: cols === 2 ? '140px' : '140px',
              height: cols === 2 ? `${rows * 35}px` : `${rows * 30}px`,
              aspectRatio: '210/297',
              maxWidth: '140px',
            }}
          >
            {Array.from({ length: rows }).map((_, row) =>
              Array.from({ length: cols }).map((_, col) => (
                <div
                  key={`${row}-${col}`}
                  className="absolute border border-blue-200 bg-blue-50/30"
                  style={{
                    left: `${(col / cols) * 100}%`,
                    top: `${(row / rows) * 100}%`,
                    width: `${100 / cols}%`,
                    height: `${100 / rows}%`,
                    padding: '2px',
                  }}
                >
                  <div className="h-[15%] bg-red-950/80 rounded-t-sm" />
                  <div className="h-[70%] flex items-center justify-center gap-1 px-1">
                    <div className="w-[30%] h-[60%] bg-slate-800/20 rounded-sm" />
                    <div className="flex-1 space-y-0.5">
                      <div className="h-[10%] bg-slate-200 rounded-sm" />
                      <div className="h-[10%] bg-slate-100 rounded-sm" />
                      <div className="h-[10%] bg-slate-100 rounded-sm" />
                    </div>
                  </div>
                  <div className="h-[15%] bg-blue-500/60 rounded-b-sm" />
                </div>
              ))
            )}
          </div>
        </div>

        <div className="flex-1 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-blue-50 p-4 rounded-xl text-center">
              <p className="text-3xl font-black text-blue-900">{badgeCount}</p>
              <p className="text-[9px] font-bold text-blue-500 uppercase tracking-wider">Badges</p>
            </div>
            <div className="bg-amber-50 p-4 rounded-xl text-center">
              <p className="text-3xl font-black text-amber-900">{pageCount}</p>
              <p className="text-[9px] font-bold text-amber-500 uppercase tracking-wider">A4 Pages</p>
            </div>
          </div>

          <div className="bg-gray-50 p-4 rounded-xl">
            <p className="text-[9px] font-bold text-gray-400 uppercase tracking-wider mb-1">
              Layout Details
            </p>
            <p className="text-[10px] font-bold text-gray-600">
              {cols} columns × {rows} rows per page
            </p>
            <p className="text-[10px] font-bold text-gray-600">
              Crop marks enabled · 3 mm cutting gap
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default BadgePreview;
