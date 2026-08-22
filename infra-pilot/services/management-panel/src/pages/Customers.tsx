import React, { useEffect, useState } from 'react';
import { apiClient } from '../lib/api';
import { Customer } from '../lib/types';
import { useConfig } from '../lib/types';
import { toast } from 'sonner';
// Lightweight modal UI implemented inline (no extra dependency)

export const Customers = () => {
  const { mode } = useConfig();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [editing, setEditing] = useState<{ id: string; name: string; email?: string } | null>(null);
  const [showModal, setShowModal] = useState(false);

  useEffect(() => {
    if (mode === 'business') {
      loadCustomers();
    } else {
      setLoading(false);
    }
  }, [mode]);

  const loadCustomers = async () => {
    try {
      const data = await apiClient.getCustomers();
      setCustomers(data);
    } catch {
      // ignore errors in MVP UI
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name) return;
    try {
      const c = await apiClient.createCustomer({ name, email } as Partial<Customer>);
      setCustomers((prev) => [c, ...prev]);
      setName('');
      setEmail('');
      toast.success('Customer created');
    } catch {
      toast.error('Failed to create customer');
    }
  };

  if (mode === 'personal') {
    return <div className="p-4 border rounded-md border-red-300 bg-red-50 text-red-800">Not available in Personal Mode</div>;
  }

  const openEditModal = (c: Customer) => {
    setEditing({ id: c.id, name: c.name, email: c.email });
    setShowModal(true);
  };

  const [seedModalOpen, setSeedModalOpen] = useState(false);
  const [seedInProgress, setSeedInProgress] = useState(false);
  // Feature flag: enable Seed Demo only in environments where it's intended
  const DEMO_FEATURE_ENABLED = (() => {
    try {
      return (import.meta && (import.meta as any).env && (import.meta as any).env.VITE_DEMO_FEATURE_ENABLED === 'true');
    } catch {
      return false;
    }
  })();

  const handleSeedDemo = async () => {
    try {
      setSeedInProgress(true);
      const res = await apiClient.seedDemo();
      const seededCustomers = res?.customersSeeded ?? 0;
      const seededApps = res?.appsSeeded ?? 0;
      toast.success(`Seeded ${seededCustomers} customers and ${seededApps} apps`);
      // Refresh the list to show new data
      await loadCustomers();
    } catch {
      toast.error('Seed Demo failed');
    } finally {
      setSeedInProgress(false);
      setSeedModalOpen(false);
    }
  };

  const handleEditSubmit = async () => {
    if (!editing?.id) return;
    try {
      const { id, name, email } = editing;
      await apiClient.updateCustomer(id, { name, email });
      setCustomers((arr) => arr.map((x) => (x.id === id ? { ...x, name, email } : x)));
      setShowModal(false);
      setEditing(null);
      toast.success('Customer updated');
    } catch {
      toast.error('Failed to update customer');
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('Delete this customer?')) return;
    try {
      await apiClient.deleteCustomer(id);
      setCustomers((arr) => arr.filter((c) => c.id !== id));
      toast.success('Customer deleted');
    } catch {
      toast.error('Failed to delete customer');
    }
  };

  // Modal for editing
  const EditModal = () => {
    if (!showModal || !editing) return null;
    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
        <div className="bg-white rounded-lg shadow-lg w-1/3 p-6">
          <h3 className="text-lg font-semibold mb-4">Edit Customer</h3>
          <div className="grid gap-2 mb-4">
            <input className="border rounded px-2 py-1" value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
            <input className="border rounded px-2 py-1" value={editing.email ?? ''} onChange={(e) => setEditing({ ...editing, email: e.target.value })} />
          </div>
          <div className="flex justify-end gap-2">
            <button className="px-4 py-2 border rounded" onClick={() => { setShowModal(false); setEditing(null); }}>Cancel</button>
            <button className="px-4 py-2 bg-blue-600 text-white rounded" onClick={handleEditSubmit}>Save</button>
          </div>
        </div>
      </div>
    );
  };

  // End of modal helpers
  return (
    <section>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-bold">Customers</h1>
          <span className="text-sm px-3 py-1 rounded bg-blue-100 text-blue-700">Business Mode</span>
          <span className={`text-xs px-2 py-1 rounded ${DEMO_FEATURE_ENABLED ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-700'}`}>
            {DEMO_FEATURE_ENABLED ? 'Demo: On' : 'Demo: Off'}
          </span>
        </div>
        {DEMO_FEATURE_ENABLED && (
          <button onClick={() => setSeedModalOpen(true)} className="ml-4 px-4 py-2 bg-green-600 text-white rounded" title="Seed demo data">
            Seed Demo
          </button>
        )}
      </div>
      {seedModalOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 z-40 flex items-center justify-center">
          <div className="bg-white rounded-lg shadow-lg w-96 p-6">
            <h3 className="text-lg font-semibold mb-2">Seed Demo Data</h3>
            <p className="text-sm text-slate-700 mb-4">
              This will seed sample customers and apps for a quick local demo. This action is safe and idempotent for demos.
            </p>
            <div className="flex justify-end gap-2">
              <button className="px-4 py-2 border rounded" onClick={() => setSeedModalOpen(false)} disabled={seedInProgress}>
                Cancel
              </button>
              <button
                className="px-4 py-2 bg-green-600 text-white rounded"
                onClick={handleSeedDemo}
                disabled={seedInProgress}
              >
                {seedInProgress ? 'Seeding...' : 'Seed Demo'}
              </button>
            </div>
          </div>
        </div>
      )}
      <form onSubmit={handleCreate} className="flex gap-2 mb-4" aria-label="Create customer">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" className="border rounded p-2" />
        <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" className="border rounded p-2" />
      <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded">Add</button>
      </form>
      {loading ? (
        <p>Loading customers...</p>
      ) : (
        <table className="min-w-full bg-white shadow rounded overflow-hidden">
          <thead>
            <tr>
              <th className="px-4 py-2 text-left">Name</th>
              <th className="px-4 py-2 text-left">Email</th>
              <th className="px-4 py-2 text-left">Created</th>
              <th className="px-4 py-2 text-left">Actions</th>
            </tr>
          </thead>
          <tbody>
            {customers.map((c) => (
              <tr key={c.id} className="hover:bg-gray-50">
                <td className="border px-4 py-2">{c.name}</td>
                <td className="border px-4 py-2">{c.email ?? ''}</td>
                <td className="border px-4 py-2">{new Date(c.created_at ?? '').toLocaleDateString()}</td>
                <td className="border px-4 py-2">
                  <button className="text-blue-600 hover:underline mr-2" onClick={() => openEditModal(c)}>
                    Edit
                  </button>
                  <button className="text-red-600 hover:underline" onClick={() => handleDelete(c.id)}>
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {/** Edit modal */}
      <EditModal />
    </section>
  );
};

export default Customers;
