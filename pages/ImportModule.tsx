
import React, { useState, useContext, useMemo, useRef } from 'react';
import { db } from '../services/supabaseService';
import { supabase } from '../services/supabaseClient';
import { AppContext } from '../context/AppContext';
import { isAdminRole } from '../types';
import { exportToCSV } from '../services/utils';

const KNOWN_TITLES = new Set([
  'mr', 'mrs', 'ms', 'miss', 'dr', 'chief', 'pastor', 'rev', 'engr',
  'barr', 'prof', 'sir', 'lady', 'hon', 'elder', 'deacon', 'deaconess',
  'bishop', 'apostle', 'evangelist', 'ven', 'snr', 'bro', 'sis', 'prince',
  'princess', 'oba', 'alhaji', 'alhaja', 'mallam', 'hajia'
]);

function parseFullName(fullName: string): { title: string; firstName: string; lastName: string } {
  if (!fullName || !fullName.trim()) return { title: 'Mr', firstName: '', lastName: '' };
  const parts = fullName.trim().split(/\s+/);
  let titleEnd = 0;
  if (parts.length >= 2) {
    const firstWord = parts[0].toLowerCase().replace(/\.$/, '');
    const secondWord = parts[1].toLowerCase().replace(/\.$/, '');
    if (KNOWN_TITLES.has(firstWord) && KNOWN_TITLES.has(secondWord)) {
      titleEnd = 2;
    }
  }
  if (titleEnd === 0 && parts.length >= 1) {
    const firstWord = parts[0].toLowerCase().replace(/\.$/, '');
    if (KNOWN_TITLES.has(firstWord)) {
      titleEnd = 1;
    }
  }
  const title = titleEnd > 0 ? parts.slice(0, titleEnd).join(' ') : 'Mr';
  const nameParts = parts.slice(titleEnd);
  const firstName = nameParts[0] || '';
  const lastName = nameParts.slice(1).join(' ');
  return { title, firstName, lastName };
}

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
    const [feedback, setFeedback] = useState<{type: 'success' | 'error', msg: string, inserted?: number, updated?: number, skipped?: number} | null>(null);
    const [fileName, setFileName] = useState('');
    const [showMapping, setShowMapping] = useState(false);
    const [detectedColumns, setDetectedColumns] = useState<string[]>([]);
    const [columnMap, setColumnMap] = useState<Record<string, boolean>>({});
    const [scrambleAnalyses, setScrambleAnalyses] = useState<any[]>([]);
    const [scrambleSamples, setScrambleSamples] = useState<string[]>([]);
    const [scrambleTotal, setScrambleTotal] = useState(0);
    const [scrambleLoading, setScrambleLoading] = useState(false);
    const [scrambleResult, setScrambleResult] = useState<{ type: 'analyzed' | 'repaired' | 'deleted' | 'error'; count: number; msg?: string } | null>(null);
    const [scrambleShowRepairs, setScrambleShowRepairs] = useState(false);

    const KNOWN_FIELDS: Record<string, string> = {
      'regid': 'RegId', 'reg_id': 'RegId', 'registration_id': 'RegId', 'external_id': 'RegId',
      'title': 'Title', 'title.': 'Title', 'honorific': 'Title', 'prefix': 'Title', 'mr': 'Title',
      'first_name': 'First Name', 'first name': 'First Name', 'firstname': 'First Name', 'given name': 'First Name', 'name': 'First Name',
      'last_name': 'Last Name', 'last name': 'Last Name', 'lastname': 'Last Name', 'surname': 'Last Name', 'family name': 'Last Name',
      'full_name': 'Full Name', 'full name': 'Full Name', 'fullname': 'Full Name', 'complete name': 'Full Name',
      'district': 'District', 'zone': 'District', 'region': 'District', 'chaptercode': 'District', 'chapter code': 'District',
      'chapter': 'Chapter', 'branch': 'Chapter', 'unit': 'Chapter',
      'phone': 'Phone', 'phone number': 'Phone', 'mobile': 'Phone', 'telephone': 'Phone', 'tel': 'Phone', 'cell': 'Phone', 'contact': 'Phone', 'nphone': 'Phone', 'whatsapp': 'Phone', 'wha': 'Phone',
      'email': 'Email', 'email address': 'Email', 'e-mail': 'Email', 'mail': 'Email',
      'rank': 'Rank', 'level': 'Rank', 'grade': 'Rank',
      'office': 'Office', 'position': 'Office', 'role': 'Office', 'post': 'Office',
      'delegate_type': 'DelegateType', 'delegate type': 'DelegateType', 'delegatetype': 'DelegateType', 'type': 'DelegateType', 'category': 'DelegateType',
    };

    const eventConfig = (activeEvent?.event_config || {}) as Record<string, boolean>;
    const showRank = eventConfig.show_rank !== false;
    const showOffice = eventConfig.show_office !== false;
    const showDelegateType = eventConfig.show_delegate_type !== false;

    const normalizeKey = (h: string) => h.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();

    const parseHeaders = (headerLine: string): string[] => {
      return headerLine.split(',').map(h => h.trim().replace(/^["']|["']$/g, '')).filter(h => h.length > 0);
    };

    const matchColumns = (headers: string[]) => {
      const map: Record<string, boolean> = {};
      headers.forEach(h => {
        const key = normalizeKey(h);
        const matched = KNOWN_FIELDS[key] || null;
        map[h] = !!matched;
      });
      if (!showRank) {
        const rankCol = headers.find(h => KNOWN_FIELDS[normalizeKey(h)] === 'Rank');
        if (rankCol) map[rankCol] = false;
      }
      if (!showOffice) {
        const officeCol = headers.find(h => KNOWN_FIELDS[normalizeKey(h)] === 'Office');
        if (officeCol) map[officeCol] = false;
      }
      if (!showDelegateType) {
        const dtCol = headers.find(h => KNOWN_FIELDS[normalizeKey(h)] === 'DelegateType');
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

    const toggleAllColumns = (enable: boolean) => {
      setColumnMap(prev => {
        const next: Record<string, boolean> = {};
        for (const col of detectedColumns) {
          const matched = KNOWN_FIELDS[normalizeKey(col)] || null;
          const isHiddenByConfig =
            (!showRank && matched === 'Rank') ||
            (!showOffice && matched === 'Office') ||
            (!showDelegateType && matched === 'DelegateType');
          next[col] = enable ? (!!matched && !isHiddenByConfig) : false;
        }
        return next;
      });
    };

    const buildFieldOrder = (): string[] => {
      const fieldOrder = ['RegId', 'Title', 'First Name', 'Last Name', 'District', 'Chapter', 'Phone', 'Email', 'Rank', 'Office', 'DelegateType'];
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
        const hKey = normalizeKey(headers[i]);
        if (KNOWN_FIELDS[hKey] === fieldName || hKey === key) return i;
      }
      return -1;
    };

    const cleanDistrictForImport = (raw: string): string => {
      const trimmed = (raw || '').trim();
      const dashIdx = trimmed.indexOf('-');
      if (dashIdx > 0) {
        const prefix = trimmed.substring(0, dashIdx);
        const suffix = trimmed.substring(dashIdx + 1);
        if (/^\d+$/.test(suffix) && /^[A-Z]{2}\d+$/i.test(prefix)) {
          return prefix.toUpperCase();
        }
      }
      return trimmed;
    };

    const mappedCsvData = React.useMemo(() => {
      if (!showMapping || detectedColumns.length === 0 || !csv.trim()) return csv;
      const lines = csv.trim().split('\n');
      if (lines.length < 2) return csv;
      const headers = parseHeaders(lines[0]);

      const fullNameColIdx = headers.findIndex(h => KNOWN_FIELDS[normalizeKey(h)] === 'Full Name');
      const titleColIdx = getColumnIndex(headers, 'Title');
      const firstNameColIdx = getColumnIndex(headers, 'First Name');
      const lastNameColIdx = getColumnIndex(headers, 'Last Name');

      const useFullName = fullNameColIdx >= 0 && columnMap[headers[fullNameColIdx]] !== false
        && (titleColIdx < 0 || columnMap[headers[titleColIdx]] === false
         || firstNameColIdx < 0 || columnMap[headers[firstNameColIdx]] === false
         || lastNameColIdx < 0 || columnMap[headers[lastNameColIdx]] === false);

      if (useFullName) {
        const fieldOrder = buildFieldOrder();
        const resultLines: string[] = [];
        for (let i = 1; i < lines.length; i++) {
          const values = lines[i].split(',').map(v => v.trim().replace(/^["']|["']$/g, ''));
          const parsed = parseFullName(values[fullNameColIdx] || '');
          const colValues: Record<string, string> = {};
          for (const field of fieldOrder) {
            if (field === 'Title') colValues[field] = parsed.title;
            else if (field === 'First Name') colValues[field] = parsed.firstName;
            else if (field === 'Last Name') colValues[field] = parsed.lastName;
            else {
              const idx = getColumnIndex(headers, field);
              let raw = (idx >= 0 && columnMap[headers[idx]] !== false) ? (values[idx] || '') : '';
              colValues[field] = field === 'District' ? cleanDistrictForImport(raw) : raw;
            }
          }
          const row = fieldOrder.map(f => colValues[f]).join(',');
          if (row.trim().replace(/,/g, '')) resultLines.push(row);
        }
        return resultLines.join('\n');
      }

      const fieldOrder = buildFieldOrder();
      const colIndices: number[] = [];
      for (const field of fieldOrder) {
        const idx = getColumnIndex(headers, field);
        colIndices.push(idx);
      }
      const remaining = colIndices.every(i => i >= 0);
      if (!remaining) {
        const selected = headers.map((h, idx) => ({ h, idx, field: KNOWN_FIELDS[normalizeKey(h)] || null }))
          .filter(({ h }) => columnMap[h] !== false);
        const hasRegId = selected.some(s => s.field === 'RegId');
        const resultLines: string[] = [];
        const KNOWN_TITLE_VALUES = new Set([
          'mr', 'mrs', 'ms', 'miss', 'dr', 'chief', 'pastor', 'rev', 'engr',
          'barr', 'prof', 'sir', 'lady', 'hon', 'elder', 'deacon', 'deaconess',
          'bishop', 'apostle', 'evangelist', 'ven', 'snr', 'bro', 'sis', 'prince',
          'princess', 'oba', 'alhaji', 'alhaja', 'mallam', 'hajia', 'arc', 'pst',
          'esv', 'evang', 'prof.', 'dcn', 'judge', 'justice', 'dame', 'r.ady',
          'ready', 'avm', 'asc', 'pharm.', 'pharm', 'cmd', 'cmdr', 'amb.', 'amb',
          'sen', 'cp'
        ]);
        for (let i = 1; i < lines.length; i++) {
          const values = lines[i].split(',').map(v => v.trim().replace(/^["']|["']$/g, ''));
          const allEmpty = values.every(v => !v);
          if (allEmpty) continue;
          const knownMatches = selected.filter(s => {
            const val = (values[s.idx] || '').toLowerCase().replace(/\.$/, '').trim();
            return val && KNOWN_FIELDS[normalizeKey(s.h)];
          }).length;
          if (knownMatches >= 3) continue;
          const colValues: Record<string, string> = {};
          for (const s of selected) {
            const val = values[s.idx] || '';
            if (s.field === 'District') {
              colValues[s.field] = cleanDistrictForImport(val);
            } else {
              colValues[s.field || ''] = val;
            }
          }
          const fieldOrder = buildFieldOrder();
          const rowParts = fieldOrder.map(f => colValues[f] || '');
          const row = rowParts.join(',');
          if (row.trim().replace(/,/g, '')) resultLines.push(row);
        }
        return resultLines.join('\n');
      }
      const resultLines: string[] = [];
      for (let i = 1; i < lines.length; i++) {
        const values = lines[i].split(',').map(v => v.trim().replace(/^["']|["']$/g, ''));
        const rowParts = colIndices.map(idx => idx >= 0 ? (values[idx] || '') : '');
        rowParts[fieldOrder.indexOf('District')] = cleanDistrictForImport(rowParts[fieldOrder.indexOf('District')] || '');
        const row = rowParts.join(',');
        if (row.trim().replace(/,/g, '')) resultLines.push(row);
      }
      return resultLines.join('\n');
    }, [csv, showMapping, detectedColumns, columnMap]);

    const handleDownloadTemplate = () => {
      const fieldOrder = buildFieldOrder();
      const sampleRow: Record<string, string> = {
        'RegId': 'CON260806093100193667ef9e',
        'Title': 'Mr', 'First Name': 'John', 'Last Name': 'Doe',
        'District': 'Lagos Central', 'Chapter': 'Ikeja Chapter',
        'Phone': '08012345678', 'Email': 'john@email.com',
        'Rank': 'CP', 'Office': 'OTHER', 'DelegateType': 'Member'
      };
      const templateRows = [{ ...Object.fromEntries(fieldOrder.map(f => [f, sampleRow[f] || ''])) }];
      exportToCSV(templateRows, 'FGBMFI_Delegate_Import_Template.csv', fieldOrder);
    };

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
            const result = await db.importDelegates(dataToImport, activeEventId, (inserted, updated, skipped, total) => {
                setProgress({ current: inserted + updated + skipped, total });
            });

            if (result.inserted > 0 || result.updated > 0 || result.skipped > 0) {
                setFeedback({
                    type: 'success',
                    msg: 'Import Complete!',
                    inserted: result.inserted,
                    updated: result.updated,
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

    const handleScrambleAnalyze = async () => {
        if (!activeEventId) return;
        setScrambleLoading(true);
        setScrambleResult(null);
        setScrambleAnalyses([]);
        setScrambleSamples([]);
        setScrambleTotal(0);
        setScrambleShowRepairs(false);
        try {
            const result = await db.analyzeScrambledDelegates(activeEventId);
            setScrambleAnalyses(result.analyses);
            setScrambleSamples(result.samples);
            setScrambleTotal(result.totalDelegates);
            const repairable = result.analyses.filter((a: any) => a.repairable).length;
            if (result.analyses.length === 0) {
                setScrambleResult({ type: 'analyzed', count: 0, msg: 'No scrambled records found.' });
            } else if (repairable > 0) {
                setScrambleResult({ type: 'analyzed', count: result.analyses.length, msg: `${result.analyses.length} scrambled. ${repairable} auto-repairable.` });
                setScrambleShowRepairs(true);
            } else {
                setScrambleResult({ type: 'analyzed', count: result.analyses.length, msg: `${result.analyses.length} scrambled but none auto-repairable.` });
            }
        } catch (e: any) {
            console.error('Analyze error:', e);
            setScrambleResult({ type: 'error', count: 0, msg: e.message });
        } finally {
            setScrambleLoading(false);
        }
    };

    const handleScrambleRepair = async () => {
        if (!activeEventId) return;
        const repairable = scrambleAnalyses.filter((a: any) => a.repairable);
        if (repairable.length === 0) return;
        setScrambleLoading(true);
        setScrambleResult(null);
        try {
            const repairs = repairable.map((a: any) => ({ delegate_id: a.delegate_id, updates: { ...a.proposed } }));
            const { repaired, errors } = await db.applyScrambleRepairs(activeEventId, repairs);
            setScrambleResult({ type: 'repaired', count: repaired, msg: `Repaired ${repaired} records in-place` + (errors > 0 ? ` (${errors} errors).` : '.') });
            setScrambleAnalyses([]);
            setScrambleShowRepairs(false);
        } catch (e: any) {
            console.error('Repair error:', e);
            setScrambleResult({ type: 'error', count: 0, msg: e.message });
        } finally {
            setScrambleLoading(false);
        }
    };

    const handleScrambleDelete = async () => {
        if (!activeEventId || scrambleAnalyses.length === 0) return;
        setScrambleLoading(true);
        setScrambleResult(null);
        try {
            const ids = scrambleAnalyses.map((a: any) => a.delegate_id);
            await supabase.from('checkins').delete().in('delegate_id', ids);
            await supabase.from('session_responses').delete().in('delegate_id', ids);
            await supabase.from('badge_print_logs').delete().in('delegate_id', ids);
            const { error } = await supabase.from('delegates').delete().in('delegate_id', ids);
            if (error) throw error;
            setScrambleResult({ type: 'deleted', count: ids.length, msg: `Deleted ${ids.length} records. Dashboard counts auto-updated.` });
            setScrambleAnalyses([]);
            setScrambleShowRepairs(false);
        } catch (e: any) {
            console.error('Delete error:', e);
            setScrambleResult({ type: 'error', count: 0, msg: e.message });
        } finally {
            setScrambleLoading(false);
        }
    };

    const handleScrambleBackup = () => {
        if (scrambleAnalyses.length === 0) return;
        const backup = scrambleAnalyses.map((a: any) => ({
            delegate_id: a.delegate_id,
            original: { first_name: a.first_name, last_name: a.last_name, district: a.district, chapter: a.chapter, title: a.title, phone: a.phone, email: a.email },
            proposed: a.proposed,
            confidence: a.confidence,
            anomalies: a.anomalies,
        }));
        const blob = new Blob([JSON.stringify({ eventId: activeEventId, exportedAt: new Date().toISOString(), records: backup }, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = `scrambled-delegates-backup-${activeEventId?.slice(0, 8) || 'unknown'}.json`;
        a.click();
        URL.revokeObjectURL(url);
    };

    const matchedCount = detectedColumns.filter(c => columnMap[c] !== false).length;
    const knownCount = detectedColumns.filter(c => KNOWN_FIELDS[normalizeKey(c)]).length;
    const allKnownChecked = matchedCount === knownCount && matchedCount > 0;

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
                    <div className="flex justify-between items-center mb-4">
                        <h4 className="text-[10px] font-black text-blue-400 uppercase tracking-[0.2em]">CSV Field Order ({buildFieldOrder().length} Columns):</h4>
                        <button
                            onClick={handleDownloadTemplate}
                            className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-[9px] font-black uppercase tracking-wider transition-all"
                        >
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                            Download Template
                        </button>
                    </div>
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
                                {feedback.type === 'success' ? '\u2705' : '\u26A0\uFE0F'}
                            </div>
                            <div>
                                <p className="font-black uppercase text-sm tracking-widest">{feedback.msg}</p>
                                <div className="mt-1 space-y-0.5">
                                    {feedback.inserted !== undefined && feedback.inserted > 0 && (
                                        <p className="text-[10px] font-bold text-green-700 uppercase">
                                            {'\u2705'} {feedback.inserted} new records imported
                                        </p>
                                    )}
                                    {feedback.updated !== undefined && feedback.updated > 0 && (
                                        <p className="text-[10px] font-bold text-blue-600 uppercase">
                                            {'\uD83D\uDD04'} {feedback.updated} existing records updated (gaps filled)
                                        </p>
                                    )}
                                    {feedback.skipped !== undefined && feedback.skipped > 0 && (
                                        <p className="text-[10px] font-bold text-amber-600 uppercase">
                                            {'\u23ED\uFE0F'} {feedback.skipped} records skipped (already complete)
                                        </p>
                                    )}
                                </div>
                            </div>
                        </div>
                        <button onClick={() => setFeedback(null)} className="text-[10px] font-black uppercase opacity-50 hover:opacity-100 px-4 py-2">Dismiss</button>
                    </div>
                )}

                {/* --- SCRAMBLED IMPORT RECOVERY --- */}
                <div className="p-4 mb-6 rounded-2xl border-2 border-red-200 bg-red-50">
                    <div className="flex justify-between items-center mb-2">
                        <div>
                            <h4 className="text-[10px] font-black text-red-800 uppercase tracking-wider">Scrambled Import Recovery</h4>
                            <p className="text-[8px] font-bold text-red-500 uppercase mt-0.5">
                                Detects delegates with non-official districts via multi-field anomaly scoring, proposes in-place repairs, and supports backup &amp; delete.
                            </p>
                        </div>
                    </div>

                    {/* Action buttons */}
                    <div className="flex flex-wrap gap-2 mb-2">
                        <button
                            onClick={handleScrambleAnalyze}
                            disabled={scrambleLoading || !activeEventId}
                            className="px-4 py-2 bg-blue-700 hover:bg-blue-600 text-white font-black rounded-xl text-[9px] uppercase tracking-wider transition-all disabled:opacity-50"
                        >
                            {scrambleLoading && scrambleAnalyses.length === 0 ? 'ANALYZING...' : '1. Analyze'}
                        </button>
                        <button
                            onClick={handleScrambleBackup}
                            disabled={scrambleAnalyses.length === 0}
                            className="px-4 py-2 bg-amber-600 hover:bg-amber-500 text-white font-black rounded-xl text-[9px] uppercase tracking-wider transition-all disabled:opacity-50"
                            title="Download JSON backup before making changes"
                        >
                            2. Backup JSON
                        </button>
                        <button
                            onClick={handleScrambleRepair}
                            disabled={!scrambleShowRepairs || scrambleLoading}
                            className="px-4 py-2 bg-green-700 hover:bg-green-600 text-white font-black rounded-xl text-[9px] uppercase tracking-wider transition-all disabled:opacity-50"
                        >
                            {scrambleLoading && scrambleResult?.type !== 'analyzed' ? 'REPAIRING...' : '3. Repair In-Place'}
                        </button>
                        <button
                            onClick={handleScrambleDelete}
                            disabled={scrambleAnalyses.length === 0 || scrambleLoading}
                            className="px-4 py-2 bg-red-700 hover:bg-red-600 text-white font-black rounded-xl text-[9px] uppercase tracking-wider transition-all disabled:opacity-50"
                        >
                            {scrambleLoading && scrambleResult?.type !== 'analyzed' ? 'DELETING...' : 'Delete All'}
                        </button>
                    </div>

                    {/* Result feedback */}
                    {scrambleResult && (
                        <div className={`p-3 rounded-xl mb-2 ${
                            scrambleResult.type === 'analyzed' ? (scrambleResult.count > 0 ? 'bg-amber-100 border border-amber-200' : 'bg-green-100 border border-green-200') :
                            scrambleResult.type === 'repaired' ? 'bg-green-100 border border-green-200' :
                            scrambleResult.type === 'deleted' ? 'bg-green-100 border border-green-200' :
                            'bg-red-100 border border-red-200'
                        }`}>
                            <p className="text-[9px] font-black uppercase">
                                {scrambleResult.type === 'analyzed' && scrambleResult.count === 0 && 'No scrambled records detected. All districts match official list.'}
                                {scrambleResult.type === 'analyzed' && scrambleResult.count > 0 && `${scrambleResult.msg} (${scrambleTotal} total delegates scanned)`}
                                {scrambleResult.type === 'repaired' && scrambleResult.msg}
                                {scrambleResult.type === 'deleted' && scrambleResult.msg}
                                {scrambleResult.type === 'error' && `Error: ${scrambleResult.msg}`}
                            </p>
                            {scrambleResult.type === 'analyzed' && scrambleResult.count === 0 && scrambleTotal > 0 && (
                                <div className="mt-2">
                                    <p className="text-[8px] font-bold text-green-700 uppercase mb-1">District values found:</p>
                                    <div className="flex flex-wrap gap-1 max-h-24 overflow-y-auto">
                                        {scrambleSamples.slice(0, 30).map((s, i) => (
                                            <span key={i} className="px-1.5 py-0.5 bg-white rounded text-[8px] font-mono text-gray-700 border border-gray-200">{s || '(empty)'}</span>
                                        ))}
                                    </div>
                                </div>
                            )}
                            {scrambleResult.type === 'analyzed' && scrambleResult.count === 0 && scrambleTotal === 0 && (
                                <p className="text-[8px] text-green-600 mt-1">No delegates found. Check the active event selector.</p>
                            )}
                        </div>
                    )}

                    {/* Comparison table for repairable records */}
                    {scrambleShowRepairs && scrambleAnalyses.length > 0 && (
                        <div className="mt-2 max-h-80 overflow-y-auto bg-white rounded-xl border border-red-100">
                            <table className="w-full text-[8px]">
                                <thead className="sticky top-0 bg-red-100 text-red-900 uppercase font-black tracking-wider">
                                    <tr>
                                        <th className="p-1.5 text-left w-16">#</th>
                                        <th className="p-1.5 text-left">Field</th>
                                        <th className="p-1.5 text-left bg-red-50 text-red-600">Scrambled</th>
                                        <th className="p-1.5 text-left bg-green-50 text-green-700">{'→'} Repaired</th>
                                        <th className="p-1.5 text-center w-12">Conf.</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {scrambleAnalyses.filter((a: any) => a.repairable).slice(0, 100).map((a: any, i: number) => (
                                        <tr key={a.delegate_id} className="border-b border-gray-100 hover:bg-gray-50">
                                            <td className="p-1.5 font-mono text-gray-400 align-top">{i + 1}</td>
                                            <td className="p-1.5 align-top leading-relaxed">
                                                <div className="text-[7px] text-gray-400">Name</div>
                                                <div className="text-[7px] text-gray-400">District</div>
                                                <div className="text-[7px] text-gray-400">Chapter</div>
                                                <div className="text-[7px] text-gray-400">Title</div>
                                            </td>
                                            <td className="p-1.5 align-top bg-red-50/50 text-red-700 font-mono leading-relaxed">
                                                <div>{a.first_name} {a.last_name}</div>
                                                <div>{a.district || <span className="text-red-300">empty</span>}</div>
                                                <div>{a.chapter || <span className="text-red-300">empty</span>}</div>
                                                <div>{a.title || <span className="text-red-300">empty</span>}</div>
                                            </td>
                                            <td className="p-1.5 align-top bg-green-50/50 text-green-700 font-mono leading-relaxed">
                                                <div>{a.proposed.first_name} {a.proposed.last_name}</div>
                                                <div>{a.proposed.district || <span className="text-green-300">empty</span>}</div>
                                                <div>{a.proposed.chapter || <span className="text-green-300 text-[7px] italic">(manual)</span>}</div>
                                                <div>{a.proposed.title || <span className="text-green-300">empty</span>}</div>
                                            </td>
                                            <td className="p-1.5 text-center align-top">
                                                <span className={`px-1.5 py-0.5 rounded-full text-[7px] font-black ${
                                                    a.confidence >= 3 ? 'bg-red-200 text-red-800' :
                                                    a.confidence >= 2 ? 'bg-amber-200 text-amber-800' :
                                                    'bg-green-200 text-green-800'
                                                }`}>{a.confidence}</span>
                                                {a.anomalies.length > 0 && (
                                                    <div className="mt-1 text-left">
                                                        {a.anomalies.map((an: string, j: number) => (
                                                            <div key={j} className="text-[6px] text-amber-600 leading-tight">{an}</div>
                                                        ))}
                                                    </div>
                                                )}
                                            </td>
                                        </tr>
                                    ))}
                                    {scrambleAnalyses.filter((a: any) => a.repairable).length > 100 && (
                                        <tr><td colSpan={5} className="p-2 text-center text-[8px] text-gray-400">
                                            ... and {scrambleAnalyses.filter((a: any) => a.repairable).length - 100} more
                                        </td></tr>
                                    )}
                                    {scrambleAnalyses.filter((a: any) => a.repairable).length === 0 && scrambleAnalyses.length > 0 && (
                                        <tr><td colSpan={5} className="p-3 text-center text-[8px] text-amber-600 font-bold uppercase">
                                            {scrambleAnalyses.length} scrambled records found but none are auto-repairable. Use Delete + Re-import instead.
                                        </td></tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>

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
                                <div className="flex items-center gap-2">
                                    <h4 className="text-[10px] font-black text-amber-800 uppercase tracking-wider">CSV Columns Detected</h4>
                                    <span className={`px-2 py-0.5 rounded-full text-[8px] font-black uppercase ${matchedCount === knownCount && matchedCount > 0 ? 'bg-green-200 text-green-800' : 'bg-amber-200 text-amber-800'}`}>
                                        {matchedCount}/{knownCount} matched
                                    </span>
                                </div>
                                <div className="flex items-center gap-2">
                                    <button
                                        onClick={() => toggleAllColumns(true)}
                                        className="text-[8px] font-bold text-amber-700 uppercase hover:text-amber-900 px-2 py-0.5 rounded"
                                    >
                                        Select All
                                    </button>
                                    <span className="text-amber-300">|</span>
                                    <button
                                        onClick={() => toggleAllColumns(false)}
                                        className="text-[8px] font-bold text-amber-500 uppercase hover:text-amber-700 px-2 py-0.5 rounded"
                                    >
                                        Deselect All
                                    </button>
                                </div>
                            </div>
                            <div className="flex flex-wrap gap-2 mb-3">
                                {detectedColumns.map(col => {
                                    const matched = KNOWN_FIELDS[normalizeKey(col)];
                                    const isFullName = matched === 'Full Name';
                                    return (
                                        <button
                                            key={col}
                                            onClick={() => toggleColumn(col)}
                                            className={`px-3 py-2 rounded-xl text-[10px] font-bold uppercase tracking-wide border-2 transition-all ${
                                                columnMap[col] !== false
                                                    ? isFullName
                                                        ? 'bg-purple-600 border-purple-600 text-white shadow-md'
                                                        : matched
                                                            ? 'bg-blue-600 border-blue-600 text-white shadow-md'
                                                            : 'bg-green-600 border-green-600 text-white shadow-md'
                                                    : matched
                                                        ? 'bg-white border-gray-300 text-gray-500 hover:border-blue-300'
                                                        : 'bg-gray-100 border-gray-200 text-gray-300 line-through'
                                            }`}>
                                            {col}{matched ? ` \u2192 ${matched}` : ''}
                                        </button>
                                    );
                                })}
                            </div>
                            {detectedColumns.some(c => normalizeKey(c) === 'full_name' || normalizeKey(c) === 'full name') && (
                                <div className="bg-purple-50 p-2 rounded-xl border border-purple-200 mb-2">
                                    <p className="text-[8px] font-bold text-purple-700 uppercase">
                                        {'\u2139\uFE0F'} Full Name column detected: will be parsed into Title + FirstName + LastName if separate name columns are missing.
                                    </p>
                                </div>
                            )}
                            <p className="text-[8px] font-bold text-amber-600 uppercase">
                                Only checked columns will be imported.{' '}
                                {!showRank && 'Rank is hidden per event config. '}
                                {!showOffice && 'Office is hidden per event config. '}
                                {!showDelegateType && 'DelegateType is hidden per event config. '}
                                Extra/unknown columns are automatically excluded.
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
                                if (headers.length > 1 && headers.some(h => KNOWN_FIELDS[normalizeKey(h)])) {
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
                    Note: The system performs an intelligent merge during import. Existing records (matched by Name + Phone per event) will have their missing fields auto-populated from the CSV. Records with all fields already complete are skipped. Extra whitespace is automatically stripped.
                </p>
            </div>
        </div>
    );
};

export default ImportModule;
