
import React, { useState, useContext, useMemo, useRef } from 'react';
import { db } from '../services/supabaseService';
import { supabase } from '../services/supabaseClient';
import { AppContext } from '../context/AppContext';
import { isAdminRole, isEventAdminRole } from '../types';
import { exportToCSV, normalizePhone, resolveDistrictShortCode, parseFullName, tokenizeFullName, normalizeTitleToken, KNOWN_TITLES, type NameOrder } from '../services/utils';

const AMBIGUOUS_VALUE_KEYS = new Set([
    'mr', 'mrs', 'ms', 'miss', 'dr', 'chief', 'pastor', 'rev', 'engr',
    'barr', 'prof', 'sir', 'lady', 'hon', 'elder', 'deacon', 'deaconess',
    'bishop', 'apostle', 'evangelist', 'ven', 'snr', 'bro', 'sis', 'prince',
    'princess', 'oba', 'alhaji', 'alhaja', 'mallam', 'hajia'
]);

const WHATSAPP_LIKE_HEADERS = new Set([
    'whatsapp', 'whatsapp number', 'whatsappnumber', 'whatsapp no', 'whatsappno',
    'whatsapp phone', 'whatsappphone', 'wha', 'wa', 'watsapp', 'whatapp', 'whats app'
]);

const extractBannerDistrict = (line: string): string => {
    const t = (line || '').replace(/\s+/g, ' ').trim().toUpperCase();
    if (!t) return '';
    const full = t.match(/(NORTH CENTRAL|NORTH EAST|NORTH WEST|SOUTH EAST|SOUTH SOUTH|SOUTH WEST)\s*(\d{1,2})\s*DISTRICT/);
    if (full) {
        const region = full[1].toLowerCase().split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
        return `${region} ${Number(full[2])}`;
    }
    const code = t.match(/(?:^|[^A-Z])(NC|NE|NW|SE|SS|SW)\s*(\d{1,2})(?:$|[^A-Z0-9])/);
    if (code) {
        const regionMap: Record<string, string> = { NC: 'North Central', NE: 'North East', NW: 'North West', SE: 'South East', SS: 'South South', SW: 'South West' };
        const region = regionMap[code[1]];
        return region ? `${region} ${Number(code[2])}` : '';
    }
    return '';
};

function normalizeDelegateType(raw: string): string {
  const t = (raw || '').trim().toUpperCase().replace(/[_\-\s]+/g, ' ');
  if (t === 'PAID GUEST') return 'National Guest';
  if (t === 'NONPAYMENT GUEST' || t === 'NON PAYMENT GUEST' || t === 'FREE GUEST') return 'Free Guest';
  if (t === 'INTERNATIONAL GUEST' || t === 'INTERNATIONAL') return 'International';
  return (raw || '').trim();
}

function resolveGuestFields(district: string, chapter: string, delegateType: string): { district: string; chapter: string; delegateType: string } {
  const d = (district || '').trim().toUpperCase() === 'GUE' ? 'National/External' : district;
  const c = (chapter || '').trim().toUpperCase() === 'GUE' ? 'Guest' : chapter;
  return { district: d, chapter: c, delegateType: normalizeDelegateType(delegateType) };
}

const OUTPUT_FIELDS = ['RegId', 'Title', 'First Name', 'Last Name', 'District', 'Chapter', 'Phone', 'Email', 'Rank', 'Office', 'DelegateType'];

