import { useEffect, useRef, useState } from 'react';
import { Users, Share2, MessageSquare } from 'lucide-react';
import { toast } from 'sonner';

const generateRandomSuffix = (length = 4): string => {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const randomBytes = new Uint8Array(length);
  window.crypto.getRandomValues(randomBytes);
  return Array.from(randomBytes, (byte) => chars[byte % chars.length]).join('');
};

interface TerminalUser {
  userId: string;
  displayName: string;
  cursor?: { row: number; col: number };
  joinedAt: string;
}

interface ChatMessage {
  userId: string;
  displayName: string;
  text: string;
  timestamp: string;
}

interface CollaborativeTerminalProps {
  appId: string;
  sessionId?: string;
  displayName?: string;
}

export const CollaborativeTerminal = ({ appId, sessionId: initialSessionId, displayName: initialName }: CollaborativeTerminalProps) => {
  const [sessionId, setSessionId] = useState(initialSessionId || '');
  const [connected, setConnected] = useState(false);
  const [lines, setLines] = useState<string[]>(['Waiting for session...']);
  const [input, setInput] = useState('');
  const [users, setUsers] = useState<TerminalUser[]>([]);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [showChat, setShowChat] = useState(false);
  const [userName, setUserName] = useState(initialName || `User_${generateRandomSuffix(4)}`);
  const wsRef = useRef<WebSocket | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [lines]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  const connect = () => {
    if (!sessionId && !appId) return;
    const sid = sessionId || appId;
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${window.location.hostname}:3001?sessionId=${sid}&displayName=${encodeURIComponent(userName)}&appId=${appId}`);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      setLines(prev => [...prev, '--- Connected to collaborative terminal ---']);
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);

        if (msg.type === 'history') {
          setLines(msg.lines);
        } else if (msg.type === 'terminal-output') {
          setLines(prev => [...prev.slice(-500), msg.line]);
        } else if (msg.type === 'user-joined') {
          setUsers(msg.users || []);
          setLines(prev => [...prev, `--- ${msg.displayName} joined ---`]);
        } else if (msg.type === 'user-left') {
          setUsers(msg.users || []);
          setLines(prev => [...prev, `--- ${msg.displayName} left ---`]);
        } else if (msg.type === 'cursor-update') {
          setUsers(prev => prev.map(u => u.userId === msg.userId ? { ...u, cursor: msg.cursor } : u));
        } else if (msg.type === 'chat-message') {
          setChatMessages(prev => [...prev, { userId: msg.userId, displayName: msg.displayName, text: msg.text, timestamp: msg.timestamp }]);
        }
      } catch {
        setLines(prev => [...prev.slice(-500), event.data]);
      }
    };

    ws.onclose = () => {
      setConnected(false);
      setLines(prev => [...prev, '--- Disconnected ---']);
    };

    ws.onerror = () => {
      setLines(prev => [...prev, '--- Connection error ---']);
    };
  };

  useEffect(() => {
    return () => wsRef.current?.close();
  }, []);

  const sendCommand = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || !wsRef.current) return;
    wsRef.current.send(JSON.stringify({ type: 'exec', command: input }));
    setInput('');
  };

  const sendChat = (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim() || !wsRef.current) return;
    wsRef.current.send(JSON.stringify({ type: 'chat', text: chatInput }));
    setChatInput('');
  };

  const copyShareLink = () => {
    const link = `${window.location.origin}${window.location.pathname}?session=${sessionId}`;
    navigator.clipboard.writeText(link);
    toast.success('Session link copied');
  };

  if (!connected && !sessionId) {
    return (
      <div className="bg-slate-800 border border-slate-700 rounded-lg p-6">
        <h3 className="text-lg font-semibold text-white mb-4">Collaborative Terminal</h3>
        <div className="space-y-3">
          <div>
            <label className="text-xs text-slate-400 block mb-1">Your Display Name</label>
            <input
              value={userName}
              onChange={e => setUserName(e.target.value)}
              className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-sm text-white"
              placeholder="Your name"
            />
          </div>
          <button
            onClick={connect}
            className="w-full px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm"
          >
            Start Session
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-slate-700 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2 bg-slate-900 text-slate-300 text-xs">
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-2">
            <Users className="w-3.5 h-3.5" />
            <span>{users.length} connected</span>
          </span>
          <span className={`w-2 h-2 rounded-full ${connected ? 'bg-green-500' : 'bg-red-500'}`} />
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setShowChat(!showChat)} className={`p-1 rounded hover:bg-slate-700 ${showChat ? 'bg-slate-700' : ''}`}>
            <MessageSquare className="w-3.5 h-3.5" />
          </button>
          <button onClick={copyShareLink} className="p-1 rounded hover:bg-slate-700">
            <Share2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      <div className="flex" style={{ height: '400px' }}>
        <div className="flex-1 flex flex-col">
          <div className="flex-1 bg-black p-4 font-mono text-xs text-green-400 overflow-y-auto" style={{ background: '#0a0a0a' }}>
            {lines.map((line, i) => (
              <div key={i}>{line}</div>
            ))}
            <div ref={endRef} />
          </div>
          <form onSubmit={sendCommand} className="flex bg-slate-900 border-t border-slate-700">
            <span className="px-3 py-2 text-green-400 font-mono text-sm">$</span>
            <input
              value={input}
              onChange={e => setInput(e.target.value)}
              className="flex-1 bg-transparent px-2 py-2 text-sm text-green-400 font-mono outline-none"
              placeholder="Type a command..."
            />
          </form>
        </div>

        {/* Connected Users Sidebar */}
        <div className="w-48 border-l border-slate-700 bg-slate-900">
          <div className="p-2 border-b border-slate-700">
            <p className="text-xs text-slate-400 font-semibold">Connected Users</p>
          </div>
          <div className="p-2 space-y-2 max-h-32 overflow-y-auto">
            {users.map((user) => (
              <div key={user.userId} className="flex items-center gap-2 text-xs">
                <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
                <span className="text-slate-300 truncate">{user.displayName}</span>
              </div>
            ))}
            {users.length === 0 && <p className="text-xs text-slate-500">No other users</p>}
          </div>

          <div className="p-2 border-t border-slate-700">
            <p className="text-xs text-slate-400 mb-1">Session ID</p>
            <p className="text-xs text-slate-500 font-mono truncate">{sessionId || appId}</p>
          </div>

          {showChat && (
            <div className="border-t border-slate-700 flex-1 flex flex-col" style={{ height: 'calc(100% - 150px)' }}>
              <div className="p-2 border-b border-slate-700">
                <p className="text-xs text-slate-400 font-semibold">Chat</p>
              </div>
              <div className="flex-1 p-2 overflow-y-auto space-y-1">
                {chatMessages.map((msg, i) => (
                  <div key={i} className="text-xs">
                    <span className="text-blue-400">{msg.displayName}: </span>
                    <span className="text-slate-300">{msg.text}</span>
                  </div>
                ))}
                <div ref={chatEndRef} />
              </div>
              <form onSubmit={sendChat} className="flex border-t border-slate-700">
                <input
                  value={chatInput}
                  onChange={e => setChatInput(e.target.value)}
                  className="flex-1 bg-transparent px-2 py-1.5 text-xs text-white outline-none"
                  placeholder="Chat..."
                />
              </form>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
