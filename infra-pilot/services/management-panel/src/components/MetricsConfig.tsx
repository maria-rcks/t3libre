import { useState, useEffect } from 'react';

export default function MetricsConfig() {
  const [type, setType] = useState<'netdata' | 'grafana'>('grafana');
  const [url, setUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [status, setStatus] = useState<'idle' | 'connected' | 'disconnected'>('idle');

  useEffect(() => {
    fetch('/api/metrics/grafana-url')
      .then(r => r.json())
      .then(data => {
        if (data.url) {
          setUrl(data.url);
          setStatus('connected');
        }
      })
      .catch(() => {});
  }, []);

  const testConnection = async () => {
    setTesting(true);
    try {
      const res = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(5000) });
      setStatus(res.ok ? 'connected' : 'disconnected');
    } catch {
      setStatus('disconnected');
    } finally {
      setTesting(false);
    }
  };

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/metrics/stream/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, url, apiKey: apiKey || undefined }),
      });
      if (res.ok) {
        setStatus('connected');
      }
    } catch {
      setStatus('disconnected');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-slate-800 border border-slate-700 rounded-lg p-6">
      <h2 className="text-lg font-semibold text-white mb-4">Metrics Integration</h2>

      <div className="space-y-4">
        <div>
          <label className="block text-sm text-slate-400 mb-1">Source Type</label>
          <div className="flex gap-3">
            {(['grafana', 'netdata'] as const).map(t => (
              <button key={t} onClick={() => setType(t)}
                className={`px-4 py-2 rounded text-sm font-medium transition-colors ${
                  type === t ? 'bg-blue-600 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                }`}>
                {t.charAt(0).toUpperCase() + t.slice(1)}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-sm text-slate-400 mb-1">URL</label>
          <input type="text" value={url} onChange={e => setUrl(e.target.value)}
            placeholder={type === 'grafana' ? 'https://grafana.example.com/d/abc/...' : 'https://netdata.example.com'}
            className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-sm text-white outline-none focus:border-blue-500" />
        </div>

        {type === 'grafana' && (
          <div>
            <label className="block text-sm text-slate-400 mb-1">API Key (optional)</label>
            <input type="password" value={apiKey} onChange={e => setApiKey(e.target.value)}
              placeholder="glsa_..."
              className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-sm text-white outline-none focus:border-blue-500" />
          </div>
        )}

        <div className="flex items-center gap-3">
          <button onClick={testConnection} disabled={!url || testing}
            className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white font-medium rounded text-sm transition-colors disabled:opacity-50">
            {testing ? 'Testing...' : 'Test Connection'}
          </button>
          <button onClick={save} disabled={!url || saving}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded text-sm transition-colors disabled:opacity-50">
            {saving ? 'Saving...' : 'Save'}
          </button>
          {status !== 'idle' && (
            <span className={`text-sm ${status === 'connected' ? 'text-green-400' : 'text-red-400'}`}>
              {status === 'connected' ? 'Connected' : 'Disconnected'}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
