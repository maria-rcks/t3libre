import { useEffect, useRef, useState } from 'react';
import { Terminal as TerminalIcon, Maximize2, Minimize2 } from 'lucide-react';

interface WebTerminalProps {
  appId: string;
  containerId?: string;
}

export function WebTerminal({ appId, containerId }: WebTerminalProps) {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [lines, setLines] = useState<string[]>(['Connecting to container...']);
  const [input, setInput] = useState('');
  const wsRef = useRef<WebSocket | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [lines]);

  useEffect(() => {
    if (!containerId) return;
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${window.location.hostname}:3001?appId=${appId}`);
    wsRef.current = ws;

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'log') setLines(prev => [...prev.slice(-500), msg.data]);
      } catch {
        setLines(prev => [...prev.slice(-500), event.data]);
      }
    };

    ws.onclose = () => setLines(prev => [...prev, '--- Connection closed ---']);
    ws.onerror = () => setLines(prev => [...prev, '--- Connection error ---']);

    return () => ws.close();
  }, [appId, containerId]);

  const sendCommand = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || !wsRef.current) return;
    setLines(prev => [...prev, `$ ${input}`]);
    wsRef.current.send(JSON.stringify({ type: 'exec', command: input }));
    setInput('');
  };

  return (
    <div className={`rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden ${isFullscreen ? 'fixed inset-4 z-50' : ''}`}>
      <div className="flex items-center justify-between px-4 py-2 bg-gray-900 text-gray-300 text-xs">
        <span className="flex items-center gap-2"><TerminalIcon className="w-3.5 h-3.5" /> Container Terminal</span>
        <button onClick={() => setIsFullscreen(!isFullscreen)} className="hover:text-white">
          {isFullscreen ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
        </button>
      </div>
      <div className="bg-black p-4 font-mono text-sm text-green-400 h-64 overflow-y-auto" style={{ background: '#0a0a0a' }}>
        {lines.map((line, i) => <div key={i}>{line}</div>)}
        <div ref={endRef} />
      </div>
      <form onSubmit={sendCommand} className="flex bg-gray-900 border-t border-gray-800">
        <span className="px-3 py-2 text-green-400 font-mono text-sm">$</span>
        <input value={input} onChange={e => setInput(e.target.value)} className="flex-1 bg-transparent px-2 py-2 text-sm text-green-400 font-mono outline-none" placeholder="Type a command..." />
      </form>
    </div>
  );
}
