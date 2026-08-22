import { useEffect, useState } from 'react';
import { apiClient } from '../lib/api';
import { toast } from 'sonner';

interface Suggestion {
  id: string;
  severity: 'critical' | 'warning' | 'info';
  category: string;
  title: string;
  description: string;
  recommendation: string;
  file?: string;
  autoFixable: boolean;
  fixCommand?: string;
}

interface AdviceResult {
  appId: string;
  analyzedAt: string;
  total: number;
  critical: number;
  warning: number;
  info: number;
  suggestions: Suggestion[];
}

interface AIConfigAdvisorProps {
  appId: string;
}

export const AIConfigAdvisor = ({ appId }: AIConfigAdvisorProps) => {
  const [result, setResult] = useState<AdviceResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [applying, setApplying] = useState<string | null>(null);

  useEffect(() => {
    loadAdvice();
  }, [appId]);

  const loadAdvice = async () => {
    setLoading(true);
    try {
      const data = await apiClient.getConfigAdvice(appId);
      setResult(data);
    } catch {
      toast.error('Failed to load config advice');
    } finally {
      setLoading(false);
    }
  };

  const toggleExpand = (id: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleApply = async (suggestionId: string) => {
    setApplying(suggestionId);
    try {
      await apiClient.applyConfigAdvice(appId, suggestionId);
      toast.success('Suggestion applied');
    } catch {
      toast.error('Failed to apply suggestion');
    } finally {
      setApplying(null);
    }
  };

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case 'critical': return 'border-red-500/30 bg-red-500/5';
      case 'warning': return 'border-yellow-500/30 bg-yellow-500/5';
      case 'info': return 'border-blue-500/30 bg-blue-500/5';
      default: return 'border-slate-700 bg-slate-800';
    }
  };

  const getSeverityBadge = (severity: string) => {
    switch (severity) {
      case 'critical': return 'bg-red-500/20 text-red-400 border-red-500/30';
      case 'warning': return 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30';
      case 'info': return 'bg-blue-500/20 text-blue-400 border-blue-500/30';
      default: return 'bg-slate-500/20 text-slate-400 border-slate-500/30';
    }
  };

  if (loading) {
    return <div className="text-slate-400 py-4">Analyzing configuration...</div>;
  }

  if (!result) {
    return (
      <div className="text-center py-8">
        <p className="text-slate-400">Unable to analyze configuration</p>
        <button onClick={loadAdvice} className="mt-4 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm">
          Retry Analysis
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-white">AI Config Advisor</h3>
        <button onClick={loadAdvice} className="px-3 py-1.5 text-xs bg-slate-700 hover:bg-slate-600 text-slate-300 rounded transition-colors">
          Re-analyze
        </button>
      </div>

      <div className="grid grid-cols-4 gap-3">
        <div className="bg-slate-800 border border-slate-700 rounded-lg p-3 text-center">
          <p className="text-2xl font-bold text-white">{result.total}</p>
          <p className="text-xs text-slate-400">Total</p>
        </div>
        <div className="bg-slate-800 border border-red-500/30 rounded-lg p-3 text-center">
          <p className="text-2xl font-bold text-red-400">{result.critical}</p>
          <p className="text-xs text-slate-400">Critical</p>
        </div>
        <div className="bg-slate-800 border border-yellow-500/30 rounded-lg p-3 text-center">
          <p className="text-2xl font-bold text-yellow-400">{result.warning}</p>
          <p className="text-xs text-slate-400">Warnings</p>
        </div>
        <div className="bg-slate-800 border border-blue-500/30 rounded-lg p-3 text-center">
          <p className="text-2xl font-bold text-blue-400">{result.info}</p>
          <p className="text-xs text-slate-400">Info</p>
        </div>
      </div>

      {result.suggestions.length === 0 ? (
        <div className="bg-slate-800 border border-slate-700 rounded-lg p-6 text-center">
          <p className="text-green-400 text-lg font-semibold">No issues found!</p>
          <p className="text-slate-400 text-sm mt-1">Your configuration follows best practices.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {result.suggestions.map((suggestion) => (
            <div
              key={suggestion.id}
              className={`border rounded-lg ${getSeverityColor(suggestion.severity)}`}
            >
              <button
                onClick={() => toggleExpand(suggestion.id)}
                className="w-full flex items-center justify-between p-3 text-left"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span className={`px-2 py-0.5 text-xs rounded border ${getSeverityBadge(suggestion.severity)} capitalize shrink-0`}>
                    {suggestion.severity}
                  </span>
                  <span className="text-xs px-2 py-0.5 bg-slate-700 rounded text-slate-300 shrink-0">{suggestion.category}</span>
                  <span className="text-sm text-white truncate">{suggestion.title}</span>
                </div>
                <svg className={`w-4 h-4 text-slate-400 shrink-0 transition-transform ${expanded.has(suggestion.id) ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              {expanded.has(suggestion.id) && (
                <div className="px-3 pb-3 space-y-3">
                  <p className="text-sm text-slate-300">{suggestion.description}</p>
                  <div className="bg-slate-900/50 rounded p-2">
                    <p className="text-xs text-slate-400 mb-1">Recommendation:</p>
                    <p className="text-sm text-blue-300">{suggestion.recommendation}</p>
                  </div>
                  {suggestion.file && (
                    <p className="text-xs text-slate-500">Affected file: {suggestion.file}</p>
                  )}
                  {suggestion.autoFixable && (
                    <button
                      onClick={() => handleApply(suggestion.id)}
                      disabled={applying === suggestion.id}
                      className="px-3 py-1.5 text-xs bg-green-600 hover:bg-green-700 disabled:bg-slate-600 text-white rounded transition-colors"
                    >
                      {applying === suggestion.id ? 'Applying...' : 'Apply Fix'}
                    </button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <p className="text-xs text-slate-500 text-right">
        Analyzed at {new Date(result.analyzedAt).toLocaleString()}
      </p>
    </div>
  );
};
