
import React, { useState } from 'react';
import { db } from '../services/supabaseService';

const ImportModule = () => {
    const [csv, setCsv] = useState('');
    const [loading, setLoading] = useState(false);
    const [feedback, setFeedback] = useState<{type: 'success' | 'error', msg: string, count?: number} | null>(null);

    const handleImport = async () => {
        if (!csv.trim()) {
            setFeedback({ type: 'error', msg: 'Please paste CSV data before attempting import.' });
            return;
        }

        setLoading(true);
        setFeedback(null);

        try {
            // Processing import through the service
            const count = await db.importDelegates(csv);
            
            if (count > 0) {
                setFeedback({ 
                    type: 'success', 
                    msg: 'Import Successful!', 
                    count: count 
                });
                setCsv(''); // Clear the text area on success
            } else {
                setFeedback({ 
                    type: 'error', 
                    msg: 'Import failed. No valid records found. Please check your format.' 
                });
            }
        } catch (e: any) {
            console.error("Import error:", e);
            setFeedback({ type: 'error', msg: `System Error: ${e.message || 'Unknown error during processing'}` });
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="max-w-4xl mx-auto space-y-6 pb-20">
            <div className="bg-white p-8 rounded-[2rem] shadow-xl border border-gray-100">
                <div className="mb-8 flex justify-between items-start">
                    <div>
                        <h2 className="text-2xl font-black text-blue-900 uppercase tracking-tighter">Bulk Delegate Import</h2>
                        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mt-1">Upload multiple records to the Regional Master List</p>
                    </div>
                    {loading && (
                        <div className="flex items-center gap-2 text-blue-600">
                            <div className="w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
                            <span className="text-[10px] font-black uppercase tracking-widest">Processing...</span>
                        </div>
                    )}
                </div>

                {/* --- FIELD ORDER INSTRUCTIONS --- */}
                <div className="bg-slate-900 p-6 rounded-2xl mb-8 border-b-4 border-blue-600 shadow-lg">
                    <h4 className="text-[10px] font-black text-blue-400 uppercase tracking-[0.2em] mb-4">Required CSV Field Order (9 Columns):</h4>
                    <div className="grid grid-cols-3 md:grid-cols-5 gap-2">
                        {['Title', 'First Name', 'Last Name', 'District', 'Chapter', 'Phone', 'Email', 'Rank', 'Office'].map((field, idx) => (
                            <div key={field} className="bg-white/10 p-2 rounded-lg border border-white/5 text-center">
                                <span className="text-[9px] font-black text-blue-300 block opacity-50">{idx + 1}</span>
                                <span className="text-[10px] font-bold text-white uppercase truncate">{field}</span>
                            </div>
                        ))}
                    </div>
                    <div className="mt-6 pt-4 border-t border-white/5">
                        <p className="text-[9px] font-black text-gray-500 uppercase tracking-tighter mb-2">Sample Data Row (Do not include headers):</p>
                        <div className="bg-black/40 p-3 rounded-xl font-mono text-[10px] text-blue-200 break-all select-all">
                            Mr, John, Doe, Lagos Central, Ikeja Chapter, 08012345678, john@email.com, CP, OTHER
                        </div>
                    </div>
                </div>

                {/* --- SUCCESS / ERROR FEEDBACK --- */}
                {feedback && (
                    <div className={`p-6 mb-6 rounded-2xl border-2 animate-in zoom-in duration-300 flex items-center justify-between ${
                        feedback.type === 'success' 
                            ? 'bg-green-50 border-green-200 text-green-800' 
                            : 'bg-red-50 border-red-200 text-red-800'
                    }`}>
                        <div className="flex items-center gap-4">
                            <div className={`w-12 h-12 rounded-full flex items-center justify-center text-xl ${
                                feedback.type === 'success' ? 'bg-green-100' : 'bg-red-100'
                            }`}>
                                {feedback.type === 'success' ? '✅' : '⚠️'}
                            </div>
                            <div>
                                <p className="font-black uppercase text-sm tracking-widest">{feedback.msg}</p>
                                {feedback.count && (
                                    <p className="text-[10px] font-bold opacity-75 uppercase mt-1">
                                        Successfully imported {feedback.count} delegate records.
                                    </p>
                                )}
                            </div>
                        </div>
                        <button onClick={() => setFeedback(null)} className="text-[10px] font-black uppercase opacity-50 hover:opacity-100 px-4 py-2">Dismiss</button>
                    </div>
                )}

                <div className="space-y-4">
                    <div className="flex justify-between items-end px-2">
                        <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Paste CSV Records</label>
                        <span className="text-[9px] font-bold text-gray-300 uppercase">Comma-Separated Values Only</span>
                    </div>
                    
                    <textarea 
                        className="w-full h-80 p-6 border-2 border-gray-100 rounded-[2rem] font-mono text-xs bg-gray-50 focus:bg-white focus:ring-4 focus:ring-blue-500/10 outline-none transition-all resize-none shadow-inner" 
                        value={csv} 
                        onChange={e => setCsv(e.target.value)} 
                        placeholder="Title, FirstName, LastName, District, Chapter, Phone, Email, Rank, Office..."
                    />
                    
                    <button 
                        onClick={handleImport} 
                        disabled={loading || !csv.trim()}
                        className="w-full py-5 bg-blue-900 hover:bg-slate-800 text-white font-black rounded-2xl shadow-2xl transition-all disabled:opacity-50 uppercase tracking-[0.2em] text-sm mt-4 transform active:scale-95"
                    >
                        {loading ? 'ANALYZING RECORDS...' : 'PROCEED WITH BULK IMPORT'}
                    </button>
                </div>
            </div>

            <div className="bg-slate-50 p-6 rounded-2xl border border-dashed border-slate-200 text-center">
                <p className="text-[9px] font-bold text-gray-400 uppercase tracking-widest leading-relaxed max-w-2xl mx-auto">
                    Note: The system performs an intelligent data cleanse during import. It will automatically strip extra spaces and validate name fields. Ensure each record is on a new line.
                </p>
            </div>
        </div>
    );
};

export default ImportModule;
