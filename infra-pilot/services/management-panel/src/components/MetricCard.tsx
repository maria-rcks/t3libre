interface MetricCardProps {
  icon: string;
  label: string;
  value: number | string;
  change?: {
    value: number;
    type: "up" | "down" | "neutral";
    timeframe: string;
  };
  trend?: "up" | "down" | "stable";
  accentColor?: string;
}

export const MetricCard = ({
  icon,
  label,
  value,
  change,
  trend = "stable",
  accentColor = "blue",
}: MetricCardProps) => {
  const accentMap: Record<string, string> = {
    blue: "from-sky-300 via-blue-500 to-indigo-500",
    green: "from-emerald-200 via-emerald-400 to-teal-500",
    red: "from-rose-200 via-rose-500 to-red-600",
    orange: "from-amber-200 via-orange-400 to-orange-600",
    purple: "from-violet-200 via-purple-500 to-fuchsia-500",
    cyan: "from-cyan-200 via-cyan-400 to-blue-500",
  };

  const getTrendColor = () => {
    switch (trend) {
      case "up":
        return "text-emerald-300";
      case "down":
        return "text-rose-300";
      default:
        return "text-white/45";
    }
  };

  const getTrendIcon = () => {
    switch (trend) {
      case "up":
        return "↑";
      case "down":
        return "↓";
      default:
        return "→";
    }
  };

  return (
    <div className="group relative overflow-hidden rounded-[1.75rem] border border-white/10 bg-white/[0.055] p-5 shadow-2xl shadow-black/30 backdrop-blur-xl transition-all duration-300 hover:-translate-y-1 hover:border-white/20 hover:bg-white/[0.08]">
      <div
        className={`absolute -right-10 -top-10 h-28 w-28 rounded-full bg-gradient-to-br ${accentMap[accentColor] || accentMap.blue} opacity-20 blur-2xl transition-opacity group-hover:opacity-35`}
      />
      <div className="relative mb-6 flex items-start justify-between">
        <div
          className={`flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br ${accentMap[accentColor] || accentMap.blue} text-xl shadow-lg shadow-black/30 ring-1 ring-white/30`}
        >
          {icon}
        </div>
        <div className="flex items-center gap-1 rounded-full border border-white/10 bg-black/20 px-2.5 py-1">
          <span className={`text-sm font-semibold ${getTrendColor()}`}>
            {getTrendIcon()}
          </span>
          {change && (
            <span className="text-[11px] text-white/50">
              {change.type === "down" && change.value > 0 ? "▼" : "▲"}{" "}
              {Math.abs(change.value)}%
            </span>
          )}
        </div>
      </div>

      <p className="relative mb-2 text-sm text-white/50">{label}</p>
      <p className="relative text-3xl font-semibold tracking-tight text-white">
        {value}
      </p>
      {change && (
        <p className="relative mt-2 text-xs text-white/35">
          vs {change.timeframe}
        </p>
      )}
    </div>
  );
};
