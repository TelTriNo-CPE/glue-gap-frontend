import { useState } from 'react';
import UploadZone from './components/UploadZone';
import AnalysisView from './components/AnalysisView';

export default function App() {
  const [fileKey, setFileKey] = useState<string | null>(null);

  if (fileKey) {
    return <AnalysisView fileKey={fileKey} onReset={() => setFileKey(null)} />;
  }
  return <UploadZone onSuccess={setFileKey} />;
}
