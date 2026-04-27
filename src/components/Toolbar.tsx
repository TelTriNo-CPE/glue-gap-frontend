import { useState } from 'react';
import { downloadExcel, downloadJpeg } from '../api';
import type { ClickMode } from '../types';

interface Props {
  width?: number;
  stem: string;
  fileKey: string;
  isGreyscale: boolean;
  hideUnselected: boolean;
  isOutlineOnly: boolean;
  hasResult: boolean;
  analyzing: boolean;
  onGreyscale: () => void;
  onToggleHideUnselected: () => void;
  onToggleOutlineOnly: () => void;
  onDetect: () => void;
  onReset: () => void;
  clickMode: ClickMode;
  setClickMode: (mode: ClickMode) => void;
  brushSize: number;
  onBrushSizeChange: (value: number) => void;
  canUndo: boolean;
  canRedo: boolean;
  hasEdits: boolean;
  isSaving: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onSaveEdits: () => void;
  onResetEdits: () => void;
  sensitivity: number;
  onSensitivityChange: (value: number) => void;
  minArea: number;
  onMinAreaChange: (value: number) => void;
  showMinimap: boolean;
  onToggleMinimap: () => void;
  isFullscreen: boolean;
  onToggleFullscreen: () => void;
  onSelectAll: () => void;
  onDeselectAll: () => void;
  onSelectManual: () => void;
  onClearManual: () => void;
  outlineColor: string;
  fillColor: string;
  selectedColor: string;
  onOutlineColorChange: (value: string) => void;
  onFillColorChange: (value: string) => void;
  onSelectedColorChange: (value: string) => void;
  onResetColors: () => void;
  wandTolerance: number;
  onWandToleranceChange: (value: number) => void;
}

const COLOR_PRESETS = ['#ff0000', '#2563eb', '#16a34a', '#eab308', '#9333ea'];

const btnClass =
  'flex flex-row items-center gap-3 px-4 py-3 w-full rounded-lg text-sm font-medium ' +
  'text-gray-400 hover:text-white hover:bg-gray-700 transition-colors ' +
  'disabled:opacity-40 disabled:cursor-not-allowed';

const historyBtnClass =
  'flex h-10 flex-1 items-center justify-center rounded-lg border border-gray-700 bg-gray-800 ' +
  'text-gray-300 transition-colors hover:border-gray-600 hover:bg-gray-700 hover:text-white ' +
  'disabled:cursor-not-allowed disabled:opacity-40';

const toggleBtnClass = (active: boolean) =>
  `flex-1 min-w-[4.5rem] flex items-center justify-center gap-2 py-2 px-3 rounded-md text-xs font-semibold transition-all ${
    active ? 'bg-blue-600 text-white shadow-inner' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
  }`;

