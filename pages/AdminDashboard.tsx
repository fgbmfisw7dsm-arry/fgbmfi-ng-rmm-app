
import React, { useState, useEffect, useContext } from 'react';
import { db } from '../services/supabaseService';
import { supabase } from '../services/supabaseClient';
import { UserRole, DashboardStats } from '../types';
import { AppContext } from '../context/AppContext';
import StatCard from '../components/StatCard';
import { formatCurrency } from '../services/utils';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';

const AdminDashboard = () => {
  const { activeEventId, user } = useContext(AppContext);
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchStats = () => {
    if (activeEventId) {
        // SCoping Logic: FINANCE and ADMIN get Regional (unscoped) view.
        // REGISTRAR gets district-scoped view.
        const districtFilter = (user?.role === UserRole.REGISTRAR && user.district && user.district.trim() !== "") 
            ? user.district.trim() 
            : undefined;
            
        db.getStats(activeEventId, districtFilter)
          .then(setStats)
          .catch(err => console.error("Stats fetch error", err))
          .finally(() => setLoading(false));
    }
  };

  useEffect(() => {
    fetchStats();
    const sub = supabase.channel('dashboard_sync').on('postgres_changes', { event: '*', table: 'checkins' }, () => fetchStats()).subscribe();
    return () => { sub.unsubscribe(); };
  }, [activeEventId, user]);

  if (loading && !stats) return <div className="p-8 text-center text-gray-500 font-bold animate-pulse">Loading Regional Analytics...</div>;
  if (!activeEventId || !stats) return <div className="p-8 text-center text-gray-500 font-bold uppercase tracking-widest opacity-50">Select Event to view Regional Dashboard</div>;

  const rankData = stats.checkInsByRank ? Object.entries(stats.checkInsByRank).map(([name, value]) => ({ name, value })) : [];
  const districtData = stats.checkInsByDistrict ? Object.entries(stats.checkInsByDistrict).map(([name, value]) => ({ name, value })).sort((a, b) => a.name.localeCompare(b.name)) : [];
  const COLORS = ['#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899', '#6366F1'];
  const percentage = stats.totalDelegates > 0 ? Math.round((stats.totalCheckIns / stats.totalDelegates) * 100) : 0;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <StatCard title="Total Delegates" value={stats.totalDelegates || 0} color="blue" />
        <StatCard title="Total Event Entry" value={`${stats.totalCheckIns || 0} (${percentage}%)`} color="green" />
        <StatCard title="Total Financials" value={formatCurrency(stats.totalFinancials || 0)} color="purple" />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white p-6 rounded-2xl shadow-sm border h-96">
          <h3 className="font-black mb-4 text-gray-400 uppercase text-[10px] tracking-widest border-b pb-2">Attendance by Rank</h3>
          {rankData.length > 0 ? (
            <ResponsiveContainer width="100%" height="90%"><PieChart><Pie data={rankData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label>{rankData.map((_, i) => <Cell key={`cell-${i}`} fill={COLORS[i % COLORS.length]} />)}</Pie><Tooltip /></PieChart></ResponsiveContainer>
          ) : <div className="h-full flex items-center justify-center text-gray-400 text-xs">Waiting for records...</div>}
        </div>
        <div className="bg-white p-6 rounded-2xl shadow-sm border h-96">
          <h3 className="font-black mb-4 text-gray-400 uppercase text-[10px] tracking-widest border-b pb-2">Attendance by District</h3>
          {districtData.length > 0 ? (
            <ResponsiveContainer width="100%" height="90%"><BarChart data={districtData}><XAxis dataKey="name" tick={{fontSize: 9}} angle={-45} textAnchor="end" height={60} /><YAxis /><Tooltip /><Bar dataKey="value" fill="#3B82F6" radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer>
          ) : <div className="h-full flex items-center justify-center text-gray-400 text-xs">Waiting for records...</div>}
        </div>
      </div>
      <div className="bg-white p-8 rounded-2xl shadow-sm border">
        <div className="flex justify-between items-center mb-6 border-b pb-2">
            <h3 className="font-black text-gray-400 uppercase text-[10px] tracking-widest">Live Attendance Feed</h3>
            <span className="text-[9px] font-bold text-blue-600 uppercase tracking-widest">Recent Activity Only</span>
        </div>
        <div className="overflow-x-auto w-full">
            <table className="w-full text-sm text-left min-w-[700px]">
              <thead>
                <tr className="border-b bg-gray-50 text-gray-400 font-black uppercase text-[10px]">
                    <th className="p-4">Date & Time</th>
                    <th className="p-4">Delegate Name</th>
                    <th className="p-4">Office</th>
                    <th className="p-4">Rank</th>
                    <th className="p-4">District</th>
                    <th className="p-4">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {stats.recentActivity && stats.recentActivity.length > 0 ? stats.recentActivity.map((c, i) => (
                  <tr key={i} className="hover:bg-gray-50 transition-colors animate-in slide-in-from-bottom-2 duration-300">
                    <td className="p-4 text-gray-400 text-[10px] font-black uppercase leading-tight">
                        <span className="block">{c.checked_in_at ? new Date(c.checked_in_at).toLocaleDateString([], {day:'2-digit', month:'short'}) : '-'}</span>
                        <span className="text-blue-600 font-bold">{c.checked_in_at ? new Date(c.checked_in_at).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit', hour12: true}) : ''}</span>
                    </td>
                    <td className="p-4 font-black text-blue-900 uppercase text-xs">{c.delegate_name}</td>
                    <td className="p-4 font-black text-blue-700 uppercase text-[10px]">{c.office || '-'}</td>
                    <td className="p-4 font-black text-blue-700 uppercase text-[10px]">{c.rank || '-'}</td>
                    <td className="p-4 text-gray-500 font-black text-[10px] uppercase">{c.district}</td>
                    <td className="p-4">
                        <span className={`px-3 py-1 rounded-full font-black uppercase text-[8px] tracking-tighter ${c.session_id ? 'bg-blue-100 text-blue-600' : 'bg-green-100 text-green-600'}`}>
                            {c.session_id ? 'Session Entry' : 'Master Arrival'}
                        </span>
                    </td>
                  </tr>
                )) : <tr><td colSpan={6} className="p-10 text-center text-gray-400 uppercase font-black tracking-widest text-xs">Waiting for activity...</td></tr>}
              </tbody>
            </table>
        </div>
      </div>
    </div>
  );
};

export default AdminDashboard;
