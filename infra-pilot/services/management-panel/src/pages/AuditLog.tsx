import { useEffect, useState } from 'react';

interface AuditEntry {
  id: string;
  timestamp: string;
  action: string;
  entity_type: string;
  entity: string;
  user: string;
}

export function AuditLog() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [actionFilter, setActionFilter] = useState('');
  const [entityFilter, setEntityFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const fetchEntries = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: '20' });
      if (actionFilter) params.set('action', actionFilter);
      if (entityFilter) params.set('entity_type', entityFilter);
      if (dateFrom) params.set('from', dateFrom);
      if (dateTo) params.set('to', dateTo);
      const res = await fetch(`/api/audit-log?${params}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('access_token')}` },
      });
      if (res.ok) {
        const data = await res.json();
        setEntries(data.entries || []);
        setTotalPages(data.total_pages || 1);
      }
    } catch (e) {
      console.error('Failed to fetch audit log', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchEntries(); }, [page]);

  const handleFilter = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
    fetchEntries();
  };

  return (
    <div className="space-y-8">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold text-white mb-2">Audit Trail</h1>
          <p className="text-slate-400">Track all administrative actions and changes</p>
        </div>
      </div>

      <form onSubmit={handleFilter} className="flex flex-wrap gap-4 p-4 bg-slate-800 border border-slate-700 rounded-lg">
        <div>
          <label className="block text-xs text-slate-400 mb-1">Action</label>
          <select value={actionFilter} onChange={e => setActionFilter(e.target.value)} className="bg-slate-700 text-white text-sm rounded px-3 py-1.5 border border-slate-600">
            <option value="">All</option>
            <option value="create">Create</option>
            <option value="update">Update</option>
            <option value="delete">Delete</option>
            <option value="login">Login</option>
          </select>
        </div>
        <div>
          <label className="block text-xs text-slate-400 mb-1">Entity Type</label>
          <select value={entityFilter} onChange={e => setEntityFilter(e.target.value)} className="bg-slate-700 text-white text-sm rounded px-3 py-1.5 border border-slate-600">
            <option value="">All</option>
            <option value="app">App</option>
            <option value="backup">Backup</option>
            <option value="user">User</option>
            <option value="setting">Setting</option>
          </select>
        </div>
        <div>
          <label className="block text-xs text-slate-400 mb-1">From</label>
          <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="bg-slate-700 text-white text-sm rounded px-3 py-1.5 border border-slate-600" />
        </div>
        <div>
          <label className="block text-xs text-slate-400 mb-1">To</label>
          <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="bg-slate-700 text-white text-sm rounded px-3 py-1.5 border border-slate-600" />
        </div>
        <div className="flex items-end gap-2">
          <button type="submit" className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded transition-colors">Apply</button>
          <button type="button" onClick={() => { setActionFilter(''); setEntityFilter(''); setDateFrom(''); setDateTo(''); setPage(1); fetchEntries(); }} className="px-4 py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-300 text-sm font-medium rounded transition-colors">Clear</button>
        </div>
      </form>

      <div className="bg-slate-800 border border-slate-700 rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-700 bg-slate-900">
              <th className="text-left px-4 py-3 text-slate-400 font-medium">Timestamp</th>
              <th className="text-left px-4 py-3 text-slate-400 font-medium">Action</th>
              <th className="text-left px-4 py-3 text-slate-400 font-medium">Entity Type</th>
              <th className="text-left px-4 py-3 text-slate-400 font-medium">Entity</th>
              <th className="text-left px-4 py-3 text-slate-400 font-medium">User</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={5} className="text-center py-8 text-slate-400">Loading...</td></tr>
            ) : entries.length === 0 ? (
              <tr><td colSpan={5} className="text-center py-8 text-slate-400">No audit entries found</td></tr>
            ) : entries.map(entry => (
              <tr key={entry.id} className="border-b border-slate-700 hover:bg-slate-700/50">
                <td className="px-4 py-3 text-slate-300">{new Date(entry.timestamp).toLocaleString()}</td>
                <td className="px-4 py-3"><span className="px-2 py-0.5 text-xs rounded bg-slate-700 text-slate-200">{entry.action}</span></td>
                <td className="px-4 py-3 text-slate-300">{entry.entity_type}</td>
                <td className="px-4 py-3 text-white font-medium">{entry.entity}</td>
                <td className="px-4 py-3 text-slate-300">{entry.user}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <button disabled={page <= 1} onClick={() => setPage(p => p - 1)} className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-slate-300 text-sm rounded transition-colors">Previous</button>
          <span className="text-sm text-slate-400">Page {page} of {totalPages}</span>
          <button disabled={page >= totalPages} onClick={() => setPage(p => p + 1)} className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-slate-300 text-sm rounded transition-colors">Next</button>
        </div>
      )}
    </div>
  );
}

export default AuditLog;