const ImportModule = () => {
    const { activeEventId, activeEvent, user } = useContext(AppContext);
    const role = (user?.role || '').toLowerCase();
    const isAdmin = isAdminRole(role);
    const canAccess = isAdmin || isEventAdminRole(role);

    if (!canAccess) {
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
    const [feedback, setFeedback] = useState<{type: 'success' | 'error', msg: string, inserted?: number, updated?: number, skipped?: number, stats?: { bannerUsed: number; shortCodesResolved: number; whatsappFilled: number }} | null>(null);
    const [fileName, setFileName] = useState('');
    const [showMapping, setShowMapping] = useState(false);
    const [detectedColumns, setDetectedColumns] = useState<string[]>([]);
    const [columnMap, setColumnMap] = useState<Record<string, boolean>>({});
    const [bannerDistrict, setBannerDistrict] = useState('');
    const [nameOrder, setNameOrder] = useState<NameOrder | 'auto'>('auto');
    const statsRef = useRef({ bannerUsed: 0, shortCodesResolved: 0, whatsappFilled: 0 });
    const [scrambleAnalyses, setScrambleAnalyses] = useState<any[]>([]);
    const [scrambleSamples, setScrambleSamples] = useState<string[]>([]);
    const [scrambleTotal, setScrambleTotal] = useState(0);
    const [scrambleLoading, setScrambleLoading] = useState(false);
    const [scrambleResult, setScrambleResult] = useState<{ type: 'analyzed' | 'repaired' | 'deleted' | 'error'; count: number; msg?: string } | null>(null);
    const [scrambleShowRepairs, setScrambleShowRepairs] = useState(false);
    const [repairCsv, setRepairCsv] = useState('');
    const [repairDistrict, setRepairDistrict] = useState('');
    const [repairOrder, setRepairOrder] = useState<NameOrder>('surname-first');
    const [repairItems, setRepairItems] = useState<any[]>([]);
    const [repairLoading, setRepairLoading] = useState(false);
    const [repairResult, setRepairResult] = useState<{ type: 'preview' | 'repaired' | 'error'; count: number; msg?: string } | null>(null);

    const KNOWN_FIELDS: Record<string, string> = {
      'regid': 'RegId', 'reg_id': 'RegId', 'registration_id': 'RegId', 'external_id': 'RegId',
      'title': 'Title', 'title.': 'Title', 'honorific': 'Title', 'prefix': 'Title', 'mr': 'Title',
      'first_name': 'First Name', 'first name': 'First Name', 'firstname': 'First Name', 'given name': 'First Name', 'name': 'First Name',
      'last_name': 'Last Name', 'last name': 'Last Name', 'lastname': 'Last Name', 'surname': 'Last Name', 'family name': 'Last Name',
      'full_name': 'Full Name', 'full name': 'Full Name', 'fullname': 'Full Name', 'complete name': 'Full Name',
      'district': 'District', 'zone': 'District', 'region': 'District', 'chaptercode': 'District', 'chapter code': 'District',
      'district code': 'District', 'districtcode': 'District', 'district short code': 'District', 'districtshortcode': 'District',
      'dist code': 'District', 'distcode': 'District', 'short district code': 'District', 'shortdistrictcode': 'District',
      'short code': 'District', 'shortcode': 'District', 'zone code': 'District', 'zonecode': 'District',
      'chapter': 'Chapter', 'branch': 'Chapter', 'unit': 'Chapter',
      'phone': 'Phone', 'phone number': 'Phone', 'phone no': 'Phone', 'phoneno': 'Phone', 'mobile': 'Phone', 'mobile no': 'Phone', 'mobileno': 'Phone', 'mobile number': 'Phone', 'mobilenumber': 'Phone', 'telephone': 'Phone', 'tel': 'Phone', 'tel no': 'Phone', 'telno': 'Phone', 'cell': 'Phone', 'contact': 'Phone', 'contact number': 'Phone', 'contactnumber': 'Phone', 'nphone': 'Phone', 'n phone': 'Phone', 'direct line': 'Phone',
      'whatsapp': 'Phone', 'whatsapp number': 'Phone', 'whatsappnumber': 'Phone', 'whatsapp no': 'Phone', 'whatsappno': 'Phone', 'whatsapp phone': 'Phone', 'whatsappphone': 'Phone', 'wha': 'Phone', 'wa': 'Phone',
      'email': 'Email', 'email address': 'Email', 'e-mail': 'Email', 'mail': 'Email',
      'rank': 'Rank', 'level': 'Rank', 'grade': 'Rank',
      'office': 'Office', 'position': 'Office', 'role': 'Office', 'post': 'Office',
      'delegate_type': 'DelegateType', 'delegate type': 'DelegateType', 'delegatetype': 'DelegateType', 'type': 'DelegateType', 'category': 'DelegateType',
    };

    const eventConfig = (activeEvent?.event_config || {}) as Record<string, boolean>;
    const showRank = eventConfig.show_rank !== false;
    const showOffice = eventConfig.show_office !== false;
    const showDelegateType = eventConfig.show_delegate_type !== false;

    const normalizeKey = (h: string) => h.toLowerCase().replace(/\s+/g, ' ').replace(/[^a-z0-9\s]/g, '').trim();

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

    const detectHeaderRow = (lines: string[]): { headerIndex: number; bannerDistrict: string; found: boolean } => {
      let banner = '';
      const scanLimit = Math.min(lines.length, 10);
      for (let i = 0; i < scanLimit; i++) {
        const rawLine = lines[i] || '';
        const strong = parseHeaders(rawLine).filter(c => {
          const k = normalizeKey(c);
          return !!KNOWN_FIELDS[k] && !AMBIGUOUS_VALUE_KEYS.has(k);
        }).length;
        if (strong >= 2) return { headerIndex: i, bannerDistrict: banner, found: true };
        const d = extractBannerDistrict(rawLine);
        if (d && !banner) banner = d;
      }
      return { headerIndex: 0, bannerDistrict: banner, found: false };
    };

    const detectNameOrder = (lines: string[], hi: number, headers: string[], cm: Record<string, boolean>): NameOrder => {
      const fullNameIdx = headers.findIndex(h => cm[h] !== false && KNOWN_FIELDS[normalizeKey(h)] === 'Full Name');
      if (fullNameIdx < 0) return 'given-first';
      let midTitle = 0;
      let leadTitle = 0;
      for (let i = hi + 1; i < Math.min(lines.length, hi + 200); i++) {
        const v = lines[i].split(',')[fullNameIdx] || '';
        if (!v.trim()) continue;
        const tokens = tokenizeFullName(v);
        if (tokens.length === 0) continue;
        const firstIsTitle = KNOWN_TITLES.has(normalizeTitleToken(tokens[0]));
        const anyTitle = tokens.some(t => KNOWN_TITLES.has(normalizeTitleToken(t)));
        if (!anyTitle) continue;
        if (firstIsTitle && tokens.length >= 2 && !KNOWN_TITLES.has(normalizeTitleToken(tokens[1]))) leadTitle++;
        else if (firstIsTitle) { if (tokens.filter(t => !KNOWN_TITLES.has(normalizeTitleToken(t))).length >= 2) midTitle++; }
        else midTitle++;
      }
      if (midTitle > leadTitle && midTitle >= 3) return 'surname-first';
      return 'given-first';
    };

    const effectiveNameOrder = (): NameOrder => {
      if (nameOrder !== 'auto') return nameOrder;
      if (!csv.trim()) return 'given-first';
      const lines = csv.trim().split('\n');
      if (lines.length < 2) return 'given-first';
      const { headerIndex: hi } = detectHeaderRow(lines);
      const headers = parseHeaders(lines[hi]);
      return detectNameOrder(lines, hi, headers, columnMap);
    };

    const namePreview: Array<{ raw: string; title: string; first: string; last: string }> = (() => {
      if (!csv.trim() || detectedColumns.length === 0) return [];
      const lines = csv.trim().split('\n');
      const { headerIndex: hi } = detectHeaderRow(lines);
      const headers = parseHeaders(lines[hi]);
      const fullNameIdx = headers.findIndex(h => columnMap[h] !== false && KNOWN_FIELDS[normalizeKey(h)] === 'Full Name');
      if (fullNameIdx < 0) return [];
      const order = effectiveNameOrder();
      const out: Array<{ raw: string; title: string; first: string; last: string }> = [];
      for (let i = hi + 1; i < lines.length && out.length < 5; i++) {
        const v = (lines[i].split(',')[fullNameIdx] || '').trim().replace(/^["']|["']$/g, '');
        if (!v) continue;
        const p = parseFullName(v, order);
        out.push({ raw: v, title: p.title, first: p.firstName, last: p.lastName });
      }
      return out;
    })();

    const getEnabledColumnIndices = (headers: string[], fieldName: string): number[] => {
      const result: number[] = [];
      const fieldKey = fieldName.toLowerCase();
      headers.forEach((h, i) => {
        if (columnMap[h] === false) return;
        const k = normalizeKey(h);
        if (KNOWN_FIELDS[k] === fieldName || k === fieldKey) result.push(i);
      });
      return result;
    };

    const pickRowValue = (values: string[], indices: number[]): string => {
      for (const idx of indices) {
        const v = (values[idx] || '').trim();
        if (v) return v;
      }
      return '';
    };

    const isWhatsappLike = (h: string): boolean => WHATSAPP_LIKE_HEADERS.has(normalizeKey(h));

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
          const { headerIndex, bannerDistrict: bd, found } = detectHeaderRow(lines);
          const headers = parseHeaders(lines[headerIndex]);
          setBannerDistrict(bd || '');
          if (found && headers.length > 1) {
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

    const mappedCsvData = React.useMemo(() => {
      statsRef.current = { bannerUsed: 0, shortCodesResolved: 0, whatsappFilled: 0 };
      if (!csv.trim()) return csv;
      const lines = csv.trim().split('\n');
      if (lines.length < 2) return showMapping ? '' : csv;

      const { headerIndex: hi, bannerDistrict: detectedBanner } = detectHeaderRow(lines);
      const effectiveBanner = (detectedBanner || bannerDistrict || '').trim();
      if (!showMapping || detectedColumns.length === 0) {
        if (hi > 0) return lines.slice(hi + 1).join('\n');
        return csv;
      }
      const headers = parseHeaders(lines[hi]);

      const fieldIndices = new Map<string, number[]>();
      for (const field of OUTPUT_FIELDS) fieldIndices.set(field, getEnabledColumnIndices(headers, field));
      const firstIdx = (field: string) => (fieldIndices.get(field) || [])[0] ?? -1;
      const hasEnabled = (field: string) => (fieldIndices.get(field) || []).length > 0;

      const districtPriority = (i: number) => {
        const k = normalizeKey(headers[i]);
        return (k.startsWith('district') || k.includes('short code') || k.includes('chaptercode')) ? 0 : 1;
      };
      const districtIndices = [...(fieldIndices.get('District') || [])].sort((a, b) => districtPriority(a) - districtPriority(b));

      const fullNameIdx = headers.findIndex(h => columnMap[h] !== false && KNOWN_FIELDS[normalizeKey(h)] === 'Full Name');
      const useFullName = fullNameIdx >= 0 && !(hasEnabled('Title') && hasEnabled('First Name') && hasEnabled('Last Name'));
      const order = effectiveNameOrder();

      const phoneLikeIdx = headers.map((_, i) => i).filter(i =>
        columnMap[headers[i]] !== false && KNOWN_FIELDS[normalizeKey(headers[i])] === 'Phone' && !isWhatsappLike(headers[i])
      );
      const whatsappIdx = headers.map((_, i) => i).filter(i =>
        columnMap[headers[i]] !== false && KNOWN_FIELDS[normalizeKey(headers[i])] === 'Phone' && isWhatsappLike(headers[i])
      );

      const stripDistrictSuffix = (raw: string): string => {
        const t = (raw || '').trim();
        const dashIdx = t.indexOf('-');
        if (dashIdx > 0 && /^\d+$/.test(t.substring(dashIdx + 1)) && /^[A-Z]{2}\d+$/i.test(t.substring(0, dashIdx))) return t.substring(0, dashIdx).toUpperCase();
        return t;
      };

      const resultLines: string[] = [];
      for (let i = hi + 1; i < lines.length; i++) {
        const values = lines[i].split(',').map(v => v.trim().replace(/^["']|["']$/g, ''));
        if (values.every(v => !v)) continue;
        if (/(^|,)\s*NUMBER\s*:\s*\d+\s*(,|$)/i.test(lines[i])) continue;
        const headerLike = values.filter(v => {
          const k = normalizeKey(v);
          return !!KNOWN_FIELDS[k] && !AMBIGUOUS_VALUE_KEYS.has(k);
        }).length;
        if (headerLike >= 3) continue;

        const colValues: Record<string, string> = {};
        if (useFullName) {
          const parsed = parseFullName(values[fullNameIdx] || '', order);
          colValues['Title'] = parsed.title;
          colValues['First Name'] = parsed.firstName;
          colValues['Last Name'] = parsed.lastName;
        } else {
          colValues['Title'] = firstIdx('Title') >= 0 ? (values[firstIdx('Title')] || '') : '';
          colValues['First Name'] = firstIdx('First Name') >= 0 ? (values[firstIdx('First Name')] || '') : '';
          colValues['Last Name'] = firstIdx('Last Name') >= 0 ? (values[firstIdx('Last Name')] || '') : '';
        }

        let districtBefore = pickRowValue(values, districtIndices);
        if (effectiveBanner && /^(ZONE|AREA)\s*\d+$/i.test(districtBefore)) districtBefore = '';
        if (!districtBefore && effectiveBanner) statsRef.current.bannerUsed++;
        const resolvedDistrict = resolveDistrictShortCode(districtBefore || effectiveBanner);
        if (districtBefore && resolvedDistrict && resolvedDistrict !== stripDistrictSuffix(districtBefore)) statsRef.current.shortCodesResolved++;
        colValues['District'] = resolvedDistrict;
        colValues['Chapter'] = pickRowValue(values, fieldIndices.get('Chapter') || []);

        const phoneFromPhoneCol = pickRowValue(values, phoneLikeIdx);
        const phoneFromWhatsapp = pickRowValue(values, whatsappIdx);
        if (!phoneFromPhoneCol && phoneFromWhatsapp) statsRef.current.whatsappFilled++;
        colValues['Phone'] = normalizePhone(phoneFromPhoneCol || phoneFromWhatsapp);

        colValues['Email'] = firstIdx('Email') >= 0 ? (values[firstIdx('Email')] || '') : '';
        colValues['Rank'] = firstIdx('Rank') >= 0 ? (values[firstIdx('Rank')] || '') : '';
        colValues['Office'] = firstIdx('Office') >= 0 ? (values[firstIdx('Office')] || '') : '';
        colValues['DelegateType'] = firstIdx('DelegateType') >= 0 ? (values[firstIdx('DelegateType')] || '') : '';
        colValues['RegId'] = firstIdx('RegId') >= 0 ? (values[firstIdx('RegId')] || '') : '';

        const guest = resolveGuestFields(colValues['District'] || '', colValues['Chapter'] || '', colValues['DelegateType'] || '');
        colValues['District'] = guest.district;
        colValues['Chapter'] = guest.chapter;
        colValues['DelegateType'] = guest.delegateType;

        const row = OUTPUT_FIELDS.map(f => colValues[f] ?? '').join(',');
        if (row.trim().replace(/,/g, '')) resultLines.push(row);
      }
      return resultLines.join('\n');
    }, [csv, showMapping, detectedColumns, columnMap, bannerDistrict, nameOrder]);

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
        const importStats = { ...statsRef.current };
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
                    skipped: result.skipped,
                    stats: importStats
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
            const { repaired, errors, harmonized } = await db.applyScrambleRepairs(activeEventId, repairs);
            let msg = `Repaired ${repaired} records in-place`;
            if (harmonized > 0) msg += `. Harmonized ${harmonized} district(s) to full name`;
            if (errors > 0) msg += ` (${errors} errors)`;
            msg += '.';
            setScrambleResult({ type: 'repaired', count: repaired, msg });
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

    const nameKey = (s?: string) => (s || '').toUpperCase().replace(/\s+/g, ' ').trim().replace(/[^A-Z0-9 ]/g, '');

    const analyzeRepairCsv = async (order: NameOrder): Promise<{ items: any[]; parsedCount: number }> => {
        const lines = repairCsv.split('\n').map(l => l.trim()).filter(Boolean);
        const parsedRows: Array<{ phone: string; title: string; first: string; last: string; district: string; raw: string }> = [];
        for (const line of lines) {
            const parts = line.split(',');
            const fullName = ((parts[0] || '').trim().replace(/^["']|["']$/g, '')).replace(/\s+/g, ' ');
            const phone = normalizePhone((parts[1] || '').trim().replace(/^["']|["']$/g, ''));
            const district = (parts[2] || '').trim().replace(/^["']|["']$/g, '');
            if (!fullName || !phone) continue;
            const p = parseFullName(fullName, order);
            parsedRows.push({ phone, title: p.title, first: p.firstName, last: p.lastName, district, raw: fullName });
        }
        const phones = Array.from(new Set(parsedRows.map(r => r.phone))).filter(Boolean);
        if (phones.length === 0) return { items: [], parsedCount: parsedRows.length };
        const candidates = await db.getDelegatesByPhones(activeEventId, phones);
        const items: any[] = [];
        for (const pr of parsedRows) {
            const deps = candidates.filter(c => normalizePhone(c.phone) === pr.phone);
            if (deps.length === 0) { items.push({ raw: pr.raw, skip: 'no delegate with this phone' }); continue; }
            const matched = deps.filter(d => nameKey(d.first_name) === nameKey(pr.last) || nameKey(d.last_name) === nameKey(pr.last));
            if (matched.length === 0) {
                items.push({ raw: pr.raw, skip: 'phone matched but surname not found in record' });
                continue;
            }
            if (matched.length > 1) {
                items.push({ raw: pr.raw, skip: 'ambiguous (multiple records share name + phone)' });
                continue;
            }
            const match = matched[0];
            const alreadyCorrect = nameKey(match.first_name) === nameKey(pr.first) && nameKey(match.last_name) === nameKey(pr.last);
            if (alreadyCorrect) { items.push({ raw: pr.raw, skip: 'already correct' }); continue; }
            const zoneLabel = /^(ZONE|AREA)\s*\d+$/i.test(match.district || '');
            items.push({
                delegate_id: match.delegate_id,
                raw: pr.raw,
                phone: pr.phone,
                before: { title: match.title || '', first_name: match.first_name, last_name: match.last_name, district: match.district || '' },
                after: {
                    title: pr.title,
                    first_name: pr.first,
                    last_name: pr.last,
                    district: (repairDistrict || pr.district || (zoneLabel && bannerDistrict ? bannerDistrict : '')) || ''
                },
                districtReason: (repairDistrict || pr.district || (zoneLabel && bannerDistrict) ? 'will fix district' : ''),
            });
        }
        return { items, parsedCount: parsedRows.length };
    };

    const handleRepairAnalyze = async () => {
        if (!activeEventId) return;
        const lines = repairCsv.split('\n').map(l => l.trim()).filter(Boolean);
        if (lines.length === 0) {
            setRepairResult({ type: 'preview', count: 0, msg: 'Paste or upload FULL NAME, PHONE rows first, or use Auto-Detect below.' });
            return;
        }
        setRepairLoading(true);
        setRepairResult(null);
        setRepairItems([]);
        try {
            const { items, parsedCount } = await analyzeRepairCsv(repairOrder);
            const actionable = items.filter(i => !i.skip && i.delegate_id);
            setRepairItems(items);
            setRepairResult({
                type: 'preview',
                count: actionable.length,
                msg: `${parsedCount} rows parsed (${repairOrder === 'surname-first' ? 'Surname First' : 'Given First'}); ${actionable.length} repairable; ${items.length - actionable.length} skipped.`
            });
        } catch (e: any) {
            setRepairResult({ type: 'error', count: 0, msg: e.message });
        } finally {
            setRepairLoading(false);
        }
    };

    const handleRepairAutoDetect = async () => {
        if (!activeEventId) return;
        setRepairLoading(true);
        setRepairResult(null);
        setRepairItems([]);
        try {
            const hasFile = repairCsv.split('\n').map(l => l.trim()).filter(Boolean).length > 0;
            if (hasFile) {
                const { items, parsedCount } = await analyzeRepairCsv(repairOrder);
                const actionable = items.filter(i => !i.skip && i.delegate_id);
                setRepairItems(items);
                setRepairResult({
                    type: 'preview',
                    count: actionable.length,
                    msg: `File-based re-derive (${repairOrder === 'surname-first' ? 'Surname First' : 'Given First'}): ${parsedCount} rows parsed; ${actionable.length} repairable; ${items.length - actionable.length} skipped.`
                });
            } else {
                const items = await db.autoRepairScannedNames(activeEventId, repairDistrict || bannerDistrict || undefined);
                setRepairItems(items);
                setRepairResult({
                    type: 'preview',
                    count: items.length,
                    msg: `Scanned the active event — ${items.length} existing record${items.length === 1 ? '' : 's'} with a trapped title can be normalized. Tip: for FULL coverage (incl. title-less rows) paste the CSV (FULL NAME, PHONE) below and run Auto-Detect again — the file pins the surname-first order per row.`
                });
            }
        } catch (e: any) {
            setRepairResult({ type: 'error', count: 0, msg: e.message });
        } finally {
            setRepairLoading(false);
        }
    };

    const handleRepairBackup = () => {
        const actionable = repairItems.filter(i => !i.skip && i.delegate_id);
        if (actionable.length === 0) return;
        const blob = new Blob([JSON.stringify({ eventId: activeEventId, exportedAt: new Date().toISOString(), records: actionable }, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = `name-repair-backup-${activeEventId?.slice(0, 8) || 'unknown'}.json`;
        a.click();
        URL.revokeObjectURL(url);
    };

    const handleRepairApply = async () => {
        if (!activeEventId) return;
        const actionable = repairItems.filter(i => !i.skip && i.delegate_id);
        if (actionable.length === 0) return;
        setRepairLoading(true);
        setRepairResult(null);
        try {
            const rows = actionable.map(i => ({
                delegateId: i.delegate_id,
                title: i.after.title,
                firstName: i.after.first_name,
                lastName: i.after.last_name,
                district: i.after.district || undefined,
            }));
            const res = await db.repairNamesFromFile(activeEventId, rows);
            setRepairItems([]);
            setRepairResult({ type: 'repaired', count: res.updated, msg: `Updated ${res.updated} records in-place${res.errors ? ` (${res.errors} errors)` : ''}. No duplicates created.` });
        } catch (e: any) {
            setRepairResult({ type: 'error', count: 0, msg: e.message });
        } finally {
            setRepairLoading(false);
        }
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
                                    {(feedback.stats?.bannerUsed ?? 0) > 0 && (
                                        <p className="text-[10px] font-bold text-blue-700 uppercase">
                                            {'\uD83C\uDFF7\uFE0F'} {feedback.stats?.bannerUsed} rows got District from the file title/banner
                                        </p>
                                    )}
                                    {(feedback.stats?.shortCodesResolved ?? 0) > 0 && (
                                        <p className="text-[10px] font-bold text-teal-700 uppercase">
                                            {'\uD83D\uDD17'} {feedback.stats?.shortCodesResolved} district short codes resolved to official names
                                        </p>
                                    )}
                                    {(feedback.stats?.whatsappFilled ?? 0) > 0 && (
                                        <p className="text-[10px] font-bold text-purple-700 uppercase">
                                            {'\uD83D\uDCF2'} {feedback.stats?.whatsappFilled} phones extracted from WhatsApp columns
                                        </p>
                                    )}
                                </div>
                            </div>
                        </div>
                        <button onClick={() => setFeedback(null)} className="text-[10px] font-black uppercase opacity-50 hover:opacity-100 px-4 py-2">Dismiss</button>
                    </div>
                )}

                {/* --- SCRAMBLED IMPORT RECOVERY (admin-only) --- */}
                {isAdmin && (
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
                )}

                {isAdmin && (
                <div className="p-4 mb-6 rounded-2xl border-2 border-amber-200 bg-amber-50">
                    <div className="flex justify-between items-center mb-2">
                        <div>
                            <h4 className="text-[10px] font-black text-amber-800 uppercase tracking-wider">Repair Imported Names</h4>
                            <p className="text-[8px] font-bold text-amber-600 uppercase mt-0.5">
                                Normalizes records imported from surname-first files (e.g. {'"Achizue Engr Kenneth"'}) that landed with the surname in the First Name field. Supply the source CSV (FULL NAME, PHONE) for full per-row re-derive of Title / First / Last — including title-less rows. Matches by phone + surname, backs up, then updates in place (no duplicates, attendance preserved).
                            </p>
                        </div>
                    </div>
                    <div className="mb-3">
                        <button
                            onClick={handleRepairAutoDetect}
                            disabled={repairLoading || !activeEventId}
                            className="px-4 py-2 bg-amber-800 hover:bg-amber-700 text-white font-black rounded-xl text-[9px] uppercase tracking-wider transition-all disabled:opacity-50 shadow"
                        >
                            {repairLoading ? 'SCANNING...' : 'Auto-Detect & Normalize'}
                        </button>
                        <p className="text-[7px] font-bold text-amber-600 uppercase mt-1">
                            With a CSV pasted/uploaded below: re-derives every row from the file (full coverage). Without a file: scans existing records and only proposes rows with a real title trapped in the Last Name.
                        </p>
                    </div>
                    <div className="mb-2 flex flex-wrap items-center gap-3">
                        <label className="text-[8px] font-bold text-amber-700 uppercase">Name order (file):</label>
                        {(['surname-first', 'given-first'] as const).map(opt => (
                            <button
                                key={opt}
                                onClick={() => setRepairOrder(opt)}
                                className={`px-2.5 py-1 rounded-lg text-[8px] font-black uppercase tracking-wide transition-all border ${
                                    repairOrder === opt
                                        ? 'bg-amber-700 text-white border-amber-700'
                                        : 'bg-white text-amber-700 border-amber-200 hover:border-amber-400'
                                }`}
                            >
                                {opt === 'surname-first' ? 'Surname First' : 'Given First'}
                            </button>
                        ))}
                        <label className="flex-1 cursor-pointer bg-white border-2 border-dashed border-amber-300 rounded-xl px-3 py-2 text-center transition-all hover:border-amber-400">
                            <input type="file" accept=".csv,.txt" className="hidden"
                                onChange={e => {
                                    const f = e.target.files?.[0];
                                    if (!f) return;
                                    const r = new FileReader();
                                    r.onload = ev => setRepairCsv((ev.target?.result as string) || '');
                                    r.readAsText(f);
                                }} />
                            <span className="text-[8px] font-black text-amber-700 uppercase">{'*\u25BC'} Load CSV file</span>
                        </label>
                    </div>
                    <textarea
                        className="w-full h-28 p-4 border-2 border-amber-200 rounded-xl bg-white font-mono text-xs focus:ring-4 focus:ring-amber-500/10 outline-none transition-all resize-none"
                        placeholder={"Achizue Engr Kenneth, 8037958534, North Central 2\nAdemora Mrs Chika, 7064640818"}
                        value={repairCsv}
                        onChange={e => setRepairCsv(e.target.value)}
                    />
                    <div className="mt-2 flex flex-wrap items-center gap-3">
                        <label className="text-[8px] font-bold text-amber-700 uppercase">District to apply (optional):</label>
                        <input
                            className="px-3 py-2 border-2 border-amber-200 rounded-xl bg-white font-mono text-xs outline-none focus:ring focus:ring-amber-500/10"
                            placeholder={bannerDistrict || 'e.g. North Central 2'}
                            value={repairDistrict}
                            onChange={e => setRepairDistrict(e.target.value)}
                        />
                    </div>
                    <div className="flex flex-wrap gap-2 mt-3">
                        <button
                            onClick={handleRepairAnalyze}
                            disabled={repairLoading || !activeEventId || !repairCsv.trim()}
                            className="px-4 py-2 bg-amber-700 hover:bg-amber-600 text-white font-black rounded-xl text-[9px] uppercase tracking-wider transition-all disabled:opacity-50"
                        >
                            {repairLoading ? 'ANALYZING...' : '1. Analyze'}
                        </button>
                        <button
                            onClick={handleRepairBackup}
                            disabled={!repairItems.some(i => !i.skip && i.delegate_id)}
                            className="px-4 py-2 bg-amber-500 hover:bg-amber-400 text-white font-black rounded-xl text-[9px] uppercase tracking-wider transition-all disabled:opacity-50"
                        >
                            2. Backup JSON
                        </button>
                        <button
                            onClick={handleRepairApply}
                            disabled={repairLoading || !repairItems.some(i => !i.skip && i.delegate_id)}
                            className="px-4 py-2 bg-teal-700 hover:bg-teal-600 text-white font-black rounded-xl text-[9px] uppercase tracking-wider transition-all disabled:opacity-50"
                        >
                            {repairLoading ? 'REPAIRING...' : '3. Apply Repairs'}
                        </button>
                    </div>
                    {repairResult && (
                        <div className={`p-3 rounded-xl mt-2 ${
                            repairResult.type === 'error' ? 'bg-red-100 border border-red-200 text-red-800' : 'bg-white border border-amber-200 text-amber-900'
                        }`}>
                            <p className="text-[9px] font-black uppercase">{repairResult.msg}</p>
                        </div>
                    )}
                    {repairItems.length > 0 && (
                        <div className="mt-2 max-h-80 overflow-y-auto bg-white rounded-xl border border-amber-100">
                            <table className="w-full text-[8px]">
                                <thead className="sticky top-0 bg-amber-100 text-amber-900 uppercase font-black tracking-wider">
                                    <tr>
                                        <th className="p-1.5 text-left w-16">#</th>
                                        <th className="p-1.5 text-left">Now</th>
                                        <th className="p-1.5 text-left bg-green-50 text-green-700">{'→'} Repaired</th>
                                        <th className="p-1.5 text-left">Note</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {repairItems.filter(i => !i.skip && i.delegate_id).slice(0, 100).map((i, idx) => (
                                        <tr key={i.delegate_id || idx} className="border-b border-gray-100">
                                            <td className="p-1.5 font-mono text-gray-400">{idx + 1}</td>
                                            <td className="p-1.5 align-top bg-red-50/50 text-red-700 font-mono leading-relaxed">
                                                <div>{i.before.first_name} {i.before.last_name}</div>
                                                <div className="text-[7px] text-gray-400">{i.before.title} · {i.before.district || '—'}</div>
                                            </td>
                                            <td className="p-1.5 align-top bg-green-50/50 text-green-700 font-mono leading-relaxed">
                                                <div>{i.after.first_name} {i.after.last_name}</div>
                                                <div className="text-[7px] text-gray-400">{i.after.title} · {i.after.district || '—'}</div>
                                            </td>
                                            <td className="p-1.5 align-top text-[7px] font-bold text-amber-600 uppercase">{i.districtReason || 'name repair'}</td>
                                        </tr>
                                    ))}
                                    {repairItems.filter(i => i.skip).length > 0 && (
                                        <tr><td colSpan={4} className="p-2 text-[8px] text-gray-500">
                                            Skipped: {repairItems.filter(i => i.skip).map(i => `${i.raw} (${i.skip})`).slice(0, 6).join(', ')}
                                            {repairItems.filter(i => i.skip).length > 6 ? ' …' : ''}
                                        </td></tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    )}
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
                                        onClick={() => { setCsv(''); setFileName(''); setShowMapping(false); setDetectedColumns([]); setColumnMap({}); setBannerDistrict(''); setNameOrder('auto'); setFeedback(null); }}
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
                                    <div className="mt-2 flex items-center gap-2 flex-wrap">
                                        <span className="text-[8px] font-bold text-purple-700 uppercase">Name order:</span>
                                        {(['auto', 'surname-first', 'given-first'] as const).map(opt => (
                                            <button
                                                key={opt}
                                                onClick={() => setNameOrder(opt)}
                                                className={`px-2.5 py-1 rounded-lg text-[8px] font-black uppercase tracking-wide transition-all border ${
                                                    nameOrder === opt
                                                        ? 'bg-purple-700 text-white border-purple-700'
                                                        : 'bg-white text-purple-700 border-purple-200 hover:border-purple-400'
                                                }`}
                                            >
                                                {opt === 'auto' ? 'Auto' : opt === 'surname-first' ? 'Surname First' : 'Given First'}
                                            </button>
                                        ))}
                                    </div>
                                    {namePreview.length > 0 && (
                                        <div className="mt-2 bg-white/70 rounded-xl border border-purple-100 overflow-hidden">
                                            <table className="w-full text-[8px]">
                                                <thead className="bg-purple-100 text-purple-900 uppercase font-black tracking-wider">
                                                    <tr>
                                                        <th className="p-1.5 text-left">As in file</th>
                                                        <th className="p-1.5 text-left">Title</th>
                                                        <th className="p-1.5 text-left">First</th>
                                                        <th className="p-1.5 text-left">Last</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {namePreview.map((p, i) => (
                                                        <tr key={i} className="border-b border-purple-100 last:border-0">
                                                            <td className="p-1.5 font-mono text-purple-900">{p.raw}</td>
                                                            <td className="p-1.5 text-purple-700">{p.title}</td>
                                                            <td className="p-1.5">{p.first || <span className="text-purple-300 italic">—</span>}</td>
                                                            <td className="p-1.5">{p.last || <span className="text-purple-300 italic">—</span>}</td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>
                                    )}
                                </div>
                            )}
                            {bannerDistrict && (
                                <div className="bg-blue-50 p-2 rounded-xl border border-blue-200 mb-2">
                                    <p className="text-[8px] font-bold text-blue-700 uppercase">
                                        {'\u2139\uFE0F'} District detected from file title/banner:{' '}
                                        <span className="font-mono text-blue-900">{bannerDistrict}</span> — will be applied to rows without a District value.
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
                                    const { headerIndex, bannerDistrict: bd, found } = detectHeaderRow(lines);
                                    const headers = parseHeaders(lines[headerIndex]);
                                    if (found && headers.length > 1) {
                                        if (detectedColumns.length === 0) {
                                            setDetectedColumns(headers);
                                            const map = matchColumns(headers);
                                            setColumnMap(map);
                                            setBannerDistrict(bd || '');
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
