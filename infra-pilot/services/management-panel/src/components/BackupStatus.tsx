import { useEffect, useState } from 'react';
import { apiClient } from '../lib/api';
import { BackupJob, BackupStatusEntry } from '../lib/types';

export const BackupStatus = () => {
  const [jobs, setJobs] = useState<BackupJob[]>([]);
  const [statuses, setStatuses] = useState<Record<string, BackupStatusEntry[]>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      try {
        const jobsData = await apiClient.getBackupJobs();
        setJobs(jobsData);
        const statusMap: Record<string, BackupStatusEntry[]> = {};
        for (const job of jobsData) {
          try {
            statusMap[job.id] = await apiClient.getBackupStatus(job.id);
          } catch {
            statusMap[job.id] = [];
          }
        }
        setStatuses(statusMap);
      } catch {
        // silent
      } finally {
        setLoading(false);
      }
    };
    load();
    const interval = setInterval(load, 30000);
    return () => clearInterval(interval);
  }, []);

  const allEntries = Object.values(statuses).flat();
  const successCount = allEntries.filter((e) => e.status === 'success').length;
  const failCount = allEntries.filter((e) => e.status === 'failed').length;
  const totalCount = allEntries.length;
  const successRate = totalCount > 0 ? Math.round((successCount / totalCount) * 100) : 0;

  if (loading) {
    return <div className="text-slate-400 py-4">Loading backup status...</div>;
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-slate-800 border border-slate-700 rounded-lg p-4 text-center">
          <p className="text-2xl font-bold text-green-400">{successCount}</p>
          <p className="text-xs text-slate-400">Successful</p>
        </div>
        <div className="bg-slate-800 border border-slate-700 rounded-lg p-4 text-center">
          <p className="text-2xl font-bold text-red-400">{failCount}</p>
          <p className="text-xs text-slate-400">Failed</p>
        </div>
        <div className="bg-slate-800 border border-slate-700 rounded-lg p-4 text-center">
          <p className="text-2xl font-bold text-white">{successRate}%</p>
          <p className="text-xs text-slate-400">Success Rate</p>
        </div>
      </div>

      <div className="w-full h-2 bg-slate-700 rounded-full overflow-hidden">
        <div
          className="h-full bg-gradient-to-r from-green-500 to-green-600 rounded-full transition-all"
          style={{ width: `${successRate}%` }}
        />
      </div>

      {jobs.length === 0 ? (
        <p className="text-slate-500 text-sm">No backup jobs configured</p>
      ) : (
        <div className="space-y-3">
          {jobs.map((job) => {
            const entries = statuses[job.id] || [];
            const recent = entries.slice(0, 5);
            return (
              <div key={job.id} className="bg-slate-800 border border-slate-700 rounded-lg p-3">
                <p className="text-sm font-semibold text-white mb-2">{job.name}</p>
                {recent.length === 0 ? (
                  <p className="text-xs text-slate-500">No backup runs yet</p>
                ) : (
                  <div className="space-y-1">
                    {recent.map((entry) => (
                      <div key={entry.id} className="flex items-center justify-between text-xs">
                        <div className="flex items-center gap-2">
                          <span className={`w-2 h-2 rounded-full ${
                            entry.status === 'success' ? 'bg-green-500' :
                            entry.status === 'failed' ? 'bg-red-500' : 'bg-yellow-500'
                          }`} />
                          <span className="text-slate-300">{entry.status}</span>
                        </div>
                        <span className="text-slate-500">
                          {entry.size_mb ? `${entry.size_mb.toFixed(1)} MB` : ''}
                          {entry.started_at && ` · ${new Date(entry.started_at).toLocaleDateString()}`}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default BackupStatus;
