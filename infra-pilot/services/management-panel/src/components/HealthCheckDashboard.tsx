import { useEffect, useState } from 'react';
import { apiClient } from '../lib/api';
import { HealthCheck } from '../lib/types';

export const HealthCheckDashboard = () => {
  const [checks, setChecks] = useState<HealthCheck[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      try {
        setChecks(await apiClient.getHealthChecks());
      } catch {
        setChecks([]);
      } finally {
        setLoading(false);
      }
    };
    load();
    const interval = setInterval(load, 30000);
    return () => clearInterval(interval);
  }, []);

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'healthy': return 'bg-green-500/10 text-green-400 border-green-500/20';
      case 'degraded': return 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20';
      case 'down': return 'bg-red-500/10 text-red-400 border-red-500/20';
      default: return 'bg-slate-500/10 text-slate-400 border-slate-500/20';
    }
  };

  const latestChecks = checks.reduce((acc, check) => {
    if (!acc[check.app_id] || new Date(check.checked_at) > new Date(acc[check.app_id].checked_at)) {
      acc[check.app_id] = check;
    }
    return acc;
  }, {} as Record<string, HealthCheck>);

  const overallUptime = checks.length > 0
    ? Math.round((checks.filter((c) => c.status === 'healthy').length / checks.length) * 10000) / 100
    : 100;

  const downCount = Object.values(latestChecks).filter((c) => c.status === 'down').length;
  const degradedCount = Object.values(latestChecks).filter((c) => c.status === 'degraded').length;

  if (loading) {
    return <div className="text-slate-400 py-4">Loading health checks...</div>;
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-4 gap-4">
        <div className="bg-slate-800 border border-slate-700 rounded-lg p-4 text-center">
          <p className="text-2xl font-bold text-green-400">{overallUptime}%</p>
          <p className="text-xs text-slate-400">Uptime</p>
        </div>
        <div className="bg-slate-800 border border-slate-700 rounded-lg p-4 text-center">
          <p className="text-2xl font-bold text-white">{Object.keys(latestChecks).length}</p>
          <p className="text-xs text-slate-400">Services</p>
        </div>
        <div className="bg-slate-800 border border-slate-700 rounded-lg p-4 text-center">
          <p className="text-2xl font-bold text-red-400">{downCount}</p>
          <p className="text-xs text-slate-400">Down</p>
        </div>
        <div className="bg-slate-800 border border-slate-700 rounded-lg p-4 text-center">
          <p className="text-2xl font-bold text-yellow-400">{degradedCount}</p>
          <p className="text-xs text-slate-400">Degraded</p>
        </div>
      </div>

      <div className="w-full h-3 bg-slate-700 rounded-full overflow-hidden flex">
        <div
          className="h-full bg-green-500 transition-all"
          style={{ width: `${overallUptime}%` }}
        />
        <div
          className="h-full bg-yellow-500 transition-all"
          style={{ width: `${degradedCount > 0 ? (degradedCount / Object.keys(latestChecks).length) * 100 : 0}%` }}
        />
        <div
          className="h-full bg-red-500 transition-all"
          style={{ width: `${downCount > 0 ? (downCount / Object.keys(latestChecks).length) * 100 : 0}%` }}
        />
      </div>

      <div className="space-y-2">
        {Object.values(latestChecks).length === 0 ? (
          <p className="text-slate-500 text-sm">No health checks recorded</p>
        ) : (
          Object.values(latestChecks).map((check) => (
            <div
              key={check.id}
              className={`flex items-center justify-between p-3 rounded-lg border ${getStatusColor(check.status)}`}
            >
              <div className="flex items-center gap-3">
                <span className={`w-2 h-2 rounded-full ${
                  check.status === 'healthy' ? 'bg-green-500' :
                  check.status === 'degraded' ? 'bg-yellow-500' :
                  check.status === 'down' ? 'bg-red-500' : 'bg-slate-500'
                }`} />
                <div>
                  <p className="text-sm font-semibold text-white">Service {check.app_id.slice(0, 8)}</p>
                  <p className="text-xs text-slate-400">
                    {check.response_time_ms ? `${check.response_time_ms}ms response` : 'No response time'}
                  </p>
                </div>
              </div>
              <div className="text-right">
                <p className={`text-sm font-semibold ${
                  check.status === 'healthy' ? 'text-green-400' :
                  check.status === 'degraded' ? 'text-yellow-400' :
                  check.status === 'down' ? 'text-red-400' : 'text-slate-400'
                }`}>
                  {check.status}
                </p>
                <p className="text-xs text-slate-500">
                  {new Date(check.checked_at).toLocaleString()}
                </p>
              </div>
            </div>
          ))
        )}
      </div>

      {checks.length > 0 && (
        <div className="bg-slate-800 border border-slate-700 rounded-lg p-4">
          <p className="text-sm text-slate-400 mb-3">Incident Timeline (Recent)</p>
          <div className="space-y-2 max-h-48 overflow-y-auto">
            {checks
              .filter((c) => c.status !== 'healthy')
              .slice(0, 20)
              .map((check) => (
                <div key={check.id} className="flex items-center gap-3 text-xs">
                  <span className={`w-2 h-2 rounded-full ${
                    check.status === 'degraded' ? 'bg-yellow-500' : 'bg-red-500'
                  }`} />
                  <span className="text-slate-300">{check.app_id.slice(0, 8)}</span>
                  <span className="text-slate-400">{check.status}</span>
                  <span className="text-slate-500">{new Date(check.checked_at).toLocaleString()}</span>
                </div>
              ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default HealthCheckDashboard;
