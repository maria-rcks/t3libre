import { useState, useEffect, useRef } from 'react';
import { Search, FileText, Server, Archive } from 'lucide-react';
import { useNavigate } from 'react-router';

interface SearchResult {
  id: string;
  name: string;
  type: 'app' | 'backup' | 'audit';
}

export function GlobalSearch() {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setIsOpen(o => !o);
      }
      if (e.key === 'Escape') setIsOpen(false);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  useEffect(() => {
    if (isOpen) setTimeout(() => inputRef.current?.focus(), 100);
  }, [isOpen]);

  useEffect(() => {
    if (query.length < 2) { setResults([]); return; }
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const token = localStorage.getItem('access_token');
        const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`, { headers: { Authorization: `Bearer ${token}` } });
        if (res.ok) { const data = await res.json(); setResults(data.results || []); }
      } catch {} finally { setLoading(false); }
    }, 300);
    return () => clearTimeout(timer);
  }, [query]);

  const goto = (result: SearchResult) => {
    setIsOpen(false);
    if (result.type === 'app') navigate(`/apps/${result.id}`);
    else if (result.type === 'backup') navigate('/backups');
    else navigate('/dashboard');
  };

  if (!isOpen) return null;

  const icons = { app: Server, backup: Archive, audit: FileText };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]" onClick={() => setIsOpen(false)}>
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-3 p-4 border-b border-gray-200 dark:border-gray-700">
          <Search className="w-5 h-5 text-gray-400" />
          <input ref={inputRef} value={query} onChange={e => setQuery(e.target.value)} placeholder="Search apps, backups, audit logs..." className="flex-1 bg-transparent outline-none text-gray-900 dark:text-white placeholder-gray-400" />
          <kbd className="hidden sm:inline-flex px-1.5 py-0.5 text-xs bg-gray-100 dark:bg-gray-700 rounded text-gray-400">ESC</kbd>
        </div>
        <div className="max-h-80 overflow-y-auto p-2">
          {loading && <div className="text-center py-4 text-gray-400"><div className="animate-spin w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full mx-auto" /></div>}
          {!loading && query.length >= 2 && results.length === 0 && <p className="text-center py-4 text-gray-400">No results found</p>}
          {results.map(r => {
            const Icon = icons[r.type];
            return (
              <button key={`${r.type}-${r.id}`} onClick={() => goto(r)} className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-left">
                <Icon className="w-4 h-4 text-gray-400" />
                <span className="text-sm text-gray-700 dark:text-gray-200">{r.name}</span>
                <span className="ml-auto text-xs text-gray-400 uppercase">{r.type}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
