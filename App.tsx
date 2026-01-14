
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { supabase, isSupabaseConfigured } from './services/supabaseClient';
import { User } from './types';
import { AppContext } from './context/AppContext';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ConfigurationError } from './components/ConfigurationError';
import Layout from './components/Layout';
import { auth } from './services/supabaseService';

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
import UserManualModule from './pages/UserManualModule';

const AppContent = () => {
  const [user, setUser] = useState<User | null>(null);
  const [activeEventId, setActiveEventId] = useState<string>(() => localStorage.getItem('fgbmfi_active_event_id') || '');
  const [isLoading, setIsLoading] = useState(true);
  
  // Use a ref to track current user ID for comparison during auth state changes
  const userIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (activeEventId) localStorage.setItem('fgbmfi_active_event_id', activeEventId);
    else localStorage.removeItem('fgbmfi_active_event_id');
  }, [activeEventId]);

  const logout = useCallback(async () => {
    userIdRef.current = null;
    setUser(null);
    setIsLoading(false);
    try {
      await supabase.auth.signOut();
      localStorage.clear();
      window.location.hash = "/login";
    } catch (e) {
      console.warn("Signout failed:", e);
      localStorage.clear();
      window.location.reload();
    }
  }, []);

  const refreshSession = useCallback(async () => {
    try {
      const { data: { session }, error } = await supabase.auth.getSession();
      if (error || !session) {
        if (userIdRef.current) await logout();
        return;
      }
    } catch (e) {
      console.warn("Heartbeat refresh failed:", e);
    }
  }, [logout]);

  useEffect(() => {
    let mounted = true;
    
    const watchdog = setTimeout(() => {
      if (mounted && isLoading) {
        console.warn("Auth Performance Watchdog: State resolution forced.");
        setIsLoading(false);
      }
    }, 4000);

    const initAuth = async () => {
      try {
        if (!isSupabaseConfigured) {
          if (mounted) setIsLoading(false);
          return;
        }
        
        const { data: { session }, error: sessionError } = await supabase.auth.getSession();
        
        if (sessionError) {
          console.error("Session corruption detected:", sessionError);
          await logout();
          return;
        }

        if (session?.user && mounted) {
           // Use repair logic to ensure profile exists
           const appUser = await auth.getOrCreateProfile(session.user.id, session.user.email || '');
           if (appUser && mounted) {
             userIdRef.current = appUser.id;
             setUser(appUser as User);
           }
        }
      } catch (err) {
        console.error("Critical Auth Boot failure:", err);
      } finally {
        if (mounted) {
          setIsLoading(false);
          clearTimeout(watchdog);
        }
      }
    };

    initAuth();
    
    const heartbeat = setInterval(refreshSession, 60000);

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        refreshSession();
      }
    };
    window.addEventListener('visibilitychange', handleVisibility);

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
        if (!mounted) return;
        
        console.log(`Auth Transition: ${event}`);

        if (event === 'SIGNED_OUT') {
          userIdRef.current = null;
          setUser(null);
          setIsLoading(false);
        } 
        else if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'INITIAL_SESSION') {
          if (session?.user) {
             // Only update if the user is different or profile is missing to avoid loops
             if (userIdRef.current !== session.user.id) {
                try {
                  const appUser = await auth.getOrCreateProfile(session.user.id, session.user.email || '');
                  if (appUser && mounted) {
                    userIdRef.current = appUser.id;
                    setUser(appUser as User);
                  }
                } catch (e) {
                  console.error("Auth profile fetch error:", e);
                }
             }
             setIsLoading(false);
          }
        }
    });

    return () => { 
      mounted = false;
      clearTimeout(watchdog);
      clearInterval(heartbeat);
      window.removeEventListener('visibilitychange', handleVisibility);
      subscription.unsubscribe(); 
    };
  }, [logout, refreshSession]);

  if (!isSupabaseConfigured) return <ConfigurationError />;
  
  if (isLoading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 p-6">
        <div className="w-16 h-16 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mb-6"></div>
        <div className="text-center space-y-4">
            <p className="text-blue-900 font-black uppercase tracking-widest text-sm">System Secure Link</p>
            <p className="text-gray-400 text-[10px] font-bold uppercase tracking-widest animate-pulse">Establishing Handshake...</p>
            <button 
              onClick={() => { 
                localStorage.clear(); 
                sessionStorage.clear(); 
                window.location.href = window.location.origin + window.location.pathname; 
              }} 
              className="mt-4 px-6 py-3 bg-red-50 text-red-600 rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-red-100 transition-all shadow-sm border border-red-100"
            >
              Reset Stuck Session
            </button>
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
                    <Route path="/help" element={<UserManualModule />} />
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
