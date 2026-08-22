import { AccessLogViewer } from '../components/AccessLogViewer';

export const AccessLogs = () => {
  return (
    <div className="space-y-8">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold text-white mb-2">Access Logs</h1>
          <p className="text-slate-400">SSH login attempts, console access, and authentication events</p>
        </div>
        <div className="flex items-center gap-2">
          <button className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm font-medium rounded transition-colors">
            🔄 Refresh
          </button>
          <button className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm font-medium rounded transition-colors">
            📥 Export
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        <div className="bg-slate-800 border border-slate-700 rounded-lg p-4 text-center">
          <p className="text-2xl font-bold text-blue-400">24</p>
          <p className="text-xs text-slate-400">Today's Events</p>
        </div>
        <div className="bg-slate-800 border border-slate-700 rounded-lg p-4 text-center">
          <p className="text-2xl font-bold text-green-400">20</p>
          <p className="text-xs text-slate-400">Successful</p>
        </div>
        <div className="bg-slate-800 border border-slate-700 rounded-lg p-4 text-center">
          <p className="text-2xl font-bold text-red-400">3</p>
          <p className="text-xs text-slate-400">Failed</p>
        </div>
        <div className="bg-slate-800 border border-slate-700 rounded-lg p-4 text-center">
          <p className="text-2xl font-bold text-yellow-400">1</p>
          <p className="text-xs text-slate-400">Pending</p>
        </div>
      </div>

      <AccessLogViewer />
    </div>
  );
};

export default AccessLogs;
