interface SystemGaugeProps {
  label: string;
  value: number;
  max: number;
  unit: string;
  color?: string;
  size?: number;
}

export const SystemGauge = ({
  label,
  value,
  max,
  unit,
  color = 'blue',
  size = 180,
}: SystemGaugeProps) => {
  const percentage = max > 0 ? Math.min((value / max) * 100, 100) : 0;
  const angle = (percentage / 100) * 180;

  const getColor = () => {
    if (percentage > 80) return 'text-red-400 stroke-red-500';
    if (percentage > 60) return 'text-yellow-400 stroke-yellow-500';
    return 'text-green-400 stroke-green-500';
  };

  return (
    <div className="bg-slate-800 border border-slate-700 rounded-lg p-4 flex flex-col items-center">
      <svg width={size} height={size / 2 + 20} viewBox="0 0 200 120">
        <path
          d="M 20 100 A 80 80 0 0 1 180 100"
          fill="none"
          stroke="#334155"
          strokeWidth="12"
          strokeLinecap="round"
        />
        <path
          d="M 20 100 A 80 80 0 0 1 180 100"
          fill="none"
          className={getColor()}
          strokeWidth="12"
          strokeLinecap="round"
          strokeDasharray={`${(angle / 180) * 251.2} 251.2`}
        />
        <text x="100" y="85" textAnchor="middle" className="fill-white text-2xl font-bold">
          {Math.round(percentage)}%
        </text>
        <text x="100" y="105" textAnchor="middle" className="fill-slate-400 text-xs">
          {value}/{max} {unit}
        </text>
      </svg>
      <span className="text-sm text-slate-300 mt-2">{label}</span>
    </div>
  );
};

export default SystemGauge;
