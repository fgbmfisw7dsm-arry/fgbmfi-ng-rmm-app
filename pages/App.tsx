
import React, { useState, useEffect } from 'react';
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { supabase, isSupabaseConfigured } from './services/supabaseClient';
import { User } from './types';
import { AppContext } from './context/AppContext';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ConfigurationError } from './components/ConfigurationError';
import Layout from './components/Layout';

// Modules
import LoginPage from './pages/LoginPage';
import AdminDashboard from './pages/AdminDashboard';
import ReportsPage from './pages/ReportsPage';
import FinancialsPage from './pages/FinancialsPage';
import CheckInPage from './pages/CheckInPage';
import NewDelegatePage from './pages/NewDelegatePage';
import MasterListModule from './pages/MasterListModule';
import EventsModule from './pages/EventsModule';
import UsersModule from './pages/UsersModule';
import ImportModule from './pages/ImportModule';
import SetupModule from './pages/SetupModule';
import DataModule from './pages/DataModule';

const AppContent = () => {
  const [user, setUser] = useState<User | null>(null);
  const [activeEventId, setActiveEventId] = useState<string>(() => localStorage.getItem('fgbmfi_active_event_id') || '');
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (activeEventId) localStorage.setItem('fgbmfi_active_event_id', activeEventId);
    else localStorage.removeItem('fgbmfi_active_event_id');
  }, [activeEventId]);

  const logout = async () => {
    setUser(null);
    setIsLoading(false);
    try {
      await supabase.auth.signOut();
      localStorage.clear();
      window.location.hash = "/login";
    } catch (e) {
      console.warn("Signout failed:", e);
    }
  };

  useEffect(() => {
    let mounted = true;
    
    // Watchdog: If auth takes more than 3s, drop to fallback/login
    const watchdog = setTimeout(() => {
      if (mounted && isLoading) {
        console.warn("Auth watchdog: System taking too long. Dropping loader.");
        setIsLoading(false);
      }
    }, 3000);

    const initAuth = async () => {
      try {
        if (!isSupabaseConfigured) {
          if (mounted) setIsLoading(false);
          return;
        }
        
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.user && mounted) {
           const { data: appUser } = await supabase
            .from('app_users')
            .select('*')
            .eq('id', session.user.id)
            .single();
           
           if (appUser && mounted) {
             setUser(appUser as User);
           }
        }
      } catch (err) {
        console.error("Auth init error:", err);
      } finally {
        if (mounted) {
          setIsLoading(false);
          clearTimeout(watchdog);
        }
      }
    };

    initAuth();
    
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
        if (!mounted) return;
        if (event === 'SIGNED_OUT') {
          setUser(null);
          setIsLoading(false);
        } else if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
          if (session?.user) {
             const { data: appUser } = await supabase.from('app_users').select('*').eq('id', session.user.id).single();
             if (appUser && mounted) setUser(appUser as User);
             setIsLoading(false);
          }
        }
    });

    return () => { 
      mounted = false;
      clearTimeout(watchdog);
      subscription.unsubscribe(); 
    };
  }, []);

  if (!isSupabaseConfigured) return <ConfigurationError />;
  
  if (isLoading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 p-6">
        <div className="w-16 h-16 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mb-6"></div>
        <div className="text-center space-y-4">
            <p className="text-blue-900 font-black uppercase tracking-widest text-sm">System Secure Link</p>
            <p className="text-gray-400 text-[10px] font-bold uppercase tracking-widest">Verifying Connection...</p>
            <button onClick={logout} className="px-4 py-2 bg-gray-200 text-gray-500 rounded-lg text-[10px] font-black uppercase tracking-widest hover:bg-red-50 hover:text-red-600 transition-colors">Force Clear Session</button>
        </div>
      </div>
    );
  }

  return (
    <AppContext.Provider value={{ user, activeEventId, login: setUser, logout, onEventChange: setActiveEventId }}>
      <HashRouter>
        <Routes>
          {!user ? (
            <>
              <Route path="/login" element={<LoginPage />} />
              <Route path="*" element={<Navigate to="/login" replace />} />
            </>
          ) : (
            <Route path="*" element={
              <Layout user={user} onLogout={logout} activeEventId={activeEventId} onEventChange={setActiveEventId}>
                 <Routes>
                    <Route path="/admin" element={<AdminDashboard />} />
                    <Route path="/admin/reports" element={<ReportsPage />} />
                    <Route path="/admin/financials" element={<FinancialsPage />} />
                    <Route path="/checkin" element={<CheckInPage />} />
                    <Route path="/register-new" element={<NewDelegatePage />} />
                    <Route path="/admin/delegates" element={<MasterListModule />} />
                    <Route path="/admin/events" element={<EventsModule />} />
                    <Route path="/admin/users" element={<UsersModule />} />
                    <Route path="/admin/import" element={<ImportModule />} />
                    <Route path="/admin/setup" element={<SetupModule />} />
                    <Route path="/admin/data" element={<DataModule />} />
                    <Route path="/" element={<Navigate to="/admin" replace />} />
                 </Routes>
              </Layout>
            } />
          )}
        </Routes>
      </HashRouter>
    </AppContext.Provider>
  );
};

const App = () => (
  <ErrorBoundary>
    <AppContent />
  </ErrorBoundary>
);

export default App;
