import { useState, useEffect, useRef } from 'react';
import { Save, Eye, Edit3, X } from 'lucide-react';
import type { KBArticle, KBCategory } from '../../lib/types';

interface ArticleEditorProps {
  article: KBArticle | null;
  categories: KBCategory[];
  onSave: (data: Partial<KBArticle>) => void;
  onClose: () => void;
}

export function ArticleEditor({ article, categories, onSave, onClose }: ArticleEditorProps) {
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [category, setCategory] = useState('');
  const [tags, setTags] = useState('');
  const [published, setPublished] = useState(true);
  const [preview, setPreview] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (article) {
      setTitle(article.title);
      setContent(article.content);
      setCategory(article.category);
      setTags(article.tags.join(', '));
      setPublished(article.published);
    } else {
      setTitle('');
      setContent('');
      setCategory(categories[0]?.name || 'uncategorized');
      setTags('');
      setPublished(true);
    }
  }, [article, categories]);

  const handleSave = () => {
    onSave({
      title,
      content,
      category,
      tags: tags.split(',').map(t => t.trim()).filter(Boolean),
      published,
    });
  };

  const isSafeUrl = (url: string) => {
    const trimmed = url.trim();
    if (!trimmed) return false;
    try {
      const parsed = new URL(trimmed, 'http://localhost');
      return parsed.protocol === 'http:' || parsed.protocol === 'https:' || parsed.protocol === 'mailto:';
    } catch {
      return false;
    }
  };

  const renderInlineMarkdown = (line: string) => {
    const nodes: JSX.Element[] = [];
    const pattern = /(\*\*(.*?)\*\*)|(\[([^\]]+)\]\(([^)]+)\))/g;
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = pattern.exec(line)) !== null) {
      if (match.index > lastIndex) {
        nodes.push(<span key={`text-${lastIndex}`}>{line.slice(lastIndex, match.index)}</span>);
      }

      if (match[1]) {
        nodes.push(<strong key={`bold-${match.index}`}>{match[2]}</strong>);
      } else if (match[3]) {
        const linkText = match[4];
        const linkUrl = match[5];
        if (isSafeUrl(linkUrl)) {
          nodes.push(
            <a key={`link-${match.index}`} href={linkUrl} className="text-blue-400 hover:underline" target="_blank" rel="noopener noreferrer">
              {linkText}
            </a>
          );
        } else {
          nodes.push(<span key={`unsafe-link-${match.index}`}>{match[0]}</span>);
        }
      }

      lastIndex = pattern.lastIndex;
    }

    if (lastIndex < line.length) {
      nodes.push(<span key={`text-${lastIndex}`}>{line.slice(lastIndex)}</span>);
    }

    return nodes;
  };

  const renderMarkdown = (text: string) => {
    const lines = text.split('\n');
    return lines.map((line, i) => {
      if (line.startsWith('# ')) return <h1 key={i} className="text-2xl font-bold text-white mb-4">{line.slice(2)}</h1>;
      if (line.startsWith('## ')) return <h2 key={i} className="text-xl font-bold text-white mb-3">{line.slice(3)}</h2>;
      if (line.startsWith('### ')) return <h3 key={i} className="text-lg font-semibold text-white mb-2">{line.slice(4)}</h3>;
      if (line.startsWith('- ')) return <li key={i} className="text-slate-300 ml-4 list-disc">{line.slice(2)}</li>;
      if (line.startsWith('> ')) return <blockquote key={i} className="border-l-4 border-blue-500 pl-4 py-1 my-2 text-slate-400 bg-slate-800/50 rounded">{line.slice(2)}</blockquote>;
      if (line.startsWith('```')) return <pre key={i} className="bg-slate-900 rounded-lg p-4 my-2 text-sm text-green-400 overflow-x-auto">{line.slice(3)}</pre>;
      if (line.trim() === '') return <div key={i} className="h-2" />;
      return <p key={i} className="text-slate-300 mb-1">{renderInlineMarkdown(line)}</p>;
    });
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between mb-4">
        <input
          value={title}
          onChange={e => setTitle(e.target.value)}
          placeholder="Article title..."
          className="flex-1 bg-transparent text-xl font-bold text-white placeholder-slate-500 outline-none"
        />
        <div className="flex items-center gap-2">
          <button onClick={() => setPreview(!preview)} className={`p-2 rounded-lg transition-colors ${preview ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white hover:bg-slate-800'}`} title={preview ? 'Edit' : 'Preview'}>
            {preview ? <Edit3 className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
          <button onClick={handleSave} className="flex items-center gap-1.5 px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors">
            <Save className="w-4 h-4" />
            <span>Save</span>
          </button>
          <button onClick={onClose} className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="flex items-center gap-4 mb-4">
        <div>
          <label className="block text-xs text-slate-400 mb-1">Category</label>
          <select value={category} onChange={e => setCategory(e.target.value)} className="bg-slate-800 text-white text-sm rounded px-3 py-1.5 border border-slate-700">
            {categories.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
            <option value="uncategorized">Uncategorized</option>
          </select>
        </div>
        <div className="flex-1">
          <label className="block text-xs text-slate-400 mb-1">Tags (comma separated)</label>
          <input value={tags} onChange={e => setTags(e.target.value)} placeholder="e.g. docker, deployment, config" className="w-full bg-slate-800 text-white text-sm rounded px-3 py-1.5 border border-slate-700 placeholder-slate-500 outline-none" />
        </div>
        <div className="flex items-center gap-2 pt-5">
          <input type="checkbox" id="published" checked={published} onChange={e => setPublished(e.target.checked)} className="rounded border-slate-600 bg-slate-800" />
          <label htmlFor="published" className="text-sm text-slate-300">Published</label>
        </div>
      </div>

      {preview ? (
        <div className="flex-1 overflow-y-auto bg-slate-900 rounded-lg p-6 border border-slate-700">
          {renderMarkdown(content)}
        </div>
      ) : (
        <textarea
          ref={textareaRef}
          value={content}
          onChange={e => setContent(e.target.value)}
          placeholder="Write your article content in Markdown..."
          className="flex-1 bg-slate-900 text-slate-200 text-sm rounded-lg p-4 border border-slate-700 outline-none focus:border-blue-500 resize-none font-mono placeholder-slate-500"
        />
      )}
    </div>
  );
}