function Spinner() {
  return (
    <svg className="w-5 h-5 shrink-0 animate-spin" fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}

function Divider() {
  return <div className="border-t border-gray-700 my-2" />;
}

export default function Toolbar({
  width = 256,
  stem,
  fileKey,
  isGreyscale,
  hideUnselected,
  isOutlineOnly,
  hasResult,
  analyzing,
  onGreyscale,
  onToggleHideUnselected,
  onToggleOutlineOnly,
  onDetect,
  onReset,
  clickMode,
  setClickMode,
  brushSize,
  onBrushSizeChange,
  canUndo,
  canRedo,
  hasEdits,
  isSaving,
  onUndo,
  onRedo,
  onSaveEdits,
  onResetEdits,
  sensitivity,
  onSensitivityChange,
  minArea,
  onMinAreaChange,
  showMinimap,
  onToggleMinimap,
  isFullscreen,
  onToggleFullscreen,
  onSelectAll,
  onDeselectAll,
  onSelectManual,
  onClearManual,
  outlineColor,
  fillColor,
  selectedColor,
  onOutlineColorChange,
  onFillColorChange,
  onSelectedColorChange,
  onResetColors,
  wandTolerance,
  onWandToleranceChange,
}: Props) {
  const [busy, setBusy] = useState<'excel' | 'jpeg' | null>(null);

  async function handleDownload(type: 'excel' | 'jpeg') {
    if (busy) return;
    setBusy(type);
    try {
      type === 'excel'
        ? await downloadExcel(fileKey, stem)
        : await downloadJpeg(fileKey, stem);
    } finally {
      setBusy(null);
    }
  }

  return (
    <aside 
      className="bg-gray-900 flex flex-col py-4 px-3 gap-1 shrink-0 h-full overflow-y-auto"
      style={{ width }}
    >

      {/* Upload Another */}
      <button onClick={onReset} className={btnClass}>
        <svg className="w-5 h-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round"
            d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
        </svg>
        Upload Another
      </button>

      <Divider />

      {/* Click Mode Toggle */}
      <div className="px-1 py-2">
        <label className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-2 block px-1">
          Click Mode
        </label>
        <div className="flex flex-wrap w-full bg-gray-950 p-1 rounded-lg gap-2">
          <button
            onClick={() => setClickMode('pan')}
            className={toggleBtnClass(clickMode === 'pan')}
            title="Pan / Move (Hand Tool)"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M10 14V6a2 2 0 0 1 2-2v0a2 2 0 0 1 2 2v0m-4 6V4a2 2 0 0 1 2-2v0a2 2 0 0 1 2 2v0m-4 6V6a2 2 0 0 1 2-2v0a2 2 0 0 1 2 2v0M6 15l-1.5-1.5a2 2 0 1 0-2.83 2.83l3.6 3.6A8 8 0 0 0 12 22h1a8 8 0 0 0 8-8V8a2 2 0 1 0-4 0v6" />
            </svg>
            Pan
          </button>
          <button
            onClick={() => setClickMode('select')}
            className={toggleBtnClass(clickMode === 'select')}
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.042 21.672 13.684 16.6m0 0-2.51 2.225.569-9.47 5.227 7.917-3.286-.672ZM12 2.25V4.5m5.834.166-1.591 1.591M20.25 10.5H18M7.757 14.743l-1.59 1.59M6 10.5H3.75m4.007-4.243-1.59-1.59" />
            </svg>
            Select
          </button>
          <button
            onClick={() => setClickMode('deselect')}
            className={toggleBtnClass(clickMode === 'deselect')}
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
            Deselect
          </button>
          <button
            onClick={() => setClickMode('brush')}
            className={`flex-1 min-w-[4.5rem] flex items-center justify-center gap-2 py-2 px-3 rounded-md text-xs font-semibold transition-all ${
              clickMode === 'brush' ? 'bg-green-600 text-white shadow-inner' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
            }`}
            title="Brush — paint to add gap area"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.53 16.122a3 3 0 0 0-5.78 1.128 2.25 2.25 0 0 1-2.4 2.245 4.5 4.5 0 0 0 8.4-2.245c0-.399-.078-.78-.22-1.128Zm0 0a15.998 15.998 0 0 0 3.388-1.62m-5.043-.025a15.994 15.994 0 0 1 1.622-3.395m3.42 3.42a15.995 15.995 0 0 0 4.764-4.648l3.876-5.814a1.151 1.151 0 0 0-1.597-1.597L14.146 6.32a15.996 15.996 0 0 0-4.649 4.763m3.42 3.42a6.776 6.776 0 0 0-3.42-3.42" />
            </svg>
            Brush
          </button>
          <button
            onClick={() => setClickMode('eraser')}
            className={`flex-1 min-w-[4.5rem] flex items-center justify-center gap-2 py-2 px-3 rounded-md text-xs font-semibold transition-all ${
              clickMode === 'eraser' ? 'bg-red-600 text-white shadow-inner' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
            }`}
            title="Eraser — paint to remove gap area"
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L6.832 19.82a4.5 4.5 0 0 1-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 0 1 1.13-1.897L16.863 4.487Zm0 0L19.5 7.125" />
            </svg>
            Eraser
          </button>
          <button
            onClick={() => setClickMode('split')}
            className={`flex-1 min-w-[4.5rem] flex items-center justify-center gap-2 py-2 px-3 rounded-md text-xs font-semibold transition-all ${
              clickMode === 'split' ? 'bg-amber-500 text-white shadow-inner' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
            }`}
            title="Split — draw a line to cut a gap into separate pieces"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="m7.848 8.25 1.536.887M7.848 8.25a3 3 0 1 1-5.196-3 3 3 0 0 1 5.196 3Zm1.536.887a2.165 2.165 0 0 1 1.083 1.839c.005.351.054.695.14 1.024M9.384 9.137l2.077 1.199M7.848 15.75l1.536-.887m-1.536.887a3 3 0 1 1-5.196 3 3 3 0 0 1 5.196-3Zm1.536-.887a2.165 2.165 0 0 0 1.083-1.838c.005-.352.054-.695.14-1.025m-1.223 2.863 2.077-1.199m0-3.328a4.323 4.323 0 0 1 2.068-1.379l5.325-1.628a4.5 4.5 0 0 1 2.48-.044l.803.215m-7.676 2.836a4.323 4.323 0 0 0 2.068 1.379l5.325 1.628a4.5 4.5 0 0 0 2.48.044l.803-.215" />
            </svg>
            Split
          </button>
          <button
            onClick={() => setClickMode('magic-wand')}
            className={`flex-1 min-w-[4.5rem] flex items-center justify-center gap-2 py-2 px-3 rounded-md text-xs font-semibold transition-all ${
              clickMode === 'magic-wand' ? 'bg-purple-600 text-white shadow-inner' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
            }`}
            title="Magic Wand — click a region to auto-select it by colour similarity"
          >
            <WandIcon />
            Wand
          </button>
          <button
            onClick={() => setClickMode('quick-select')}
            className={`flex-1 min-w-[4.5rem] flex items-center justify-center gap-2 py-2 px-3 rounded-md text-xs font-semibold transition-all ${
              clickMode === 'quick-select' ? 'bg-fuchsia-600 text-white shadow-inner' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
            }`}
            title="Quick Select — drag to smart-fill regions continuously along your path"
          >
            <QuickSelectIcon />
            Quick
          </button>
          <button
            onClick={() => setClickMode('object-select')}
            className={`flex-1 min-w-[4.5rem] flex items-center justify-center gap-2 py-2 px-3 rounded-md text-xs font-semibold transition-all ${
              clickMode === 'object-select' ? 'bg-teal-600 text-white shadow-inner' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
            }`}
            title="Object Select — drag a bounding box over a region to run AI detection inside it"
          >
            <ObjectSelectIcon />
            Scan
          </button>
        </div>
      </div>

      {/* Tolerance Slider — shown only when magic-wand or quick-select is active */}
      {(clickMode === 'magic-wand' || clickMode === 'quick-select') && (
        <div className="px-2 py-2">
          <div className="flex flex-col gap-1 w-full px-1">
            <div className="flex justify-between items-center">
              <span className="text-[11px] text-gray-400">Tolerance</span>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => onWandToleranceChange(32)}
                  className="text-[10px] font-bold text-purple-400 hover:text-purple-300 uppercase tracking-tight transition-colors"
                  title="Reset tolerance to default (32)"
                >
                  Reset
                </button>
              <input
                type="number"
                min={0}
                max={255}
                value={wandTolerance}
                onChange={e => {
                  const v = Number(e.target.value);
                  if (v >= 0 && v <= 255) onWandToleranceChange(v);
                }}
                className="w-16 text-right text-[11px] font-mono bg-gray-800 border border-gray-700
                           text-gray-300 rounded px-1.5 py-0.5 focus:outline-none focus:border-purple-500"
              />
              </div>
            </div>
            <input
              type="range"
              min={0}
              max={255}
              step={1}
              value={wandTolerance}
              onChange={e => onWandToleranceChange(Number(e.target.value))}
              className="w-full h-1.5 rounded-full appearance-none bg-gray-700
                         accent-purple-500"
            />
            <div className="flex justify-between text-[9px] text-gray-600">
              <span>0</span>
              <span>255</span>
            </div>
          </div>
        </div>
      )}

      {/* Brush Size Slider — shown only when brush, eraser, or quick-select is active */}
      {(clickMode === 'brush' || clickMode === 'eraser' || clickMode === 'quick-select') && (
        <div className="px-2 py-2">
          <div className="flex flex-col gap-1 w-full px-1">
            <div className="flex justify-between items-center">
              <span className="text-[11px] text-gray-400">Brush Size (px)</span>
              <input
                type="number"
                min={5}
                max={200}
                value={brushSize}
                onChange={e => {
                  const v = Number(e.target.value);
                  if (v >= 5 && v <= 200) onBrushSizeChange(v);
                }}
                className="w-16 text-right text-[11px] font-mono bg-gray-800 border border-gray-700
                           text-gray-300 rounded px-1.5 py-0.5 focus:outline-none focus:border-blue-500"
              />
            </div>
            <input
              type="range"
              min={5}
              max={200}
              step={1}
              value={brushSize}
              onChange={e => onBrushSizeChange(Number(e.target.value))}
              className="w-full h-1.5 rounded-full appearance-none bg-gray-700
                         accent-blue-500"
            />
            <div className="flex justify-between text-[9px] text-gray-600">
              <span>5</span>
              <span>200</span>
            </div>
          </div>
        </div>
      )}

      <Divider />

      <div className="px-1 py-2">
        <label className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-2 block px-1">
          Bulk Actions
        </label>
        <div className="flex flex-row gap-2 w-full">
          <button
            onClick={onSelectAll}
            className="flex-1 rounded-lg bg-blue-600 px-3 py-2.5 text-xs font-semibold text-white transition-colors hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Select All
          </button>
          <button
            onClick={onDeselectAll}
            className="flex-1 rounded-lg border border-gray-700 bg-gray-800 px-3 py-2.5 text-xs font-semibold text-gray-200 transition-colors hover:border-gray-600 hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Deselect All
          </button>
        </div>
        <div className="mt-2 flex flex-row gap-2 w-full">
          <button
            onClick={onSelectManual}
            className="flex-1 flex items-center justify-center gap-1.5 rounded-lg border border-indigo-700/50 bg-indigo-900/30 px-3 py-2 text-xs font-semibold text-indigo-200 transition-colors hover:bg-indigo-900/50 disabled:cursor-not-allowed disabled:opacity-40"
            title="Select all manually created or modified gaps"
          >
            <SelectManualIcon />
            Select Manual
          </button>
          <button
            onClick={onClearManual}
            className="flex-1 flex items-center justify-center gap-1.5 rounded-lg border border-red-900/50 bg-red-900/20 px-3 py-2 text-xs font-semibold text-red-300 transition-colors hover:bg-red-900/40 disabled:cursor-not-allowed disabled:opacity-40"
            title="Clear only manual gaps (preserves auto-detected gaps)"
          >
            <TrashIcon className="w-3.5 h-3.5" />
            Clear Manual
          </button>
        </div>
        <div className="mt-2 flex items-center gap-2">
          <button
            type="button"
            onClick={onUndo}
            disabled={!canUndo || isSaving}
            className={historyBtnClass}
            title="Undo (Ctrl/Cmd+Z)"
            aria-label="Undo the last gap edit"
          >
            <UndoIcon />
          </button>
          <button
            type="button"
            onClick={onRedo}
            disabled={!canRedo || isSaving}
            className={historyBtnClass}
            title="Redo (Ctrl/Cmd+Shift+Z or Ctrl+Y)"
            aria-label="Redo the last undone gap edit"
          >
            <RedoIcon />
          </button>
        </div>
        <div className="mt-2 flex flex-col gap-2">
          <button
            type="button"
            onClick={onSaveEdits}
            disabled={!hasEdits || isSaving}
            className="w-full flex items-center justify-center gap-2 rounded-lg bg-emerald-600 px-3 py-2.5 text-xs font-semibold text-white transition-colors hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {isSaving ? <Spinner /> : <SaveIcon />}
            {isSaving ? 'Saving Changes...' : 'Save Changes'}
          </button>
          <button
            type="button"
            onClick={onResetEdits}
            disabled={!hasEdits || isSaving}
            className="w-full flex items-center justify-center gap-2 rounded-lg bg-amber-600 px-3 py-2.5 text-xs font-semibold text-white transition-colors hover:bg-amber-500 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <UndoIcon className="w-3.5 h-3.5" />
            Reset Edits
          </button>
        </div>
      </div>

      <Divider />

      {/* Detection Settings — shown when detection is available */}
      {(isGreyscale || hasResult) && (
        <div className="px-1 py-2 flex flex-col gap-3 w-full">
          <div className="flex items-center justify-between px-1">
            <label className="text-[10px] font-bold text-gray-500 uppercase tracking-wider block">
              Detection Settings
            </label>
            <button
              onClick={() => {
                onSensitivityChange(50);
                onMinAreaChange(20);
              }}
              className="text-[10px] font-bold text-blue-500 hover:text-blue-400 uppercase tracking-tight transition-colors"
              title="Reset to defaults (50, 20px)"
            >
              Reset
            </button>
          </div>

          {/* Sensitivity slider */}
          <div className="flex flex-col gap-1 w-full px-1">
            <div className="flex justify-between items-center">
              <span className="text-[11px] text-gray-400">Sensitivity</span>
              <input
                type="number"
                min={0}
                max={100}
                value={sensitivity}
                onChange={e => {
                  const v = Number(e.target.value);
                  if (v >= 0 && v <= 100) onSensitivityChange(v);
                }}
                disabled={analyzing}
                className="w-16 text-right text-[11px] font-mono bg-gray-800 border border-gray-700
                           text-gray-300 rounded px-1.5 py-0.5 focus:outline-none focus:border-blue-500
                           disabled:opacity-40"
              />
            </div>
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={sensitivity}
              onChange={e => onSensitivityChange(Number(e.target.value))}
              disabled={analyzing}
              className="w-full h-1.5 rounded-full appearance-none bg-gray-700
                         accent-blue-500 disabled:opacity-40"
            />
            <div className="flex justify-between text-[9px] text-gray-600">
              <span>Low</span>
              <span>High</span>
            </div>
          </div>

          {/* Min Area input */}
          <div className="flex flex-col gap-1 w-full px-1">
            <div className="flex justify-between items-center">
              <span className="text-[11px] text-gray-400">Min Gap Size (px)</span>
              <input
                type="number"
                min={1}
                max={500}
                value={minArea}
                onChange={e => {
                  const v = Number(e.target.value);
                  if (v >= 1 && v <= 500) onMinAreaChange(v);
                }}
                disabled={analyzing}
                className="w-16 text-right text-[11px] font-mono bg-gray-800 border border-gray-700
                           text-gray-300 rounded px-1.5 py-0.5 focus:outline-none focus:border-blue-500
                           disabled:opacity-40"
              />
            </div>
            <input
              type="range"
              min={1}
              max={500}
              step={1}
              value={minArea}
              onChange={e => onMinAreaChange(Number(e.target.value))}
              disabled={analyzing}
              className="w-full h-1.5 rounded-full appearance-none bg-gray-700
                         accent-blue-500 disabled:opacity-40"
            />
            <div className="flex justify-between text-[9px] text-gray-600">
              <span>1</span>
              <span>500</span>
            </div>
          </div>
          <Divider />
        </div>
      )}

      {/* Step 2: Start Detection — shown after greyscale is applied, or when results exist */}
      {(isGreyscale || hasResult) && (
        <button
          onClick={onDetect}
          disabled={analyzing}
          className={btnClass}
        >
          {analyzing ? <Spinner /> : hasResult ? (
            <svg className="w-5 h-5 shrink-0" fill="none" viewBox="0 0 24 24"
                 stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round"
                d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.992 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182" />
            </svg>
          ) : (
            <svg className="w-5 h-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round"
                d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 15.803 7.5 7.5 0 0 0 15.803 15.803z" />
            </svg>
          )}
          {analyzing ? 'Detecting…' : hasResult ? 'Re-run Detection' : 'Start Detection'}
        </button>
      )}

      {/* Toggle Greyscale / Color */}
      <button
        onClick={onGreyscale}
        className={`${btnClass} ${isGreyscale ? 'text-blue-400' : ''}`}
      >
        <svg className="w-5 h-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round"
            d="M12 3v18M9 6.343A8 8 0 1 0 15 17.657" />
          <circle cx="12" cy="12" r="9" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        {isGreyscale ? 'Switch to Color' : 'Switch to Greyscale'}
      </button>

      {/* Hide Unselected Toggle */}
      <button
        onClick={onToggleHideUnselected}
        className={`${btnClass} ${hideUnselected ? 'text-blue-400' : ''}`}
      >
        {hideUnselected ? (
          <svg className="w-5 h-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 0 0 1.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.451 10.451 0 0 1 12 4.5c4.756 0 8.773 3.162 10.065 7.498a10.522 10.522 0 0 1-4.293 5.774M6.228 6.228 3 3m3.228 3.228 3.65 3.65m7.894 7.894L21 21m-3.228-3.228-3.65-3.65m0 0a3 3 0 1 0-4.243-4.243m4.242 4.242L9.88 9.88" />
          </svg>
        ) : (
          <svg className="w-5 h-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 0 1 0-.644C3.413 7.147 7.243 4.5 12 4.5c4.757 0 8.783 2.647 10.741 6.178.118.213.118.468 0 .681C20.587 14.853 16.557 17.5 12 17.5c-4.757 0-8.783-2.647-10.741-6.178Z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
          </svg>
        )}
        {hideUnselected ? 'Show All Gaps' : 'Isolate Selected'}
      </button>

      {/* Outline Only Toggle */}
      <button
        onClick={onToggleOutlineOnly}
        className={`${btnClass} ${isOutlineOnly ? 'text-blue-400' : ''}`}
      >
        <svg className="w-5 h-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 7.5A2.25 2.25 0 0 1 7.5 5.25h9a2.25 2.25 0 0 1 2.25 2.25v9a2.25 2.25 0 0 1-2.25 2.25h-9a2.25 2.25 0 0 1-2.25-2.25v-9Z" />
        </svg>
        {isOutlineOnly ? 'Show Fill' : 'Outline Only'}
      </button>

      {/* Minimap Toggle */}
      <button
        onClick={onToggleMinimap}
        className={`${btnClass} ${showMinimap ? 'text-blue-400' : ''}`}
      >
        <svg className="w-5 h-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 6.75V15m6-10.5v.008H15V4.5m0 6v.008H15V10.5m0 6v.008H15V16.5m-6-9h.008v.008H9V7.5m0 6h.008v.008H9v-.008Zm-3-1.5h.008v.008H6V12m0-6h.008v.008H6V6m0 12h.008v.008H6v-.008Zm12-1.5h.008v.008H18v-.008Zm0-6h.008v.008H18V6.152a3 3 0 0 0-3-3H9a3 3 0 0 0-3 3V18a3 3 0 0 0 3 3h6a3 3 0 0 0 3-3v-6.152Z" />
        </svg>
        {showMinimap ? 'Hide Minimap' : 'Show Minimap'}
      </button>

      {/* Fullscreen Toggle */}
      <button
        onClick={onToggleFullscreen}
        className={`${btnClass} ${isFullscreen ? 'text-blue-400' : ''}`}
      >
        {isFullscreen ? (
          <svg className="w-5 h-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 9V4.5M9 9H4.5M9 9 3.75 3.75M9 15v4.5M9 15H4.5M9 15l-5.25 5.25M15 9V4.5M15 9h4.5M15 9l5.25-5.25M15 15v4.5M15 15h4.5m-4.5 0 5.25 5.25" />
          </svg>
        ) : (
          <svg className="w-5 h-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75h-4.5m4.5 0v4.5m0-4.5L15 9m5.25 11.25h-4.5m4.5 0v-4.5m0 4.5L15 15" />
          </svg>
        )}
        {isFullscreen ? 'Exit Full Screen' : 'Full Screen'}
      </button>

      {(isGreyscale || hasResult) && (
        <>
          <Divider />

          <div className="px-1 py-2">
            <div className="mb-3 flex items-center justify-between px-1">
              <label className="text-[10px] font-bold uppercase tracking-wider text-gray-500">
                Appearance
              </label>
              <button
                type="button"
                onClick={onResetColors}
                className="rounded-md px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-gray-400 transition-colors hover:bg-gray-800 hover:text-white"
              >
                Reset
              </button>
            </div>
            <div className="flex flex-col gap-3">
              <ColorControlRow label="Outline" value={outlineColor} onChange={onOutlineColorChange} />
              <ColorControlRow label="Fill" value={fillColor} onChange={onFillColorChange} />
              <ColorControlRow label="Selected" value={selectedColor} onChange={onSelectedColorChange} />
            </div>
          </div>
        </>
      )}

      {/* Downloads — only available after analysis */}
      {hasResult && (
        <>
          <Divider />

          {/* Download Excel */}
          <button
            onClick={() => handleDownload('excel')}
            disabled={busy === 'excel'}
            className={btnClass}
          >
            {busy === 'excel' ? <Spinner /> : (
              <svg className="w-5 h-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round"
                  d="M3.375 19.5h17.25m-17.25 0a1.125 1.125 0 01-1.125-1.125M3.375 19.5h1.5C5.496 19.5 6 18.996 6 18.375m-3.75 0V5.625m0 12.75v-1.5c0-.621.504-1.125 1.125-1.125m18.375 2.625V5.625m0 12.75c0 .621-.504 1.125-1.125 1.125m1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125m0 3.75h-1.5A1.125 1.125 0 0118 18.375M20.625 4.5H3.375m17.25 0c.621 0 1.125.504 1.125 1.125M20.625 4.5h-1.5C18.504 4.5 18 5.004 18 5.625m3.75 0v1.5c0 .621-.504 1.125-1.125 1.125M3.375 4.5c-.621 0-1.125.504-1.125 1.125M3.375 4.5h1.5C5.496 4.5 6 5.004 6 5.625m-3.75 0v1.5c0 .621.504 1.125 1.125 1.125m0 0h1.5m-1.5 0c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125m1.5-3.75C5.496 8.25 6 8.754 6 9.375v1.5m0-5.25v5.25m0-5.25C6 5.004 6.504 4.5 7.125 4.5h9.75c.621 0 1.125.504 1.125 1.125m1.125 2.625h1.5m-1.5 0A1.125 1.125 0 0118 9.375v1.5m1.5-3.75C19.496 8.25 20 8.754 20 9.375v1.5c0 .621-.504 1.125-1.125 1.125m-17.25 0h1.5m14.25 0h1.5" />
              </svg>
            )}
            {busy === 'excel' ? 'Downloading…' : 'Download Excel'}
          </button>

          {/* Download JPEG */}
          <button
            onClick={() => handleDownload('jpeg')}
            disabled={busy === 'jpeg'}
            className={btnClass}
          >
            {busy === 'jpeg' ? <Spinner /> : (
              <svg className="w-5 h-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round"
                  d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v12a1.5 1.5 0 001.5 1.5zm10.5-11.25h.008v.008h-.008V8.25zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" />
              </svg>
            )}
            {busy === 'jpeg' ? 'Downloading…' : 'Download JPEG'}
          </button>
        </>
      )}
    </aside>
  );
}

function ColorControlRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="rounded-xl border border-gray-800 bg-gray-950/60 px-3 py-2.5">
      <div className="mb-2 flex items-center justify-between gap-3">
        <span className="text-xs font-semibold text-gray-300">{label}</span>
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="h-8 w-10 cursor-pointer rounded-md border border-gray-700 bg-gray-900 p-1"
          aria-label={`${label} color`}
        />
      </div>
      <div className="flex items-center gap-2">
        {COLOR_PRESETS.map((preset) => {
          const isActive = preset.toLowerCase() === value.toLowerCase();
          return (
            <button
              key={preset}
              type="button"
              onClick={() => onChange(preset)}
              className={`h-6 w-6 rounded-full border transition-all ${
                isActive ? 'scale-110 border-white shadow-[0_0_0_2px_rgba(255,255,255,0.15)]' : 'border-gray-700 hover:border-gray-400'
              }`}
              style={{ backgroundColor: preset }}
              aria-label={`Set ${label} color to ${preset}`}
              title={preset}
            />
          );
        })}
      </div>
    </div>
  );
}

function UndoIcon({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 15 3 9m0 0 6-6M3 9h11.25a6.75 6.75 0 1 1 0 13.5H11.5" />
    </svg>
  );
}

function RedoIcon({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="m15 15 6-6m0 0-6-6m6 6H9.75a6.75 6.75 0 1 0 0 13.5h2.75" />
    </svg>
  );
}

