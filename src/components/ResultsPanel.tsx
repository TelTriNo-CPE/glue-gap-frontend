import { useRef, useEffect, useState, useMemo } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { AnalysisResult, DetectionVersion, Gap } from '../types';
import RadiusStatsPanel from './RadiusChart';

// ─── Calibration constants ────────────────────────────────────────────────────
const AREA_FACTOR = 0.871076; // µm² per px²

interface Props {
  width?: number;
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
  detectionHistory: DetectionVersion[];
  activeVersionId: string | null;
  onSwitchVersion: (id: string) => void;
  onDeleteVersion: (id: string) => void;
}

export default function ResultsPanel({ width = 320, result, error, hiddenGapIndices, onShowAllGaps, onHideAllGaps, onToggleGap, selectedGapIds, onSelectGap, isSyncViewport, onToggleSyncViewport, visibleGapIdsInViewport, detectionHistory, activeVersionId, onSwitchVersion, onDeleteVersion }: Props) {
  const allHidden = result ? hiddenGapIndices.size === result.gaps.length : false;
  
  const [topSectionHeight, setTopSectionHeight] = useState(350);
  const [isDragging, setIsDragging] = useState(false);
  const [activeTab, setActiveTab] = useState<'all' | 'selected'>('all');

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      // Clamp between 200px and window height - 200px
      const newHeight = Math.max(200, Math.min(e.clientY, window.innerHeight - 200));
      setTopSectionHeight(newHeight);
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging]);

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  useEffect(() => {
    if (activeTab === 'selected' && selectedGapIds.size === 0) {
      setActiveTab('all');
    }
  }, [selectedGapIds.size, activeTab]);

  const displayIndices = useMemo(() => {
    if (!result) return [];
    if (activeTab === 'selected') {
      return Array.from(selectedGapIds).sort((a, b) => a - b);
    }
    const all = result.gaps.map((_, i) => i);
    if (!isSyncViewport) return all;
    return all.filter(i => visibleGapIdsInViewport.has(i));
  }, [result, isSyncViewport, visibleGapIdsInViewport, activeTab, selectedGapIds]);

  const totalDisplayedAreaUm = useMemo(() => {
    if (!result) return 0;
    return displayIndices.reduce((sum, i) => sum + result.gaps[i].area_px, 0) * AREA_FACTOR;
  }, [displayIndices, result]);

  const selectedAreaUm = useMemo(() => {
    if (!result) return 0;
    let sum = 0;
    for (const i of selectedGapIds) sum += result.gaps[i].area_px;
    return sum * AREA_FACTOR;
  }, [selectedGapIds, result]);

  const totalAbsoluteAreaUm = useMemo(() => {
    if (!result) return 0;
    return result.gaps.reduce((sum, g) => sum + g.area_px, 0) * AREA_FACTOR;
  }, [result]);

  return (
    <aside 
      className="bg-white border-l border-gray-200 flex flex-col overflow-hidden shrink-0"
      style={{ userSelect: isDragging ? 'none' : 'auto', width }}
    >
      <div className="p-4 border-b border-gray-100 flex items-center justify-between shrink-0">
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

      {result ? (
        <>
          <div 
            style={{ height: topSectionHeight }}
            className="flex flex-col overflow-y-auto shrink-0 bg-white"
          >
            {/* Version selector */}
            {detectionHistory.length > 0 && activeVersionId && (
              <div className="px-4 py-2 border-b border-gray-100 bg-gray-50/50 flex items-center gap-2">
                <select
                  value={activeVersionId}
                  onChange={e => onSwitchVersion(e.target.value)}
                  className="flex-1 text-xs bg-white border border-gray-200 rounded-md px-2 py-1.5
                            text-gray-700 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                >
                  {detectionHistory.map(v => (
                    <option key={v.id} value={v.id}>
                      v{v.versionNumber} (Sens: {v.params.sensitivity}, Min: {v.params.minArea})
                    </option>
                  ))}
                </select>
                <button
                  onClick={() => onDeleteVersion(activeVersionId)}
                  className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-md transition-all"
                  title="Delete this version"
                >
                  <TrashIcon />
                </button>
              </div>
            )}

            {/* Error */}
            {error && (
              <div className="p-4">
                <p className="text-sm text-red-600 bg-red-50 rounded-lg p-3">{error}</p>
              </div>
            )}

            {/* Summary + Stats */}
            <div className="p-4 flex flex-col gap-6">
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
                  <div className="border-t border-gray-100 my-1" />
                  <div className="flex justify-between text-xs font-mono">
                    <dt className="text-gray-500">Listed Area</dt>
                    <dd className="text-gray-700">{totalDisplayedAreaUm.toLocaleString(undefined, { maximumFractionDigits: 2 })} µm²</dd>
                  </div>
                  <div className="flex justify-between text-xs font-mono">
                    <dt className="text-indigo-500 font-medium">Selected Area</dt>
                    <dd className="text-indigo-700 font-medium">{selectedAreaUm.toLocaleString(undefined, { maximumFractionDigits: 2 })} µm²</dd>
                  </div>
                  <div className="flex justify-between text-sm font-mono mt-1">
                    <dt className="text-blue-600 font-bold uppercase text-[10px]">Total Area</dt>
                    <dd className="text-blue-600 font-bold">{totalAbsoluteAreaUm.toLocaleString(undefined, { maximumFractionDigits: 2 })} µm²</dd>
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
          </div>

          {/* Draggable Divider */}
          <div 
            onMouseDown={handleMouseDown}
            className="h-2 bg-gray-100 hover:bg-blue-400 cursor-row-resize active:bg-blue-500 
                       transition-colors flex items-center justify-center shrink-0 group border-y border-gray-200"
          >
            <div className="flex gap-1">
              <div className="w-1 h-1 rounded-full bg-gray-300 group-hover:bg-blue-100" />
              <div className="w-1 h-1 rounded-full bg-gray-300 group-hover:bg-blue-100" />
              <div className="w-1 h-1 rounded-full bg-gray-300 group-hover:bg-blue-100" />
            </div>
          </div>

          {/* Bottom section: Tabs + List */}
          <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
            {/* Tab Control */}
            <div className="border-b border-gray-100 bg-gray-50/50 p-1 gap-1 flex shrink-0">
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
                disabled={selectedGapIds.size === 0}
                className={`flex-1 py-1.5 text-[11px] font-semibold uppercase tracking-wider rounded transition-all
                  ${activeTab === 'selected' 
                    ? 'bg-white text-blue-600 shadow-sm border border-gray-200' 
                    : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100/50 disabled:opacity-30 disabled:hover:bg-transparent'}`}
              >
                Selected ({selectedGapIds.size})
              </button>
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
                activeTab={activeTab}
                onTabChange={setActiveTab}
                displayIndices={displayIndices}
              />
            )}
          </div>
        </>
      ) : (
        <>
          {/* Waiting/Error state */}
          <div className="flex flex-col flex-1 overflow-y-auto">
            {error && (
              <div className="p-4">
                <p className="text-sm text-red-600 bg-red-50 rounded-lg p-3">{error}</p>
              </div>
            )}
            {!error && (
              <div className="flex flex-col items-center justify-center flex-1 gap-3 text-center py-12">
                <svg className="w-10 h-10 text-gray-300" fill="none" viewBox="0 0 24 24"
                    stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round"
                    d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19.8 15.3M14.25 3.104c.251.023.501.05.75.082M19.8 15.3l-1.57.393A9.065 9.065 0 0112 15a9.065 9.065 0 00-6.23-.693L5 14.5m14.8.8 1.402 1.402c1.232 1.232.65 3.318-1.067 3.611A48.309 48.309 0 0112 21a48.25 48.25 0 01-8.135-.687c-1.718-.293-2.3-2.379-1.067-3.61L5 14.5" />
                </svg>
                <div>
                  <p className="text-sm font-medium text-gray-500">Waiting for analysis</p>
                  <p className="text-xs text-gray-400 mt-1">
                    Click "Switch to Greyscale" in the toolbar to begin
                  </p>
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </aside>
  );
}

// ─── Virtualized gap list ────────────────────────────────────────────────────

const ITEM_HEIGHT = 52; // px — must match the rendered row height

interface GapListProps {
  gaps: Gap[];
  hiddenGapIndices: Set<number>;
  onToggleGap: (index: number) => void;
  selectedGapIds: Set<number>;
  onSelectGap: (id: number | number[] | null, mode?: 'select' | 'deselect' | 'toggle' | 'clear') => void;
  isSyncViewport: boolean;
  onToggleSyncViewport: () => void;
  visibleGapIdsInViewport: Set<number>;
  activeTab: 'all' | 'selected';
  onTabChange: (tab: 'all' | 'selected') => void;
  displayIndices: number[];
}

function GapList({ gaps, hiddenGapIndices, onToggleGap, selectedGapIds, onSelectGap, isSyncViewport, onToggleSyncViewport, visibleGapIdsInViewport, activeTab, onTabChange, displayIndices }: GapListProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [lastSelectedId, setLastSelectedId] = useState<number | null>(null);
  const [lastSelectedIndex, setLastSelectedIndex] = useState<number | null>(null);

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
        onTabChange('selected');
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
                    {(gap.area_px * AREA_FACTOR).toLocaleString(undefined, { maximumFractionDigits: 2 })} µm²<br/>
                    <span className="opacity-60">({gap.area_px.toLocaleString()} px²)</span>
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

function TrashIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.342 10.822m-5.512 0L8.54 9m4.836-9.178a.75.75 0 0 1 .197.89l-.11.228m-2.203-1.118a.75.75 0 0 0-.197.89l.11.228M3.75 5.25h16.5m-14.25 0v13.5A2.25 2.25 0 0 0 8.25 21h7.5a2.25 2.25 0 0 0 2.25-2.25V5.25m-12 0V3.75A2.25 2.25 0 0 1 10.5 1.5h3a2.25 2.25 0 0 1 2.25 2.25V5.25" />
    </svg>
  );
}
