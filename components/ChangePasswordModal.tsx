import React, { useState, useEffect, useRef } from 'react';
import { auth } from '../services/supabaseService';

interface ChangePasswordModalProps {
  onClose: () => void;
}

const ChangePasswordModal: React.FC<ChangePasswordModalProps> = ({ onClose }) => {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const currentRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    currentRef.current?.focus();
  }, []);

  const handleBackdrop = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') onClose();
  };

  const handleSubmit = async () => {
    setError(null);
    if (!currentPassword) {
      setError('Please enter your current password.');
      return;
    }
    if (!newPassword || newPassword.length < 6) {
      setError('New password must be at least 6 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('New password and confirmation do not match.');
      return;
    }
    if (newPassword === currentPassword) {
      setError('New password must be different from your current password.');
      return;
    }

    setSaving(true);
    try {
      await auth.changePassword(currentPassword, newPassword);
      setSuccess(true);
    } catch (e: any) {
      setError(e?.message || 'Password change failed. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4 no-print"
      onMouseDown={handleBackdrop}
      onKeyDown={handleKeyDown}
    >
      <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl border border-gray-100 overflow-hidden animate-in zoom-in-95 duration-200">
        <div className="px-6 py-5 border-b border-gray-100 flex items-center justify-between">
          <div>
            <h3 className="font-black text-blue-900 uppercase text-sm tracking-widest">Change Password</h3>
            <p className="text-[9px] font-bold text-gray-400 uppercase tracking-widest mt-0.5">Update your login credentials</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors p-1" title="Close">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>

        <div className="px-6 py-5 space-y-4">
          {success ? (
            <div className="text-center py-6 space-y-4">
              <div className="w-14 h-14 mx-auto bg-green-100 rounded-full flex items-center justify-center">
                <svg className="w-7 h-7 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>
              </div>
              <div>
                <p className="font-black text-green-700 uppercase text-xs tracking-widest">Password Updated</p>
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mt-1">Use your new password the next time you sign in.</p>
              </div>
              <button
                onClick={onClose}
                className="w-full py-4 bg-green-600 text-white rounded-2xl font-black uppercase text-xs tracking-widest shadow-xl shadow-green-100 hover:bg-green-700 transition-all active:scale-[0.98]"
              >
                Done
              </button>
            </div>
          ) : (
            <>
              {error && (
                <div className="p-4 rounded-xl text-[10px] font-black uppercase tracking-tight border bg-red-50 border-red-100 text-red-600">
                  {error}
                </div>
              )}

              <div className="space-y-1">
                <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Current Password</label>
                <input
                  ref={currentRef}
                  type="password"
                  className="w-full p-4 border-2 border-gray-100 rounded-2xl bg-gray-50 font-bold focus:ring-4 focus:ring-blue-500/10 focus:bg-white focus:border-blue-500 outline-none disabled:opacity-50 transition-all"
                  placeholder="Enter current password"
                  value={currentPassword}
                  onChange={e => setCurrentPassword(e.target.value)}
                  disabled={saving}
                />
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest">New Password</label>
                <input
                  type="password"
                  className="w-full p-4 border-2 border-gray-100 rounded-2xl bg-gray-50 font-bold focus:ring-4 focus:ring-blue-500/10 focus:bg-white focus:border-blue-500 outline-none disabled:opacity-50 transition-all"
                  placeholder="At least 6 characters"
                  value={newPassword}
                  onChange={e => setNewPassword(e.target.value)}
                  disabled={saving}
                />
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Confirm New Password</label>
                <input
                  type="password"
                  className="w-full p-4 border-2 border-gray-100 rounded-2xl bg-gray-50 font-bold focus:ring-4 focus:ring-blue-500/10 focus:bg-white focus:border-blue-500 outline-none disabled:opacity-50 transition-all"
                  placeholder="Re-enter new password"
                  value={confirmPassword}
                  onChange={e => setConfirmPassword(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') handleSubmit(); }}
                  disabled={saving}
                />
              </div>

              <div className="flex flex-col gap-3 pt-2">
                <button
                  onClick={handleSubmit}
                  disabled={saving}
                  className="w-full py-4 bg-blue-600 text-white rounded-2xl font-black uppercase text-xs tracking-widest shadow-xl shadow-blue-100 hover:bg-blue-700 transition-all active:scale-[0.98] disabled:opacity-50"
                >
                  {saving ? 'Updating...' : 'Update Password'}
                </button>
                <button
                  onClick={onClose}
                  disabled={saving}
                  className="w-full py-3 bg-gray-100 text-gray-600 rounded-2xl font-black uppercase text-xs disabled:opacity-50 transition-all"
                >
                  Cancel
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default ChangePasswordModal;
