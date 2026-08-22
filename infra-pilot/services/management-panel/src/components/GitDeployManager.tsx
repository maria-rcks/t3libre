import { useEffect, useState } from 'react';
import { apiClient } from '../lib/api';
import { GitDeployment, DockerApp } from '../lib/types';
import { toast } from 'sonner';

export const GitDeployManager = () => {
  const [deployments, setDeployments] = useState<GitDeployment[]>([]);
  const [apps, setApps] = useState<DockerApp[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [selectedDep, setSelectedDep] = useState<GitDeployment | null>(null);
  const [form, setForm] = useState({
    name: '',
    repoUrl: '',
    branch: 'main',
    containerId: '',
    targetDir: '/app',
    installCommand: '',
    restartCommand: '',
  });

  useEffect(() => {
    Promise.all([loadDeployments(), loadApps()]).finally(() => setLoading(false));
  }, []);

  const loadDeployments = async () => {
    try {
      setDeployments(await apiClient.getDeployments());
    } catch {
      setDeployments([]);
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
    setForm({ name: '', repoUrl: '', branch: 'main', containerId: '', targetDir: '/app', installCommand: '', restartCommand: '' });
    setShowForm(false);
  };

  const handleCreate = async () => {
    if (!form.name || !form.repoUrl) {
      toast.error('Name and repository URL are required');
      return;
    }
    try {
      await apiClient.createDeployment(form);
      toast.success('Git deployment created');
      resetForm();
      loadDeployments();
    } catch {
      toast.error('Failed to create deployment');
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('Are you sure you want to delete this deployment?')) return;
    try {
      await apiClient.deleteDeployment(id);
      toast.success('Deployment deleted');
      if (selectedDep?.id === id) setSelectedDep(null);
      loadDeployments();
    } catch {
      toast.error('Failed to delete deployment');
    }
  };

  const handleToggle = async (id: string) => {
    try {
      await apiClient.toggleDeployment(id);
      loadDeployments();
    } catch {
      toast.error('Failed to toggle deployment');
    }
  };

  const viewDetails = async (dep: GitDeployment) => {
    try {
      const result = await apiClient.getDeploymentHistory(dep.id);
      setSelectedDep({ ...dep, history: result.history || [] });
    } catch {
      setSelectedDep(dep);
    }
  };

  const getStatusIcon = (status?: string) => {
    switch (status) {
      case 'success': return '✅';
      case 'failed': return '❌';
      case 'timeout': return '⏰';
      default: return '—';
    }
  };

  if (loading) {
    return <div className="text-slate-400 py-4">Loading git deployments...</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h4 className="text-md font-semibold text-white">Git Deployments</h4>
        <button
          onClick={() => { resetForm(); setShowForm(!showForm); }}
          className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded transition-colors"
        >
          {showForm ? 'Cancel' : 'New Deployment'}
        </button>
      </div>

      {showForm && (
        <div className="bg-slate-800 border border-slate-700 rounded-lg p-4 space-y-3">
          <input
            type="text"
            placeholder="Deployment name"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-sm text-white placeholder-slate-400 outline-none focus:border-blue-500"
          />
          <input
            type="text"
            placeholder="Git repository URL (e.g. https://github.com/user/repo.git)"
            value={form.repoUrl}
            onChange={(e) => setForm({ ...form, repoUrl: e.target.value })}
            className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-sm text-white placeholder-slate-400 outline-none focus:border-blue-500"
          />
          <input
            type="text"
            placeholder="Branch (default: main)"
            value={form.branch}
            onChange={(e) => setForm({ ...form, branch: e.target.value })}
            className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-sm text-white placeholder-slate-400 outline-none focus:border-blue-500"
          />
          <select
            value={form.containerId}
            onChange={(e) => setForm({ ...form, containerId: e.target.value })}
            className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-sm text-white outline-none focus:border-blue-500"
          >
            <option value="">Select container / app</option>
            {apps.filter(a => a.container_id).map((app) => (
              <option key={app.id} value={app.container_id}>{app.name} ({app.container_id?.slice(0, 12)})</option>
            ))}
          </select>
          <input
            type="text"
            placeholder="Target directory in container (default: /app)"
            value={form.targetDir}
            onChange={(e) => setForm({ ...form, targetDir: e.target.value })}
            className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-sm text-white placeholder-slate-400 outline-none focus:border-blue-500"
          />
          <input
            type="text"
            placeholder="Install command (e.g. npm install, optional)"
            value={form.installCommand}
            onChange={(e) => setForm({ ...form, installCommand: e.target.value })}
            className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-sm text-white placeholder-slate-400 outline-none focus:border-blue-500"
          />
          <input
            type="text"
            placeholder="Restart command (e.g. pm2 restart app, optional)"
            value={form.restartCommand}
            onChange={(e) => setForm({ ...form, restartCommand: e.target.value })}
            className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-sm text-white placeholder-slate-400 outline-none focus:border-blue-500"
          />
          <button
            onClick={handleCreate}
            className="w-full py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded transition-colors"
          >
            Create Deployment
          </button>
        </div>
      )}

      <div className="space-y-2">
        {deployments.length === 0 ? (
          <p className="text-slate-500 text-sm">No git deployments configured</p>
        ) : (
          deployments.map((dep) => {
            const last = dep.history?.[dep.history.length - 1];
            return (
              <div
                key={dep.id}
                className="flex items-center justify-between p-3 bg-slate-800 rounded-lg border border-slate-700 cursor-pointer hover:border-slate-500 transition-colors"
                onClick={() => viewDetails(dep)}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={(e) => { e.stopPropagation(); handleToggle(dep.id); }}
                      className={`text-sm px-2 py-0.5 rounded-full cursor-pointer transition-colors ${
                        dep.enabled ? 'bg-green-500/20 text-green-400 hover:bg-green-500/30' : 'bg-slate-600/20 text-slate-400 hover:bg-slate-600/30'
                      }`}
                    >
                      {dep.enabled ? 'ON' : 'OFF'}
                    </button>
                    <span className="text-sm font-semibold text-white truncate">{dep.name}</span>
                    <span className="text-xs text-slate-400 font-mono">{dep.repo}/{dep.branch}</span>
                    {last && (
                      <span className="text-xs">{getStatusIcon(last.status)}</span>
                    )}
                  </div>
                  {dep.targetDir && (
                    <p className="text-xs text-slate-500 mt-1 font-mono">{dep.targetDir}</p>
                  )}
                </div>
                <div className="flex items-center gap-2 ml-3" onClick={(e) => e.stopPropagation()}>
                  <button
                    onClick={() => handleDelete(dep.id)}
                    className="px-2 py-1 text-xs bg-red-600/20 text-red-400 hover:bg-red-600/40 rounded transition-colors"
                  >
                    Delete
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {selectedDep && (
        <div className="bg-slate-800 border border-slate-700 rounded-lg p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h5 className="font-semibold text-white">{selectedDep.name} — Details</h5>
            <button
              onClick={() => setSelectedDep(null)}
              className="text-xs text-slate-400 hover:text-white transition-colors"
            >
              Close
            </button>
          </div>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-slate-400">Webhook URL:</span>
              <span className="text-green-400 font-mono text-xs break-all ml-2">http://your-host:8500/webhook/gitops</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Auth:</span>
              <span className="text-amber-400 font-mono text-xs">HMAC-SHA256 of X-Timestamp + body (GITOPS_WEBHOOK_TOKEN)</span>
            </div>
            <p className="text-xs text-slate-500">GitHub webhooks cannot send these headers directly — route pushes through a proxy that signs each request (see wiki/08-Security.md).</p>
            <div className="flex justify-between">
              <span className="text-slate-400">Repository:</span>
              <span className="text-white font-mono text-xs">{selectedDep.repoUrl}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Branch:</span>
              <span className="text-white">{selectedDep.branch}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Target:</span>
              <span className="text-white font-mono text-xs">{selectedDep.containerId ? `${selectedDep.containerId}:${selectedDep.targetDir}` : selectedDep.targetDir}</span>
            </div>
          </div>

          <div className="border-t border-slate-700 pt-3">
            <h6 className="text-sm font-semibold text-white mb-2">Deployment History</h6>
            {selectedDep.history && selectedDep.history.length > 0 ? (
              <div className="space-y-1 max-h-40 overflow-y-auto">
                {selectedDep.history.slice().reverse().map((h: any, i: number) => (
                  <div key={i} className="flex items-center gap-2 text-xs">
                    <span>{getStatusIcon(h.status)}</span>
                    <span className="text-slate-300">{h.timestamp?.slice(0, 19)?.replace('T', ' ')}</span>
                    <span className={`font-medium ${
                      h.status === 'success' ? 'text-green-400' : h.status === 'failed' ? 'text-red-400' : 'text-yellow-400'
                    }`}>
                      {h.status}
                    </span>
                    {h.commits !== undefined && (
                      <span className="text-slate-500">({h.commits} commits)</span>
                    )}
                    {h.error && <span className="text-red-400 truncate">{h.error}</span>}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-slate-500">No deployments yet</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default GitDeployManager;
