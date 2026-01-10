
import React, { useState, useContext, useEffect } from 'react';
import { auth } from '../services/supabaseService';
import { supabase } from '../services/supabaseClient';
import { AppContext } from '../context/AppContext';
import { FGBMFILogo } from '../components/Logos';

const LoginPage = () => {
  const { login } = useContext(AppContext);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setError('');
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    
    setLoading(true);
    setError('');

    try {
      const user = await auth.login(email, password);
      if (user) {
        login(user);
      } else {
        setError('Verification rejected: Invalid credentials.');
      }
    } catch (e: any) {
      console.error("Login component caught error:", e);
      const msg = e.message || 'System error. Check your connection.';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleDeepReset = () => {
    if (window.confirm("This will clear all system connection data and refresh the login page for a clean start. Proceed?")) {
      // 1. Immediately clear storage to guarantee it happens even if network/auth hangs
      localStorage.clear();
      sessionStorage.clear();

      try {
        // 2. Fire and forget local signout (no await to prevent hanging the reload logic)
        supabase.auth.signOut({ scope: 'local' });
      } catch (e) {
        console.warn("Local signout failed during reset:", e);
      }

      // 3. Force a hard reload to the root URL (base origin) to reset the entire JS memory state
      window.location.href = window.location.origin + window.location.pathname;
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="bg-white p-8 rounded-[2.5rem] shadow-2xl w-full max-w-md border border-gray-100 animate-in fade-in zoom-in duration-500">
        <div className="flex justify-center mb-8"><FGBMFILogo className="h-28 w-28" /></div>
        <div className="text-center mb-10">
          <h1 className="text-xl font-black text-gray-900 leading-tight text-center">FGBMFI Nigeria</h1>
          <p className="text-sm font-bold text-blue-600 uppercase tracking-tight mt-1">Regional Events Management System</p>
        </div>
        
        {error && (
            <div className="p-5 rounded-2xl mb-6 text-xs font-bold border text-center leading-relaxed bg-red-50 text-red-600 border-red-100 animate-in slide-in-from-top-2">
                <span>{error}</span>
            </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
              <label className="text-[10px] font-black text-gray-400 uppercase ml-2 mb-1 block tracking-widest">System Username</label>
              <input 
                type="text" 
                required 
                className="w-full px-5 py-4 bg-gray-50 border-2 border-gray-50 rounded-2xl focus:ring-4 focus:ring-blue-500/10 focus:bg-white focus:border-blue-500 outline-none transition-all font-bold" 
                value={email} 
                onChange={e => setEmail(e.target.value)} 
                placeholder="Enter Username" 
                autoFocus
                disabled={loading}
              />
          </div>
          <div className="relative">
              <label className="text-[10px] font-black text-gray-400 uppercase ml-2 mb-1 block tracking-widest">Security Password</label>
              <input 
                type={showPassword ? "text" : "password"} 
                required 
                className="w-full px-5 py-4 bg-gray-50 border-2 border-gray-50 rounded-2xl focus:ring-4 focus:ring-blue-500/10 focus:bg-white focus:border-blue-500 outline-none transition-all pr-14 font-bold" 
                value={password} 
                onChange={e => setPassword(e.target.value)} 
                placeholder="••••••••" 
                disabled={loading}
              />
              <button 
                type="button" 
                onClick={() => setShowPassword(!showPassword)} 
                className="absolute bottom-4 right-5 text-[10px] font-black text-blue-600 hover:text-blue-800 transition-colors"
              >
                  {showPassword ? "HIDE" : "SHOW"}
              </button>
          </div>
          <button 
            type="submit" 
            disabled={loading} 
            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-black py-5 rounded-2xl transition-all shadow-xl shadow-blue-100 disabled:bg-gray-200 disabled:text-gray-400 uppercase tracking-[0.2em] text-xs mt-4 transform active:scale-[0.98]"
          >
              {loading ? (
                <div className="flex items-center justify-center gap-3">
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                  <span>Verifying...</span>
                </div>
              ) : 'Sign In To System'}
          </button>
        </form>

        <div className="mt-8 flex flex-col items-center gap-4">
            <button 
              type="button" 
              onClick={handleDeepReset}
              className="text-[10px] font-black text-gray-400 hover:text-blue-600 uppercase tracking-widest transition-colors flex items-center gap-2 bg-gray-50 px-4 py-2 rounded-full border border-gray-100"
            >
              <span>Reset Connection</span>
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
            </button>
        </div>
        
        <div className="mt-10 pt-6 border-t border-gray-100 text-center">
            <p className="text-[10px] text-gray-300 font-bold uppercase tracking-[0.2em] leading-loose">Full Gospel Business Men's Fellowship International</p>
        </div>
      </div>
    </div>
  );
};

export default LoginPage;