function SaveIcon() {
  return (
    <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M17.25 3.75H5.25A2.25 2.25 0 0 0 3 6v12a2.25 2.25 0 0 0 2.25 2.25h13.5A2.25 2.25 0 0 0 21 18V7.5l-3.75-3.75Z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 3.75v5.25h6V3.75m-5.25 12h6.75" />
    </svg>
  );
}

function SelectManualIcon() {
  return (
    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M10.05 4.575a1.575 1.575 0 1 0-3.15 0v12.272l-1.424-1.42a1.575 1.575 0 0 0-2.227 2.227l3.011 3.012a6.75 6.75 0 0 0 9.992-6.943V6.15a1.575 1.575 0 1 0-3.15 0v5.625h-1.05V4.575Z" />
    </svg>
  );
}

function TrashIcon({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.342 10.822m-5.512 0L8.54 9m4.836-9.178a.75.75 0 0 1 .197.89l-.11.228m-2.203-1.118a.75.75 0 0 0-.197.89l.11.228M3.75 5.25h16.5m-14.25 0v13.5A2.25 2.25 0 0 0 8.25 21h7.5a2.25 2.25 0 0 0 2.25-2.25V5.25m-12 0V3.75A2.25 2.25 0 0 1 10.5 1.5h3a2.25 2.25 0 0 1 2.25 2.25V5.25" />
    </svg>
  );
}

