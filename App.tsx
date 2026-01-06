import React, { useState, useEffect } from 'react';
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { supabase, isSupabaseConfigured } from './services/supabaseClient';
import { User, UserRole } from './types';
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

  // Sync event ID to localStorage
  useEffect(() => {
    if (activeEventId) localStorage.setItem('fgbmfi_active_event_id', activeEventId);
    else localStorage.removeItem('fgbmfi_active_event_id');
  }, [activeEventId]);

  useEffect(() => {
    let mounted = true;

    // PRODUCTION HARDENING: 10-second Safety watchdog
    // Optimized for Niger/Nigeria low-bandwidth 3G/4G stability
    const safetyTimeout = setTimeout(() => {
      if (mounted && isLoading) {
        console.warn("Network Latency Warning: Safety Watchdog activated.");
        setIsLoading(false);
      }
    }, 10000);

    const initAuth = async () => {
      try {
        if (!isSupabaseConfigured) {
          if (mounted) setIsLoading(false);
          return;
        }
        
        const { data: { session } } = await supabase.auth.getSession();

        if (session?.user && mounted) {
           const { data: appUser, error: userError } = await supabase
            .from('app_users')
            .select('*')
            .eq('id', session.user.id)
            .single();
           
           if (!userError && appUser && mounted) {
             setUser(appUser as User);
           } else if (mounted) {
             // Basic session recovery if profile retrieval is slow
             setUser({
               id: session.user.id,
               email: session.user.email || '',
               role: UserRole.ADMIN
             });
           }
        }
      } catch (err) {
        console.error("Auth init failure:", err);
      } finally {
        if (mounted) {
          setIsLoading(false);
          clearTimeout(safetyTimeout);
        }
      }
    };

    initAuth();
    
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
        if (!mounted) return;
        
        if (event === 'SIGNED_OUT') { 
          setUser(null); 
        } 
        else if (event === 'SIGNED_IN' || event === 'USER_UPDATED' || event === 'TOKEN_REFRESHED') {
          if (session?.user) {
             try {
                const { data: appUser } = await supabase.from('app_users').select('*').eq('id', session.user.id).single();
                if (appUser && mounted) {
                    setUser(appUser as User);
                }
             } catch (e) {
                console.warn("Real-time profile sync pending...");
             }
          }
        }
    });

    return () => { 
      mounted = false;
      clearTimeout(safetyTimeout);
      subscription.unsubscribe(); 
    };
  }, []);

  const login = (u: User) => setUser(u);
  const logout = async () => { 
    setUser(null);
    try { 
      await supabase.auth.signOut();
      localStorage.clear();
      window.location.hash = "/login";
    } catch (e) {}
  };

  if (!isSupabaseConfigured) return <ConfigurationError />;
  
  if (isLoading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 p-6">
        <div className="w-16 h-16 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mb-6"></div>
        <div className="text-center">
            <p className="text-blue-900 font-black uppercase tracking-widest text-sm">System Secure Link</p>
            <p className="text-gray-400 text-[10px] font-bold uppercase mt-2 animate-pulse tracking-[0.2em]">Establishing Data Connection...</p>
        </div>
      </div>
    );
  }

  return (
    <AppContext.Provider value={{ user, activeEventId, login, logout, onEventChange: setActiveEventId }}>
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