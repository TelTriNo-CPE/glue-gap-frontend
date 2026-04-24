import { useState } from 'react';
import { downloadExcel, downloadJpeg } from '../api';

interface Props {
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
  clickMode: 'select' | 'deselect';
  setClickMode: (mode: 'select' | 'deselect') => void;
}

const btnClass =
  'flex flex-row items-center gap-3 px-4 py-3 w-full rounded-lg text-sm font-medium ' +
  'text-gray-400 hover:text-white hover:bg-gray-700 transition-colors ' +
  'disabled:opacity-40 disabled:cursor-not-allowed';

const toggleBtnClass = (active: boolean) =>
  `flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-md text-xs font-semibold transition-all ${
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
    <aside className="w-64 bg-gray-900 flex flex-col py-4 px-3 gap-1 shrink-0">

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
        <div className="flex bg-gray-950 p-1 rounded-lg gap-1">
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
        </div>
      </div>

      <Divider />

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

      {/* Step 2: Start Detection — shown after greyscale is applied, or when results exist */}
      {(isGreyscale || hasResult) && (
        <button
          onClick={onDetect}
          disabled={hasResult || analyzing}
          className={btnClass}
        >
          {analyzing ? <Spinner /> : hasResult ? (
            <svg className="w-5 h-5 shrink-0 text-green-400" fill="none" viewBox="0 0 24 24"
                 stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          ) : (
            <svg className="w-5 h-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round"
                d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 15.803 7.5 7.5 0 0 0 15.803 15.803z" />
            </svg>
          )}
          {analyzing ? 'Detecting…' : hasResult ? 'Detection Complete' : 'Start Detection'}
        </button>
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
