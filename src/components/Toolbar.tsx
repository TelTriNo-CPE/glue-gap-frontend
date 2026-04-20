import { useState } from 'react';
import { downloadExcel, downloadJpeg } from '../api';

interface Props {
  stem: string;
  fileKey: string;
  isGreyscale: boolean;
  hasResult: boolean;
  analyzing: boolean;
  onGreyscale: () => void;
  onDetect: () => void;
  onReset: () => void;
}

const btnClass =
  'flex flex-row items-center gap-3 px-4 py-3 w-full rounded-lg text-sm font-medium ' +
  'text-gray-400 hover:text-white hover:bg-gray-700 transition-colors ' +
  'disabled:opacity-40 disabled:cursor-not-allowed';

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

export default function Toolbar({ stem, fileKey, isGreyscale, hasResult, analyzing, onGreyscale, onDetect, onReset }: Props) {
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

      {/* Step 1: Change to Greyscale */}
      <button
        onClick={onGreyscale}
        disabled={isGreyscale}
        className={`${btnClass} ${isGreyscale ? 'text-blue-400' : ''}`}
      >
        <svg className="w-5 h-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round"
            d="M12 3v18M9 6.343A8 8 0 1 0 15 17.657" />
          <circle cx="12" cy="12" r="9" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        {isGreyscale ? 'Greyscale Applied' : 'Change to Greyscale'}
      </button>

      {/* Step 2: Start Detection — only shown after greyscale is applied */}
      {isGreyscale && (
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
