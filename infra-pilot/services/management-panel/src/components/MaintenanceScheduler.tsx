import { useEffect, useState } from 'react';
import { apiClient } from '../lib/api';
import { MaintenanceWindow, DockerApp } from '../lib/types';
import { toast } from 'sonner';

export const MaintenanceScheduler = () => {
  const [windows, setWindows] = useState<MaintenanceWindow[]>([]);
  const [apps, setApps] = useState<DockerApp[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    title: '',
    description: '',
    app_id: '',
    starts_at: '',
    ends_at: '',
  });

  useEffect(() => {
    Promise.all([loadWindows(), loadApps()]).finally(() => setLoading(false));
  }, []);

  const loadWindows = async () => {
    try {
      setWindows(await apiClient.getMaintenanceWindows());
    } catch {
      setWindows([]);
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
    if (!form.title || !form.starts_at || !form.ends_at) {
      toast.error('Title, start and end times are required');
      return;
    }
    try {
      await apiClient.createMaintenanceWindow(form);
      toast.success('Maintenance window created');
      setShowForm(false);
      setForm({ title: '', description: '', app_id: '', starts_at: '', ends_at: '' });
      loadWindows();
    } catch {
      toast.error('Failed to create maintenance window');
    }
  };

  const handleCancel = async (id: string) => {
    try {
      await apiClient.updateMaintenanceWindow(id, { status: 'cancelled' });
      toast.success('Maintenance window cancelled');
      loadWindows();
    } catch {
      toast.error('Failed to cancel maintenance window');
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'scheduled': return 'bg-blue-500/10 text-blue-400';
      case 'active': return 'bg-green-500/10 text-green-400';
      case 'completed': return 'bg-slate-500/10 text-slate-400';
      case 'cancelled': return 'bg-red-500/10 text-red-400';
      default: return 'bg-slate-500/10 text-slate-400';
    }
  };

  if (loading) {
    return <div className="text-slate-400 py-4">Loading maintenance windows...</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h4 className="text-md font-semibold text-white">Maintenance Windows</h4>
        <button
          onClick={() => setShowForm(!showForm)}
          className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded transition-colors"
        >
          {showForm ? 'Cancel' : 'Schedule'}
        </button>
      </div>

      {showForm && (
        <div className="bg-slate-800 border border-slate-700 rounded-lg p-4 space-y-3">
          <input
            type="text"
            placeholder="Window title"
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-sm text-white placeholder-slate-400 outline-none focus:border-blue-500"
          />
          <input
            type="text"
            placeholder="Description (optional)"
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-sm text-white placeholder-slate-400 outline-none focus:border-blue-500"
          />
          <select
            value={form.app_id}
            onChange={(e) => setForm({ ...form, app_id: e.target.value })}
            className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-sm text-white outline-none focus:border-blue-500"
          >
            <option value="">All apps (global)</option>
            {apps.map((app) => (
              <option key={app.id} value={app.id}>{app.name}</option>
            ))}
          </select>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-slate-400 mb-1">Start</label>
              <input
                type="datetime-local"
                value={form.starts_at}
                onChange={(e) => setForm({ ...form, starts_at: e.target.value })}
                className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-sm text-white outline-none focus:border-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">End</label>
              <input
                type="datetime-local"
                value={form.ends_at}
                onChange={(e) => setForm({ ...form, ends_at: e.target.value })}
                className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-sm text-white outline-none focus:border-blue-500"
              />
            </div>
          </div>
          <button
            onClick={handleCreate}
            className="w-full py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded transition-colors"
          >
            Create Window
          </button>
        </div>
      )}

      <div className="space-y-2">
        {windows.length === 0 ? (
          <p className="text-slate-500 text-sm">No maintenance windows scheduled</p>
        ) : (
          windows.map((w) => (
            <div key={w.id} className="flex items-center justify-between p-3 bg-slate-800 rounded-lg border border-slate-700">
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-white">{w.title}</span>
                  <span className={`text-xs px-2 py-0.5 rounded-full ${getStatusColor(w.status)}`}>
                    {w.status}
                  </span>
                </div>
                {w.description && (
                  <p className="text-xs text-slate-400 mt-1">{w.description}</p>
                )}
                <p className="text-xs text-slate-500 mt-1">
                  {new Date(w.starts_at).toLocaleString()} - {new Date(w.ends_at).toLocaleString()}
                </p>
              </div>
              {w.status === 'scheduled' && (
                <button
                  onClick={() => handleCancel(w.id)}
                  className="px-2 py-1 text-xs bg-red-600/20 text-red-400 hover:bg-red-600/40 rounded transition-colors"
                >
                  Cancel
                </button>
              )}
            </div>
          ))
        )}
      </div>

      {windows.length > 0 && (
        <div className="bg-slate-800 border border-slate-700 rounded-lg p-4">
          <p className="text-sm text-slate-400 mb-3">Calendar View (Upcoming)</p>
          <div className="grid grid-cols-7 gap-1">
            {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
              <div key={d} className="text-center text-xs text-slate-500 py-1">{d}</div>
            ))}
            {Array.from({ length: 35 }, (_, i) => {
              const hasWindow = windows.some((w) => {
                const start = new Date(w.starts_at);
                const end = new Date(w.ends_at);
                const day = new Date();
                day.setDate(day.getDate() + (i - day.getDay() + 1));
                return start <= day && end >= day;
              });
              return (
                <div
                  key={i}
                  className={`text-center text-xs py-2 rounded ${
                    hasWindow ? 'bg-blue-600/20 text-blue-400' : 'text-slate-500'
                  }`}
                >
                  {new Date(new Date().getFullYear(), new Date().getMonth(), i - new Date().getDay() + 1).getDate()}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

export default MaintenanceScheduler;
