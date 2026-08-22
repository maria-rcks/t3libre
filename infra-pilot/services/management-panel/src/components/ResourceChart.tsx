interface ResourceChartProps {
  label: string;
  data: number[];
  color?: string;
  unit?: string;
  height?: number;
  current?: number;
  max?: number;
}

export const ResourceChart = ({
  label,
  data,
  color = 'from-blue-500 to-blue-600',
  unit = '%',
  height = 80,
  current,
  max,
}: ResourceChartProps) => {
  const maxVal = max || Math.max(...data, 1);

  return (
    <div className="bg-slate-800 border border-slate-700 rounded-lg p-4">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm text-slate-400">{label}</span>
        {current !== undefined && (
          <span className="text-sm font-bold text-white">
            {current}{unit}
          </span>
        )}
      </div>
      <div className="flex items-end gap-[2px]" style={{ height }}>
        {data.map((v, i) => (
          <div
            key={i}
            className={`flex-1 bg-gradient-to-t ${color} rounded-t opacity-80 hover:opacity-100 transition-opacity`}
            style={{ height: `${(v / maxVal) * 100}%`, minHeight: v > 0 ? '2px' : '0' }}
            title={`${v}${unit}`}
          />
        ))}
      </div>
    </div>
  );
};

export default ResourceChart;
