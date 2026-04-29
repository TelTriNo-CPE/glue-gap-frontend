import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';

export interface CalibrationParams {
  scaleBarLengthPx: number;
  physicalScaleLength: number;
}

interface Props {
  onClose: () => void;
  params: CalibrationParams;
  onSave: (params: CalibrationParams) => void;
  calibratedPixelLength: number | null;
}

/**
 * CalibrationModal — always conditionally mounted by the parent so that
 * useState initialises fresh from `params` every time it opens.
 *
 * Two fields:
 *   L — Scale bar length (px): auto-populated from the calibrate-line tool, still editable
 *   z — Real-world length (µm): typed by the user
 *
 * Computes:
 *   scaleFactor = z / L   (µm per px)
 *   areaFactor  = scaleFactor²
 */
export default function CalibrationModal({ onClose, params, onSave, calibratedPixelLength }: Props) {
  const [scaleBarPx, setScaleBarPx] = useState(String(params.scaleBarLengthPx));
  const [physical,   setPhysical]   = useState(String(params.physicalScaleLength));

  // Sync calibratedPixelLength into the field whenever it changes (e.g. opened after drawing a line)
  useEffect(() => {
    if (calibratedPixelLength !== null && calibratedPixelLength > 0) {
      setScaleBarPx(String(Math.round(calibratedPixelLength * 10) / 10));
    }
  }, [calibratedPixelLength]);

  const numPx = parseFloat(scaleBarPx);
  const numP  = parseFloat(physical);

  const isValid = numPx > 0 && isFinite(numPx) && numP > 0 && isFinite(numP);

  const scaleFactor = isValid ? numP / numPx : null;
  const areaFactor  = scaleFactor !== null ? scaleFactor * scaleFactor : null;

  function handleSave() {
    if (!isValid) return;
    onSave({ scaleBarLengthPx: numPx, physicalScaleLength: numP });
    onClose();
  }

  function fieldBorder(raw: string, parsed: number): string {
    if (raw === '') return 'border-gray-700 focus:border-teal-500';
    return parsed > 0 && isFinite(parsed)
      ? 'border-gray-700 focus:border-teal-500'
      : 'border-red-500 focus:border-red-400';
  }

  const baseInput =
    'w-full bg-gray-800 border rounded-lg px-3 py-2 text-sm text-gray-200 font-mono ' +
    'focus:outline-none transition-colors';

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div className="relative w-full max-w-sm mx-4 bg-gray-900 rounded-2xl shadow-2xl border border-gray-700/80 overflow-hidden">

        {/* ── Header ──────────────────────────────────────────────────────── */}
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

        {/* ── Body ────────────────────────────────────────────────────────── */}
        <div className="px-6 py-5 space-y-5">

          {/* Hint */}
          <div className="bg-gray-800/60 rounded-xl border border-gray-700/50 px-4 py-3">
            <p className="text-[11px] text-gray-400 leading-relaxed">
              Use the{' '}
              <span className="font-mono text-teal-300">Calibrate Line</span>{' '}
              tool to draw a line over a known scale bar, then enter its real-world size below.
              Formula:{' '}
              <span className="font-mono text-gray-200">µm/px = z / L</span>
            </p>
          </div>

          <div className="space-y-4">

            {/* Scale bar length (px) */}
            <div>
              <label className="text-[10px] font-bold uppercase tracking-wider text-gray-500 block mb-1.5">
                L — Scale bar length (<span className="normal-case">px</span>)
                {calibratedPixelLength !== null && calibratedPixelLength > 0 && (
                  <span className="ml-2 normal-case font-normal text-teal-400">← from calibrate line</span>
                )}
              </label>
              <input
                type="text"
                inputMode="decimal"
                value={scaleBarPx}
                onChange={e => setScaleBarPx(e.target.value)}
                placeholder="e.g. 320"
                className={`${baseInput} ${fieldBorder(scaleBarPx, numPx)}`}
              />
            </div>

            {/* Real-world length (µm) */}
            <div>
              <label className="text-[10px] font-bold uppercase tracking-wider text-gray-500 block mb-1.5">
                z — Real-world length (<span className="normal-case">µm</span>)
              </label>
              <input
                type="text"
                inputMode="decimal"
                value={physical}
                onChange={e => setPhysical(e.target.value)}
                placeholder="e.g. 2000"
                className={`${baseInput} ${fieldBorder(physical, numP)}`}
              />
            </div>
          </div>

          {/* ── Live preview ─────────────────────────────────────────────── */}
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
              </div>
            ) : (
              <p className="text-xs text-gray-500 italic">
                Enter valid positive numbers in all fields.
              </p>
            )}
          </div>
        </div>

        {/* ── Footer ──────────────────────────────────────────────────────── */}
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
            disabled={!isValid}
            className="flex-1 px-4 py-2 bg-teal-600 text-white text-sm font-semibold rounded-lg
                       hover:bg-teal-500 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Apply
          </button>
        </div>

      </div>
    </div>,
    document.body,
  );
}
