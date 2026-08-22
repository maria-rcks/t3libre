import { useEffect, useState } from 'react';
import { apiClient } from '../lib/api';
import { ConfigVersion } from '../lib/types';
import { toast } from 'sonner';

interface ConfigVersionControlProps {
  appId: string;
}

export const ConfigVersionControl = ({ appId }: ConfigVersionControlProps) => {
  const [versions, setVersions] = useState<ConfigVersion[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedVersion, setSelectedVersion] = useState<ConfigVersion | null>(null);
  const [showDiff, setShowDiff] = useState(false);
  const [summary, setSummary] = useState('');
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    loadVersions();
  }, [appId]);

  const loadVersions = async () => {
    try {
      const data = await apiClient.getConfigVersions(appId);
      setVersions(data);
    } catch {
      setVersions([]);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateSnapshot = async () => {
    if (!summary) {
      toast.error('Please provide a change summary');
      return;
    }
    setCreating(true);
    try {
      const snapshot = { environment_vars: {}, memory_limit: '', cpu_shares: 0 };
      await apiClient.createConfigVersion(appId, snapshot, summary);
      toast.success('Config snapshot created');
      setSummary('');
      loadVersions();
    } catch {
      toast.error('Failed to create snapshot');
    } finally {
      setCreating(false);
    }
  };

  const handleRollback = async (version: number) => {
    try {
      await apiClient.rollbackConfig(appId, version);
      toast.success(`Rolled back to version ${version}`);
      loadVersions();
    } catch {
      toast.error('Rollback failed');
    }
  };

  if (loading) {
    return <div className="text-slate-400 py-4">Loading config versions...</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h4 className="text-md font-semibold text-white">Configuration Versions</h4>
        <div className="flex gap-2">
          <input
            type="text"
            placeholder="Change summary..."
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            className="px-3 py-1.5 bg-slate-700 border border-slate-600 rounded text-sm text-white placeholder-slate-400 outline-none focus:border-blue-500"
          />
          <button
            onClick={handleCreateSnapshot}
            disabled={creating}
            className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded transition-colors disabled:opacity-50"
          >
            {creating ? 'Saving...' : 'Save Snapshot'}
          </button>
        </div>
      </div>

      {versions.length === 0 ? (
        <p className="text-slate-500 text-sm">No config versions saved yet</p>
      ) : (
        <div className="space-y-2">
          {versions.map((v) => (
            <div
              key={v.id}
              className="flex items-center justify-between p-3 bg-slate-800 rounded-lg border border-slate-700 hover:border-slate-600 transition-colors"
            >
              <div className="flex items-center gap-4">
                <span className="text-blue-400 font-mono text-sm">v{v.version}</span>
                <div>
                  <p className="text-sm text-white">{v.change_summary || 'No summary'}</p>
                  <p className="text-xs text-slate-500">{new Date(v.created_at).toLocaleString()}</p>
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => { setSelectedVersion(v); setShowDiff(true); }}
                  className="px-2 py-1 text-xs bg-slate-700 hover:bg-slate-600 text-slate-300 rounded transition-colors"
                >
                  View
                </button>
                {v.version > 1 && (
                  <button
                    onClick={() => handleRollback(v.version)}
                    className="px-2 py-1 text-xs bg-orange-600 hover:bg-orange-700 text-white rounded transition-colors"
                  >
                    Rollback
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {showDiff && selectedVersion && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowDiff(false)}>
          <div className="bg-slate-900 border border-slate-700 rounded-xl p-6 max-w-2xl w-full mx-4 max-h-[80vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-white">Version {selectedVersion.version}</h3>
              <button onClick={() => setShowDiff(false)} className="text-slate-400 hover:text-white">✕</button>
            </div>
            <pre className="text-xs text-slate-300 bg-slate-800 p-4 rounded-lg overflow-x-auto">
              {JSON.stringify(selectedVersion.config_snapshot, null, 2)}
            </pre>
            <p className="text-xs text-slate-500 mt-2">
              Created: {new Date(selectedVersion.created_at).toLocaleString()}
            </p>
          </div>
        </div>
      )}
    </div>
  );
};

export default ConfigVersionControl;
