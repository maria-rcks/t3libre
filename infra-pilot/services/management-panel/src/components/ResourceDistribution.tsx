interface ResourceDistributionProps {
  cpu: number;
  memory: number;
  disk: number;
  other?: number;
}

export const ResourceDistribution = ({
  cpu = 23,
  memory = 39,
  disk = 28,
  other = 10,
}: ResourceDistributionProps) => {
  const resources = [
    { name: 'CPU', value: cpu, color: '#3b82f6', bgColor: 'bg-blue-500' },
    { name: 'Memory', value: memory, color: '#a855f7', bgColor: 'bg-purple-500' },
    { name: 'Disk', value: disk, color: '#06b6d4', bgColor: 'bg-cyan-500' },
    { name: 'Other', value: other, color: '#64748b', bgColor: 'bg-slate-500' },
  ];

  const total = cpu + memory + disk + other;
  let currentAngle = -90; // Start from top

  const segments = resources.map((resource) => {
    const sliceAngle = (resource.value / total) * 360;
    const startAngle = currentAngle;
    const endAngle = currentAngle + sliceAngle;

    // Convert angles to radians
    const startRad = (startAngle * Math.PI) / 180;
    const endRad = (endAngle * Math.PI) / 180;

    // Calculate path points
    const x1 = 50 + 45 * Math.cos(startRad);
    const y1 = 50 + 45 * Math.sin(startRad);
    const x2 = 50 + 45 * Math.cos(endRad);
    const y2 = 50 + 45 * Math.sin(endRad);

    const largeArc = sliceAngle > 180 ? 1 : 0;

    const path = [
      `M 50 50`,
      `L ${x1} ${y1}`,
      `A 45 45 0 ${largeArc} 1 ${x2} ${y2}`,
      'Z',
    ].join(' ');

    currentAngle = endAngle;

    return {
      ...resource,
      path,
      startAngle,
      endAngle,
      labelAngle: (startAngle + endAngle) / 2,
    };
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <h3 className="text-xl font-bold text-white">Resource Distribution</h3>

      <div className="grid grid-cols-2 gap-8">
        {/* Pie Chart */}
        <div className="bg-slate-800 border border-slate-700 rounded-lg p-8 flex items-center justify-center">
          <svg width="200" height="200" viewBox="0 0 100 100">
            {segments.map((segment) => (
              <path
                key={segment.name}
                d={segment.path}
                fill={segment.color}
                opacity="0.8"
              />
            ))}
            {/* Center circle for donut effect */}
            <circle cx="50" cy="50" r="25" fill="#1f2937" />
          </svg>
        </div>

        {/* Legend */}
        <div className="space-y-3">
          {resources.map((resource) => (
            <div
              key={resource.name}
              className="flex items-center justify-between p-3 bg-slate-800 rounded-lg hover:bg-slate-700 transition-colors"
            >
              <div className="flex items-center gap-3">
                <div
                  className={`w-3 h-3 rounded-full ${resource.bgColor}`}
                ></div>
                <span className="text-sm text-slate-300">{resource.name}</span>
              </div>
              <span className="text-sm font-semibold text-white">{resource.value}%</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
