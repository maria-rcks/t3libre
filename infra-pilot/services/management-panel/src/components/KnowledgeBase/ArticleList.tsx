import { useState } from 'react';
import { Search, Plus, FileText, Trash2 } from 'lucide-react';
import type { KBArticle } from '../../lib/types';

interface ArticleListProps {
  articles: KBArticle[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onDelete: (id: string) => void;
  onSearch: (query: string) => void;
  searchQuery: string;
}

export function ArticleList({ articles, selectedId, onSelect, onCreate, onDelete, onSearch, searchQuery }: ArticleListProps) {
  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 mb-4">
        <div className="flex items-center gap-2 flex-1 px-3 py-2 bg-slate-800 rounded-lg border border-slate-700 focus-within:border-blue-500">
          <Search className="w-4 h-4 text-slate-400" />
          <input
            value={searchQuery}
            onChange={e => onSearch(e.target.value)}
            placeholder="Search articles..."
            className="flex-1 bg-transparent text-sm text-white placeholder-slate-400 outline-none"
          />
        </div>
        <button onClick={onCreate} className="p-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors" title="New Article">
          <Plus className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto space-y-1">
        {articles.length === 0 ? (
          <div className="text-center py-8">
            <FileText className="w-8 h-8 text-slate-600 mx-auto mb-2" />
            <p className="text-sm text-slate-500">No articles found</p>
          </div>
        ) : articles.map(article => (
          <div
            key={article.id}
            onClick={() => onSelect(article.id)}
            className={`group flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors ${
              selectedId === article.id ? 'bg-blue-600/20 border border-blue-500/30' : 'hover:bg-slate-800 border border-transparent'
            }`}
          >
            <FileText className={`w-4 h-4 ${selectedId === article.id ? 'text-blue-400' : 'text-slate-500'}`} />
            <div className="flex-1 min-w-0">
              <p className={`text-sm truncate ${selectedId === article.id ? 'text-white' : 'text-slate-300'}`}>
                {article.title}
              </p>
              <p className="text-xs text-slate-500 truncate">
                {article.category} · {new Date(article.updated_at).toLocaleDateString()}
              </p>
            </div>
            <button
              onClick={(e) => { e.stopPropagation(); onDelete(article.id); }}
              className="p-1 text-slate-500 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all"
              title="Delete article"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
