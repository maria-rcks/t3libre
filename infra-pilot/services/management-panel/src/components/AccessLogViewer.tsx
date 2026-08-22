import { useEffect, useState } from 'react';
import { apiClient } from '../lib/api';
import { AccessLog } from '../lib/types';

export const AccessLogViewer = () => {
  const [logs, setLogs] = useState<AccessLog[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      try {
        const data = await apiClient.getAccessLogs(100);
        setLogs(data);
      } catch {
        setLogs([]);
      } finally {
        setLoading(false);
      }
    };
    load();
    const interval = setInterval(load, 15000);
    return () => clearInterval(interval);
  }, []);

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'success': return 'text-green-400';
      case 'failed': return 'text-red-400';
      case 'pending': return 'text-yellow-400';
      default: return 'text-slate-400';
    }
  };

  if (loading) {
    return (
      <div className="bg-slate-800 border border-slate-700 rounded-lg p-6">
        <p className="text-slate-400">Loading access logs...</p>
      </div>
    );
  }

  if (logs.length === 0) {
    return (
      <div className="bg-slate-800 border border-slate-700 rounded-lg p-6 text-center">
        <p className="text-slate-400">No access logs yet</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-slate-400 border-b border-slate-700">
              <th className="pb-3 pr-4">Time</th>
              <th className="pb-3 pr-4">Action</th>
              <th className="pb-3 pr-4">Source IP</th>
              <th className="pb-3 pr-4">Status</th>
              <th className="pb-3">Details</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((log) => (
              <tr key={log.id} className="border-b border-slate-800 hover:bg-slate-800/50 transition-colors">
                <td className="py-3 pr-4 text-slate-300 whitespace-nowrap">
                  {new Date(log.created_at).toLocaleString()}
                </td>
                <td className="py-3 pr-4 text-white">{log.action}</td>
                <td className="py-3 pr-4 text-slate-300 font-mono">{log.source_ip}</td>
                <td className={`py-3 pr-4 font-semibold ${getStatusColor(log.status)}`}>
                  {log.status}
                </td>
                <td className="py-3 text-slate-400 max-w-xs truncate">{log.details}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default AccessLogViewer;
