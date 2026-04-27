import { useCallback, useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { saveAnalysisGaps } from '../api';
import type { AnalysisResult, ClickMode, DetectionVersion, Gap } from '../types';
import useGapHistory from '../hooks/useGapHistory';
import Toolbar from './Toolbar';
import OsdViewer from './OsdViewer';
import ResultsPanel from './ResultsPanel';

interface Props {
  fileKey: string;
  onReset: () => void;
}

const ANALYZE_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
const TOAST_DURATION_MS  = 10_000;
const INFO_TOAST_DURATION_MS = 3_000;
const DESKTOP_BREAKPOINT = 1024;
const LEFT_PANEL_WIDTH = 256;
const RIGHT_PANEL_WIDTH = 320;
const DEFAULT_OUTLINE_COLOR = '#ff0000';
const DEFAULT_FILL_COLOR = '#ff0000';
const DEFAULT_SELECTED_COLOR = '#eab308';
const EDIT_HISTORY_LIMIT = 30;
const EMPTY_GAPS: Gap[] = [];

function getIsDesktop() {
  return typeof window !== 'undefined' && window.innerWidth >= DESKTOP_BREAKPOINT;
}

export default function AnalysisView({ fileKey, onReset }: Props) {
  const [selectedGapIds, setSelectedGapIds] = useState<Set<number>>(new Set());
  const fileStem = fileKey.replace(/\.[^.]+$/, '');
  
  const viewerContainerRef = useRef<HTMLDivElement>(null);

  const [detectionHistory, setDetectionHistory]  = useState<DetectionVersion[]>([]);
  const [activeVersionId,  setActiveVersionId]   = useState<string | null>(null);

  const activeVersion = detectionHistory.find(v => v.id === activeVersionId) ?? null;
  const result = activeVersion?.result ?? null;
  const [analyzing,        setAnalyzing]         = useState(false);
  const [parsing,          setParsing]           = useState(false);
  const [analyzeError,     setAnalyzeError]      = useState<string | null>(null);
  const [toast,            setToast]             = useState<string | null>(null);
  const [infoToast,        setInfoToast]         = useState<string | null>(null);
  const [grayscale,        setGrayscale]         = useState(false);
  const [hideUnselected,   setHideUnselected]    = useState(false);
  const [isOutlineOnly,    setIsOutlineOnly]     = useState(false);
  const [hiddenGapIndices, setHiddenGapIndices]  = useState<Set<number>>(new Set());
  const [clickMode,        setClickMode]         = useState<ClickMode>('select');
  const [brushSize,        setBrushSize]         = useState(20);
  const [isSaving,         setIsSaving]          = useState(false);
  const [isSyncViewport,   setIsSyncViewport]    = useState(false);
  const [visibleGapIdsInViewport, setVisibleGapIdsInViewport] = useState<Set<number>>(new Set());
  const [sensitivity,  setSensitivity]  = useState(50);
  const [minArea,      setMinArea]      = useState(20);
  const [wandTolerance, setWandTolerance] = useState(32);
  const [showMinimap,  setShowMinimap]  = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [outlineColor, setOutlineColor] = useState(DEFAULT_OUTLINE_COLOR);
  const [fillColor, setFillColor] = useState(DEFAULT_FILL_COLOR);
  const [selectedColor, setSelectedColor] = useState(DEFAULT_SELECTED_COLOR);
  const {
    present,
    hasEdits,
    canUndo,
    canRedo,
    commit: commitGapEdits,
    undo,
    redo,
    reset: resetGapEdits,
  } = useGapHistory(result?.gaps ?? null, EDIT_HISTORY_LIMIT);

  const displayGaps = present ?? result?.gaps ?? EMPTY_GAPS;
  const analysisStem = result?.stem ?? fileStem;

  // Safety net: clamp stale selection/hidden indices whenever displayGaps shrinks
  useEffect(() => {
    const count = displayGaps.length;
    setSelectedGapIds(prev => {
      let needsClamp = false;
      for (const id of prev) { if (id >= count) { needsClamp = true; break; } }
      if (!needsClamp) return prev;
      const next = new Set<number>();
      for (const id of prev) { if (id < count) next.add(id); }
      return next;
    });
    setHiddenGapIndices(prev => {
      let needsClamp = false;
      for (const id of prev) { if (id >= count) { needsClamp = true; break; } }
      if (!needsClamp) return prev;
      const next = new Set<number>();
      for (const id of prev) { if (id < count) next.add(id); }
      return next;
    });
  }, [displayGaps.length]);

  const [isDesktop, setIsDesktop] = useState(getIsDesktop);
  const [isLeftPanelOpen, setIsLeftPanelOpen] = useState(getIsDesktop);
  const [isRightPanelOpen, setIsRightPanelOpen] = useState(getIsDesktop);
  const [leftWidth, setLeftWidth] = useState(LEFT_PANEL_WIDTH);
  const [rightWidth, setRightWidth] = useState(RIGHT_PANEL_WIDTH);
  const [draggingPanel, setDraggingPanel] = useState<'left' | 'right' | null>(null);
  const [layoutTick, setLayoutTick] = useState(0);

  useEffect(() => {
    const handleResize = () => {
      const desktop = getIsDesktop();

      setIsDesktop(prev => {
        if (prev !== desktop) {
          setIsLeftPanelOpen(desktop);
          setIsRightPanelOpen(desktop);
        }
        return desktop;
      });

      if (desktop) {
        setLeftWidth(prev => Math.min(Math.max(prev, 220), Math.floor(window.innerWidth * 0.35)));
        setRightWidth(prev => Math.min(Math.max(prev, 280), Math.floor(window.innerWidth * 0.4)));
      }
    };

    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    const timers = [0, 150, 320].map(delay =>
      setTimeout(() => {
        window.dispatchEvent(new Event('resize'));
        setLayoutTick(prev => prev + 1);
      }, delay),
    );

    return () => timers.forEach(clearTimeout);
  }, [isDesktop, isLeftPanelOpen, isRightPanelOpen, leftWidth, rightWidth, isFullscreen]);

  useEffect(() => {
    if (!draggingPanel) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (draggingPanel === 'left') {
        const newWidth = e.clientX;
        if (newWidth < 150) {
          setIsLeftPanelOpen(false);
          setDraggingPanel(null);
        } else {
          setLeftWidth(Math.min(newWidth, window.innerWidth / 2));
          setIsLeftPanelOpen(true);
        }
      } else if (draggingPanel === 'right') {
        const newWidth = window.innerWidth - e.clientX;
        if (newWidth < 150) {
          setIsRightPanelOpen(false);
          setDraggingPanel(null);
        } else {
          setRightWidth(Math.min(newWidth, window.innerWidth / 2));
          setIsRightPanelOpen(true);
        }
      }
    };

    const handleMouseUp = () => setDraggingPanel(null);

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [draggingPanel]);

  // Sync fullscreen state with native browser event (e.g. Esc key)
  useEffect(() => {
    const handler = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handler);
    return () => document.removeEventListener('fullscreenchange', handler);
  }, []);

  function toggleFullscreen() {
    if (!document.fullscreenElement) {
      viewerContainerRef.current?.requestFullscreen().catch(err => {
        console.error(`Error attempting to enable full-screen mode: ${err.message}`);
      });
    } else {
      document.exitFullscreen();
    }
  }

  // Auto-dismiss toast after TOAST_DURATION_MS
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), TOAST_DURATION_MS);
    return () => clearTimeout(t);
  }, [toast]);

  // Auto-dismiss info toast after INFO_TOAST_DURATION_MS
  useEffect(() => {
    if (!infoToast) return;
    const t = setTimeout(() => setInfoToast(null), INFO_TOAST_DURATION_MS);
    return () => clearTimeout(t);
  }, [infoToast]);

  function handleGreyscale() {
    setGrayscale(prev => !prev);
  }

  const clearGapInteractionState = useCallback(() => {
    setSelectedGapIds(new Set());
    setHiddenGapIndices(new Set());
  }, []);

  function handleSelectGap(
    id: number | number[] | null,
    mode: 'select' | 'deselect' | 'toggle' | 'clear' = 'select'
  ) {
    if (id === null || mode === 'clear') {
      setSelectedGapIds(new Set());
      return;
    }

    const ids = Array.isArray(id) ? id : [id];
    let idsToUnhide: number[] = [];

    setSelectedGapIds(prev => {
      const next = new Set(prev);
      const added: number[] = [];
      for (const currentId of ids) {
        if (mode === 'toggle') {
          if (next.has(currentId)) {
            next.delete(currentId);
          } else {
            next.add(currentId);
            added.push(currentId);
          }
        } else if (mode === 'select') {
          next.add(currentId);
          // Always unhide on explicit select (row click / canvas click),
          // even if the gap was already in the set.
          added.push(currentId);
        } else if (mode === 'deselect') {
          next.delete(currentId);
        }
      }
      idsToUnhide = added;
      return next;
    });

    // Auto-unhide only gaps that were actually added to the selection.
    // This ensures the eye-icon toggle (which calls toggleGap directly,
    // not handleSelectGap) is never overridden.
    if (idsToUnhide.length > 0) {
      setHiddenGapIndices(prev => {
        const next = new Set(prev);
        let changed = false;
        for (const currentId of idsToUnhide) {
          if (next.has(currentId)) {
            next.delete(currentId);
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    }
  }

  function toggleGap(index: number) {
    setHiddenGapIndices(prev => {
      const next = new Set(prev);
      next.has(index) ? next.delete(index) : next.add(index);
      return next;
    });
  }

  function showAllGaps() {
    setHiddenGapIndices(new Set());
  }

  function hideAllGaps() {
    if (displayGaps.length === 0) return;
    setHiddenGapIndices(new Set(displayGaps.map((_, i) => i)));
  }

  function selectAllGaps() {
    if (displayGaps.length === 0) return;
    setSelectedGapIds(new Set(displayGaps.map((_, i) => i)));
    setHiddenGapIndices(new Set());
  }

  function deselectAllGaps() {
    setSelectedGapIds(new Set());
  }

  const handleGapsModified = useCallback((newGaps: Gap[]) => {
    const oldCount = displayGaps.length;
    if (!commitGapEdits(newGaps)) return;

    const newCount = newGaps.length;

    // Show contextual info toast when gap count changes
    // Note: magic-wand fires its own toast via onInfoToast, so skip here.
    if (clickMode !== 'magic-wand') {
      if (newCount < oldCount) {
        const diff = oldCount - newCount;
        if (clickMode === 'brush') {
          setInfoToast(diff === 1 ? 'Gaps merged' : `${diff + 1} gaps merged`);
        } else {
          setInfoToast(diff === 1 ? 'Gap deleted' : `${diff} gaps deleted`);
        }
      } else if (newCount > oldCount) {
        setInfoToast('Gap split into multiple pieces');
      }
    }

    // Clamp selection & hidden to valid indices instead of clearing
    setSelectedGapIds(prev => {
      const next = new Set<number>();
      for (const id of prev) {
        if (id < newCount) next.add(id);
      }
      return next.size === prev.size ? prev : next;
    });
    setHiddenGapIndices(prev => {
      const next = new Set<number>();
      for (const id of prev) {
        if (id < newCount) next.add(id);
      }
      return next.size === prev.size ? prev : next;
    });
  }, [commitGapEdits, displayGaps.length, clickMode]);

  const clampInteractionState = useCallback((gapCount: number) => {
    setSelectedGapIds(prev => {
      const next = new Set<number>();
      for (const id of prev) {
        if (id < gapCount) next.add(id);
      }
      return next.size === prev.size ? prev : next;
    });
    setHiddenGapIndices(prev => {
      const next = new Set<number>();
      for (const id of prev) {
        if (id < gapCount) next.add(id);
      }
      return next.size === prev.size ? prev : next;
    });
  }, []);

  const handleUndo = useCallback(() => {
    if (undo()) {
      // After undo, the present changes — clamp to new length.
      // We read from the hook's returned `present` on next render,
      // but we need the count now. The undo() call already updated
      // the internal state, so `present` will update on next render.
      // Use displayGaps length as a safe fallback; the clamp effect
      // below will catch any remaining stale indices.
      clampInteractionState(displayGaps.length);
    }
  }, [clampInteractionState, displayGaps.length, undo]);

  const handleRedo = useCallback(() => {
    if (redo()) {
      clampInteractionState(displayGaps.length);
    }
  }, [clampInteractionState, displayGaps.length, redo]);

  const handleResetEdits = useCallback(() => {
    resetGapEdits();
    clearGapInteractionState();
  }, [clearGapInteractionState, resetGapEdits]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || isEditableTarget(event.target)) return;
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;

      const key = event.key.toLowerCase();

      if (key === 'z') {
        if (event.shiftKey) {
          if (!canRedo || isSaving) return;
          event.preventDefault();
          handleRedo();
          return;
        }

        if (!canUndo || isSaving) return;
        event.preventDefault();
        handleUndo();
        return;
      }

      if (key === 'y' && !event.shiftKey) {
        if (!canRedo || isSaving) return;
        event.preventDefault();
        handleRedo();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [canRedo, canUndo, handleRedo, handleUndo, isSaving]);

  async function handleSaveEdits() {
    if (!result || !present || isSaving) return;

    setIsSaving(true);

    try {
      const updatedResult = await saveAnalysisGaps(analysisStem, present);

      setDetectionHistory(prev =>
        prev.map(version =>
          version.id === activeVersionId
            ? {
                ...version,
                result: updatedResult,
              }
            : version,
        ),
      );

      resetGapEdits();
      clearGapInteractionState();
      setVisibleGapIdsInViewport(new Set());
    } catch (err: unknown) {
      setToast(extractErrorMessage(err));
    } finally {
      setIsSaving(false);
    }
  }

  function switchVersion(id: string) {
    setActiveVersionId(id);
    resetGapEdits();
    clearGapInteractionState();
    setVisibleGapIdsInViewport(new Set());
  }

  function deleteVersion(versionId: string) {
    if (!window.confirm('Are you sure you want to delete this version?')) return;

    setDetectionHistory(prev => {
      const next = prev.filter(v => v.id !== versionId);

      if (activeVersionId === versionId) {
        if (next.length > 0) {
          // Set to the most recent one (last in array)
          setActiveVersionId(next[next.length - 1].id);
        } else {
          // History empty, full reset
          setActiveVersionId(null);
          setSelectedGapIds(new Set());
          setHiddenGapIndices(new Set());
          setVisibleGapIdsInViewport(new Set());
        }
      }
      return next;
    });
  }

  async function handleDetect() {
    setAnalyzing(true);
    setAnalyzeError(null);
    try {
      // responseType: 'text' lets us control exactly when JSON.parse blocks
      // the main thread (see setParsing below).
      const { data: raw } = await axios.post<string>(
        '/analyze-gaps',
        { key: fileKey, sensitivity, minArea },
        {
          responseType: 'text',
          timeout: ANALYZE_TIMEOUT_MS,
        },
      );

      // Switch overlay to "Parsing…" and yield one frame so the browser can
      // paint the message before JSON.parse blocks the thread.
      setAnalyzing(false);
      setParsing(true);
      await new Promise<void>(res => setTimeout(res, 32));

      const r: AnalysisResult = JSON.parse(raw);
      const newVersion: DetectionVersion = {
        id: crypto.randomUUID(),
        versionNumber: detectionHistory.length + 1,
        timestamp: new Date(),
        params: { sensitivity, minArea },
        result: r,
      };
      setDetectionHistory(prev => [...prev, newVersion]);
      setActiveVersionId(newVersion.id);
      resetGapEdits();
      clearGapInteractionState();
      setVisibleGapIdsInViewport(new Set());
    } catch (err: unknown) {
      const message = extractErrorMessage(err);
      setAnalyzeError(message);
      setToast(message);
    } finally {
      // Guaranteed: spinner always stops, regardless of success or failure.
      setAnalyzing(false);
      setParsing(false);
    }
  }

  const overlayVisible = analyzing || parsing;
  const mobileLeftPanelWidth = Math.min(leftWidth, 320);
  const mobileRightPanelWidth = Math.min(rightWidth, 360);

  function openLeftPanel() {
    setIsLeftPanelOpen(true);
    if (!isDesktop) setIsRightPanelOpen(false);
  }

  function openRightPanel() {
    setIsRightPanelOpen(true);
    if (!isDesktop) setIsLeftPanelOpen(false);
  }

  function closePanels() {
    setIsLeftPanelOpen(false);
    setIsRightPanelOpen(false);
  }

  function resetAppearanceColors() {
    setOutlineColor(DEFAULT_OUTLINE_COLOR);
    setFillColor(DEFAULT_FILL_COLOR);
    setSelectedColor(DEFAULT_SELECTED_COLOR);
  }

  return (
    <div 
      className="flex h-screen w-full overflow-hidden bg-gray-950"
      style={{ userSelect: draggingPanel ? 'none' : 'auto' }}
    >

      {/* Error toast — top-centre, auto-dismisses */}
      {toast && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-50 flex items-start gap-3
                        max-w-lg w-full mx-4 bg-red-950 border border-red-700 text-red-200
                        rounded-xl shadow-2xl px-4 py-3 text-sm">
          {/* Warning icon */}
          <svg className="w-5 h-5 shrink-0 text-red-400 mt-0.5" fill="none"
               viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round"
              d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
          </svg>
          <span className="flex-1">{toast}</span>
          <button
            onClick={() => setToast(null)}
            className="shrink-0 text-red-400 hover:text-red-200 transition-colors"
            aria-label="Dismiss"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24"
                 stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}

      {/* Info toast — bottom-centre, auto-dismisses */}
      {infoToast && (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-50
                        bg-gray-800 border border-gray-600 text-gray-100
                        rounded-full shadow-xl px-4 py-2 text-xs font-medium
                        flex items-center gap-2 animate-[fadeIn_0.15s_ease-out]">
          <svg className="w-4 h-4 shrink-0 text-blue-400" fill="none"
               viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round"
              d="m11.25 11.25.041-.02a.75.75 0 0 1 1.063.852l-.708 2.836a.75.75 0 0 0 1.063.853l.041-.021M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9-3.75h.008v.008H12V8.25Z" />
          </svg>
          {infoToast}
        </div>
      )}

      {/* Full-screen processing overlay */}
      {overlayVisible && (
        <div className="absolute inset-0 z-40 flex flex-col items-center justify-center
                        bg-gray-950/80 backdrop-blur-sm gap-4">
          <svg className="w-10 h-10 animate-spin text-blue-400" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10"
                    stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          <div className="text-center">
            <p className="text-white text-sm font-medium">
              {parsing ? 'Parsing results…' : 'Detecting gaps…'}
            </p>
            <p className="text-gray-400 text-xs mt-1">
              {parsing
                ? 'Processing large dataset — please wait'
                : 'Analysing image for glue gaps (up to 5 min)'}
            </p>
          </div>
        </div>
      )}

      <div 
        ref={viewerContainerRef}
        className="flex flex-1 h-full min-w-0 min-h-0 bg-gray-950 relative overflow-hidden"
      >
        {/* Left Panel (Toolbar) */}
        <div 
          className={`
            ${isDesktop ? 'relative h-full' : 'fixed inset-y-0 left-0 z-50 shadow-2xl'}
            transition-all duration-300 ease-in-out overflow-hidden bg-gray-900 shrink-0
            ${isDesktop ? '' : 'max-w-[85vw]'}
            ${isDesktop ? (isLeftPanelOpen ? 'translate-x-0' : 'translate-x-0') : (isLeftPanelOpen ? 'translate-x-0' : '-translate-x-full')}
          `}
          style={{ width: isLeftPanelOpen ? (isDesktop ? leftWidth : mobileLeftPanelWidth) : 0 }}
        >
          <Toolbar
            width={isDesktop ? leftWidth : mobileLeftPanelWidth}
            stem={analysisStem}
            fileKey={fileKey}
            isGreyscale={grayscale}
            hideUnselected={hideUnselected}
            isOutlineOnly={isOutlineOnly}
            hasResult={result !== null}
            analyzing={overlayVisible}
            onGreyscale={handleGreyscale}
            onToggleHideUnselected={() => setHideUnselected(prev => !prev)}
            onToggleOutlineOnly={() => setIsOutlineOnly(prev => !prev)}
            onDetect={handleDetect}
            onReset={onReset}
            clickMode={clickMode}
            setClickMode={setClickMode}
            brushSize={brushSize}
            onBrushSizeChange={setBrushSize}
            canUndo={canUndo}
            canRedo={canRedo}
            hasEdits={hasEdits}
            isSaving={isSaving}
            onUndo={handleUndo}
            onRedo={handleRedo}
            onSaveEdits={handleSaveEdits}
            onResetEdits={handleResetEdits}
            sensitivity={sensitivity}
            onSensitivityChange={setSensitivity}
            minArea={minArea}
            onMinAreaChange={setMinArea}
            showMinimap={showMinimap}
            onToggleMinimap={() => setShowMinimap(prev => !prev)}
            isFullscreen={isFullscreen}
            onToggleFullscreen={toggleFullscreen}
            onSelectAll={selectAllGaps}
            onDeselectAll={deselectAllGaps}
            outlineColor={outlineColor}
            fillColor={fillColor}
            selectedColor={selectedColor}
            onOutlineColorChange={setOutlineColor}
            onFillColorChange={setFillColor}
            onSelectedColorChange={setSelectedColor}
            onResetColors={resetAppearanceColors}
            wandTolerance={wandTolerance}
            onWandToleranceChange={setWandTolerance}
          />
        </div>

        {/* Left Resizer */}
        {isDesktop && isLeftPanelOpen && (
          <div
            onMouseDown={() => setDraggingPanel('left')}
            className="w-1 bg-gray-800 hover:bg-blue-600 cursor-col-resize transition-colors shrink-0 z-10"
          />
        )}

        {/* Middle Panel (Viewer + Toggles) */}
        <div className="flex-1 relative flex flex-col h-full min-w-0 min-h-0">
          {/* Mobile Toggles */}
          {!isDesktop && (
            <div className="absolute top-4 left-4 right-4 z-30 flex items-center justify-between gap-3 pointer-events-none">
              <button
                onClick={() => isLeftPanelOpen ? closePanels() : openLeftPanel()}
                className="pointer-events-auto bg-gray-800/80 backdrop-blur text-white p-2.5 rounded-xl border border-gray-700 shadow-xl"
                aria-label={isLeftPanelOpen ? 'Close left panel' : 'Open left panel'}
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}>
                  {isLeftPanelOpen ? (
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
                  ) : (
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 19.5 15.75 12 8.25 4.5" />
                  )}
                </svg>
              </button>
              <div className="pointer-events-none rounded-full bg-black/25 px-3 py-1.5 text-[11px] font-medium uppercase tracking-[0.2em] text-gray-300 backdrop-blur-sm">
                Viewer
              </div>
              <button
                onClick={() => isRightPanelOpen ? closePanels() : openRightPanel()}
                className="pointer-events-auto bg-gray-800/80 backdrop-blur text-white p-2.5 rounded-xl border border-gray-700 shadow-xl"
                aria-label={isRightPanelOpen ? 'Close right panel' : 'Open right panel'}
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}>
                  {isRightPanelOpen ? (
                    <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
                  ) : (
                    <path strokeLinecap="round" strokeLinejoin="round" d="m15.75 4.5-7.5 7.5 7.5 7.5" />
                  )}
                </svg>
              </button>
            </div>
          )}

          {/* Desktop Edge Toggles */}
          {isDesktop && !isFullscreen && (
            <>
              <button
                onClick={() => setIsLeftPanelOpen(prev => !prev)}
                className="absolute left-0 top-1/2 z-30 -translate-y-1/2 rounded-r-lg border border-l-0 border-gray-700 bg-gray-800/85 p-1.5 text-gray-300 shadow-lg backdrop-blur transition-all duration-300 hover:bg-gray-700 hover:text-white"
                title={isLeftPanelOpen ? 'Collapse left panel' : 'Expand left panel'}
                aria-label={isLeftPanelOpen ? 'Collapse left panel' : 'Expand left panel'}
              >
                <svg
                  className={`h-8 w-4 transition-transform duration-300 ${isLeftPanelOpen ? '' : 'rotate-180'}`}
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2.6}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
                </svg>
              </button>

              <button
                onClick={() => setIsRightPanelOpen(prev => !prev)}
                className="absolute right-0 top-1/2 z-30 -translate-y-1/2 rounded-l-lg border border-r-0 border-gray-700 bg-gray-800/85 p-1.5 text-gray-300 shadow-lg backdrop-blur transition-all duration-300 hover:bg-gray-700 hover:text-white"
                title={isRightPanelOpen ? 'Collapse right panel' : 'Expand right panel'}
                aria-label={isRightPanelOpen ? 'Collapse right panel' : 'Expand right panel'}
              >
                <svg
                  className={`h-8 w-4 transition-transform duration-300 ${isRightPanelOpen ? '' : 'rotate-180'}`}
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2.6}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
                </svg>
              </button>
            </>
          )}

          <div className="flex-1 relative h-full min-w-0 min-h-0">
            <OsdViewer
              stem={analysisStem}
              gaps={displayGaps}
              hiddenGapIndices={hiddenGapIndices}
              hideUnselected={hideUnselected}
              isOutlineOnly={isOutlineOnly}
              showMinimap={showMinimap}
              isFullscreen={isFullscreen}
              clickMode={clickMode}
              grayscale={grayscale}
              selectedGapIds={selectedGapIds}
              onSelectGap={handleSelectGap}
              onVisibleGapsChange={setVisibleGapIdsInViewport}
              layoutSignal={layoutTick}
              outlineColor={outlineColor}
              fillColor={fillColor}
              selectedColor={selectedColor}
              brushSize={brushSize}
              onGapsModified={handleGapsModified}
              imageSize={result?.image_size ?? null}
              wandTolerance={wandTolerance}
              onInfoToast={setInfoToast}
            />
          </div>
        </div>

        {/* Right Resizer */}
        {isDesktop && isRightPanelOpen && !isFullscreen && (
          <div
            onMouseDown={() => setDraggingPanel('right')}
            className="w-1 bg-gray-800 hover:bg-blue-600 cursor-col-resize transition-colors shrink-0 z-10"
          />
        )}

        {/* Right Panel (Results) */}
        <div 
          className={`
            ${isDesktop ? 'relative h-full' : 'fixed inset-y-0 right-0 z-50 shadow-2xl'}
            transition-all duration-300 ease-in-out overflow-hidden bg-gray-900 shrink-0
            ${isDesktop ? '' : 'max-w-[92vw]'}
            ${isDesktop ? (isRightPanelOpen ? 'translate-x-0' : 'translate-x-0') : (isRightPanelOpen ? 'translate-x-0' : 'translate-x-full')}
          `}
          style={{ width: isRightPanelOpen ? (isDesktop ? rightWidth : mobileRightPanelWidth) : 0 }}
        >
          {!isFullscreen && (
            <ResultsPanel
              width={isDesktop ? rightWidth : mobileRightPanelWidth}
              result={result}
              gaps={displayGaps}
              error={analyzeError}
              hiddenGapIndices={hiddenGapIndices}
              onToggleGap={toggleGap}
              onShowAllGaps={showAllGaps}
              onHideAllGaps={hideAllGaps}
              selectedGapIds={selectedGapIds}
              onSelectGap={handleSelectGap}
              isSyncViewport={isSyncViewport}
              onToggleSyncViewport={() => setIsSyncViewport(prev => !prev)}
              visibleGapIdsInViewport={visibleGapIdsInViewport}
              detectionHistory={detectionHistory}
              activeVersionId={activeVersionId}
              onSwitchVersion={switchVersion}
              onDeleteVersion={deleteVersion}
            />
          )}
        </div>

        {/* Mobile Backdrop */}
        {!isDesktop && (isLeftPanelOpen || isRightPanelOpen) && (
          <div 
            onClick={closePanels}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40 transition-opacity duration-300"
          />
        )}
      </div>
    </div>
  );
}

