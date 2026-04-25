import { useRef, useState } from 'react';
import axios, { AxiosProgressEvent } from 'axios';
import { deleteFile } from '../api';

type UploadStatus = 'idle' | 'uploading' | 'uploaded' | 'cancelling' | 'error';

const UPLOAD_URL = '/upload/image';
const MAX_FILE_SIZE = 1024 * 1024 * 1024; // 1 GB

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024).toFixed(0)} KB`;
}

const ACCEPTED_FORMATS = ['TIFF', 'PNG', 'JPEG', 'BMP', 'WebP'];

function validateFile(file: File): string | null {
  if (!file.type.startsWith('image/')) {
    return `"${file.name}" is not an image file. Accepted formats: ${ACCEPTED_FORMATS.join(', ')}.`;
  }
  if (file.size > MAX_FILE_SIZE) {
    return `File too large (${formatSize(file.size)}). Maximum is 1 GB.`;
  }
  return null;
}

interface Props {
  onSuccess: (key: string) => void;
}

export default function UploadZone({ onSuccess }: Props) {
  const [isDragOver, setIsDragOver] = useState(false);
  const [status, setStatus] = useState<UploadStatus>('idle');
  const [progress, setProgress] = useState(0);
  const [errorMessage, setErrorMessage] = useState('');
  const [uploadedKey, setUploadedKey] = useState('');
  const [uploadedName, setUploadedName] = useState('');
  const [uploadedSize, setUploadedSize] = useState(0);
  const dragCounterRef = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const busy = status === 'uploading' || status === 'cancelling';

  function handleDragEnter(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current += 1;
    if (e.dataTransfer.items && e.dataTransfer.items.length > 0) setIsDragOver(true);
  }

  function handleDragLeave(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current -= 1;
    if (dragCounterRef.current === 0) setIsDragOver(false);
  }

  function handleDragOver(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
  }

  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    dragCounterRef.current = 0;
    const files = e.dataTransfer.files;
    if (!files || files.length === 0) return;
    processFile(files[0]);
  }

  function handleZoneClick() {
    if (busy) return;
    inputRef.current?.click();
  }

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    processFile(file);
    e.target.value = '';
  }

  function processFile(file: File) {
    const err = validateFile(file);
    if (err) { setStatus('error'); setErrorMessage(err); return; }
    uploadFile(file);
  }

  async function uploadFile(file: File) {
    setStatus('uploading');
    setProgress(0);
    setErrorMessage('');
    const formData = new FormData();
    formData.append('file', file);
    try {
      const { data } = await axios.post<{
        key: string;
        originalName: string;
        size: number;
      }>(UPLOAD_URL, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 300000, // 5 minutes — large files need more time
        onUploadProgress: (event: AxiosProgressEvent) => {
          if (event.total !== undefined && event.total > 0) {
            setProgress(Math.round((event.loaded / event.total) * 100));
          }
        },
      });
      setUploadedKey(data.key);
      setUploadedName(data.originalName);
      setUploadedSize(data.size);
      setStatus('uploaded');
    } catch (err: unknown) {
      setStatus('error');
      setErrorMessage(
        axios.isAxiosError(err)
          ? (err.response?.data?.message ?? err.message)
          : 'Upload failed.'
      );
    }
  }

  async function handleCancel() {
    setStatus('cancelling');
    try {
      await deleteFile(uploadedKey);
    } catch {
      // ignore delete errors — reset regardless
    }
    reset();
  }

  function reset() {
    setStatus('idle');
    setProgress(0);
    setErrorMessage('');
    setUploadedKey('');
    setUploadedName('');
    setUploadedSize(0);
  }

  const zoneBase =
    'flex flex-col items-center justify-center gap-4 w-full max-w-xl mx-auto mt-16 p-12 ' +
    'border-2 border-dashed rounded-2xl select-none transition-colors duration-200';
  const zoneColor =
    busy
      ? 'border-gray-300 bg-gray-50 cursor-not-allowed'
      : isDragOver
      ? 'border-blue-500 bg-blue-50 cursor-pointer'
      : 'border-gray-300 bg-white hover:border-blue-400 hover:bg-blue-50 cursor-pointer';

  // ── Upload complete state ──────────────────────────────────────────────────
  if (status === 'uploaded' || status === 'cancelling') {
    return (
      <div className="min-h-screen bg-gray-100 flex flex-col items-center justify-start pt-8 px-4">
        <h1 className="text-3xl font-bold text-gray-800 mb-2">Glue Gap</h1>
        <p className="text-gray-500 mb-8">Drop a file to upload (max 1 GB)</p>

        <div className="w-full max-w-xl bg-white rounded-2xl border border-gray-200 p-8 flex flex-col items-center gap-6">
          {/* Check icon */}
          <div className="w-14 h-14 rounded-full bg-green-100 flex items-center justify-center">
            <svg className="w-7 h-7 text-green-600" fill="none" viewBox="0 0 24 24"
                 stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>

          <div className="text-center">
            <p className="text-lg font-semibold text-gray-800">Upload Complete</p>
            <p className="text-sm text-gray-500 mt-1 truncate max-w-xs">{uploadedName}</p>
            <p className="text-xs text-gray-400 mt-0.5">{formatSize(uploadedSize)}</p>
          </div>

          <div className="flex gap-3 w-full">
            <button
              onClick={handleCancel}
              disabled={status === 'cancelling'}
              className="flex-1 py-2.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed rounded-xl transition-colors"
            >
              {status === 'cancelling' ? 'Cancelling…' : 'Cancel'}
            </button>
            <button
              onClick={() => onSuccess(uploadedKey)}
              disabled={status === 'cancelling'}
              className="flex-1 py-2.5 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-xl transition-colors flex items-center justify-center gap-2"
            >
              Go to Analysis
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24"
                   stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Default / uploading / error state ─────────────────────────────────────
  return (
    <div className="min-h-screen bg-gray-100 flex flex-col items-center justify-start pt-8 px-4">
      <h1 className="text-3xl font-bold text-gray-800 mb-2">Glue Gap</h1>
      <p className="text-gray-500 mb-8">Drop a file to upload (max 1 GB)</p>

      <div
        className={`${zoneBase} ${zoneColor}`}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        onClick={handleZoneClick}
        role="button"
        aria-label="File upload area"
        tabIndex={0}
        onKeyDown={(e) => e.key === 'Enter' && handleZoneClick()}
      >
        <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={handleInputChange} />

        <svg
          className={`w-12 h-12 ${isDragOver ? 'text-blue-500' : 'text-gray-400'}`}
          xmlns="http://www.w3.org/2000/svg"
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}
          aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round"
            d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5" />
        </svg>

        {status === 'uploading' ? (
          <div className="w-full flex flex-col gap-2">
            <div className="flex justify-between text-sm text-gray-600">
              <span>{progress < 100 ? 'Uploading…' : 'Processing…'}</span>
              <span>{progress}%</span>
            </div>
            <div className="w-full h-3 bg-gray-200 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-150 ease-linear ${
                  progress < 100 ? 'bg-blue-500' : 'bg-blue-400 animate-pulse'
                }`}
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        ) : (
          <div className="text-center">
            <p className="text-base font-medium text-gray-700">
              {isDragOver ? 'Release to upload' : 'Drag & drop a file here'}
            </p>
            <p className="text-sm text-gray-400 mt-1">or click to browse</p>
            <div className="flex flex-wrap justify-center gap-1.5 mt-3">
              {ACCEPTED_FORMATS.map(fmt => (
                <span key={fmt}
                      className="px-2 py-0.5 text-xs font-medium text-gray-500 bg-gray-100 rounded-md">
                  {fmt}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      {status === 'error' && (
        <div className="mt-6 px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm w-full max-w-xl">
          <span className="font-medium">Error: </span>{errorMessage}
        </div>
      )}

      {status === 'error' && (
        <button
          className="mt-4 px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
          onClick={reset}
        >
          Try again
        </button>
      )}
    </div>
  );
}
