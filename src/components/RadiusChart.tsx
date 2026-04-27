import type { RadiusStats } from '../types';

const LENGTH_FACTOR = 0.9333146; // µm per px

interface Props { stats: RadiusStats; }

export default function RadiusStatsPanel({ stats }: Props) {
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
        const valueUm = value * LENGTH_FACTOR;
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
