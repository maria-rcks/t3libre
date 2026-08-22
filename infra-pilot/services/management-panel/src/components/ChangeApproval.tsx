import { useEffect, useState } from 'react';
import { apiClient } from '../lib/api';
import { ChangeRequest, ChangeRequestInput } from '../lib/types';
import { toast } from 'sonner';

interface ChangeApprovalProps {
  appId?: string;
}

export const ChangeApproval = ({ appId }: ChangeApprovalProps) => {
  const [requests, setRequests] = useState<ChangeRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<ChangeRequestInput>({ appId: appId || '', action: '', reason: '', details: '', isBreakGlass: false });
  const [submitting, setSubmitting] = useState(false);
  const [filter, setFilter] = useState<string>('all');
  const [rejectReason, setRejectReason] = useState('');
  const [rejectingId, setRejectingId] = useState<string | null>(null);

  useEffect(() => {
    loadRequests();
    const interval = setInterval(loadRequests, 10000);
    return () => clearInterval(interval);
  }, [filter, appId]);

  const loadRequests = async () => {
    try {
      const data = await apiClient.listChangeRequests({ status: filter !== 'all' ? filter : undefined, appId });
      setRequests(data);
    } catch {
      // Silent
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = async () => {
    if (!form.action || !form.reason) return;
    setSubmitting(true);
    try {
      await apiClient.createChangeRequest(form);
      toast.success('Change request created');
      setShowForm(false);
      setForm({ appId: appId || '', action: '', reason: '', details: '', isBreakGlass: false });
      loadRequests();
    } catch {
      toast.error('Failed to create change request');
    } finally {
      setSubmitting(false);
    }
  };

  const handleApprove = async (id: string) => {
    try {
      await apiClient.approveChangeRequest(id);
      toast.success('Change request approved');
      loadRequests();
    } catch {
      toast.error('Failed to approve');
    }
  };

  const handleReject = async (id: string) => {
    if (!rejectReason.trim()) return;
    try {
      await apiClient.rejectChangeRequest(id, rejectReason);
      toast.success('Change request rejected');
      setRejectingId(null);
      setRejectReason('');
      loadRequests();
    } catch {
      toast.error('Failed to reject');
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'pending': return 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30';
      case 'approved': return 'bg-green-500/20 text-green-400 border-green-500/30';
      case 'rejected': return 'bg-red-500/20 text-red-400 border-red-500/30';
      case 'emergency': return 'bg-purple-500/20 text-purple-400 border-purple-500/30';
      default: return 'bg-slate-500/20 text-slate-400 border-slate-500/30';
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-white">Change Approval</h3>
        <button
          onClick={() => setShowForm(!showForm)}
          className="px-3 py-1.5 text-xs bg-blue-600 hover:bg-blue-700 text-white rounded transition-colors"
        >
          {showForm ? 'Cancel' : 'New Request'}
        </button>
      </div>

      {showForm && (
        <div className="bg-slate-800 border border-slate-700 rounded-lg p-4 space-y-3">
          <div>
            <label className="text-xs text-slate-400 block mb-1">Action *</label>
            <input
              value={form.action}
              onChange={e => setForm(f => ({ ...f, action: e.target.value }))}
              className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-sm text-white"
              placeholder="e.g., restart, deploy, delete"
            />
          </div>
          <div>
            <label className="text-xs text-slate-400 block mb-1">Reason *</label>
            <input
              value={form.reason}
              onChange={e => setForm(f => ({ ...f, reason: e.target.value }))}
              className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-sm text-white"
              placeholder="Why is this change needed?"
            />
          </div>
          <div>
            <label className="text-xs text-slate-400 block mb-1">Details</label>
            <textarea
              value={form.details}
              onChange={e => setForm(f => ({ ...f, details: e.target.value }))}
              className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-sm text-white resize-none"
              rows={3}
              placeholder="Additional details..."
            />
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-300">
            <input
              type="checkbox"
              checked={form.isBreakGlass}
              onChange={e => setForm(f => ({ ...f, isBreakGlass: e.target.checked }))}
              className="rounded border-slate-600"
            />
            Break Glass (Emergency override - auto-approved)
          </label>
          <button
            onClick={handleCreate}
            disabled={submitting || !form.action || !form.reason}
            className="w-full px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-600 text-white rounded text-sm"
          >
            {submitting ? 'Creating...' : 'Create Change Request'}
          </button>
        </div>
      )}

      <div className="flex gap-2">
        {['all', 'pending', 'approved', 'rejected', 'emergency'].map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-1 text-xs rounded border capitalize ${
              filter === f
                ? 'bg-blue-600 border-blue-600 text-white'
                : 'bg-slate-800 border-slate-700 text-slate-400 hover:border-slate-600'
            }`}
          >
            {f}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="text-slate-400 text-sm">Loading...</p>
      ) : requests.length === 0 ? (
        <div className="bg-slate-800 border border-slate-700 rounded-lg p-6 text-center">
          <p className="text-slate-400">No change requests</p>
        </div>
      ) : (
        <div className="space-y-2">
          {requests.map((req) => (
            <div key={req.id} className="bg-slate-800 border border-slate-700 rounded-lg p-4">
              <div className="flex items-start justify-between mb-2">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`px-2 py-0.5 text-xs rounded border capitalize ${getStatusColor(req.status)}`}>
                      {req.status}
                    </span>
                    <span className="text-sm font-semibold text-white">{req.action}</span>
                  </div>
                  <p className="text-xs text-slate-400">
                    by {req.userName} on {new Date(req.createdAt).toLocaleString()}
                  </p>
                </div>
              </div>
              <p className="text-sm text-slate-300 mb-1">{req.reason}</p>
              {req.details && <p className="text-xs text-slate-500 mb-2">{req.details}</p>}
              {req.isBreakGlass && (
                <p className="text-xs text-purple-400 mb-2">Break Glass emergency override</p>
              )}

              {req.status === 'pending' && (
                <div className="flex gap-2 mt-2">
                  <button
                    onClick={() => handleApprove(req.id)}
                    className="px-3 py-1 text-xs bg-green-600 hover:bg-green-700 text-white rounded"
                  >
                    Approve
                  </button>
                  {rejectingId === req.id ? (
                    <div className="flex gap-2 flex-1">
                      <input
                        value={rejectReason}
                        onChange={e => setRejectReason(e.target.value)}
                        className="flex-1 px-2 py-1 text-xs bg-slate-700 border border-slate-600 rounded text-white"
                        placeholder="Reason for rejection..."
                      />
                      <button onClick={() => handleReject(req.id)} className="px-3 py-1 text-xs bg-red-600 hover:bg-red-700 text-white rounded">
                        Confirm
                      </button>
                      <button onClick={() => { setRejectingId(null); setRejectReason(''); }} className="px-3 py-1 text-xs bg-slate-600 text-white rounded">
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setRejectingId(req.id)}
                      className="px-3 py-1 text-xs bg-red-600 hover:bg-red-700 text-white rounded"
                    >
                      Reject
                    </button>
                  )}
                </div>
              )}

              {req.reviewerName && (
                <p className="text-xs text-slate-500 mt-2">
                  Reviewed by {req.reviewerName}{req.reviewedAt ? ` at ${new Date(req.reviewedAt).toLocaleString()}` : ''}
                  {req.rejectReason && ` - Reason: ${req.rejectReason}`}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
