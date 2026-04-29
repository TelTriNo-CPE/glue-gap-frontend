import { useState } from 'react';
import { createPortal } from 'react-dom';

export interface CalibrationParams {
  scaleNumerator: number;
  scaleDenominator: number;
  physicalScaleLength: number;
}

interface Props {
  onClose: () => void;
  params: CalibrationParams;
  onSave: (params: CalibrationParams) => void;
  imageWidthPx?: number;
}

/**
 * CalibrationModal — always conditionally mounted by the parent so that
 * useState initialises fresh from `params` every time it opens.
 *
 * Math:
 *   scaleBarLengthPx = imageWidthPx × (x / y)
 *   scaleFactor      = z / scaleBarLengthPx   (µm per px)
 *   areaFactor       = scaleFactor²            (µm² per px²)
 */
export default function CalibrationModal({ onClose, params, onSave, imageWidthPx }: Props) {
  const [numerator,   setNumerator]   = useState(params.scaleNumerator);
  const [denominator, setDenominator] = useState(params.scaleDenominator);
  const [physical,    setPhysical]    = useState(params.physicalScaleLength);

  const scaleBarLengthPx =
    imageWidthPx && imageWidthPx > 0 && denominator > 0 && numerator > 0
      ? imageWidthPx * (numerator / denominator)
      : null;

  const scaleFactor =
    scaleBarLengthPx && scaleBarLengthPx > 0 && physical > 0
      ? physical / scaleBarLengthPx
      : null;

  const areaFactor = scaleFactor !== null ? scaleFactor * scaleFactor : null;

  function handleSave() {
    onSave({ scaleNumerator: numerator, scaleDenominator: denominator, physicalScaleLength: physical });
    onClose();
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div className="relative w-full max-w-sm mx-4 bg-gray-900 rounded-2xl shadow-2xl border border-gray-700/80 overflow-hidden">

        {/* ── Header ──────────────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-700/80">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-teal-600 flex items-center justify-center shrink-0">
              <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                <path strokeLinecap="round" strokeLinejoin="round"
                  d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2Z" />
              </svg>
            </div>
            <div>
              <h2 className="text-sm font-semibold text-white leading-tight">Calibration Settings</h2>
              <p className="text-xs text-gray-400">Set scale reference values</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white transition-colors p-1 rounded-md hover:bg-gray-800"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* ── Body ────────────────────────────────────────────────────────────── */}
        <div className="px-6 py-5 space-y-5">

          {/* Formula explanation */}
          <div className="bg-gray-800/60 rounded-xl border border-gray-700/50 px-4 py-3">
            <p className="text-[11px] text-gray-400 leading-relaxed">
              The scale bar covers{' '}
              <span className="font-mono text-gray-200">x / y</span>{' '}
              of the image width and represents{' '}
              <span className="font-mono text-gray-200">z µm</span>{' '}
              in physical space.
            </p>
          </div>

          {/* Inputs */}
          <div className="space-y-4">
            <div>
              <label className="text-[10px] font-bold uppercase tracking-wider text-gray-500 block mb-1.5">
                x — Scale Numerator
              </label>
              <input
                type="number"
                min={1}
                step={1}
                value={numerator}
                onChange={e => { const v = Number(e.target.value); if (v >= 1) setNumerator(v); }}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm
                           text-gray-200 font-mono focus:outline-none focus:border-teal-500"
              />
            </div>

            <div>
              <label className="text-[10px] font-bold uppercase tracking-wider text-gray-500 block mb-1.5">
                y — Scale Denominator
              </label>
              <input
                type="number"
                min={1}
                step={1}
                value={denominator}
                onChange={e => { const v = Number(e.target.value); if (v >= 1) setDenominator(v); }}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm
                           text-gray-200 font-mono focus:outline-none focus:border-teal-500"
              />
            </div>

            <div>
              <label className="text-[10px] font-bold uppercase tracking-wider text-gray-500 block mb-1.5">
                z — Physical Scale Length (µm)
              </label>
              <input
                type="number"
                min={1}
                step={1}
                value={physical}
                onChange={e => { const v = Number(e.target.value); if (v >= 1) setPhysical(v); }}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm
                           text-gray-200 font-mono focus:outline-none focus:border-teal-500"
              />
            </div>
          </div>

          {/* Computed result preview */}
          <div className="bg-teal-900/20 rounded-xl border border-teal-700/40 px-4 py-3">
            <p className="text-[10px] font-bold uppercase tracking-wider text-teal-400 mb-2">
              Computed Factors
            </p>
            {scaleFactor !== null ? (
              <div className="space-y-1">
                <div className="flex justify-between text-xs font-mono">
                  <span className="text-gray-400">Scale factor</span>
                  <span className="text-teal-300">{scaleFactor.toFixed(7)} µm/px</span>
                </div>
                <div className="flex justify-between text-xs font-mono">
                  <span className="text-gray-400">Area factor</span>
                  <span className="text-teal-300">{areaFactor!.toFixed(7)} µm²/px²</span>
                </div>
                {imageWidthPx && (
                  <div className="flex justify-between text-xs font-mono border-t border-teal-700/30 pt-1 mt-1">
                    <span className="text-gray-400">Scale bar length</span>
                    <span className="text-gray-300">{scaleBarLengthPx!.toFixed(1)} px</span>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-xs text-gray-500 italic">
                {imageWidthPx
                  ? 'Invalid parameters — all values must be positive.'
                  : 'Load an image first to preview computed values.'}
              </p>
            )}
          </div>
        </div>

        {/* ── Footer ──────────────────────────────────────────────────────────── */}
        <div className="flex gap-2 px-6 py-4 border-t border-gray-700/80">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2 text-sm text-gray-300 hover:text-white border border-gray-600
                       rounded-lg hover:bg-gray-800 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="flex-1 px-4 py-2 bg-teal-600 text-white text-sm font-semibold rounded-lg
                       hover:bg-teal-500 transition-colors"
          >
            Apply
          </button>
        </div>

      </div>
    </div>,
    document.body,
  );
}
