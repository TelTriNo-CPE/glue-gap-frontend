import axios from 'axios';
import type { AnalysisResult, Gap } from './types';

export async function analyzeGaps(key: string): Promise<AnalysisResult> {
  const { data } = await axios.post<AnalysisResult>('/analyze-gaps', { key });
  return data;
}

export async function deleteFile(key: string): Promise<void> {
  await axios.delete(`/upload/image/${encodeURIComponent(key)}`);
}

export const getDziUrl = (stem: string) =>
  `/tiles/${stem}/${stem}.dzi`;

export async function downloadExcel(key: string, stem: string) {
  await axios.post('/exports/excel', { key });
  const { data } = await axios.get<{ url: string }>(`/exports/${stem}/excel`);
  const a = document.createElement('a');
  a.href = data.url;
  a.download = `${stem}.xlsx`;
  a.click();
}

export async function downloadJpeg(key: string, stem: string) {
  await axios.post('/exports/image', { key });
  const { data } = await axios.get<{ url: string }>(`/exports/${stem}/image`);
  const a = document.createElement('a');
  a.href = data.url;
  a.download = `${stem}-annotated.jpg`;
  a.click();
}

export async function saveAnalysisGaps(analysisId: string, gaps: Gap[]) {
  await axios.put(`/analysis/${encodeURIComponent(analysisId)}/gaps`, {
    key: analysisId,
    gaps,
  });
}
