interface PlayerCountChartProps {
  data: Array<{ time: string; count: number }>;
  height?: number;
}

export const PlayerCountChart = ({
  data,
  height = 160,
}: PlayerCountChartProps) => {
  if (data.length === 0) {
    return (
      <div className="bg-slate-800 border border-slate-700 rounded-lg p-4">
        <p className="text-sm text-slate-400 mb-3">Players Over Time</p>
        <div className="flex items-center justify-center" style={{ height }}>
          <p className="text-slate-500 text-sm">No data available</p>
        </div>
      </div>
    );
  }

  const max = Math.max(...data.map((d) => d.count), 1);
  const barWidth = Math.max(4, Math.floor(100 / data.length));

  return (
    <div className="bg-slate-800 border border-slate-700 rounded-lg p-4">
      <p className="text-sm text-slate-400 mb-3">Players Over Time</p>
      <div className="flex items-end gap-1" style={{ height }}>
        {data.map((d, i) => (
          <div
            key={i}
            className="flex-1 bg-gradient-to-t from-blue-500 to-cyan-400 rounded-t transition-all duration-300 hover:opacity-80"
            style={{
              height: `${(d.count / max) * 100}%`,
              minHeight: d.count > 0 ? '2px' : '0',
            }}
            title={`${d.time}: ${d.count} players`}
          />
        ))}
      </div>
      <div className="flex items-center justify-between mt-2 text-xs text-slate-500">
        <span>{data[0]?.time || ''}</span>
        <span>{data[data.length - 1]?.time || ''}</span>
      </div>
    </div>
  );
};

export default PlayerCountChart;