/** Object-select / scan icon — dashed rectangle with corner markers. */
function ObjectSelectIcon() {
  return (
    <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" strokeDasharray="3 2"
        d="M3 9V6a1 1 0 0 1 1-1h3M3 15v3a1 1 0 0 0 1 1h3m11-1h3a1 1 0 0 0 1-1v-3m0-6V6a1 1 0 0 0-1-1h-3" />
    </svg>
  );
}

/** Magic-wand / sparkles icon (Heroicons outline "sparkles"). */
function WandIcon() {
  return (
    <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round"
        d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09ZM18.259 8.715 18 9.75l-.259-1.035a3.375 3.375 0 0 0-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 0 0 2.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 0 0 2.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 0 0-2.456 2.456Z" />
    </svg>
  );
}

/** Quick-select icon (Magnet icon to represent magnetic lasso/smart brush). */
function QuickSelectIcon() {
  return (
    <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round"
        d="M4.5 12V7.5a7.5 7.5 0 0 1 15 0V12m-15 0v2.25c0 1.243.68 2.378 1.772 2.914l3.18 1.564a2.25 2.25 0 0 0 1.954 0l3.18-1.564A3.375 3.375 0 0 0 19.5 14.25V12m-15 0h3.75m11.25 0h3.75" />
    </svg>
  );
}
