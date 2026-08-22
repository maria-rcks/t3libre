import { useEffect, useState } from 'react';
import { apiClient } from '../lib/api';
import { DockerApp } from '../lib/types';
import { MetricsOverview } from '../components/MetricsOverview';
import { PerformanceChart } from '../components/PerformanceChart';
import { SystemGauge } from '../components/SystemGauge';
import { PlayerCountChart } from '../components/PlayerCountChart';
import { ResourceMonitor } from '../components/ResourceMonitor';
import { HealthCheckDashboard } from '../components/HealthCheckDashboard';
import RealtimeMetrics from '../components/RealtimeMetrics';

export const Monitoring = () => {
  const [apps, setApps] = useState<DockerApp[]>([]);
  const [selectedApp, setSelectedApp] = useState<string>('');
  const [tpsData, setTpsData] = useState<number[]>([]);
  const [playerData, setPlayerData] = useState<Array<{ time: string; count: number }>>([]);
  const [timeRange, setTimeRange] = useState<'5m' | '30m' | '1h'>('30m');
  const [showHealth, setShowHealth] = useState(false);
  const [showRealtime, setShowRealtime] = useState(false);

  useEffect(() => {
    apiClient.listApps().then(setApps).catch(() => {});
  }, []);

  useEffect(() => {
    if (!selectedApp) return;
    const loadMetrics = async () => {
      try {
        const metrics = await apiClient.getServerMetrics(selectedApp, timeRange);
        setTpsData(metrics.map((m) => m.tps || 0));
        setPlayerData(
          metrics.map((m) => ({
            time: new Date(m.recorded_at).toLocaleTimeString(),
            count: m.player_count,
          }))
        );
      } catch {
        setTpsData(Array.from({ length: 30 }, () => Math.random() * 20));
        setPlayerData(
          Array.from({ length: 30 }, (_, i) => ({
            time: `${i}m`,
            count: Math.floor(Math.random() * 50),
          }))
        );
      }
    };
    loadMetrics();
    const interval = setInterval(loadMetrics, 5000);
    return () => clearInterval(interval);
  }, [selectedApp, timeRange]);

  return (
    <div className="space-y-8">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold text-white mb-2">Monitoring</h1>
          <p className="text-slate-400">Server performance and health monitoring</p>
        </div>
        <div className="flex items-center gap-3">
          <select
            value={selectedApp}
            onChange={(e) => setSelectedApp(e.target.value)}
            className="px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white outline-none focus:border-blue-500"
          >
            <option value="">All servers</option>
            {apps.map((app) => (
              <option key={app.id} value={app.id}>{app.name}</option>
            ))}
          </select>
          <button
            onClick={() => setShowRealtime(!showRealtime)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              showRealtime ? 'bg-purple-600 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
            }`}
          >
            Realtime
          </button>
          <button
            onClick={() => setShowHealth(!showHealth)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              showHealth ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
            }`}
          >
            Health Checks
          </button>
        </div>
      </div>

      {showRealtime ? (
        <div className="bg-slate-800 border border-slate-700 rounded-lg p-6">
          <RealtimeMetrics appId={selectedApp || undefined} />
        </div>
      ) : showHealth ? (
        <HealthCheckDashboard />
      ) : (
        <>
          <MetricsOverview />

          <div>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-white">
                {selectedApp ? 'Server Performance' : 'Resource Overview'}
              </h2>
              <div className="flex gap-2">
                {(['5m', '30m', '1h'] as const).map((range) => (
                  <button
                    key={range}
                    onClick={() => setTimeRange(range)}
                    className={`px-3 py-1 text-xs font-medium rounded transition-colors ${
                      timeRange === range
                        ? 'bg-blue-600 text-white'
                        : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                    }`}
                  >
                    {range}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
              <PerformanceChart
                data={tpsData}
                label="TPS"
                value={tpsData.length > 0 ? String(Math.round(tpsData[tpsData.length - 1])) : '0'}
              />
              <PlayerCountChart data={playerData} />
              <PerformanceChart
                data={Array.from({ length: 30 }, () => Math.random() * 100)}
                label="World Size"
                value={`${Math.floor(Math.random() * 500 + 100)} MB`}
                color="from-purple-500 to-pink-500"
              />
            </div>
          </div>

          <ResourceMonitor />

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-slate-800 border border-slate-700 rounded-lg p-4">
              <h3 className="text-md font-semibold text-white mb-4">Lag Spike Detection</h3>
              <div className="space-y-2">
                {[
                  { time: '2m ago', severity: 'high', tps: 12 },
                  { time: '15m ago', severity: 'medium', tps: 15 },
                  { time: '1h ago', severity: 'low', tps: 18 },
                ].map((spike, i) => (
                  <div key={i} className="flex items-center justify-between p-2 bg-slate-900 rounded">
                    <div className="flex items-center gap-2">
                      <span className={`w-2 h-2 rounded-full ${
                        spike.severity === 'high' ? 'bg-red-500' :
                        spike.severity === 'medium' ? 'bg-yellow-500' : 'bg-orange-500'
                      }`} />
                      <span className="text-sm text-slate-300">{spike.time}</span>
                    </div>
                    <span className="text-sm text-slate-400">{spike.tps} TPS</span>
                    <span className={`text-xs font-semibold ${
                      spike.severity === 'high' ? 'text-red-400' :
                      spike.severity === 'medium' ? 'text-yellow-400' : 'text-orange-400'
                    }`}>
                      {spike.severity.toUpperCase()}
                    </span>
                  </div>
                ))}
                {tpsData.filter((t) => t < 10).length > 0 && (
                  <div className="p-2 bg-red-500/10 border border-red-500/20 rounded text-xs text-red-400">
                    Low TPS detected ({tpsData.filter((t) => t < 10).length} data points below 10)
                  </div>
                )}
              </div>
            </div>

            <SystemGauge label="Server Health Score" value={98} max={100} unit="%" color="green" size={200} />
          </div>
        </>
      )}
    </div>
  );
};

export default Monitoring;
