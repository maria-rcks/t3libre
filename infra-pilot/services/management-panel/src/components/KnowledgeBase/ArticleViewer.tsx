import { Clock, User, Tag, Edit3, ArrowLeft, Globe } from 'lucide-react';
import type { KBArticle } from '../../lib/types';

interface ArticleViewerProps {
  article: KBArticle;
  onEdit: () => void;
  onBack: () => void;
}

export function ArticleViewer({ article, onEdit, onBack }: ArticleViewerProps) {
  const renderMarkdown = (text: string) => {
    const lines = text.split('\n');
    const elements: JSX.Element[] = [];
    let inCodeBlock = false;
    let codeContent = '';

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      if (line.startsWith('```')) {
        if (inCodeBlock) {
          elements.push(
            <pre key={i} className="bg-slate-900 rounded-lg p-4 my-3 text-sm text-green-400 overflow-x-auto border border-slate-700">
              <code>{codeContent}</code>
            </pre>
          );
          codeContent = '';
          inCodeBlock = false;
        } else {
          inCodeBlock = true;
        }
        continue;
      }

      if (inCodeBlock) {
        codeContent += (codeContent ? '\n' : '') + line;
        continue;
      }

      if (line.startsWith('# ')) {
        elements.push(<h1 key={i} className="text-3xl font-bold text-white mb-6">{line.slice(2)}</h1>);
      } else if (line.startsWith('## ')) {
        elements.push(<h2 key={i} className="text-xl font-bold text-white mt-6 mb-3">{line.slice(3)}</h2>);
      } else if (line.startsWith('### ')) {
        elements.push(<h3 key={i} className="text-lg font-semibold text-white mt-4 mb-2">{line.slice(4)}</h3>);
      } else if (line.startsWith('- ')) {
        elements.push(<li key={i} className="text-slate-300 ml-5 list-disc mb-1">{line.slice(2)}</li>);
      } else if (line.startsWith('> ')) {
        elements.push(
          <blockquote key={i} className="border-l-4 border-blue-500 pl-4 py-2 my-3 text-slate-400 bg-slate-800/50 rounded-r-lg">
            {line.slice(2)}
          </blockquote>
        );
      } else if (line.trim() === '') {
        elements.push(<div key={i} className="h-3" />);
      } else {
        let html = line
          .replace(/\*\*(.*?)\*\*/g, '<strong class="text-white">$1</strong>')
          .replace(/\*(.*?)\*/g, '<em>$1</em>')
          .replace(/`([^`]+)`/g, '<code class="bg-slate-800 text-blue-300 px-1.5 py-0.5 rounded text-xs">$1</code>')
          .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" class="text-blue-400 hover:underline" target="_blank" rel="noopener">$1</a>');
        elements.push(<p key={i} className="text-slate-300 leading-relaxed mb-2" dangerouslySetInnerHTML={{ __html: html }} />);
      }
    }

    return elements;
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between mb-6">
        <button onClick={onBack} className="flex items-center gap-1.5 text-sm text-slate-400 hover:text-white transition-colors">
          <ArrowLeft className="w-4 h-4" />
          <span>Back to list</span>
        </button>
        <button onClick={onEdit} className="flex items-center gap-1.5 px-3 py-2 bg-slate-800 hover:bg-slate-700 text-white text-sm rounded-lg transition-colors border border-slate-700">
          <Edit3 className="w-4 h-4" />
          <span>Edit</span>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        <h1 className="text-3xl font-bold text-white mb-4">{article.title}</h1>

        <div className="flex flex-wrap items-center gap-4 mb-6 text-xs text-slate-400">
          <span className="flex items-center gap-1.5">
            <User className="w-3.5 h-3.5" />
            {article.authorName || article.author}
          </span>
          <span className="flex items-center gap-1.5">
            <Clock className="w-3.5 h-3.5" />
            Updated {new Date(article.updated_at).toLocaleDateString()}
          </span>
          <span className="flex items-center gap-1.5">
            <Globe className="w-3.5 h-3.5" />
            {article.category}
          </span>
          {article.tags.map(tag => (
            <span key={tag} className="flex items-center gap-1 px-2 py-0.5 bg-slate-800 rounded-full text-slate-300">
              <Tag className="w-3 h-3" />
              {tag}
            </span>
          ))}
        </div>

        <div className="prose prose-invert max-w-none">
          {renderMarkdown(article.content)}
        </div>

        {article.resourceLinks && article.resourceLinks.length > 0 && (
          <div className="mt-8 p-4 bg-slate-800 rounded-lg border border-slate-700">
            <h3 className="text-sm font-semibold text-slate-300 mb-3">Related Resources</h3>
            <ul className="space-y-2">
              {article.resourceLinks.map((link, i) => (
                <li key={i}>
                  <a href={link} target="_blank" rel="noopener" className="text-sm text-blue-400 hover:underline">{link}</a>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
