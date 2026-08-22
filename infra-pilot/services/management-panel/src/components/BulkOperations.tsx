import { useState, useEffect } from 'react';
import { useIntl, FormattedMessage } from 'react-intl';
import { toast } from 'sonner';
import { apiClient } from '../lib/api';
import { useBulkSelection } from '../hooks/useBulkSelection';

interface BulkItem {
  id: string;
  name: string;
  type: string;
}

interface BulkAction {
  action: string;
  label: string;
}

const BULK_ACTIONS: BulkAction[] = [
  { action: 'start', label: 'Start' },
  { action: 'stop', label: 'Stop' },
  { action: 'restart', label: 'Restart' },
  { action: 'backup', label: 'Backup' },
  { action: 'delete', label: 'Delete' },
];

export const BulkOperations = () => {
  const intl = useIntl();
  const [items, setItems] = useState<BulkItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [executing, setExecuting] = useState(false);
  const [progress, setProgress] = useState<Record<string, { status: string; progress: number }>>({});
  const [batchId, setBatchId] = useState<string | null>(null);
  const [history, setHistory] = useState<any[]>([]);
  const [selectedAction, setSelectedAction] = useState('start');

  const getId = (item: BulkItem) => item.id;

  const {
    selectedIds, toggle, selectAll, clearSelection,
    isSelected, allSelected, count,
  } = useBulkSelection({ items, getId });

  useEffect(() => {
    loadItems();
    loadHistory();
  }, []);

  useEffect(() => {
    if (!batchId) return;
    const interval = setInterval(async () => {
      try {
        const status = await apiClient.getBulkActionStatus(batchId);
        setProgress(status.progress || {});
        if (status.status === 'completed' || status.status === 'failed') {
          clearInterval(interval);
          setBatchId(null);
          setExecuting(false);
          toast.success('Bulk action completed');
          loadHistory();
        }
      } catch {
        clearInterval(interval);
        setBatchId(null);
        setExecuting(false);
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [batchId]);

  const loadItems = async () => {
    try {
      const apps = await apiClient.listApps();
      setItems(apps.map((a: any) => ({ id: a.id, name: a.name, type: 'app' })));
    } catch {
      toast.error('Failed to load items');
    } finally {
      setLoading(false);
    }
  };

  const loadHistory = async () => {
    try {
      const res = await apiClient.getBulkActionStatus('history');
      setHistory(Array.isArray(res) ? res : []);
    } catch {}
  };

  const handleExecute = async () => {
    if (count === 0) {
      toast.error('No items selected');
      return;
    }
    setExecuting(true);
    try {
      const result = await apiClient.bulkAction(selectedAction, Array.from(selectedIds), {});
      setBatchId(result.batchId);
      setProgress(result.progress || {});
    } catch {
      toast.error('Failed to execute bulk action');
      setExecuting(false);
    }
  };

  const handleRollback = async () => {
    if (!batchId) return;
    try {
      await apiClient.undoBulkAction(batchId);
      toast.success('Rollback initiated');
      setBatchId(null);
      setProgress({});
      setExecuting(false);
      loadHistory();
    } catch {
      toast.error('Rollback failed');
    }
  };

  return (
    <div className="space-y-6">
      <div className="bg-slate-800 border border-slate-700 rounded-lg p-6">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-bold text-white">
            <FormattedMessage id="bulk.title" />
          </h2>
          <div className="flex items-center gap-3">
            <select
              value={selectedAction}
              onChange={(e) => setSelectedAction(e.target.value)}
              className="bg-slate-700 border border-slate-600 text-white text-sm rounded-lg px-3 py-2 outline-none focus:border-blue-500"
            >
              {BULK_ACTIONS.map((a) => (
                <option key={a.action} value={a.action}>{a.label}</option>
              ))}
            </select>
            <button
              onClick={handleExecute}
              disabled={executing || count === 0}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-medium rounded-lg transition-colors text-sm"
            >
              <FormattedMessage id="bulk.execute" /> ({count})
            </button>
            {batchId && (
              <button
                onClick={handleRollback}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white font-medium rounded-lg transition-colors text-sm"
              >
                <FormattedMessage id="bulk.rollback" />
              </button>
            )}
          </div>
        </div>

        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-2 text-sm text-slate-400">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={allSelected ? clearSelection : selectAll}
                className="rounded bg-slate-700 border-slate-600"
              />
              <FormattedMessage id="bulk.selectAll" />
            </label>
            {count > 0 && (
              <button onClick={clearSelection} className="text-sm text-blue-400 hover:text-blue-300">
                <FormattedMessage id="bulk.clearSelection" />
              </button>
            )}
          </div>
          <span className="text-sm text-slate-400">{count} selected</span>
        </div>

        {loading ? (
          <p className="text-slate-400"><FormattedMessage id="common.loading" /></p>
        ) : items.length === 0 ? (
          <p className="text-slate-400 text-sm">No items available</p>
        ) : (
          <div className="space-y-2">
            {items.map((item) => (
              <div
                key={item.id}
                className={`flex items-center gap-3 p-3 rounded-lg border transition-colors ${
                  isSelected(item.id)
                    ? 'bg-blue-900/20 border-blue-700'
                    : 'bg-slate-700/50 border-slate-600 hover:border-slate-500'
                }`}
              >
                <input
                  type="checkbox"
                  checked={isSelected(item.id)}
                  onChange={() => toggle(item.id)}
                  className="rounded bg-slate-700 border-slate-600"
                />
                <div className="flex-1">
                  <p className="text-sm text-white">{item.name}</p>
                  <p className="text-xs text-slate-400">{item.type}</p>
                </div>
                {progress[item.id] && (
                  <div className="flex items-center gap-2">
                    <div className="w-24 h-2 bg-slate-600 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-blue-500 transition-all"
                        style={{ width: `${progress[item.id].progress}%` }}
                      />
                    </div>
                    <span className="text-xs text-slate-400">{progress[item.id].status}</span>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {history.length > 0 && (
        <div className="bg-slate-800 border border-slate-700 rounded-lg p-6">
          <h3 className="text-lg font-semibold text-white mb-4">
            <FormattedMessage id="bulk.history" />
          </h3>
          <div className="space-y-2">
            {history.map((entry: any) => (
              <div key={entry.batchId} className="flex items-center justify-between p-3 bg-slate-700/50 rounded-lg">
                <div>
                  <p className="text-sm text-white">{entry.action}</p>
                  <p className="text-xs text-slate-400">{entry.itemCount} items - {new Date(entry.timestamp).toLocaleString()}</p>
                </div>
                <span className={`text-xs px-2 py-1 rounded ${
                  entry.status === 'completed' ? 'bg-green-900/50 text-green-400' :
                  entry.status === 'failed' ? 'bg-red-900/50 text-red-400' :
                  'bg-yellow-900/50 text-yellow-400'
                }`}>
                  {entry.status}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
