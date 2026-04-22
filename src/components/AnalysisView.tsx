import { useState, useEffect } from 'react';
import axios from 'axios';
import type { AnalysisResult } from '../types';
import Toolbar from './Toolbar';
import OsdViewer from './OsdViewer';
import ResultsPanel from './ResultsPanel';

interface Props {
  fileKey: string;
  onReset: () => void;
}

const ANALYZE_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
const TOAST_DURATION_MS  = 10_000;

export default function AnalysisView({ fileKey, onReset }: Props) {
  const [selectedGapIds, setSelectedGapIds] = useState<Set<number>>(new Set());
  const stem = fileKey.replace(/\.[^.]+$/, '');

  const [result,           setResult]           = useState<AnalysisResult | null>(null);
  const [analyzing,        setAnalyzing]         = useState(false);
  const [parsing,          setParsing]           = useState(false);
  const [analyzeError,     setAnalyzeError]      = useState<string | null>(null);
  const [toast,            setToast]             = useState<string | null>(null);
  const [grayscale,        setGrayscale]         = useState(false);
  const [hiddenGapIndices, setHiddenGapIndices]  = useState<Set<number>>(new Set());
  const [clickMode,        setClickMode]         = useState<'select' | 'deselect'>('select');
  const [isSyncViewport,   setIsSyncViewport]    = useState(false);
  const [visibleGapIdsInViewport, setVisibleGapIdsInViewport] = useState<Set<number>>(new Set());

  // Auto-dismiss toast after TOAST_DURATION_MS
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), TOAST_DURATION_MS);
    return () => clearTimeout(t);
  }, [toast]);

  function handleGreyscale() {
    setGrayscale(prev => !prev);
  }

  function handleSelectGap(
    id: number | null,
    mode: 'select' | 'deselect' | 'toggle' | 'clear' = 'select'
  ) {
    if (id === null || mode === 'clear') {
      setSelectedGapIds(new Set());
      return;
    }

    let wasAdded = false;
    setSelectedGapIds(prev => {
      const next = new Set(prev);
      if (mode === 'toggle') {
        if (next.has(id)) {
          next.delete(id);
        } else {
          next.add(id);
          wasAdded = true;
        }
      } else if (mode === 'select') {
        if (!next.has(id)) {
          next.add(id);
          wasAdded = true;
        }
      } else if (mode === 'deselect') {
        next.delete(id);
      }
      return next;
    });

    // Rule 5: Auto-unhide if it was added to the selection
    // Note: Since wasAdded is captured in the closure, it might be stale if multiple
    // calls happen in one turn, but for single clicks this is reliable.
    // Better: Always remove from hidden if we are in 'select' or 'toggle' (optimistic)
    if (mode === 'select' || mode === 'toggle') {
      setHiddenGapIndices(prev => {
        if (!prev.has(id)) return prev;
        const next = new Set(prev);
        next.delete(id);
        return next;
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
    if (!result) return;
    setHiddenGapIndices(new Set(result.gaps.map((_, i) => i)));
  }

  async function handleDetect() {
    setAnalyzing(true);
    setAnalyzeError(null);
    try {
      // responseType: 'text' lets us control exactly when JSON.parse blocks
      // the main thread (see setParsing below).
      const { data: raw } = await axios.post<string>(
        '/analyze-gaps',
        { key: fileKey },
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
      setResult(r);
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

  function toggleGap(index: number) {
    setHiddenGapIndices(prev => {
      const next = new Set(prev);
      next.has(index) ? next.delete(index) : next.add(index);
      return next;
    });
  }

  const overlayVisible = analyzing || parsing;

  return (
    <div className="relative flex h-screen bg-gray-950 overflow-hidden">

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

      <Toolbar
        stem={stem}
        fileKey={fileKey}
        isGreyscale={grayscale}
        hasResult={result !== null}
        analyzing={overlayVisible}
        onGreyscale={handleGreyscale}
        onDetect={handleDetect}
        onReset={onReset}
        clickMode={clickMode}
        setClickMode={setClickMode}
      />
      <OsdViewer
        stem={stem}
        gaps={result?.gaps ?? []}
        hiddenGapIndices={hiddenGapIndices}
        clickMode={clickMode}
        grayscale={grayscale}
        selectedGapIds={selectedGapIds}
        onSelectGap={handleSelectGap}
      />
      <ResultsPanel
        result={result}
        error={analyzeError}
        hiddenGapIndices={hiddenGapIndices}
        onToggleGap={toggleGap}
        onShowAllGaps={showAllGaps}
        onHideAllGaps={hideAllGaps}
        selectedGapIds={selectedGapIds}
        onSelectGap={handleSelectGap}
      />
    </div>
  );
}

// ─── Error message extraction ────────────────────────────────────────────────

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
