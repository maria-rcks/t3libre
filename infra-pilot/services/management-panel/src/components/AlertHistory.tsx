import { useEffect, useState } from 'react';
import { apiClient } from '../lib/api';
import { AlertHistoryEntry } from '../lib/types';

export const AlertHistory = () => {
  const [alerts, setAlerts] = useState<AlertHistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      try {
        setAlerts(await apiClient.getAlertHistory());
      } catch {
        setAlerts([]);
      } finally {
        setLoading(false);
      }
    };
    load();
    const interval = setInterval(load, 30000);
    return () => clearInterval(interval);
  }, []);

  const handleAcknowledge = async (id: number) => {
    try {
      await apiClient.acknowledgeAlert(id);
      setAlerts((prev) => prev.map((a) => (a.id === id ? { ...a, acknowledged: true } : a)));
    } catch {
      // silent
    }
  };

  if (loading) {
    return <div className="text-slate-400 py-4">Loading alert history...</div>;
  }

  if (alerts.length === 0) {
    return (
      <div className="bg-slate-800 border border-slate-700 rounded-lg p-6 text-center">
        <p className="text-slate-400">No alerts triggered yet</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {alerts.map((alert) => (
        <div
          key={alert.id}
          className={`flex items-center justify-between p-3 rounded-lg border transition-colors ${
            alert.acknowledged
              ? 'bg-slate-800/50 border-slate-700/50'
              : 'bg-slate-800 border-red-700/50'
          }`}
        >
          <div className="flex items-center gap-3">
            <span className={`w-2 h-2 rounded-full ${alert.acknowledged ? 'bg-slate-500' : 'bg-red-500 animate-pulse'}`} />
            <div>
              <p className="text-sm text-white">
                {alert.metric_type} was {alert.metric_value} ({alert.operator} {alert.threshold})
              </p>
              <p className="text-xs text-slate-500">
                {new Date(alert.triggered_at).toLocaleString()}
              </p>
            </div>
          </div>
          {!alert.acknowledged && (
            <button
              onClick={() => handleAcknowledge(alert.id)}
              className="px-3 py-1 text-xs bg-blue-600 hover:bg-blue-700 text-white rounded transition-colors"
            >
              Acknowledge
            </button>
          )}
        </div>
      ))}
    </div>
  );
};

export default AlertHistory;
