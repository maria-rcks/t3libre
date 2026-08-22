import { useState, useEffect } from 'react';
import { apiClient } from '../lib/api';
import type { BillingInfo, Transaction, BillingRates, CostEstimate } from '../lib/types';

const PRESET_AMOUNTS = [5, 10, 25, 50, 100];

export const BillingDashboard = () => {
  const [billingInfo, setBillingInfo] = useState<BillingInfo | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [rates, setRates] = useState<BillingRates | null>(null);
  const [customAmount, setCustomAmount] = useState('');
  const [topupStatus, setTopupStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [cpuCores, setCpuCores] = useState(2);
  const [ramGb, setRamGb] = useState(4);
  const [storageGb, setStorageGb] = useState(50);
  const [costEstimate, setCostEstimate] = useState<CostEstimate | null>(null);

  useEffect(() => {
    loadBillingData();
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (cpuCores > 0 && ramGb > 0 && storageGb > 0) {
        apiClient.getCostEstimate(cpuCores, ramGb, storageGb).then(setCostEstimate);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [cpuCores, ramGb, storageGb]);

  const loadBillingData = async () => {
    try {
      const [info, txns, billingRates] = await Promise.all([
        apiClient.getBalance(),
        apiClient.getTransactions(),
        apiClient.getBillingRates(),
      ]);
      setBillingInfo(info);
      setTransactions(txns);
      setRates(billingRates);
    } catch (err) {
      console.error('Failed to load billing data:', err);
    }
  };

  const handleTopUp = async (amount: number) => {
    setTopupStatus('loading');
    try {
      const result = await apiClient.topUp(amount);
      setBillingInfo(result);
      setTopupStatus('success');
      const txns = await apiClient.getTransactions();
      setTransactions(txns);
      setTimeout(() => setTopupStatus('idle'), 2000);
    } catch (err) {
      setTopupStatus('error');
      setTimeout(() => setTopupStatus('idle'), 2000);
    }
  };

  const handleCustomTopUp = () => {
    const amount = parseFloat(customAmount);
    if (isNaN(amount) || amount <= 0) return;
    handleTopUp(amount);
    setCustomAmount('');
  };

  const getBalanceColor = (balance: number) => {
    if (balance < 1) return 'text-red-400';
    if (balance < 10) return 'text-yellow-400';
    return 'text-green-400';
  };

  if (!billingInfo) {
    return (
      <div className="bg-slate-800 border border-slate-700 rounded-lg p-6">
        <p className="text-slate-400">Loading billing data...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Balance Card */}
      <div className="bg-slate-800 border border-slate-700 rounded-lg p-6">
        <h2 className="text-lg font-semibold text-white mb-2">Prepaid Balance</h2>
        <p className={`text-4xl font-bold mb-4 ${getBalanceColor(billingInfo.balance)}`}>
          ${billingInfo.balance.toFixed(2)}
        </p>
        <div className="flex gap-6 text-sm text-slate-400">
          <span>Total Spent: <strong className="text-white">${billingInfo.totalSpent.toFixed(2)}</strong></span>
          <span>Total Top-Ups: <strong className="text-white">${billingInfo.totalToppedUp.toFixed(2)}</strong></span>
        </div>
      </div>

      {/* Top-Up Section */}
      <div className="bg-slate-800 border border-slate-700 rounded-lg p-6">
        <h2 className="text-lg font-semibold text-white mb-4">Add Funds</h2>
        <div className="flex flex-wrap gap-2 mb-4">
          {PRESET_AMOUNTS.map((amount) => (
            <button
              key={amount}
              onClick={() => handleTopUp(amount)}
              disabled={topupStatus === 'loading'}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg transition-colors text-sm font-medium"
            >
              ${amount}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <input
            type="number"
            value={customAmount}
            onChange={(e) => setCustomAmount(e.target.value)}
            placeholder="Custom amount"
            min="1"
            step="0.01"
            className="w-40 px-3 py-2 bg-slate-700 border border-slate-600 rounded text-sm text-white outline-none focus:border-blue-500"
          />
          <button
            onClick={handleCustomTopUp}
            disabled={topupStatus === 'loading' || !customAmount || parseFloat(customAmount) <= 0}
            className="px-4 py-2 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white rounded-lg transition-colors text-sm font-medium"
          >
            Add Funds
          </button>
        </div>
        {topupStatus === 'success' && <p className="text-green-400 text-sm mt-2">Funds added successfully!</p>}
        {topupStatus === 'error' && <p className="text-red-400 text-sm mt-2">Failed to add funds.</p>}
      </div>

      {/* Transaction History */}
      <div className="bg-slate-800 border border-slate-700 rounded-lg p-6">
        <h2 className="text-lg font-semibold text-white mb-4">Transaction History</h2>
        {transactions.length === 0 ? (
          <p className="text-slate-400 text-sm">No transactions yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-slate-400 border-b border-slate-700">
                  <th className="text-left py-2 pr-4">Date</th>
                  <th className="text-left py-2 pr-4">Description</th>
                  <th className="text-right py-2 pr-4">Amount</th>
                  <th className="text-right py-2">Balance</th>
                </tr>
              </thead>
              <tbody>
                {transactions.slice(0, 20).map((txn) => (
                  <tr key={txn.id} className="border-b border-slate-700/50">
                    <td className="py-2 pr-4 text-slate-400 whitespace-nowrap">
                      {new Date(txn.timestamp).toLocaleDateString()}
                    </td>
                    <td className="py-2 pr-4 text-white">{txn.description}</td>
                    <td className={`py-2 pr-4 text-right font-medium ${txn.amount > 0 ? 'text-green-400' : 'text-red-400'}`}>
                      {txn.amount > 0 ? '+' : ''}${txn.amount.toFixed(2)}
                    </td>
                    <td className="py-2 text-right text-slate-300">${txn.balanceAfter.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Cost Calculator */}
      <div className="bg-slate-800 border border-slate-700 rounded-lg p-6">
        <h2 className="text-lg font-semibold text-white mb-4">Cost Calculator</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
          <div>
            <label className="block text-sm text-slate-400 mb-1">CPU Cores: {cpuCores}</label>
            <input
              type="range"
              min="1"
              max="32"
              value={cpuCores}
              onChange={(e) => setCpuCores(parseInt(e.target.value))}
              className="w-full accent-blue-500"
            />
            <input
              type="number"
              value={cpuCores}
              onChange={(e) => setCpuCores(Math.max(1, parseInt(e.target.value) || 1))}
              className="w-full px-3 py-1 mt-1 bg-slate-700 border border-slate-600 rounded text-sm text-white outline-none focus:border-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm text-slate-400 mb-1">RAM (GB): {ramGb}</label>
            <input
              type="range"
              min="1"
              max="128"
              value={ramGb}
              onChange={(e) => setRamGb(parseInt(e.target.value))}
              className="w-full accent-blue-500"
            />
            <input
              type="number"
              value={ramGb}
              onChange={(e) => setRamGb(Math.max(1, parseInt(e.target.value) || 1))}
              className="w-full px-3 py-1 mt-1 bg-slate-700 border border-slate-600 rounded text-sm text-white outline-none focus:border-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm text-slate-400 mb-1">Storage (GB): {storageGb}</label>
            <input
              type="range"
              min="10"
              max="1000"
              value={storageGb}
              onChange={(e) => setStorageGb(parseInt(e.target.value))}
              className="w-full accent-blue-500"
            />
            <input
              type="number"
              value={storageGb}
              onChange={(e) => setStorageGb(Math.max(10, parseInt(e.target.value) || 10))}
              className="w-full px-3 py-1 mt-1 bg-slate-700 border border-slate-600 rounded text-sm text-white outline-none focus:border-blue-500"
            />
          </div>
        </div>
        {costEstimate && (
          <div className="bg-slate-700/50 rounded-lg p-4 grid grid-cols-3 gap-4 text-center">
            <div>
              <p className="text-slate-400 text-xs mb-1">Hourly</p>
              <p className="text-white font-bold text-lg">${costEstimate.hourly.toFixed(4)}</p>
            </div>
            <div>
              <p className="text-slate-400 text-xs mb-1">Daily</p>
              <p className="text-white font-bold text-lg">${costEstimate.daily.toFixed(2)}</p>
            </div>
            <div>
              <p className="text-slate-400 text-xs mb-1">Monthly (30d)</p>
              <p className="text-white font-bold text-lg">${costEstimate.monthly.toFixed(2)}</p>
            </div>
          </div>
        )}
      </div>

      {/* Billing Rates */}
      {rates && (
        <div className="bg-slate-800 border border-slate-700 rounded-lg p-6">
          <h2 className="text-lg font-semibold text-white mb-4">Billing Rates</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-slate-700/50 rounded-lg p-3">
              <p className="text-slate-400 text-xs mb-1">CPU per Core/Hour</p>
              <p className="text-white font-semibold">${rates.cpuPerCoreHour.toFixed(4)}</p>
            </div>
            <div className="bg-slate-700/50 rounded-lg p-3">
              <p className="text-slate-400 text-xs mb-1">RAM per GB/Hour</p>
              <p className="text-white font-semibold">${rates.ramPerGbHour.toFixed(4)}</p>
            </div>
            <div className="bg-slate-700/50 rounded-lg p-3">
              <p className="text-slate-400 text-xs mb-1">Storage per GB/Hour</p>
              <p className="text-white font-semibold">${rates.storagePerGbHour.toFixed(4)}</p>
            </div>
            <div className="bg-slate-700/50 rounded-lg p-3">
              <p className="text-slate-400 text-xs mb-1">Backup per GB</p>
              <p className="text-white font-semibold">${rates.backupPerGb.toFixed(4)}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
