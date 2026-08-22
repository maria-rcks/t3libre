import { useState, useEffect } from 'react';
import { setup2FA, verify2FASetup, disable2FA, get2FABackupCodes } from '../lib/auth';
import { apiClient } from '../lib/api';
import { BrandButton } from './BrandButton';

type State = 'initial' | 'loading' | 'setup' | 'verify_backup' | 'enabled';

export const TwoFactorSetup = () => {
  const [state, setState] = useState<State>('loading');
  const [secret, setSecret] = useState('');
  const [uri, setUri] = useState('');
  const [qrUrl, setQrUrl] = useState('');
  const [verifyCode, setVerifyCode] = useState('');
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [disablePassword, setDisablePassword] = useState('');
  const [error, setError] = useState('');
  const [userId, setUserId] = useState('');

  useEffect(() => {
    const load = async () => {
      try {
        const user = await apiClient.getUser();
        setUserId(user.id);
        setState('initial');
      } catch {
        setState('initial');
      }
    };
    load();
  }, []);

  const handleStartSetup = async () => {
    setError('');
    try {
      const result = await setup2FA(userId);
      setSecret(result.secret);
      setUri(result.uri);
      setQrUrl(result.qr_code_url);
      setState('setup');
    } catch (e: any) {
      setError(e.message);
    }
  };

  const handleVerifySetup = async () => {
    setError('');
    if (verifyCode.length !== 6) {
      setError('Please enter a 6-digit code');
      return;
    }
    try {
      const ok = await verify2FASetup(userId, verifyCode);
      if (ok) {
        const codes = await get2FABackupCodes(userId);
        setBackupCodes(codes);
        setState('verify_backup');
      } else {
        setError('Invalid code. Please try again.');
      }
    } catch (e: any) {
      setError(e.message);
    }
  };

  const handleFinishSetup = () => {
    setState('enabled');
  };

  const handleDisable = async () => {
    setError('');
    if (!disablePassword) {
      setError('Please enter your password');
      return;
    }
    try {
      const ok = await disable2FA(userId, disablePassword);
      if (ok) {
        setState('initial');
        setDisablePassword('');
        setSecret('');
        setUri('');
        setQrUrl('');
        setVerifyCode('');
        setBackupCodes([]);
      } else {
        setError('Failed to disable 2FA');
      }
    } catch (e: any) {
      setError(e.message);
    }
  };

  const handleCopyCodes = () => {
    navigator.clipboard.writeText(backupCodes.join('\n'));
  };

  const handleDownloadCodes = () => {
    const blob = new Blob([backupCodes.join('\n')], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'infrapilot-backup-codes.txt';
    a.click();
    URL.revokeObjectURL(url);
  };

  if (state === 'loading') {
    return (
      <div className="bg-slate-800 border border-slate-700 rounded-lg p-6">
        <p className="text-slate-400">Loading...</p>
      </div>
    );
  }

  return (
    <div className="bg-slate-800 border border-slate-700 rounded-lg p-6">
      <h2 className="text-lg font-semibold text-white mb-4">Two-Factor Authentication</h2>

      {error && (
        <div className="mb-4 p-3 bg-red-900/30 border border-red-800 rounded text-sm text-red-400">
          {error}
        </div>
      )}

      {state === 'initial' && (
        <div>
          <p className="text-sm text-slate-400 mb-4">
            Add an extra layer of security to your account by enabling two-factor authentication.
          </p>
          <BrandButton label="Enable Two-Factor Authentication" onClick={handleStartSetup} />
        </div>
      )}

      {state === 'setup' && (
        <div className="space-y-4">
          <p className="text-sm text-slate-400">
            Scan the QR code with your authenticator app (e.g. Google Authenticator, Authy) or enter the setup key manually.
          </p>

          <div className="flex justify-center">
            <img src={qrUrl} alt="TOTP QR Code" className="rounded-lg" />
          </div>

          <div className="bg-slate-900 rounded p-3">
            <p className="text-xs text-slate-500 mb-1">Manual Setup Key:</p>
            <p className="text-sm text-white font-mono select-all break-all">{secret}</p>
          </div>

          <div>
            <label className="block text-sm text-slate-400 mb-1">Verification Code</label>
            <input
              type="text"
              value={verifyCode}
              onChange={(e) => setVerifyCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder="000000"
              maxLength={6}
              className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-sm text-white outline-none focus:border-blue-500 text-center tracking-widest font-mono"
            />
          </div>

          <BrandButton label="Verify & Enable" onClick={handleVerifySetup} disabled={verifyCode.length !== 6} />
        </div>
      )}

      {state === 'verify_backup' && (
        <div className="space-y-4">
          <div className="p-3 bg-yellow-900/30 border border-yellow-800 rounded">
            <p className="text-sm text-yellow-400 font-medium mb-1">Save these backup codes!</p>
            <p className="text-xs text-yellow-500">
              Each code can only be used once. Store them in a secure location.
              If you lose your authenticator device, these codes are the only way to regain access.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-2">
            {backupCodes.map((code, i) => (
              <div key={i} className="bg-slate-900 rounded p-2 text-center">
                <span className="text-sm text-white font-mono">{code}</span>
              </div>
            ))}
          </div>

          <div className="flex gap-2">
            <button
              onClick={handleCopyCodes}
              className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white text-sm rounded transition-colors"
            >
              Copy Codes
            </button>
            <button
              onClick={handleDownloadCodes}
              className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white text-sm rounded transition-colors"
            >
              Download
            </button>
          </div>

          <BrandButton label="I've Saved My Codes - Finish" onClick={handleFinishSetup} />
        </div>
      )}

      {state === 'enabled' && (
        <div className="space-y-4">
          <div className="flex items-center gap-2 text-green-400">
            <span className="text-lg">✓</span>
            <span className="text-sm font-medium">Two-factor authentication is active</span>
          </div>

          <div>
            <label className="block text-sm text-slate-400 mb-1">Confirm password to disable</label>
            <input
              type="password"
              value={disablePassword}
              onChange={(e) => setDisablePassword(e.target.value)}
              placeholder="Enter your password"
              className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-sm text-white outline-none focus:border-blue-500"
            />
          </div>

          <button
            onClick={handleDisable}
            disabled={!disablePassword}
            className="px-4 py-2 bg-red-600 hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium rounded transition-colors"
          >
            Disable 2FA
          </button>
        </div>
      )}
    </div>
  );
};

export default TwoFactorSetup;
