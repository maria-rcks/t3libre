import { useState } from 'react';
import { Filter, Download, Clock, User, AlertTriangle, Info, AlertCircle } from 'lucide-react';
import { apiClient } from '../lib/api';
import { apiClientEffect, useEffectful } from '../lib/effect';
import type { ActivityEvent } from '../lib/types';

const severityIcons = {
  info: Info,
  warning: AlertTriangle,
  error: AlertCircle,
};

const severityColors = {
  info: 'text-blue-400 bg-blue-500/10',
  warning: 'text-amber-400 bg-amber-500/10',
  error: 'text-red-400 bg-red-500/10',
};

const eventTypeLabels: Record<string, string> = {
  'app:create': 'App Created',
  'app:update': 'App Updated',
  'app:delete': 'App Deleted',
  'app:start': 'App Started',
  'app:stop': 'App Stopped',
  'app:restart': 'App Restarted',
  'backup:create': 'Backup Created',
  'backup:update': 'Backup Updated',
  'backup:delete': 'Backup Deleted',
  'config:update': 'Config Updated',
  deployment: 'Deployment',
  alert: 'Alert Triggered',
  maintenance: 'Maintenance',
  'user:login': 'User Login',
  'user:logout': 'User Logout',
  'database:create': 'Database Created',
  'database:delete': 'Database Deleted',
  'knowledge_base:create': 'KB Article Created',
  'knowledge_base:update': 'KB Article Updated',
  'knowledge_base:delete': 'KB Article Deleted',
};

interface ActivityFeedProps {
  limit?: number;
  compact?: boolean;
}

export function ActivityFeed({ limit = 50, compact = false }: ActivityFeedProps) {
  const [offset, setOffset] = useState(0);
  const [typeFilter, setTypeFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const { data, loading, refresh } = useEffectful(
    () => apiClientEffect.getActivityFeed({
      limit,
      offset,
      type: typeFilter || undefined,
      from: dateFrom || undefined,
      to: dateTo || undefined,
    }),
    [limit, offset, typeFilter, dateFrom, dateTo]
  );

  const events = data?.events ?? [];
  const total = data?.total ?? 0;
  const hasMore = offset + limit < total;

  const handleExport = async (format: 'csv' | 'json') => {
    try {
      const blob = await apiClient.exportActivity({
        format,
        type: typeFilter || undefined,
        from: dateFrom || undefined,
        to: dateTo || undefined,
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `activity-export.${format}`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      console.error('Export failed');
    }
  };

  const loadMore = () => setOffset(o => o + limit);

  return (
    <div className="space-y-4">
      {!compact && (
        <div className="flex flex-wrap items-center gap-3 p-4 bg-slate-800 border border-slate-700 rounded-lg">
          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-slate-400" />
            <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)} className="bg-slate-700 text-white text-sm rounded px-2 py-1.5 border border-slate-600">
              <option value="">All Events</option>
              {Object.entries(eventTypeLabels).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="bg-slate-700 text-white text-sm rounded px-2 py-1.5 border border-slate-600" />
            <span className="text-slate-500 text-xs">to</span>
            <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="bg-slate-700 text-white text-sm rounded px-2 py-1.5 border border-slate-600" />
          </div>
          <div className="flex items-center gap-1 ml-auto">
            <button onClick={() => handleExport('csv')} className="flex items-center gap-1 px-2 py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-300 text-xs rounded transition-colors">
              <Download className="w-3 h-3" /> CSV
            </button>
            <button onClick={() => handleExport('json')} className="flex items-center gap-1 px-2 py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-300 text-xs rounded transition-colors">
              <Download className="w-3 h-3" /> JSON
            </button>
          </div>
        </div>
      )}

      <div className="bg-slate-900 border border-slate-800 rounded-lg divide-y divide-slate-800">
        {loading && events.length === 0 ? (
          <div className="text-center py-8 text-slate-500">Loading...</div>
        ) : events.length === 0 ? (
          <div className="text-center py-8 text-slate-500">No activity events found</div>
        ) : events.map(event => {
          const SevIcon = severityIcons[event.severity];
          return (
            <div key={event.id} className="flex items-start gap-3 p-4 hover:bg-slate-800/50 transition-colors">
              <div className={`p-1.5 rounded-full ${severityColors[event.severity]}`}>
                <SevIcon className="w-3.5 h-3.5" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${
                    event.severity === 'error' ? 'bg-red-500/10 text-red-400' :
                    event.severity === 'warning' ? 'bg-amber-500/10 text-amber-400' :
                    'bg-blue-500/10 text-blue-400'
                  }`}>
                    {eventTypeLabels[event.type] || event.type}
                  </span>
                  {event.userName && (
                    <span className="flex items-center gap-1 text-xs text-slate-500">
                      <User className="w-3 h-3" />
                      {event.userName}
                    </span>
                  )}
                </div>
                <p className="text-sm text-slate-300">{event.description}</p>
                <span className="flex items-center gap-1 text-xs text-slate-500 mt-1">
                  <Clock className="w-3 h-3" />
                  {new Date(event.timestamp).toLocaleString()}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {hasMore && (
        <div className="text-center">
          <button onClick={loadMore} className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm rounded-lg transition-colors">
            Load More ({total - offset - limit} remaining)
          </button>
        </div>
      )}
    </div>
  );
}
