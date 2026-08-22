import { ChevronRight, FolderOpen, Folder } from 'lucide-react';
import { useState } from 'react';
import type { KBCategory } from '../../lib/types';

interface CategoryTreeProps {
  categories: KBCategory[];
  selected: string | null;
  onSelect: (id: string | null) => void;
  onAddCategory: () => void;
  onDeleteCategory: (id: string) => void;
}

export function CategoryTree({ categories, selected, onSelect, onAddCategory, onDeleteCategory }: CategoryTreeProps) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const toggle = (id: string) => {
    setCollapsed(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const rootCats = categories.filter(c => !c.parentId);
  const childrenOf = (parentId: string) => categories.filter(c => c.parentId === parentId);

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-slate-300 uppercase tracking-wider">Categories</h3>
        <button onClick={onAddCategory} className="text-xs text-blue-400 hover:text-blue-300 transition-colors">+ Add</button>
      </div>

      <button
        onClick={() => onSelect(null)}
        className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors ${
          selected === null ? 'bg-blue-600 text-white' : 'text-slate-300 hover:bg-slate-800'
        }`}
      >
        <FolderOpen className="w-4 h-4" />
        <span>All Articles</span>
      </button>

      {rootCats.map(cat => (
        <CategoryItem
          key={cat.id}
          category={cat}
          depth={0}
          selected={selected}
          collapsed={collapsed.has(cat.id)}
          onToggle={() => toggle(cat.id)}
          onSelect={onSelect}
          onDelete={onDeleteCategory}
          childrenCats={childrenOf(cat.id)}
        />
      ))}
    </div>
  );
}

interface CategoryItemProps {
  category: KBCategory;
  depth: number;
  selected: string | null;
  collapsed: boolean;
  onToggle: () => void;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  childrenCats: KBCategory[];
}

function CategoryItem({ category, depth, selected, collapsed, onToggle, onSelect, onDelete, childrenCats }: CategoryItemProps) {
  const hasChildren = childrenCats.length > 0;

  return (
    <div>
      <div
        className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors cursor-pointer ${
          selected === category.id ? 'bg-blue-600 text-white' : 'text-slate-300 hover:bg-slate-800'
        }`}
        style={{ paddingLeft: `${12 + depth * 16}px` }}
      >
        {hasChildren ? (
          <button onClick={(e) => { e.stopPropagation(); onToggle(); }} className="p-0.5">
            <ChevronRight className={`w-3 h-3 transition-transform ${collapsed ? '' : 'rotate-90'}`} />
          </button>
        ) : (
          <span className="w-4" />
        )}
        <button onClick={() => onSelect(category.id)} className="flex items-center gap-2 flex-1 text-left">
          {hasChildren ? <Folder className="w-4 h-4" /> : <FolderOpen className="w-4 h-4" />}
          <span>{category.name}</span>
          {category.articleCount !== undefined && (
            <span className="ml-auto text-xs text-slate-500">{category.articleCount}</span>
          )}
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(category.id); }}
          className="p-0.5 text-slate-500 hover:text-red-400 transition-colors opacity-0 hover:opacity-100"
          title="Delete category"
        >
          <span className="text-xs">✕</span>
        </button>
      </div>
      {hasChildren && !collapsed && (
        <div>
          {childrenCats.map(child => (
            <CategoryItem
              key={child.id}
              category={child}
              depth={depth + 1}
              selected={selected}
              collapsed={collapsed}
              onToggle={onToggle}
              onSelect={onSelect}
              onDelete={onDelete}
              childrenCats={[]}
            />
          ))}
        </div>
      )}
    </div>
  );
}
