import { useState } from 'react';
import UploadZone from './components/UploadZone';
import AnalysisView from './components/AnalysisView';

export default function App() {
  const [fileKey, setFileKey] = useState<string | null>(null);
  const [originalFile, setOriginalFile] = useState<File | null>(null);

  if (fileKey) {
    return (
      <AnalysisView 
        fileKey={fileKey} 
        originalFile={originalFile}
        onReset={() => {
          setFileKey(null);
          setOriginalFile(null);
        }} 
      />
    );
  }
  return (
    <UploadZone 
      onSuccess={(key, file) => {
        setFileKey(key);
        setOriginalFile(file);
      }} 
    />
  );
}
