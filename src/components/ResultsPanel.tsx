import { useRef, useEffect, useState, useMemo } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { AnalysisResult, Gap } from '../types';
import RadiusStatsPanel from './RadiusChart';

interface Props {
  result: AnalysisResult | null;
  error: string | null;
  hiddenGapIndices: Set<number>;
  onShowAllGaps: () => void;
  onHideAllGaps: () => void;
  onToggleGap: (index: number) => void;
  selectedGapIds: Set<number>;
  onSelectGap: (id: number | number[] | null, mode?: 'select' | 'deselect' | 'toggle' | 'clear') => void;
  isSyncViewport: boolean;
  onToggleSyncViewport: () => void;
  visibleGapIdsInViewport: Set<number>;
}

export default function ResultsPanel({ result, error, hiddenGapIndices, onShowAllGaps, onHideAllGaps, onToggleGap, selectedGapIds, onSelectGap, isSyncViewport, onToggleSyncViewport, visibleGapIdsInViewport }: Props) {
  const allHidden = result ? hiddenGapIndices.size === result.gaps.length : false;

  return (
    <aside className="w-80 bg-white border-l border-gray-200 flex flex-col overflow-hidden shrink-0">
      <div className="p-4 border-b border-gray-100 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-800 uppercase tracking-wide">Analysis</h2>
        {result && (
          <button
            onClick={() => allHidden ? onShowAllGaps() : onHideAllGaps()}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium transition-all
              ${allHidden
                ? 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                : 'bg-blue-50 text-blue-600 hover:bg-blue-100'}`}
            title={allHidden ? 'Show all overlays' : 'Hide all overlays'}
          >
            {allHidden ? <EyeOffIcon /> : <EyeIcon />}
            {allHidden ? 'Show All' : 'Hide All'}
          </button>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="p-4">
          <p className="text-sm text-red-600 bg-red-50 rounded-lg p-3">{error}</p>
        </div>
      )}

      {/* Waiting state */}
      {!result && !error && (
        <div className="flex flex-col items-center justify-center flex-1 gap-3 text-center py-12">
          <svg className="w-10 h-10 text-gray-300" fill="none" viewBox="0 0 24 24"
               stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round"
              d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19.8 15.3M14.25 3.104c.251.023.501.05.75.082M19.8 15.3l-1.57.393A9.065 9.065 0 0112 15a9.065 9.065 0 00-6.23-.693L5 14.5m14.8.8 1.402 1.402c1.232 1.232.65 3.318-1.067 3.611A48.309 48.309 0 0112 21a48.25 48.25 0 01-8.135-.687c-1.718-.293-2.3-2.379-1.067-3.61L5 14.5" />
          </svg>
          <div>
            <p className="text-sm font-medium text-gray-500">Waiting for analysis</p>
            <p className="text-xs text-gray-400 mt-1">
              Click "Change to Greyscale" in the toolbar to begin
            </p>
          </div>
        </div>
      )}

      {/* Results */}
      {result && (
        <>
          {/* Summary + Stats — fixed block, not part of the virtual scroll */}
          <div className="p-4 flex flex-col gap-6 border-b border-gray-100">
            <section>
              <h3 className="text-xs font-semibold text-gray-500 uppercase mb-3">Summary</h3>
              <dl className="flex flex-col gap-2">
                <div className="flex justify-between text-sm">
                  <dt className="text-gray-600">Total Gaps</dt>
                  <dd className="font-medium text-gray-900">
                    {result.gap_count.toLocaleString()}
                  </dd>
                </div>
                <div className="flex justify-between text-sm">
                  <dt className="text-gray-600">Image Size</dt>
                  <dd className="font-medium text-gray-900">
                    {result.image_size.width} × {result.image_size.height}
                  </dd>
                </div>
              </dl>
            </section>

            {result.radius_stats && (
              <section>
                <h3 className="text-xs font-semibold text-gray-500 uppercase mb-3">
                  Radius Statistics (px)
                </h3>
                <RadiusStatsPanel stats={result.radius_stats} />
              </section>
            )}
          </div>

          {/* Virtualized gap list — takes all remaining height */}
          {result.gaps.length > 0 && (
            <GapList
              gaps={result.gaps}
              hiddenGapIndices={hiddenGapIndices}
              onToggleGap={onToggleGap}
              selectedGapIds={selectedGapIds}
              onSelectGap={onSelectGap}
              isSyncViewport={isSyncViewport}
              onToggleSyncViewport={onToggleSyncViewport}
              visibleGapIdsInViewport={visibleGapIdsInViewport}
            />
          )}
        </>
      )}
    </aside>
  );
}

// ─── Virtualized gap list ────────────────────────────────────────────────────

const ITEM_HEIGHT = 36; // px — must match the rendered row height

interface GapListProps {
  gaps: Gap[];
  hiddenGapIndices: Set<number>;
  onToggleGap: (index: number) => void;
  selectedGapIds: Set<number>;
  onSelectGap: (id: number | number[] | null, mode?: 'select' | 'deselect' | 'toggle' | 'clear') => void;
  isSyncViewport: boolean;
  onToggleSyncViewport: () => void;
  visibleGapIdsInViewport: Set<number>;
}

function GapList({ gaps, hiddenGapIndices, onToggleGap, selectedGapIds, onSelectGap, isSyncViewport, onToggleSyncViewport, visibleGapIdsInViewport }: GapListProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [lastSelectedId, setLastSelectedId] = useState<number | null>(null);
  const [lastSelectedIndex, setLastSelectedIndex] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState<'all' | 'selected'>('all');

  const selectedCount = selectedGapIds.size;

  // Auto-switch to "all" if "selected" becomes empty
  useEffect(() => {
    if (activeTab === 'selected' && selectedCount === 0) {
      setActiveTab('all');
    }
  }, [selectedCount, activeTab]);

  const displayIndices = useMemo(() => {
    if (activeTab === 'selected') {
      // Sort them so they appear in order of index even if selected out of order
      return Array.from(selectedGapIds).sort((a, b) => a - b);
    }

    const all = gaps.map((_, i) => i);
    if (!isSyncViewport) return all;
    return all.filter(i => visibleGapIdsInViewport.has(i));
  }, [gaps, isSyncViewport, visibleGapIdsInViewport, activeTab, selectedGapIds]);

  const virtualizer = useVirtualizer({
    count: displayIndices.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ITEM_HEIGHT,
    overscan: 10,
  });

  // Auto-scroll to selected gap when it changes (e.g. from canvas click)
  useEffect(() => {
    // Only scroll to the MOST RECENTLY selected gap
    const latest = Array.from(selectedGapIds).pop();
    if (latest !== undefined && latest !== lastSelectedId) {
      setLastSelectedId(latest);
      
      // Auto-switch to "Selected" tab when a selection occurs
      if (activeTab !== 'selected') {
        setActiveTab('selected');
      }

      const displayIndex = displayIndices.indexOf(latest);
      if (displayIndex !== -1) {
        virtualizer.scrollToIndex(displayIndex, { align: 'center' });
      }
    } else if (selectedGapIds.size === 0) {
      setLastSelectedId(null);
    }
  }, [selectedGapIds, virtualizer, lastSelectedId, displayIndices, activeTab]);

  const handleItemClick = (e: React.MouseEvent, currentIndex: number) => {
    const originalIndex = displayIndices[currentIndex];
    
    if (e.shiftKey && lastSelectedIndex !== null) {
      const start = Math.min(lastSelectedIndex, currentIndex);
      const end = Math.max(lastSelectedIndex, currentIndex);
      const idsInRange = displayIndices.slice(start, end + 1);
      onSelectGap(idsInRange, 'select');
    } else {
      onSelectGap(originalIndex, 'toggle');
      setLastSelectedIndex(currentIndex);
    }
  };

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      {/* Tab Control */}
      <div className="flex border-b border-gray-100 bg-gray-50/50 p-1 gap-1">
        <button
          onClick={() => setActiveTab('all')}
          className={`flex-1 py-1.5 text-[11px] font-semibold uppercase tracking-wider rounded transition-all
            ${activeTab === 'all' 
              ? 'bg-white text-blue-600 shadow-sm border border-gray-200' 
              : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100/50'}`}
        >
          All Gaps
        </button>
        <button
          onClick={() => setActiveTab('selected')}
          disabled={selectedCount === 0}
          className={`flex-1 py-1.5 text-[11px] font-semibold uppercase tracking-wider rounded transition-all
            ${activeTab === 'selected' 
              ? 'bg-white text-blue-600 shadow-sm border border-gray-200' 
              : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100/50 disabled:opacity-30 disabled:hover:bg-transparent'}`}
        >
          Selected ({selectedCount})
        </button>
      </div>

      {/* Section header + viewport sync toggle — fixed, outside the scroll */}
      <div className={`px-4 py-2.5 border-b border-gray-100 shrink-0 flex flex-col gap-1.5 transition-all
        ${activeTab === 'selected' ? 'opacity-40 pointer-events-none grayscale' : ''}`}>
        <h3 className="text-xs font-semibold text-gray-500 uppercase">
          Gaps ({displayIndices.length.toLocaleString()}{displayIndices.length !== gaps.length ? ` / ${gaps.length.toLocaleString()}` : ''})
        </h3>
        <label className="flex items-center gap-2 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={isSyncViewport}
            onChange={onToggleSyncViewport}
            className="rounded border-gray-300 text-blue-600 focus:ring-blue-500 h-3.5 w-3.5"
          />
          <span className="text-[11px] text-gray-400">Show only visible on screen</span>
        </label>
      </div>

      {/* Scrollable viewport — the virtualizer measures this element */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        {/* Spacer div that gives the scrollbar its full range */}
        <div style={{ height: `${virtualizer.getTotalSize()}px`, position: 'relative' }}>
          {virtualizer.getVirtualItems().map(vRow => {
            const originalIndex = displayIndices[vRow.index];
            const gap = gaps[originalIndex];
            const isHidden = hiddenGapIndices.has(originalIndex);

            const isSelected = selectedGapIds.has(originalIndex);

            return (
              <div
                key={vRow.key}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  height: `${vRow.size}px`,
                  transform: `translateY(${vRow.start}px)`,
                }}
              >
                <div
                  onClick={(e) => handleItemClick(e, vRow.index)}
                  className={`flex items-center gap-2 h-full px-4 text-sm cursor-pointer
                    transition-colors select-none
                    ${isSelected
                      ? 'bg-yellow-100 border-l-4 border-yellow-400'
                      : 'hover:bg-gray-50 border-l-4 border-transparent'}
                    ${isHidden ? 'opacity-40' : ''}`}
                >
                  <button
                    onClick={(e) => { e.stopPropagation(); onToggleGap(originalIndex); }}
                    title={isHidden ? 'Show overlay' : 'Hide overlay'}
                    className="shrink-0 text-gray-400 hover:text-gray-700 transition-colors"
                    aria-label={`Toggle visibility for gap ${originalIndex + 1}`}
                  >
                    {isHidden ? <EyeOffIcon /> : <EyeIcon />}
                  </button>
                  <span className={`flex-1 ${isSelected ? 'text-yellow-800 font-medium' : 'text-gray-700'}`}>
                    Gap {originalIndex + 1}
                  </span>
                  <span className={`text-xs font-mono text-right leading-tight ${isSelected ? 'text-yellow-700' : 'text-gray-400'}`}>
                    r={gap.equiv_radius_px.toFixed(1)} px<br/>
                    A={gap.area_px.toLocaleString()} px²
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── Icons ───────────────────────────────────────────────────────────────────

function EyeIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round"
        d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.964-7.178Z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round"
        d="M3.98 8.223A10.477 10.477 0 0 0 1.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.451 10.451 0 0 1 12 4.5c4.756 0 8.773 3.162 10.065 7.498a10.522 10.522 0 0 1-4.293 5.774M6.228 6.228 3 3m3.228 3.228 3.65 3.65m7.894 7.894L21 21m-3.228-3.228-3.65-3.65m0 0a3 3 0 1 0-4.243-4.243m4.242 4.242L9.88 9.88" />
    </svg>
  );
}