// ─── Error message extraction ────────────────────────────────────────────────

function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  if (target.isContentEditable || target.closest('[contenteditable="true"]')) {
    return true;
  }

  return target instanceof HTMLInputElement
    || target instanceof HTMLTextAreaElement
    || target instanceof HTMLSelectElement;
}

function extractErrorMessage(err: unknown): string {
  if (!axios.isAxiosError(err)) {
    return 'An unexpected error occurred. Please try again.';
  }

  // Axios timeout (ECONNABORTED) or cancelled (ERR_CANCELED)
  if (err.code === 'ECONNABORTED' || err.code === 'ERR_CANCELED') {
    return 'Request timed out after 5 minutes. The backend may still be processing — check server logs.';
  }

  // Server responded with an error status
  if (err.response) {
    const status = err.response.status;
    const d = err.response.data;

    // FastAPI returns { detail: "..." } for HTTP exceptions
    const detail: string | undefined =
      typeof d === 'string'
        ? d
        : (d as Record<string, unknown>)?.detail as string | undefined
          ?? (d as Record<string, unknown>)?.message as string | undefined;

    if (detail) return `Server error (${status}): ${detail}`;
    return `Server returned status ${status}. Check backend logs for details.`;
  }

  // Request was made but no response arrived (network down, CORS, etc.)
  if (err.request) {
    return 'No response from server. Make sure the backend is running on port 8080.';
  }

  return err.message ?? 'Analysis failed. Please try again.';
}
