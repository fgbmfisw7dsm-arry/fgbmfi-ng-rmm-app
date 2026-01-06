
import React, { useState, useContext } from 'react';
import { auth } from '../services/supabaseService';
import { AppContext } from '../context/AppContext';
import { FGBMFILogo } from '../components/Logos';

const LoginPage = () => {
  const { login } = useContext(AppContext);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const user = await auth.login(email, password);
      if (user) {
        login(user);
      } else {
        setError('Invalid username or password.');
      }
    } catch (e: any) {
      console.error("Login component caught error:", e);
      setError(e.message || 'System error. Please check your connection.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="bg-white p-8 rounded-2xl shadow-xl w-full max-w-md border border-gray-100">
        <div className="flex justify-center mb-8"><FGBMFILogo className="h-28 w-28" /></div>
        <div className="text-center mb-10">
          <h1 className="text-xl font-black text-gray-900 leading-tight text-center">FGBMFI Nigeria</h1>
          <p className="text-sm font-bold text-blue-600 uppercase tracking-tight mt-1">Regional Events Management System</p>
        </div>
        
        {error && (
            <div className={`p-4 rounded-xl mb-6 text-xs font-bold border text-center leading-relaxed animate-in fade-in ${
              error.includes('Database Access') || error.includes('Schema') ? 'bg-orange-50 text-orange-800 border-orange-200' : 'bg-red-50 text-red-600 border-red-100'
            }`}>
                <div className="flex flex-col gap-2">
                    <span>{error}</span>
                    {(error.includes('Database Access') || error.includes('Schema')) && (
                      <div className="mt-2 pt-2 border-t border-orange-200 text-[9px] text-orange-600 space-y-1">
                        <p>1. Open Supabase SQL Editor</p>
                        <p>2. Paste and Run the 'Step 1 SQL Fix'</p>
                        <p>3. Verify your API Key in services/supabaseClient.ts</p>
                      </div>
                    )}
                </div>
            </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
              <label className="text-[10px] font-black text-gray-400 uppercase ml-1 mb-1 block">Username</label>
              <input 
                type="text" 
                required 
                className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:bg-white outline-none transition-all" 
                value={email} 
                onChange={e => setEmail(e.target.value)} 
                placeholder="Enter username" 
                autoFocus
              />
          </div>
          <div className="relative">
              <label className="text-[10px] font-black text-gray-400 uppercase ml-1 mb-1 block">Password</label>
              <input 
                type={showPassword ? "text" : "password"} 
                required 
                className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:bg-white outline-none transition-all pr-12" 
                value={password} 
                onChange={e => setPassword(e.target.value)} 
                placeholder="••••••••" 
              />
              <button 
                type="button" 
                onClick={() => setShowPassword(!showPassword)} 
                className="absolute bottom-3.5 right-4 text-[10px] font-black text-blue-600 hover:text-blue-800"
              >
                  {showPassword ? "HIDE" : "SHOW"}
              </button>
          </div>
          <button 
            type="submit" 
            disabled={loading} 
            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-black py-4 rounded-xl transition-all shadow-xl shadow-blue-100 disabled:opacity-50 uppercase tracking-widest text-sm mt-4"
          >
              {loading ? 'AUTHENTICATING...' : 'Sign In'}
          </button>
        </form>
        
        <div className="mt-8 pt-6 border-t border-gray-100 text-center">
            <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest">Production Ready • v3.0.0</p>
        </div>
      </div>
    </div>
  );
};

export default LoginPage;
