import React, { useState, useEffect, useRef, useCallback } from 'react';
import { apiClient } from '../lib/api';
import { toast } from 'sonner';

interface ConfigEditorProps {
  appId: string;
  initialPath?: string;
}

interface FileEntry {
  name: string;
  path: string;
  size: number;
  modifiedAt: string;
  isDirectory: boolean;
}

function detectLanguage(filename: string): 'yaml' | 'json' | 'properties' | 'text' {
  if (filename.endsWith('.yml') || filename.endsWith('.yaml')) return 'yaml';
  if (filename.endsWith('.json')) return 'json';
  if (filename.endsWith('.properties')) return 'properties';
  return 'text';
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function highlightSyntax(code: string, language: string): string {
  let html = escapeHtml(code);
  if (language === 'json') {
    html = html.replace(/("(?:[^"\\]|\\.)*")\s*:/g, '<span class="json-key">$1</span>:');
    html = html.replace(/:\s*("(?:[^"\\]|\\.)*")/g, ': <span class="json-string">$1</span>');
    html = html.replace(/(:\s*)(-?\d+\.?\d*)/g, '$1<span class="json-number">$2</span>');
    html = html.replace(/(:\s*)(true|false)/g, '$1<span class="json-boolean">$2</span>');
    html = html.replace(/(:\s*)(null)/g, '$1<span class="json-null">$2</span>');
  } else if (language === 'yaml') {
    html = html.replace(/(#.*)$/gm, '<span class="yaml-comment">$1</span>');
    html = html.replace(/^(\s*)([\w.-]+)(:)/gm, '$1<span class="yaml-key">$2</span>$3');
    html = html.replace(/("(?:[^"\\]|\\.)*")/g, '<span class="yaml-string">$1</span>');
    html = html.replace(/(:\s+)(-?\d+\.?\d*)/g, '$1<span class="yaml-number">$2</span>');
    html = html.replace(/(:\s+)(true|false|yes|no)/g, '$1<span class="yaml-boolean">$2</span>');
    html = html.replace(/(:\s+)(null|~)/g, '$1<span class="yaml-null">$2</span>');
  }
  return html;
}

export const ConfigEditor: React.FC<ConfigEditorProps> = ({ appId, initialPath }) => {
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [currentPath, setCurrentPath] = useState('/');
  const [selectedFile, setSelectedFile] = useState<string | null>(initialPath || null);
  const [content, setContent] = useState('');
  const [savedContent, setSavedContent] = useState('');
  const [language, setLanguage] = useState<'yaml' | 'json' | 'properties' | 'text'>('text');
  const [loading, setLoading] = useState(false);
  const [fileLoading, setFileLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [validationResult, setValidationResult] = useState<{ valid: boolean; errors: string[] } | null>(null);
  const [breadcrumbs, setBreadcrumbs] = useState<string[]>(['/']);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const highlightRef = useRef<HTMLPreElement>(null);

  const isDirty = content !== savedContent;

  const loadFiles = useCallback(async (dirPath: string) => {
    setLoading(true);
    try {
      const result = await apiClient.listConfigFiles(appId, dirPath);
      setFiles(result.files || []);
      setCurrentPath(result.currentPath);
    } catch (err: any) {
      toast.error('Failed to load files: ' + (err.response?.data?.error || err.message));
      setFiles([]);
    } finally {
      setLoading(false);
    }
  }, [appId]);

  useEffect(() => {
    loadFiles('/');
  }, [loadFiles]);

  const navigateToDir = (dirPath: string) => {
    setSelectedFile(null);
    setContent('');
    setSavedContent('');
    setValidationResult(null);
    loadFiles(dirPath);
    const parts = dirPath.split('/').filter(Boolean);
    setBreadcrumbs(['/', ...parts]);
  };

  const navigateBreadcrumb = (index: number) => {
    if (index === 0) {
      navigateToDir('/');
      return;
    }
    const parts = breadcrumbs.slice(1, index + 1);
    navigateToDir('/' + parts.join('/'));
  };

  const openFile = async (filePath: string) => {
    setFileLoading(true);
    setSelectedFile(filePath);
    setValidationResult(null);
    try {
      const result = await apiClient.readConfigFile(appId, filePath);
      setContent(result.content);
      setSavedContent(result.content);
      setLanguage(result.language as any);
    } catch (err: any) {
      toast.error('Failed to read file');
      setContent('');
      setSavedContent('');
    } finally {
      setFileLoading(false);
    }
  };

  const handleSave = async () => {
    if (!selectedFile) return;
    setSaving(true);
    try {
      const result = await apiClient.writeConfigFile(appId, selectedFile, content);
      setSavedContent(content);
      toast.success('File saved' + (result.backupPath ? ' (backup created)' : ''));
    } catch (err: any) {
      toast.error('Failed to save file');
    } finally {
      setSaving(false);
    }
  };

  const handleDiscard = () => {
    setContent(savedContent);
    toast.info('Changes discarded');
  };

  const handleValidate = async () => {
    if (!selectedFile) return;
    try {
      const result = await apiClient.validateConfigFile(appId, selectedFile);
      setValidationResult(result);
      if (result.valid) {
        toast.success('Configuration is valid');
      } else {
        toast.error('Validation errors found');
      }
    } catch (err: any) {
      toast.error('Failed to validate file');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      handleSave();
    }
  };

  const syncScroll = () => {
    if (textareaRef.current && highlightRef.current) {
      highlightRef.current.scrollTop = textareaRef.current.scrollTop;
      highlightRef.current.scrollLeft = textareaRef.current.scrollLeft;
    }
  };

  const renderHighlightedContent = () => {
    const html = highlightSyntax(content, language);
    return html + '\n';
  };

  return (
    <div className="flex gap-4 h-[600px]">
      {/* File Browser Sidebar */}
      <div className="w-64 flex-shrink-0 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg overflow-hidden flex flex-col">
        <div className="p-3 border-b border-slate-200 dark:border-slate-700">
          <div className="flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400 flex-wrap">
            {breadcrumbs.map((crumb, idx) => (
              <React.Fragment key={idx}>
                {idx > 0 && <span className="text-slate-400">/</span>}
                <button
                  onClick={() => navigateBreadcrumb(idx)}
                  className="hover:text-blue-600 dark:hover:text-blue-400 truncate max-w-[80px]"
                >
                  {crumb === '/' ? 'root' : crumb}
                </button>
              </React.Fragment>
            ))}
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-2">
          {loading ? (
            <div className="text-center py-4 text-sm text-slate-500">Loading...</div>
          ) : files.length === 0 ? (
            <div className="text-center py-4 text-sm text-slate-500">Empty directory</div>
          ) : (
            <div className="space-y-0.5">
              {currentPath !== '/' && (
                <button
                  onClick={() => {
                    const parent = currentPath.split('/').slice(0, -1).join('/') || '/';
                    navigateToDir(parent);
                  }}
                  className="w-full text-left px-2 py-1.5 text-sm text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 rounded"
                >
                  ..
                </button>
              )}
              {files.map((file) => (
                <div key={file.path}>
                  {file.isDirectory ? (
                    <button
                      onClick={() => navigateToDir(file.path)}
                      className="w-full text-left px-2 py-1.5 text-sm text-blue-600 dark:text-blue-400 hover:bg-slate-100 dark:hover:bg-slate-700 rounded truncate"
                    >
                      {file.name}/
                    </button>
                  ) : (
                    <button
                      onClick={() => openFile(file.path)}
                      className={`w-full text-left px-2 py-1.5 text-sm rounded truncate ${
                        selectedFile === file.path
                          ? 'bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200'
                          : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700'
                      }`}
                    >
                      {file.name}
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Editor Area */}
      <div className="flex-1 flex flex-col">
        {!selectedFile ? (
          <div className="flex-1 flex items-center justify-center bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg">
            <p className="text-slate-500 dark:text-slate-400">Select a file to edit</p>
          </div>
        ) : fileLoading ? (
          <div className="flex-1 flex items-center justify-center bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg">
            <p className="text-slate-500">Loading file...</p>
          </div>
        ) : (
          <>
            {/* Toolbar */}
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <span className="text-sm font-mono text-slate-600 dark:text-slate-400 truncate max-w-[300px]">
                  {selectedFile}
                </span>
                {isDirty && (
                  <span className="text-xs px-2 py-0.5 bg-yellow-100 dark:bg-yellow-900 text-yellow-800 dark:text-yellow-200 rounded">
                    Unsaved
                  </span>
                )}
              </div>
              <div className="flex gap-2">
                <button
                  onClick={handleValidate}
                  className="px-3 py-1.5 text-xs bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600 rounded transition-colors"
                >
                  Validate
                </button>
                <button
                  onClick={handleDiscard}
                  disabled={!isDirty}
                  className="px-3 py-1.5 text-xs bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600 rounded transition-colors disabled:opacity-50"
                >
                  Discard
                </button>
                <button
                  onClick={handleSave}
                  disabled={!isDirty || saving}
                  className="px-3 py-1.5 text-xs bg-blue-600 hover:bg-blue-700 text-white rounded transition-colors disabled:opacity-50"
                >
                  {saving ? 'Saving...' : 'Save'}
                </button>
              </div>
            </div>

            {/* Validation Result */}
            {validationResult && !validationResult.valid && (
              <div className="mb-2 p-2 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded text-xs text-red-700 dark:text-red-300">
                {validationResult.errors.map((err, i) => (
                  <div key={i}>{err}</div>
                ))}
              </div>
            )}

            {/* Editor with Syntax Highlighting */}
            <div className="flex-1 relative bg-slate-900 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-lg overflow-hidden font-mono text-sm">
              <pre
                ref={highlightRef}
                className="absolute inset-0 m-0 p-4 pointer-events-none whitespace-pre-wrap break-all overflow-auto text-green-400"
                dangerouslySetInnerHTML={{ __html: renderHighlightedContent() }}
                style={{ zIndex: 1 }}
              />
              <textarea
                ref={textareaRef}
                value={content}
                onChange={(e) => setContent(e.target.value)}
                onKeyDown={handleKeyDown}
                onScroll={syncScroll}
                className="absolute inset-0 m-0 p-4 w-full h-full bg-transparent text-transparent caret-white resize-none border-0 outline-none whitespace-pre-wrap break-all overflow-auto"
                style={{ zIndex: 2 }}
                spellCheck={false}
              />
            </div>

            {/* Status Bar */}
            <div className="flex justify-between items-center mt-1 text-xs text-slate-500 dark:text-slate-400">
              <span>Language: {language}</span>
              <span>{content.split('\n').length} lines | {content.length} chars</span>
            </div>
          </>
        )}
      </div>

      <style>{`
        .json-key { color: #93c5fd; }
        .json-string { color: #86efac; }
        .json-number { color: #fde68a; }
        .json-boolean { color: #c4b5fd; }
        .json-null { color: #fca5a5; }
        .yaml-comment { color: #64748b; }
        .yaml-key { color: #93c5fd; }
        .yaml-string { color: #86efac; }
        .yaml-number { color: #fde68a; }
        .yaml-boolean { color: #c4b5fd; }
        .yaml-null { color: #fca5a5; }
      `}</style>
    </div>
  );
};
