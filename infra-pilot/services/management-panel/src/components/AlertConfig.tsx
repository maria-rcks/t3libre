import { useEffect, useState } from 'react';
import { apiClient } from '../lib/api';
import { AlertConfig as AlertConfigType } from '../lib/types';
import { toast } from 'sonner';

const METRIC_TYPES = ['cpu_percent', 'memory_used_mb', 'tps', 'player_count', 'world_size_mb', 'disk_usage'];
const OPERATORS = [
  { value: 'gt', label: '>' },
  { value: 'lt', label: '<' },
  { value: 'gte', label: '>=' },
  { value: 'lte', label: '<=' },
  { value: 'eq', label: '=' },
];

export const AlertConfig = () => {
  const [configs, setConfigs] = useState<AlertConfigType[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    metric_type: 'cpu_percent',
    operator: 'gt' as const,
    threshold: 80,
    enabled: true,
    notify_email: false,
  });

  useEffect(() => {
    loadConfigs();
  }, []);

  const loadConfigs = async () => {
    try {
      setConfigs(await apiClient.getAlertConfigs());
    } catch {
      setConfigs([]);
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = async () => {
    try {
      await apiClient.createAlertConfig(form);
      toast.success('Alert rule created');
      setShowForm(false);
      setForm({ metric_type: 'cpu_percent', operator: 'gt', threshold: 80, enabled: true, notify_email: false });
      loadConfigs();
    } catch {
      toast.error('Failed to create alert');
    }
  };

  const handleToggle = async (config: AlertConfigType) => {
    try {
      await apiClient.updateAlertConfig(config.id, { enabled: !config.enabled });
      toast.success(`Alert ${config.enabled ? 'disabled' : 'enabled'}`);
      loadConfigs();
    } catch {
      toast.error('Failed to update alert');
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await apiClient.deleteAlertConfig(id);
      toast.success('Alert rule deleted');
      loadConfigs();
    } catch {
      toast.error('Failed to delete alert');
    }
  };

  if (loading) {
    return <div className="text-slate-400 py-4">Loading alert configs...</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h4 className="text-md font-semibold text-white">Alert Thresholds</h4>
        <button
          onClick={() => setShowForm(!showForm)}
          className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded transition-colors"
        >
          {showForm ? 'Cancel' : 'Add Rule'}
        </button>
      </div>

      {showForm && (
        <div className="bg-slate-800 border border-slate-700 rounded-lg p-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-slate-400 mb-1">Metric</label>
              <select
                value={form.metric_type}
                onChange={(e) => setForm({ ...form, metric_type: e.target.value })}
                className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-sm text-white outline-none focus:border-blue-500"
              >
                {METRIC_TYPES.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Operator</label>
              <select
                value={form.operator}
                onChange={(e) => setForm({ ...form, operator: e.target.value as any })}
                className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-sm text-white outline-none focus:border-blue-500"
              >
                {OPERATORS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">
              Threshold: <span className="text-white font-bold">{form.threshold}</span>
            </label>
            <input
              type="range"
              min={0}
              max={100}
              value={form.threshold}
              onChange={(e) => setForm({ ...form, threshold: parseInt(e.target.value) })}
              className="w-full accent-blue-500"
            />
          </div>
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2 text-sm text-slate-300">
              <input
                type="checkbox"
                checked={form.enabled}
                onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
                className="accent-blue-500"
              />
              Enabled
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-300">
              <input
                type="checkbox"
                checked={form.notify_email}
                onChange={(e) => setForm({ ...form, notify_email: e.target.checked })}
                className="accent-blue-500"
              />
              Email notification
            </label>
          </div>
          <button
            onClick={handleCreate}
            className="w-full py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded transition-colors"
          >
            Create Alert Rule
          </button>
        </div>
      )}

      <div className="space-y-2">
        {configs.length === 0 ? (
          <p className="text-slate-500 text-sm">No alert rules configured</p>
        ) : (
          configs.map((config) => (
            <div key={config.id} className="flex items-center justify-between p-3 bg-slate-800 rounded-lg border border-slate-700">
              <div className="flex items-center gap-3">
                <span className={`w-2 h-2 rounded-full ${config.enabled ? 'bg-green-500' : 'bg-slate-500'}`} />
                <div>
                  <p className="text-sm text-white">
                    {config.metric_type} {config.operator} {config.threshold}
                  </p>
                  <p className="text-xs text-slate-400">
                    {config.enabled ? 'Active' : 'Disabled'}
                    {config.notify_email ? ' · Email alerts on' : ''}
                  </p>
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => handleToggle(config)}
                  className={`px-2 py-1 text-xs rounded transition-colors ${
                    config.enabled
                      ? 'bg-yellow-600/20 text-yellow-400 hover:bg-yellow-600/40'
                      : 'bg-green-600/20 text-green-400 hover:bg-green-600/40'
                  }`}
                >
                  {config.enabled ? 'Disable' : 'Enable'}
                </button>
                <button
                  onClick={() => handleDelete(config.id)}
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

export default AlertConfig;
