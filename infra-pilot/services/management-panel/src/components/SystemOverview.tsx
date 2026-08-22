import { useState, useEffect } from 'react';

interface ChartDataPoint {
  value: number;
  timestamp: string;
}

interface SystemMetric {
  name: string;
  current: number;
  max: number;
  unit: string;
  color: string;
  trend: 'up' | 'down' | 'stable';
}

interface SystemOverviewProps {
  cpuUsage?: number;
  memoryUsage?: { used: number; total: number };
  networkIO?: { rx: number; tx: number };
}

const SimpleLineChart = ({
  data,
  color,
  height = 100,
}: {
  data: number[];
  color: string;
  height?: number;
}) => {
  if (data.length === 0) return null;

  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;

  const points = data.map((value, index) => {
    const x = (index / (data.length - 1)) * 100;
    const y = 100 - ((value - min) / range) * 100;
    return `${x},${y}`;
  });

  return (
    <svg
      width="100%"
      height={height}
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      className="stroke-current"
    >
      <polyline
        points={points.join(' ')}
        fill="none"
        vectorEffect="non-scaling-stroke"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="0.5"
      />
    </svg>
  );
};

export const SystemOverview = ({
  cpuUsage = 23,
  memoryUsage = { used: 6.1, total: 15.6 },
  networkIO = { rx: 345, tx: 125 },
}: SystemOverviewProps) => {
  const [chartData] = useState({
    cpu: Array.from({ length: 30 }, () => Math.random() * 50 + 10),
    memory: Array.from({ length: 30 }, () => Math.random() * 40 + 20),
    network: Array.from({ length: 30 }, () => Math.random() * 400 + 100),
  });

  const [activeTab, setActiveTab] = useState<'1H' | '6H' | '24H' | '7D'>('24H');

  const metrics: SystemMetric[] = [
    {
      name: 'CPU Usage',
      current: cpuUsage,
      max: 100,
      unit: '%',
      color: 'text-blue-400',
      trend: 'stable',
    },
    {
      name: 'Memory Usage',
      current: memoryUsage.used,
      max: memoryUsage.total,
      unit: 'GB',
      color: 'text-purple-400',
      trend: 'up',
    },
    {
      name: 'Network I/O',
      current: networkIO.rx,
      max: 1000,
      unit: 'KB/s',
      color: 'text-cyan-400',
      trend: 'stable',
    },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-xl font-bold text-white">System Overview</h3>
        <div className="flex gap-2">
          {(['1H', '6H', '24H', '7D'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-3 py-1 text-xs font-medium rounded transition-colors ${
                activeTab === tab
                  ? 'bg-blue-600 text-white'
                  : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
              }`}
            >
              {tab}
            </button>
          ))}
        </div>
      </div>

      {/* Metrics Grid */}
      <div className="grid grid-cols-3 gap-6">
        {/* CPU Usage */}
        <div className="bg-slate-800 border border-slate-700 rounded-lg p-6">
          <div className="mb-4">
            <p className="text-sm text-slate-400 mb-1">CPU Usage</p>
            <p className="text-2xl font-bold text-white">23%</p>
            <p className="text-xs text-slate-400 mt-1">100%</p>
          </div>
          <div className="h-12 text-blue-400">
            <SimpleLineChart data={chartData.cpu} color="blue" />
          </div>
        </div>

        {/* Memory Usage */}
        <div className="bg-slate-800 border border-slate-700 rounded-lg p-6">
          <div className="mb-4">
            <p className="text-sm text-slate-400 mb-1">Memory Usage</p>
            <p className="text-2xl font-bold text-white">6.1 GB</p>
            <p className="text-xs text-slate-400 mt-1">16 GB</p>
          </div>
          <div className="h-12 text-purple-400">
            <SimpleLineChart data={chartData.memory} color="purple" />
          </div>
        </div>

        {/* Network I/O */}
        <div className="bg-slate-800 border border-slate-700 rounded-lg p-6">
          <div className="mb-4">
            <p className="text-sm text-slate-400 mb-1">Network I/O</p>
            <p className="text-2xl font-bold text-white">345 KB/s</p>
            <p className="text-xs text-slate-400 mt-1">1 MB/s</p>
          </div>
          <div className="h-12 text-cyan-400">
            <SimpleLineChart data={chartData.network} color="cyan" />
          </div>
        </div>
      </div>
    </div>
  );
};
