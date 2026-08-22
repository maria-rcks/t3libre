import { useState } from 'react';
import { apiClient } from '../lib/api';
import { toast } from 'sonner';

export const Reports = () => {
  const [startDate, setStartDate] = useState(new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0]);
  const [endDate, setEndDate] = useState(new Date().toISOString().split('T')[0]);
  const [reportData, setReportData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);

  const handleGenerate = async () => {
    setLoading(true);
    try {
      const data = await apiClient.getReports(startDate, endDate);
      setReportData(data);
    } catch {
      toast.error('Failed to generate report');
    } finally {
      setLoading(false);
    }
  };

  const handleExport = async (format: 'pdf' | 'csv') => {
    setExporting(true);
    try {
      const blob = await apiClient.exportReport(format, startDate, endDate);
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `report.${format}`;
      a.click();
      window.URL.revokeObjectURL(url);
      toast.success(`Report exported as ${format.toUpperCase()}`);
    } catch {
      toast.error('Failed to export report');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-8">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold text-white mb-2">Reports</h1>
          <p className="text-slate-400">Resource usage reports and analytics</p>
        </div>
      </div>

      <div className="bg-slate-800 border border-slate-700 rounded-lg p-6">
        <h2 className="text-lg font-semibold text-white mb-4">Generate Report</h2>
        <div className="flex items-end gap-4">
          <div>
            <label className="block text-xs text-slate-400 mb-1">Start Date</label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="px-3 py-2 bg-slate-700 border border-slate-600 rounded text-sm text-white outline-none focus:border-blue-500"
            />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">End Date</label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="px-3 py-2 bg-slate-700 border border-slate-600 rounded text-sm text-white outline-none focus:border-blue-500"
            />
          </div>
          <button
            onClick={handleGenerate}
            disabled={loading}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded transition-colors disabled:opacity-50"
          >
            {loading ? 'Generating...' : 'Generate'}
          </button>
          {reportData && (
            <>
              <button
                onClick={() => handleExport('csv')}
                disabled={exporting}
                className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white font-medium rounded transition-colors disabled:opacity-50"
              >
                {exporting ? 'Exporting...' : '📥 Export CSV'}
              </button>
              <button
                onClick={() => handleExport('pdf')}
                disabled={exporting}
                className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white font-medium rounded transition-colors disabled:opacity-50"
              >
                {exporting ? 'Exporting...' : '📄 Export PDF'}
              </button>
            </>
          )}
        </div>
      </div>

      {reportData && (
        <div className="space-y-6">
          <div className="grid grid-cols-3 gap-4">
            <div className="bg-slate-800 border border-slate-700 rounded-lg p-4 text-center">
              <p className="text-2xl font-bold text-blue-400">{(reportData.metrics || []).length}</p>
              <p className="text-xs text-slate-400">Metric Data Points</p>
            </div>
            <div className="bg-slate-800 border border-slate-700 rounded-lg p-4 text-center">
              <p className="text-2xl font-bold text-green-400">{(reportData.backups || []).filter((b: any) => b.status === 'success').length}</p>
              <p className="text-xs text-slate-400">Successful Backups</p>
            </div>
            <div className="bg-slate-800 border border-slate-700 rounded-lg p-4 text-center">
              <p className="text-2xl font-bold text-red-400">{(reportData.alerts || []).length}</p>
              <p className="text-xs text-slate-400">Alerts Triggered</p>
            </div>
          </div>

          {reportData.metrics && reportData.metrics.length > 0 && (
            <div className="bg-slate-800 border border-slate-700 rounded-lg p-4">
              <h3 className="text-md font-semibold text-white mb-3">Recent Metrics</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-slate-400 border-b border-slate-700">
                      <th className="pb-2 pr-4">App</th>
                      <th className="pb-2 pr-4">CPU</th>
                      <th className="pb-2 pr-4">Memory</th>
                      <th className="pb-2 pr-4">TPS</th>
                      <th className="pb-2">Time</th>
                    </tr>
                  </thead>
                  <tbody>
                    {reportData.metrics.slice(0, 20).map((m: any) => (
                      <tr key={m.id} className="border-b border-slate-800">
                        <td className="py-2 pr-4 text-slate-300">{m.app_id?.slice(0, 8)}</td>
                        <td className="py-2 pr-4 text-white">{m.cpu_percent}%</td>
                        <td className="py-2 pr-4 text-white">{m.memory_used_mb}MB</td>
                        <td className="py-2 pr-4 text-white">{m.tps}</td>
                        <td className="py-2 text-slate-400">{new Date(m.recorded_at).toLocaleDateString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {reportData.alerts && reportData.alerts.length > 0 && (
            <div className="bg-slate-800 border border-slate-700 rounded-lg p-4">
              <h3 className="text-md font-semibold text-white mb-3">Alert Summary</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-slate-400 border-b border-slate-700">
                      <th className="pb-2 pr-4">Type</th>
                      <th className="pb-2 pr-4">Value</th>
                      <th className="pb-2 pr-4">Threshold</th>
                      <th className="pb-2">Triggered</th>
                    </tr>
                  </thead>
                  <tbody>
                    {reportData.alerts.slice(0, 20).map((a: any) => (
                      <tr key={a.id} className="border-b border-slate-800">
                        <td className="py-2 pr-4 text-slate-300">{a.metric_type}</td>
                        <td className="py-2 pr-4 text-white">{a.metric_value}</td>
                        <td className="py-2 pr-4 text-white">{a.threshold}</td>
                        <td className="py-2 text-slate-400">{new Date(a.triggered_at).toLocaleDateString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default Reports;
