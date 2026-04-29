import type { RadiusStats } from '../types';

interface Props { stats: RadiusStats; scaleFactor: number; }

export default function RadiusStatsPanel({ stats, scaleFactor }: Props) {
  const rows: [string, number][] = [
    ['Min', stats.min],
    ['Max', stats.max],
    ['Mean', stats.mean],
    ['Median', stats.median],
    ['Std Dev', stats.std],
  ];

  return (
    <dl className="flex flex-col gap-2">
      {rows.map(([label, value]) => {
        const valueUm = value * scaleFactor;
        return (
          <div key={label} className="flex justify-between text-sm">
            <dt className="text-gray-600">{label}</dt>
            <dd className="font-medium text-gray-900">
              {value.toFixed(2)} px <span className="text-gray-400 font-normal">({valueUm.toFixed(2)} µm)</span>
            </dd>
          </div>
        );
      })}
    </dl>
  );
}
