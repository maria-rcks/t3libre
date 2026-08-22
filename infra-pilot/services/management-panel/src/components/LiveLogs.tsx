import { useState, useEffect, useRef, useCallback } from 'react';
import { apiClient } from '../lib/api';

interface LogEntry {
  id: string;
  timestamp: string;
  app: string;
  level: 'INFO' | 'WARN' | 'ERROR' | 'DEBUG';
  message: string;
  status?: 'success' | 'failed';
}

interface LiveLogsProps {
  logs?: LogEntry[];
  isLive?: boolean;
  maxHeight?: string;
  appId?: string;
}

const LOG_LEVELS = ['ALL', 'INFO', 'WARN', 'ERROR', 'DEBUG'] as const;

function highlightText(text: string, query: string) {
  if (!query) return text;
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const parts = text.split(new RegExp(`(${escaped})`, 'gi'));
  return parts.map((part, i) =>
    part.toLowerCase() === query.toLowerCase()
      ? `<mark class="bg-yellow-500/30 text-yellow-200 rounded px-0.5">${part}</mark>`
      : part
  ).join('');
}

export const LiveLogs = ({
  logs = [
    {
      id: '1423',
      timestamp: '2024-05-14T18:15:23.123Z',
      app: 'web-frontend',
      level: 'INFO',
      message: 'GET /api/v1/users 200 45ms',
      status: 'success',
    },
    {
      id: '1424',
      timestamp: '2024-05-14T18:15:24.456Z',
      app: 'api-gateway',
      level: 'INFO',
      message: 'Request processesI successfully',
      status: 'success',
    },
    {
      id: '1425',
      timestamp: '2024-05-14T18:15:25.789Z',
      app: 'worker',
      level: 'WARN',
      message: 'Job queue size high: 1850',
      status: 'failed',
    },
    {
      id: '1426',
      timestamp: '2024-05-14T18:15:26.012Z',
      app: 'mail-service',
      level: 'ERROR',
      message: 'Failed to connect to SMTP server',
      status: 'failed',
    },
    {
      id: '1427',
      timestamp: '2024-05-14T18:15:26.345Z',
      app: 'postgres-db',
      level: 'INFO',
      message: 'Checkpoint completed',
      status: 'success',
    },
    {
      id: '1428',
      timestamp: '2024-05-14T18:15:27.678Z',
      app: 'redis-cache',
      level: 'INFO',
      message: 'Key expired: session:abc123',
      status: 'success',
    },
  ],
  isLive = true,
  maxHeight = 'max-h-96',
  appId,
}: LiveLogsProps) => {
  const [isPaused, setIsPaused] = useState(false);
  const [displayLogs, setDisplayLogs] = useState(logs);
  const [mode, setMode] = useState<'live' | 'search'>('live');
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [levelFilter, setLevelFilter] = useState('ALL');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [searchResults, setSearchResults] = useState<LogEntry[]>([]);
  const [totalResults, setTotalResults] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    setDisplayLogs(logs);
  }, [logs]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setDebouncedSearch(searchQuery);
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [searchQuery]);

  const performSearch = useCallback(async (page = 1) => {
    if (!appId) return;
    setLoading(true);
    try {
      const result = await apiClient.searchLogs(appId, {
        query: debouncedSearch || undefined,
        level: levelFilter === 'ALL' ? undefined : levelFilter,
        from: fromDate || undefined,
        to: toDate || undefined,
        page,
        limit: 50,
      });
      setSearchResults(result.logs);
      setTotalResults(result.total);
      setCurrentPage(page);
    } catch {
      setSearchResults([]);
      setTotalResults(0);
    } finally {
      setLoading(false);
    }
  }, [appId, debouncedSearch, levelFilter, fromDate, toDate]);

  useEffect(() => {
    if (mode === 'search') {
      performSearch(1);
    }
  }, [mode, performSearch]);

  const getLevelBackground = (level: string) => {
    switch (level) {
      case 'INFO':
        return 'bg-blue-500/10 text-blue-400';
      case 'WARN':
        return 'bg-yellow-500/10 text-yellow-400';
      case 'ERROR':
        return 'bg-red-500/10 text-red-400';
      case 'DEBUG':
        return 'bg-gray-500/10 text-gray-400';
      default:
        return 'bg-slate-500/10 text-slate-400';
    }
  };

  const formatTime = (timestamp: string) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
  };

  const currentLogs = mode === 'search' ? searchResults : displayLogs;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h3 className="text-xl font-bold text-white">Logs</h3>
          {mode === 'live' && (
            <div className="flex items-center gap-2 px-3 py-1 bg-green-500/10 text-green-400 rounded-full text-sm">
              <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></span>
              Live
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setMode(mode === 'live' ? 'search' : 'live')}
            className={`px-3 py-1.5 text-sm font-medium rounded transition-colors ${
              mode === 'search'
                ? 'bg-blue-600 text-white hover:bg-blue-700'
                : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
            }`}
          >
            {mode === 'live' ? '🔍 Search' : '🔴 Live'}
          </button>
          {mode === 'live' && (
            <button
              onClick={() => setIsPaused(!isPaused)}
              className={`px-3 py-1.5 text-sm font-medium rounded transition-colors ${
                isPaused
                  ? 'bg-blue-600 text-white hover:bg-blue-700'
                  : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
              }`}
            >
              {isPaused ? '▶ Resume' : '⏸ Pause'}
            </button>
          )}
          {mode === 'live' && (
            <button onClick={() => setDisplayLogs([])} className="px-3 py-1.5 text-sm font-medium bg-slate-700 text-slate-300 hover:bg-slate-600 rounded transition-colors">
              🗑 Clear
            </button>
          )}
        </div>
      </div>

      {/* Search / Filter Bar */}
      {mode === 'search' && (
        <div className="flex flex-wrap items-center gap-3 p-3 bg-slate-800 border border-slate-700 rounded-lg">
          <input
            type="text"
            placeholder="Search logs..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="flex-1 min-w-[200px] px-3 py-1.5 bg-slate-900 border border-slate-600 rounded text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-blue-500"
          />
          <select
            value={levelFilter}
            onChange={(e) => setLevelFilter(e.target.value)}
            className="px-3 py-1.5 bg-slate-900 border border-slate-600 rounded text-sm text-slate-200 focus:outline-none focus:border-blue-500"
          >
            {LOG_LEVELS.map((l) => (
              <option key={l} value={l}>{l}</option>
            ))}
          </select>
          <input
            type="date"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
            className="px-3 py-1.5 bg-slate-900 border border-slate-600 rounded text-sm text-slate-200 focus:outline-none focus:border-blue-500"
          />
          <input
            type="date"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
            className="px-3 py-1.5 bg-slate-900 border border-slate-600 rounded text-sm text-slate-200 focus:outline-none focus:border-blue-500"
          />
          <button
            onClick={() => performSearch(1)}
            className="px-4 py-1.5 text-sm font-medium bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
          >
            Search
          </button>
          {totalResults > 0 && (
            <span className="text-sm text-slate-400">
              Showing {searchResults.length} of {totalResults} results
            </span>
          )}
        </div>
      )}

      {/* Logs Container */}
      <div className={`${maxHeight} overflow-y-auto bg-slate-900 border border-slate-700 rounded-lg`}>
        {loading ? (
          <div className="flex items-center justify-center py-8 text-slate-400">
            Searching logs...
          </div>
        ) : currentLogs.length === 0 ? (
          <div className="flex items-center justify-center py-8 text-slate-500">
            No results
          </div>
        ) : (
          <div className="font-mono text-xs">
            {currentLogs.map((log, idx) => (
              <div
                key={log.id || idx}
                className="flex items-start gap-3 px-4 py-2 border-b border-slate-800 hover:bg-slate-800/50 transition-colors"
              >
                <span className="text-slate-500 flex-shrink-0 w-20">
                  {log.id}
                </span>
                <span className="text-slate-500 flex-shrink-0 w-32">
                  {formatTime(log.timestamp)}
                </span>
                <span
                  className={`${getLevelBackground(log.level)} px-2 py-0.5 rounded text-xs font-semibold flex-shrink-0 w-16`}
                >
                  {log.level}
                </span>
                <span className="text-blue-400 flex-shrink-0 w-24">{log.app}:</span>
                <span
                  className="text-slate-300 flex-1"
                  dangerouslySetInnerHTML={{
                    __html: mode === 'search' && debouncedSearch
                      ? highlightText(log.message, debouncedSearch)
                      : log.message,
                  }}
                />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Pagination */}
      {mode === 'search' && totalResults > 50 && (
        <div className="flex items-center justify-center gap-2">
          <button
            disabled={currentPage <= 1}
            onClick={() => performSearch(currentPage - 1)}
            className="px-3 py-1 text-sm bg-slate-700 text-slate-300 rounded hover:bg-slate-600 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Previous
          </button>
          <span className="text-sm text-slate-400">
            Page {currentPage} of {Math.ceil(totalResults / 50)}
          </span>
          <button
            disabled={currentPage >= Math.ceil(totalResults / 50)}
            onClick={() => performSearch(currentPage + 1)}
            className="px-3 py-1 text-sm bg-slate-700 text-slate-300 rounded hover:bg-slate-600 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
};
