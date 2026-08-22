import { useEffect, useState } from 'react';
import { apiClient } from '../lib/api';
import { ScheduledTask, DockerApp } from '../lib/types';
import { toast } from 'sonner';

const TASK_TYPES = ['restart', 'command', 'backup', 'custom'] as const;

export const CronJobManager = () => {
  const [tasks, setTasks] = useState<ScheduledTask[]>([]);
  const [apps, setApps] = useState<DockerApp[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: '',
    description: '',
    taskType: 'restart' as ScheduledTask['taskType'],
    targetAppId: '',
    cronExpression: '',
    command: '',
  });

  useEffect(() => {
    Promise.all([loadTasks(), loadApps()]).finally(() => setLoading(false));
  }, []);

  const loadTasks = async () => {
    try {
      setTasks(await apiClient.getScheduledTasks());
    } catch {
      setTasks([]);
    }
  };

  const loadApps = async () => {
    try {
      setApps(await apiClient.listApps());
    } catch {
      setApps([]);
    }
  };

  const resetForm = () => {
    setForm({ name: '', description: '', taskType: 'restart', targetAppId: '', cronExpression: '', command: '' });
    setEditingId(null);
    setShowForm(false);
  };

  const handleCreate = async () => {
    if (!form.name || !form.cronExpression) {
      toast.error('Name and cron expression are required');
      return;
    }
    try {
      if (editingId) {
        await apiClient.updateScheduledTask(editingId, form);
        toast.success('Scheduled task updated');
      } else {
        await apiClient.createScheduledTask(form);
        toast.success('Scheduled task created');
      }
      resetForm();
      loadTasks();
    } catch {
      toast.error('Failed to save scheduled task');
    }
  };

  const handleEdit = (task: ScheduledTask) => {
    setForm({
      name: task.name,
      description: task.description || '',
      taskType: task.taskType,
      targetAppId: task.targetAppId || '',
      cronExpression: task.cronExpression,
      command: task.command || '',
    });
    setEditingId(task.id);
    setShowForm(true);
  };

  const handleDelete = async (id: string) => {
    try {
      await apiClient.deleteScheduledTask(id);
      toast.success('Scheduled task deleted');
      loadTasks();
    } catch {
      toast.error('Failed to delete scheduled task');
    }
  };

  const handleToggle = async (id: string) => {
    try {
      await apiClient.toggleScheduledTask(id);
      loadTasks();
    } catch {
      toast.error('Failed to toggle scheduled task');
    }
  };

  const getStatusColor = (status?: string) => {
    switch (status) {
      case 'success': return 'bg-green-500/10 text-green-400';
      case 'failed': return 'bg-red-500/10 text-red-400';
      case 'running': return 'bg-blue-500/10 text-blue-400';
      default: return 'bg-slate-500/10 text-slate-400';
    }
  };

  if (loading) {
    return <div className="text-slate-400 py-4">Loading scheduled tasks...</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h4 className="text-md font-semibold text-white">Scheduled Tasks (Cronjobs)</h4>
        <button
          onClick={() => { resetForm(); setShowForm(!showForm); }}
          className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded transition-colors"
        >
          {showForm ? 'Cancel' : 'New Task'}
        </button>
      </div>

      {showForm && (
        <div className="bg-slate-800 border border-slate-700 rounded-lg p-4 space-y-3">
          <input
            type="text"
            placeholder="Task name"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
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
            value={form.taskType}
            onChange={(e) => setForm({ ...form, taskType: e.target.value as ScheduledTask['taskType'] })}
            className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-sm text-white outline-none focus:border-blue-500"
          >
            {TASK_TYPES.map((type) => (
              <option key={type} value={type}>{type.charAt(0).toUpperCase() + type.slice(1)}</option>
            ))}
          </select>
          <select
            value={form.targetAppId}
            onChange={(e) => setForm({ ...form, targetAppId: e.target.value })}
            className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-sm text-white outline-none focus:border-blue-500"
          >
            <option value="">No target app</option>
            {apps.map((app) => (
              <option key={app.id} value={app.id}>{app.name}</option>
            ))}
          </select>
          <input
            type="text"
            placeholder="Cron expression (e.g. 0 3 * * *)"
            value={form.cronExpression}
            onChange={(e) => setForm({ ...form, cronExpression: e.target.value })}
            className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-sm text-white placeholder-slate-400 outline-none focus:border-blue-500"
          />
          {(form.taskType === 'command' || form.taskType === 'custom') && (
            <input
              type="text"
              placeholder="Shell command to execute"
              value={form.command}
              onChange={(e) => setForm({ ...form, command: e.target.value })}
              className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-sm text-white placeholder-slate-400 outline-none focus:border-blue-500"
            />
          )}
          <button
            onClick={handleCreate}
            className="w-full py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded transition-colors"
          >
            {editingId ? 'Update Task' : 'Create Task'}
          </button>
        </div>
      )}

      <div className="space-y-2">
        {tasks.length === 0 ? (
          <p className="text-slate-500 text-sm">No scheduled tasks configured</p>
        ) : (
          tasks.map((task) => (
            <div key={task.id} className="flex items-center justify-between p-3 bg-slate-800 rounded-lg border border-slate-700">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleToggle(task.id)}
                    className={`text-sm px-2 py-0.5 rounded-full cursor-pointer transition-colors ${
                      task.enabled ? 'bg-green-500/20 text-green-400 hover:bg-green-500/30' : 'bg-slate-600/20 text-slate-400 hover:bg-slate-600/30'
                    }`}
                  >
                    {task.enabled ? 'ON' : 'OFF'}
                  </button>
                  <span className="text-sm font-semibold text-white truncate">{task.name}</span>
                  <span className="text-xs px-2 py-0.5 rounded-full bg-purple-500/10 text-purple-400">
                    {task.taskType}
                  </span>
                  <span className={`text-xs px-2 py-0.5 rounded-full ${getStatusColor(task.lastRunStatus)}`}>
                    {task.lastRunStatus || 'pending'}
                  </span>
                </div>
                {task.description && (
                  <p className="text-xs text-slate-400 mt-1 truncate">{task.description}</p>
                )}
                <p className="text-xs text-slate-500 mt-1">
                  <span className="font-mono">{task.cronExpression}</span>
                  {task.lastRunAt && <> &middot; Last: {new Date(task.lastRunAt).toLocaleString()}</>}
                </p>
              </div>
              <div className="flex items-center gap-2 ml-3">
                <button
                  onClick={() => handleEdit(task)}
                  className="px-2 py-1 text-xs bg-blue-600/20 text-blue-400 hover:bg-blue-600/40 rounded transition-colors"
                >
                  Edit
                </button>
                <button
                  onClick={() => handleDelete(task.id)}
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

export default CronJobManager;
