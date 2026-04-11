import { useState } from 'react';
import { analyzeGaps } from '../api';
import type { AnalysisResult } from '../types';
import Toolbar from './Toolbar';
import OsdViewer from './OsdViewer';
import ResultsPanel from './ResultsPanel';

interface Props {
  fileKey: string;
  onReset: () => void;
}

export default function AnalysisView({ fileKey, onReset }: Props) {
  const stem = fileKey.replace(/\.[^.]+$/, '');

  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);
  const [grayscale, setGrayscale] = useState(false);
  const [hiddenGapIndices, setHiddenGapIndices] = useState<Set<number>>(new Set());

  async function handleAnalyze() {
    setGrayscale(true);
    setAnalyzing(true);
    setAnalyzeError(null);
    try {
      const r = await analyzeGaps(fileKey);
      setResult(r);
    } catch {
      setAnalyzeError('Analysis failed. Please try again.');
      setGrayscale(false);
    } finally {
      setAnalyzing(false);
    }
  }

  function toggleGap(index: number) {
    setHiddenGapIndices(prev => {
      const next = new Set(prev);
      next.has(index) ? next.delete(index) : next.add(index);
      return next;
    });
  }

  return (
    <div className="flex h-screen bg-gray-950 overflow-hidden">
      <Toolbar
        stem={stem}
        fileKey={fileKey}
        hasResult={result !== null}
        analyzing={analyzing}
        onAnalyze={handleAnalyze}
        onReset={onReset}
      />
      <OsdViewer
        stem={stem}
        gaps={result?.gaps ?? []}
        imageSize={result?.image_size ?? { width: 0, height: 0 }}
        hiddenGapIndices={hiddenGapIndices}
        grayscale={grayscale}
      />
      <ResultsPanel
        result={result}
        error={analyzeError}
        hiddenGapIndices={hiddenGapIndices}
        onToggleGap={toggleGap}
      />
    </div>
  );
}
