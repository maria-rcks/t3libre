import { useEffect, useState } from 'react';
import { apiClient } from '../lib/api';
import { BackupJob, DockerApp } from '../lib/types';
import { toast } from 'sonner';

export const BackupManager = () => {
  const [jobs, setJobs] = useState<BackupJob[]>([]);
  const [apps, setApps] = useState<DockerApp[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    name: '',
    app_id: '',
    schedule_type: 'daily' as const,
    retention_count: 7,
  });

  useEffect(() => {
    Promise.all([loadJobs(), loadApps()]).finally(() => setLoading(false));
  }, []);

  const loadJobs = async () => {
    try {
      setJobs(await apiClient.getBackupJobs());
    } catch {
      setJobs([]);
    }
  };

  const loadApps = async () => {
    try {
      setApps(await apiClient.listApps());
    } catch {
      setApps([]);
    }
  };

  const handleCreate = async () => {
    if (!form.name || !form.app_id) {
      toast.error('Name and app are required');
      return;
    }
    try {
      await apiClient.createBackupJob(form);
      toast.success('Backup job created');
      setShowForm(false);
      setForm({ name: '', app_id: '', schedule_type: 'daily', retention_count: 7 });
      loadJobs();
    } catch {
      toast.error('Failed to create backup job');
    }
  };

  const handleToggle = async (job: BackupJob) => {
    try {
      const newStatus = job.status === 'active' ? 'paused' : 'active';
      await apiClient.updateBackupJob(job.id, { status: newStatus });
      toast.success(`Backup ${newStatus === 'active' ? 'resumed' : 'paused'}`);
      loadJobs();
    } catch {
      toast.error('Failed to update backup job');
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await apiClient.deleteBackupJob(id);
      toast.success('Backup job deleted');
      loadJobs();
    } catch {
      toast.error('Failed to delete backup job');
    }
  };

  const getScheduleIcon = (type: string) => {
    switch (type) {
      case 'hourly': return '🕐';
      case 'daily': return '📅';
      case 'weekly': return '📆';
      default: return '✋';
    }
  };

  if (loading) {
    return <div className="text-slate-400 py-4">Loading backup jobs...</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h4 className="text-md font-semibold text-white">Backup Jobs</h4>
        <button
          onClick={() => setShowForm(!showForm)}
          className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded transition-colors"
        >
          {showForm ? 'Cancel' : 'New Backup Job'}
        </button>
      </div>

      {showForm && (
        <div className="bg-slate-800 border border-slate-700 rounded-lg p-4 space-y-3">
          <input
            type="text"
            placeholder="Backup name"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-sm text-white placeholder-slate-400 outline-none focus:border-blue-500"
          />
          <select
            value={form.app_id}
            onChange={(e) => setForm({ ...form, app_id: e.target.value })}
            className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-sm text-white outline-none focus:border-blue-500"
          >
            <option value="">Select app...</option>
            {apps.map((app) => (
              <option key={app.id} value={app.id}>{app.name}</option>
            ))}
          </select>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-slate-400 mb-1">Schedule</label>
              <select
                value={form.schedule_type}
                onChange={(e) => setForm({ ...form, schedule_type: e.target.value as any })}
                className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-sm text-white outline-none focus:border-blue-500"
              >
                <option value="hourly">Hourly</option>
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="manual">Manual</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Retention (backups)</label>
              <input
                type="number"
                min={1}
                max={365}
                value={form.retention_count}
                onChange={(e) => setForm({ ...form, retention_count: parseInt(e.target.value) || 7 })}
                className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-sm text-white outline-none focus:border-blue-500"
              />
            </div>
          </div>
          <button
            onClick={handleCreate}
            className="w-full py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded transition-colors"
          >
            Create Backup Job
          </button>
        </div>
      )}

      <div className="space-y-2">
        {jobs.length === 0 ? (
          <p className="text-slate-500 text-sm">No backup jobs configured</p>
        ) : (
          jobs.map((job) => (
            <div key={job.id} className="flex items-center justify-between p-3 bg-slate-800 rounded-lg border border-slate-700">
              <div className="flex items-center gap-3">
                <span className="text-lg">{getScheduleIcon(job.schedule_type)}</span>
                <div>
                  <p className="text-sm font-semibold text-white">{job.name}</p>
                  <p className="text-xs text-slate-400">
                    {job.schedule_type} · Retention: {job.retention_count} · {job.status}
                  </p>
                  {job.last_run && (
                    <p className="text-xs text-slate-500">Last run: {new Date(job.last_run).toLocaleString()}</p>
                  )}
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => handleToggle(job)}
                  className={`px-2 py-1 text-xs rounded transition-colors ${
                    job.status === 'active'
                      ? 'bg-yellow-600/20 text-yellow-400 hover:bg-yellow-600/40'
                      : 'bg-green-600/20 text-green-400 hover:bg-green-600/40'
                  }`}
                >
                  {job.status === 'active' ? 'Pause' : 'Resume'}
                </button>
                <button
                  onClick={() => handleDelete(job.id)}
                  className="px-2 py-1 text-xs bg-red-600/20 text-red-400 hover:bg-red-600/40 rounded transition-colors"
                >
                  Delete
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export default BackupManager;
