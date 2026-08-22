import { useEffect, useState } from 'react';
import { apiClient } from '../lib/api';
import { MetricCard } from './MetricCard';

export const MetricsOverview = () => {
  const [metrics, setMetrics] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      try {
        const data = await apiClient.getAggregatedMetrics();
        setMetrics(data);
      } catch {
        setMetrics({ totalApps: 0, totalPlayers: 0, avgCpu: 0, avgMemory: 0, serverCount: 0, lagSpikes: 0 });
      } finally {
        setLoading(false);
      }
    };
    load();
    const interval = setInterval(load, 10000);
    return () => clearInterval(interval);
  }, []);

  if (loading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="bg-slate-800 border border-slate-700 rounded-lg p-6 animate-pulse">
            <div className="h-4 bg-slate-700 rounded w-24 mb-4" />
            <div className="h-8 bg-slate-700 rounded w-16" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
      <MetricCard
        icon="🖥️"
        label="Total Servers"
        value={metrics?.serverCount || 0}
        accentColor="blue"
      />
      <MetricCard
        icon="👥"
        label="Total Players"
        value={metrics?.totalPlayers || 0}
        accentColor="green"
      />
      <MetricCard
        icon="⚡"
        label="Avg CPU"
        value={`${metrics?.avgCpu || 0}%`}
        accentColor="purple"
      />
      <MetricCard
        icon="💾"
        label="Avg Memory"
        value={`${metrics?.avgMemory || 0}%`}
        accentColor="orange"
      />
    </div>
  );
};

export default MetricsOverview;
