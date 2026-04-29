import { useState } from 'react';
import { createPortal } from 'react-dom';

export interface CalibrationParams {
  useDecimalRatio: boolean;
  scaleNumerator: number;
  scaleDenominator: number;
  decimalRatio: number;
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
 * Two input modes:
 *   x/y mode:      scaleBarLengthPx = imageWidthPx × (x / y)
 *   decimal mode:  scaleBarLengthPx = imageWidthPx × r
 *
 * In both cases:
 *   scaleFactor = z / scaleBarLengthPx   (µm per px)
 *   areaFactor  = scaleFactor²           (µm² per px²)
 *
 * All numeric fields use string state so the user can freely clear or type
 * a decimal point mid-entry. Parsing happens only in the preview and on Apply.
 */
export default function CalibrationModal({ onClose, params, onSave, imageWidthPx }: Props) {
  // ── Local draft state (strings so "" and "0." are valid intermediate values) ──
  const [useDecimal,   setUseDecimal]   = useState(params.useDecimalRatio);
  const [numerator,    setNumerator]    = useState(String(params.scaleNumerator));
  const [denominator,  setDenominator]  = useState(String(params.scaleDenominator));
  const [decimalRatio, setDecimalRatio] = useState(String(params.decimalRatio));
  const [physical,     setPhysical]     = useState(String(params.physicalScaleLength));

  // ── Parse draft strings for preview and validation ────────────────────────
  const numN = parseFloat(numerator);
  const numD = parseFloat(denominator);
  const numR = parseFloat(decimalRatio);
  const numP = parseFloat(physical);

  const isRatioValid = useDecimal
    ? (numR > 0 && isFinite(numR))
    : (numN > 0 && isFinite(numN) && numD > 0 && isFinite(numD));

  const isValid = isRatioValid && numP > 0 && isFinite(numP);

  const ratio = useDecimal ? numR : numN / numD;
  const scaleBarLengthPx =
    isValid && imageWidthPx && imageWidthPx > 0 && ratio > 0
      ? imageWidthPx * ratio
      : null;
  const scaleFactor = scaleBarLengthPx ? numP / scaleBarLengthPx : null;
  const areaFactor  = scaleFactor !== null ? scaleFactor * scaleFactor : null;

  // ── Apply — only commits to global state on explicit user action ──────────
  function handleSave() {
    if (!isValid) return;
    onSave({
      useDecimalRatio:     useDecimal,
      // Preserve the hidden mode's last good values so switching back is lossless
      scaleNumerator:      (numN > 0 && isFinite(numN)) ? numN : params.scaleNumerator,
      scaleDenominator:    (numD > 0 && isFinite(numD)) ? numD : params.scaleDenominator,
      decimalRatio:        (numR > 0 && isFinite(numR)) ? numR : params.decimalRatio,
      physicalScaleLength: numP,
    });
    onClose();
  }

  // ── Helper: border colour for a single field ──────────────────────────────
  function fieldBorder(raw: string, parsed: number): string {
    // While empty or mid-decimal (e.g. "0.") show neutral border
    if (raw === '') return 'border-gray-700 focus:border-teal-500';
    return parsed > 0 && isFinite(parsed)
      ? 'border-gray-700 focus:border-teal-500'
      : 'border-red-500 focus:border-red-400';
  }

  const baseInput =
    'w-full bg-gray-800 border rounded-lg px-3 py-2 text-sm text-gray-200 font-mono ' +
    'focus:outline-none transition-colors';

  // ── Render ────────────────────────────────────────────────────────────────
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

          {/* Formula hint — updates with mode */}
          <div className="bg-gray-800/60 rounded-xl border border-gray-700/50 px-4 py-3">
            <p className="text-[11px] text-gray-400 leading-relaxed">
              {useDecimal ? (
                <>
                  The scale bar covers{' '}
                  <span className="font-mono text-gray-200">r</span>{' '}
                  (decimal fraction) of the image width and represents{' '}
                  <span className="font-mono text-gray-200">z µm</span>{' '}
                  in physical space.
                </>
              ) : (
                <>
                  The scale bar covers{' '}
                  <span className="font-mono text-gray-200">x / y</span>{' '}
                  of the image width and represents{' '}
                  <span className="font-mono text-gray-200">z µm</span>{' '}
                  in physical space.
                </>
              )}
            </p>
          </div>

          {/* Mode toggle */}
          <label className="flex items-center gap-3 px-1 cursor-pointer select-none group">
            <div className={`w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 transition-colors ${
              useDecimal
                ? 'bg-teal-600 border-teal-500'
                : 'border-gray-600 bg-gray-800 group-hover:border-gray-500'
            }`}>
              {useDecimal && (
                <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                </svg>
              )}
              <input
                type="checkbox"
                className="hidden"
                checked={useDecimal}
                onChange={e => setUseDecimal(e.target.checked)}
              />
            </div>
            <span className="text-xs font-medium text-gray-300 group-hover:text-white transition-colors">
              Use single decimal ratio
            </span>
          </label>

          {/* ── Ratio inputs (conditional on mode) ──────────────────────── */}
          <div className="space-y-4">
            {useDecimal ? (
              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-gray-500 block mb-1.5">
                  r — Decimal Ratio
                </label>
                <input
                  type="text"
                  inputMode="decimal"
                  value={decimalRatio}
                  onChange={e => setDecimalRatio(e.target.value)}
                  placeholder="e.g. 0.1"
                  className={`${baseInput} ${fieldBorder(decimalRatio, numR)}`}
                />
              </div>
            ) : (
              <>
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-wider text-gray-500 block mb-1.5">
                    x — Scale Numerator
                  </label>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={numerator}
                    onChange={e => setNumerator(e.target.value)}
                    placeholder="e.g. 1"
                    className={`${baseInput} ${fieldBorder(numerator, numN)}`}
                  />
                </div>
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-wider text-gray-500 block mb-1.5">
                    y — Scale Denominator
                  </label>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={denominator}
                    onChange={e => setDenominator(e.target.value)}
                    placeholder="e.g. 10"
                    className={`${baseInput} ${fieldBorder(denominator, numD)}`}
                  />
                </div>
              </>
            )}

            {/* Physical scale length — always visible */}
            <div>
              <label className="text-[10px] font-bold uppercase tracking-wider text-gray-500 block mb-1.5">
                z — Physical Scale Length (<span className="normal-case">µm</span>)
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
                {imageWidthPx && (
                  <div className="flex justify-between text-xs font-mono border-t border-teal-700/30 pt-1 mt-1">
                    <span className="text-gray-400">Scale bar length</span>
                    <span className="text-gray-300">{scaleBarLengthPx!.toFixed(1)} px</span>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-xs text-gray-500 italic">
                {!isValid
                  ? 'Enter valid positive numbers in all fields.'
                  : 'Load an image first to preview computed values.'}
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
