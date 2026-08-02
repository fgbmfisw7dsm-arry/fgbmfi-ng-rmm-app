
import React, { useState, useContext, useMemo, useRef } from 'react';
import { db } from '../services/supabaseService';
import { AppContext } from '../context/AppContext';
import { isAdminRole } from '../types';

const ImportModule = () => {
    const { activeEventId, activeEvent, user } = useContext(AppContext);
    const isAdmin = isAdminRole((user?.role || '').toLowerCase());

    if (!isAdmin) {
        return (
            <div className="min-h-screen bg-gray-100 flex items-center justify-center p-8">
                <div className="bg-white p-10 rounded-2xl shadow-xl border border-red-100 max-w-md w-full text-center space-y-4">
                    <div className="w-16 h-16 mx-auto bg-red-100 rounded-full flex items-center justify-center">
                        <svg className="w-8 h-8 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m0 0v2m0-2h2m-2 0H10m9.364-7.364A9 9 0 1112 3a9 9 0 017.364 4.636z" /></svg>
                    </div>
                    <h2 className="text-2xl font-black text-red-900 uppercase tracking-tight">Access Denied</h2>
                    <p className="text-sm font-bold text-gray-500 uppercase tracking-wider">This feature is restricted to administrators only.</p>
                    <a href="#/admin" className="inline-block mt-4 px-6 py-3 bg-blue-600 text-white rounded-xl font-black uppercase text-xs tracking-widest hover:bg-blue-700 transition-all">Return to Dashboard</a>
                </div>
            </div>
        );
    }
    const [csv, setCsv] = useState('');
    const [loading, setLoading] = useState(false);
    const [progress, setProgress] = useState<{ current: number; total: number } | null>(null);
    const [feedback, setFeedback] = useState<{type: 'success' | 'error', msg: string, inserted?: number, skipped?: number} | null>(null);
    const [fileName, setFileName] = useState('');
    const [showMapping, setShowMapping] = useState(false);
    const [detectedColumns, setDetectedColumns] = useState<string[]>([]);
    const [columnMap, setColumnMap] = useState<Record<string, boolean>>({});

    const KNOWN_FIELDS: Record<string, string> = {
      'title': 'Title', 'title.': 'Title', 'honorific': 'Title', 'prefix': 'Title', 'mr': 'Title',
      'first_name': 'First Name', 'first name': 'First Name', 'firstname': 'First Name', 'given name': 'First Name', 'name': 'First Name',
      'last_name': 'Last Name', 'last name': 'Last Name', 'lastname': 'Last Name', 'surname': 'Last Name', 'family name': 'Last Name',
      'district': 'District', 'zone': 'District', 'region': 'District',
      'chapter': 'Chapter', 'branch': 'Chapter', 'unit': 'Chapter',
      'phone': 'Phone', 'phone number': 'Phone', 'mobile': 'Phone', 'telephone': 'Phone', 'tel': 'Phone', 'cell': 'Phone', 'contact': 'Phone',
      'email': 'Email', 'email address': 'Email', 'e-mail': 'Email', 'mail': 'Email',
      'rank': 'Rank', 'level': 'Rank', 'grade': 'Rank',
      'office': 'Office', 'position': 'Office', 'role': 'Office', 'post': 'Office',
      'delegate_type': 'DelegateType', 'delegate type': 'DelegateType', 'delegatetype': 'DelegateType', 'type': 'DelegateType', 'category': 'DelegateType',
    };

    const eventConfig = (activeEvent?.event_config || {}) as Record<string, boolean>;
    const showRank = eventConfig.show_rank !== false;
    const showOffice = eventConfig.show_office !== false;
    const showDelegateType = eventConfig.show_delegate_type !== false;

    const parseHeaders = (headerLine: string): string[] => {
      return headerLine.split(',').map(h => h.trim().replace(/^["']|["']$/g, '')).filter(h => h.length > 0);
    };

    const matchColumns = (headers: string[]) => {
      const map: Record<string, boolean> = {};
      headers.forEach(h => {
        const key = h.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
        const matched = KNOWN_FIELDS[key] || null;
        map[h] = !!matched;
      });
      if (!showRank) {
        const rankCol = headers.find(h => KNOWN_FIELDS[h.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim()] === 'Rank');
        if (rankCol) map[rankCol] = false;
      }
      if (!showOffice) {
        const officeCol = headers.find(h => KNOWN_FIELDS[h.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim()] === 'Office');
        if (officeCol) map[officeCol] = false;
      }
      if (!showDelegateType) {
        const dtCol = headers.find(h => KNOWN_FIELDS[h.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim()] === 'DelegateType');
        if (dtCol) map[dtCol] = false;
      }
      return map;
    };

    const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      setFileName(file.name);
      const reader = new FileReader();
      reader.onload = (ev) => {
        const text = ev.target?.result as string;
        setCsv(text);
        const lines = text.trim().split('\n');
        if (lines.length > 1) {
          const headers = parseHeaders(lines[0]);
          if (headers.length > 1) {
            setDetectedColumns(headers);
            const map = matchColumns(headers);
            setColumnMap(map);
            setShowMapping(true);
          } else {
            setShowMapping(false);
          }
        }
        setFeedback(null);
      };
      reader.readAsText(file);
    };

    const toggleColumn = (col: string) => {
      setColumnMap(prev => ({ ...prev, [col]: !prev[col] }));
    };

    const buildFieldOrder = (): string[] => {
      const fieldOrder = ['Title', 'First Name', 'Last Name', 'District', 'Chapter', 'Phone', 'Email', 'Rank', 'Office', 'DelegateType'];
      if (!showRank) {
        const idx = fieldOrder.indexOf('Rank');
        if (idx !== -1) fieldOrder.splice(idx, 1);
      }
      if (!showOffice) {
        const idx = fieldOrder.indexOf('Office');
        if (idx !== -1) fieldOrder.splice(idx, 1);
      }
      if (!showDelegateType) {
        const idx = fieldOrder.indexOf('DelegateType');
        if (idx !== -1) fieldOrder.splice(idx, 1);
      }
      return fieldOrder;
    };

    const getColumnIndex = (headers: string[], fieldName: string): number => {
      const key = fieldName.toLowerCase();
      for (let i = 0; i < headers.length; i++) {
        const hKey = headers[i].toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
        if (KNOWN_FIELDS[hKey] === fieldName || hKey === key) return i;
      }
      return -1;
    };

    const mappedCsvData = React.useMemo(() => {
      if (!showMapping || detectedColumns.length === 0 || !csv.trim()) return csv;
      const lines = csv.trim().split('\n');
      if (lines.length < 2) return csv;
      const headers = parseHeaders(lines[0]);
      const fieldOrder = buildFieldOrder();
      const colIndices: number[] = [];
      for (const field of fieldOrder) {
        const idx = getColumnIndex(headers, field);
        colIndices.push(idx);
      }
      const remaining = colIndices.every(i => i >= 0);
      if (!remaining) {
        const activeColumns = headers.filter((h, i) => columnMap[h] !== false);
        const resultLines = [activeColumns.join(',')];
        for (let i = 1; i < lines.length; i++) {
          const values = lines[i].split(',').map(v => v.trim().replace(/^["']|["']$/g, ''));
          const selected = headers.map((h, idx) => ({ h, idx })).filter(({ h }) => columnMap[h] !== false);
          const row = selected.map(({ idx }) => values[idx] || '').join(',');
          if (row.trim()) resultLines.push(row);
        }
        return resultLines.join('\n');
      }
      const resultLines: string[] = [];
      for (let i = 1; i < lines.length; i++) {
        const values = lines[i].split(',').map(v => v.trim().replace(/^["']|["']$/g, ''));
        const row = colIndices.map(idx => idx >= 0 ? (values[idx] || '') : '').join(',');
        if (row.trim().replace(/,/g, '')) resultLines.push(row);
      }
      return resultLines.join('\n');
    }, [csv, showMapping, detectedColumns, columnMap]);

    const handleImport = async () => {
        const dataToImport = mappedCsvData;
        if (!dataToImport.trim()) {
            setFeedback({ type: 'error', msg: 'Please upload a CSV file or paste CSV data before attempting import.' });
            return;
        }

        setLoading(true);
        setProgress({ current: 0, total: dataToImport.trim().split('\n').length });
        setFeedback(null);

        try {
            const result = await db.importDelegates(dataToImport, activeEventId, (inserted, skipped, total) => {
                setProgress({ current: inserted + skipped, total });
            });
            
            if (result.inserted > 0 || result.skipped > 0) {
                setFeedback({ 
                    type: 'success', 
                    msg: 'Import Complete!', 
                    inserted: result.inserted,
                    skipped: result.skipped
                });
                setProgress(null);
                setCsv('');
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
            setProgress(null);
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
                        <div className="flex flex-col items-end gap-2">
                            <div className="flex items-center gap-2 text-blue-600">
                                <div className="w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
                                <span className="text-[10px] font-black uppercase tracking-widest">
                                    {progress ? `Processing ${progress.current}/${progress.total}` : 'Processing...'}
                                </span>
                            </div>
                            {progress && progress.total > 0 && (
                                <div className="w-48 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                                    <div 
                                        className="h-full bg-blue-600 rounded-full transition-all duration-300"
                                        style={{ width: `${(progress.current / progress.total) * 100}%` }}
                                    />
                                </div>
                            )}
                        </div>
                    )}
                </div>

                {/* --- FIELD ORDER INSTRUCTIONS --- */}
                <div className="bg-slate-900 p-6 rounded-2xl mb-8 border-b-4 border-blue-600 shadow-lg">
                    <h4 className="text-[10px] font-black text-blue-400 uppercase tracking-[0.2em] mb-4">CSV Field Order ({buildFieldOrder().length} Columns):</h4>
                    <div className="grid grid-cols-3 md:grid-cols-5 gap-2">
                        {buildFieldOrder().map((field, idx) => (
                            <div key={field} className="bg-white/10 p-2 rounded-lg border border-white/5 text-center">
                                <span className="text-[9px] font-black text-blue-300 block opacity-50">{idx + 1}</span>
                                <span className="text-[10px] font-bold text-white uppercase truncate">{field}</span>
                            </div>
                        ))}
                    </div>
                    <div className="mt-6 pt-4 border-t border-white/5">
                        <p className="text-[9px] font-black text-gray-500 uppercase tracking-tighter mb-2">Sample Data Row (Do not include headers):</p>
                        <div className="bg-black/40 p-3 rounded-xl font-mono text-[10px] text-blue-200 break-all select-all">
                            Mr, John, Doe, Lagos Central, Ikeja Chapter, 08012345678, john@email.com{showRank ? ', CP' : ''}{showOffice ? ', OTHER' : ''}{showDelegateType ? ', Member' : ''}
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
                                {feedback.inserted !== undefined && (
                                    <div className="mt-1 space-y-0.5">
                                        <p className="text-[10px] font-bold text-green-700 uppercase">
                                            ✅ {feedback.inserted} records imported
                                        </p>
                                        {feedback.skipped !== undefined && feedback.skipped > 0 && (
                                            <p className="text-[10px] font-bold text-amber-600 uppercase">
                                                ⏭️ {feedback.skipped} duplicates skipped
                                            </p>
                                        )}
                                    </div>
                                )}
                            </div>
                        </div>
                        <button onClick={() => setFeedback(null)} className="text-[10px] font-black uppercase opacity-50 hover:opacity-100 px-4 py-2">Dismiss</button>
                    </div>
                )}

                <div className="space-y-4">
                    <div className="flex justify-between items-end px-2">
                        <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Upload or Paste CSV</label>
                        <span className="text-[9px] font-bold text-gray-300 uppercase">Comma-Separated Values</span>
                    </div>

                    {/* --- FILE UPLOAD --- */}
                    <div className="flex items-center gap-3">
                        <label className="flex-1 cursor-pointer bg-gradient-to-r from-blue-50 to-slate-50 border-2 border-dashed border-blue-200 hover:border-blue-400 rounded-2xl p-4 text-center transition-all">
                            <input type="file" accept=".csv,.txt" onChange={handleFileUpload} className="hidden" />
                            <div className="flex items-center justify-center gap-2">
                                <svg className="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" /></svg>
                                <span className="text-[11px] font-black text-blue-700 uppercase tracking-wider">
                                    {fileName ? fileName : 'Upload CSV File'}
                                </span>
                            </div>
                        </label>
                        {csv && (
                            <button
                                onClick={() => { setCsv(''); setFileName(''); setShowMapping(false); setDetectedColumns([]); setColumnMap({}); setFeedback(null); }}
                                className="px-4 py-4 bg-red-50 hover:bg-red-100 text-red-600 font-black rounded-2xl text-[10px] uppercase tracking-wider transition-all"
                            >
                                Clear
                            </button>
                        )}
                    </div>

                    {/* --- COLUMN MAPPING UI --- */}
                    {showMapping && detectedColumns.length > 0 && (
                        <div className="bg-amber-50 p-4 rounded-2xl border border-amber-200 animate-in slide-in-from-top-2">
                            <div className="flex justify-between items-center mb-3">
                                <h4 className="text-[10px] font-black text-amber-800 uppercase tracking-wider">CSV Columns Detected</h4>
                                <span className="text-[8px] font-bold text-amber-500 uppercase">Toggle to include/exclude</span>
                            </div>
                            <div className="flex flex-wrap gap-2 mb-3">
                                {detectedColumns.map(col => {
                                    const matched = KNOWN_FIELDS[col.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim()];
                                    return (
                                        <button
                                            key={col}
                                            onClick={() => toggleColumn(col)}
                                            className={`px-3 py-2 rounded-xl text-[10px] font-bold uppercase tracking-wide border-2 transition-all ${
                                                columnMap[col] !== false
                                                    ? 'bg-blue-600 border-blue-600 text-white shadow-md'
                                                    : 'bg-white border-gray-200 text-gray-400 hover:border-gray-300'
                                            }`}>
                                            {col}{matched ? ` → ${matched}` : ''}
                                        </button>
                                    );
                                })}
                            </div>
                            <p className="text-[8px] font-bold text-amber-600 uppercase">
                                Only checked columns will be imported. {!showRank && 'Rank is hidden per event config. '}{!showOffice && 'Office is hidden per event config. '}{!showDelegateType && 'DelegateType is hidden per event config. '}
                            </p>
                        </div>
                    )}

                    <textarea 
                        className="w-full h-64 p-6 border-2 border-gray-100 rounded-[2rem] font-mono text-xs bg-gray-50 focus:bg-white focus:ring-4 focus:ring-blue-500/10 outline-none transition-all resize-none shadow-inner" 
                        value={csv} 
                        onChange={e => {
                            setCsv(e.target.value);
                            const lines = e.target.value.trim().split('\n');
                            if (lines.length > 1) {
                                const headers = parseHeaders(lines[0]);
                                if (headers.length > 1 && headers.some(h => KNOWN_FIELDS[h.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim()])) {
                                    if (detectedColumns.length === 0) {
                                        setDetectedColumns(headers);
                                        const map = matchColumns(headers);
                                        setColumnMap(map);
                                    }
                                    setShowMapping(true);
                                }
                            }
                        }} 
                        placeholder="Title, FirstName, LastName, District, Chapter, Phone, Email, Rank, Office, DelegateType..."
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
