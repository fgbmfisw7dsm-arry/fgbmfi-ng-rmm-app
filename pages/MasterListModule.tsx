
import React, { useState, useEffect, useRef, useMemo, useCallback, useContext } from 'react';
import { db } from '../services/supabaseService';
import { supabase } from '../services/supabaseClient';
import { Delegate, SystemSettings, Chapter, isAdminRole, isEventAdminRole, DateBasis, ImportBatch } from '../types';
import { exportToCSV, exportMasterListPDF, formatCurrency, downloadJSON, describeDateRange, hasDateRange, sortDelegatesByDistrict } from '../services/utils';
import type { MasterListPdfColumn, MasterListPdfRow } from '../services/utils';
import { getScopeFilter } from '../types';
import { AppContext } from '../context/AppContext';

const PAGE_SIZE = 25;

interface SelectionInfo { name: string; district: string; }

const selectionInfoOf = (d: Delegate): SelectionInfo => ({
    name: `${d.title || ''} ${d.first_name || ''} ${d.last_name || ''}`.replace(/\s+/g, ' ').trim(),
    district: (d.district || '').trim(),
});

const regDateOf = (d: Delegate): string => {
    if (!d.created_at) return '-';
    const t = new Date(d.created_at);
    return Number.isNaN(t.getTime()) ? '-' : t.toLocaleDateString('en-GB');
};

// v1.93: 'last activity' = generated column, falling back to the newest of
// updated_at / created_at when the column is absent (pre-migration payloads).
const activityDateOf = (d: Delegate): string => {
    let raw: string | null | undefined = d.last_activity_at;
    if (!raw) {
        const times = [d.created_at, d.updated_at]
            .filter(Boolean)
            .map(v => new Date(v as string).getTime())
            .filter(t => !Number.isNaN(t));
        raw = times.length ? new Date(Math.max(...times)).toISOString() : null;
    }
    if (!raw) return '-';
    const t = new Date(raw);
    return Number.isNaN(t.getTime()) ? '-' : t.toLocaleDateString('en-GB');
};

const sourceFilterLabel = (sf: string) => sf === 'portal' ? 'Portal' : sf === 'web' ? 'Web' : sf === 'ems' ? 'EMS' : sf === 'manual' ? 'Manual' : '';
const showRegId = (d: Delegate) => d.reg_type === 'portal' || d.reg_type === 'web';

const MasterListModule = () => {
    const { activeEventId, activeEvent, user, events, onEventChange } = useContext(AppContext);
    const isAdmin = isAdminRole((user?.role || '').toLowerCase()) || isEventAdminRole((user?.role || '').toLowerCase());
    const canManage = isAdminRole((user?.role || '').toLowerCase());

    useEffect(() => {
        if (!activeEventId && Array.isArray(events)) {
            const liveEvent = events.find(e => e.is_active !== false);
            if (liveEvent) onEventChange(liveEvent.event_id);
        }
    }, [activeEventId, events, onEventChange]);

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
    const eventConfig = (activeEvent?.event_config || {}) as Record<string, unknown>;
    const canDelete = canManage && eventConfig.delegate_deletion_enabled === true;
    const scope = getScopeFilter(user);
    const showRank = eventConfig.show_rank !== false;
    const showOffice = eventConfig.show_office !== false;
    const showDelegateType = eventConfig.show_delegate_type !== false;
    // v1.55: payment columns apply to EMS registrations only; shown via a
    // persisted toggle rendered only when the active event captures payments.
    const paymentEnabled = eventConfig.show_payment_fields !== false;
    const [showPaymentCols, setShowPaymentCols] = useState<boolean>(() => {
        try { return localStorage.getItem('fgbmfi_ml_show_payments') === '1'; } catch { return false; }
    });
    const [delegates, setDelegates] = useState<Delegate[]>([]);
    const [searchTerm, setSearchTerm] = useState('');
    const [selectedDistrict, setSelectedDistrict] = useState('');
    const [sourceFilter, setSourceFilter] = useState<'portal' | 'web' | 'manual' | 'ems' | ''>('');
    const [regFrom, setRegFrom] = useState('');
    const [regTo, setRegTo] = useState('');
    const [dateBasis, setDateBasis] = useState<DateBasis>('activity');
    const [importBatchId, setImportBatchId] = useState('');
    const [importBatches, setImportBatches] = useState<ImportBatch[]>([]);
    const [settings, setSettings] = useState<SystemSettings | null>(null);
    const [chapters, setChapters] = useState<Chapter[]>([]);
    const [editForm, setEditForm] = useState<Partial<Delegate>>({
        title: '', first_name: '', last_name: '', district: '', chapter: '', rank: '', office: '', phone: '', email: '', delegate_type: 'Member'
    });
    const [editingId, setEditingId] = useState<string | null>(null);
    const [listLoading, setListLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [page, setPage] = useState(1);
    const [totalPages, setTotalPages] = useState(0);
    const [totalRecords, setTotalRecords] = useState(0);
    const pageRef = useRef(1);
    const listRef = useRef<HTMLDivElement>(null);
    const districtsSeq = useRef(0);
    const [districtListLoading, setDistrictListLoading] = useState(false);
    const [districtList, setDistrictList] = useState<{ district: string; count: number }[]>([]);
    const [districtSections, setDistrictSections] = useState<Record<string, { delegates: Delegate[]; page: number; total: number; pages: number; loading: boolean }>>({});
    const [mergePrompt, setMergePrompt] = useState<{ dropId: string; candidates: Delegate[] } | null>(null);
    const [merging, setMerging] = useState(false);
    const [selected, setSelected] = useState<Map<string, SelectionInfo>>(new Map());
    const [bulkConfirmOpen, setBulkConfirmOpen] = useState(false);
    const [bulkDeleting, setBulkDeleting] = useState(false);
    const [bulkBusy, setBulkBusy] = useState(false);
    const [bulkNotice, setBulkNotice] = useState<string | null>(null);
    const [confirmText, setConfirmText] = useState('');
    const [rpcHealth, setRpcHealth] = useState<{ paginated: boolean; districtCounts: boolean }>({ paginated: true, districtCounts: true });

    const dateRange = useMemo(() => ({
        from: regFrom || undefined,
        to: regTo || undefined,
    }), [regFrom, regTo]);
    const dateRangeActive = hasDateRange(dateRange);
    const dateRangeInvalid = !!(regFrom && regTo && regTo < regFrom);
    const activeDateRange = dateRangeInvalid ? undefined : (dateRangeActive ? dateRange : undefined);
    // An active date range behaves like the Source dropdown: it switches the page
    // into the unified paginated table (the All-Districts section counts come from
    // a separate RPC that knows nothing about dates).
    const mode: 'sections' | 'unified' =
        (selectedDistrict || searchTerm || sourceFilter || dateRangeActive || importBatchId) ? 'unified' : 'sections';
    const viewFiltersActive = mode === 'unified';
    const canSelect = canManage;

    const loadData = useCallback(async (p?: number) => {
        if (!activeEventId) return;
        const currentPage = p ?? pageRef.current;
        setListLoading(true);
        try {
            const [paginated, settData] = await Promise.all([
                db.getPaginatedDelegates(currentPage, PAGE_SIZE, searchTerm || undefined, selectedDistrict || undefined, scope.region, activeEventId, sourceFilter || undefined, activeDateRange, dateBasis, importBatchId || undefined),
                db.getSettings()
            ]);
            setDelegates(paginated.data);
            setTotalPages(paginated.totalPages);
            setTotalRecords(paginated.total);
            setSettings(settData);
            setPage(currentPage);
            pageRef.current = currentPage;
        } catch (err) {
            console.error("Master List Load Error:", err);
        } finally {
            setListLoading(false);
            setRpcHealth(db.getMasterListRpcHealth());
        }
    }, [searchTerm, selectedDistrict, activeEventId, sourceFilter, activeDateRange, dateBasis, importBatchId]);

    const loadDistrictPage = useCallback(async (district: string, pageNum: number) => {
        if (!activeEventId) return;
        setDistrictSections(prev => ({
            ...prev,
            [district]: { ...(prev[district] || { delegates: [], page: 1, total: 0, pages: 0 }), loading: true },
        }));
        try {
            const result = await db.getPaginatedDelegates(pageNum, PAGE_SIZE, undefined, district, undefined, activeEventId, sourceFilter || undefined);
            setDistrictSections(prev => ({
                ...prev,
                [district]: { delegates: result.data, page: pageNum, total: result.total, pages: result.totalPages, loading: false },
            }));
        } catch (err) {
            console.error(`[MasterList] loadDistrictPage error for ${district}:`, err);
            setDistrictSections(prev => ({
                ...prev,
                [district]: { ...(prev[district] || { delegates: [], page: 1, total: 0, pages: 0 }), loading: false },
            }));
        }
    }, [activeEventId, sourceFilter]);

    const loadAllDistricts = useCallback(async () => {
        if (!activeEventId) return;
        const run = ++districtsSeq.current;
        setDistrictListLoading(true);
        try {
            const [list, settData] = await Promise.all([
                db.getDistrictsWithDelegates(activeEventId, sourceFilter || undefined),
                db.getSettings(),
            ]);
            if (districtsSeq.current !== run) return;
            setDistrictList(list);
            setSettings(settData);
            const init: Record<string, any> = {};
            for (const d of list) {
                init[d.district] = { delegates: [], page: 1, total: d.count, pages: Math.ceil(d.count / PAGE_SIZE), loading: true };
            }
            setDistrictSections(init);

            // The page only waits for the district LIST, never for every section's
            // first page. v1.96 awaited the whole pool, which kept the page-level
            // splash up for ceil(N/4) sequential rounds even though each section
            // renders its own "Loading..." row. Clearing here makes the page
            // usable after ~1 round-trip; sections fill in as they arrive.
            if (districtsSeq.current !== run) return;
            setDistrictListLoading(false);

            // One RPC per district is inherent (each section paginates on its own),
            // but firing 20-25 at once burst the connection pool. Four at a time
            // keeps the server calm and renders each section as it arrives.
            const queue = list.map(d => d.district);
            const CONCURRENCY = 4;
            let cursor = 0;
            const worker = async () => {
                while (cursor < queue.length) {
                    if (districtsSeq.current !== run) return;
                    const district = queue[cursor++];
                    await loadDistrictPage(district, 1);
                }
            };
            await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, () => worker()));
        } catch (err) {
            console.error('[MasterList] loadAllDistricts error:', err);
        } finally {
            if (districtsSeq.current === run) {
                setDistrictListLoading(false);
                setListLoading(false);
                setRpcHealth(db.getMasterListRpcHealth());
            }
        }
    }, [activeEventId, sourceFilter, loadDistrictPage]);

    useEffect(() => {
        if (!activeEventId) return;
        if (mode === 'sections') {
            loadAllDistricts();
        } else {
            loadData(1);
        }
    }, [activeEventId, mode, selectedDistrict, searchTerm, sourceFilter, regFrom, regTo, dateBasis, importBatchId]);

    // v1.94: import batches for the active event (filter dropdown).
    useEffect(() => {
        if (!activeEventId) { setImportBatches([]); return; }
        db.getImportBatches(activeEventId, 30).then(setImportBatches).catch(() => setImportBatches([]));
    }, [activeEventId]);

    // Selection is event-scoped: never carry checked rows across an event switch.
    useEffect(() => {
        setSelected(new Map());
        setBulkConfirmOpen(false);
        setConfirmText('');
        setBulkNotice(null);
    }, [activeEventId]);

    useEffect(() => {
        if (mode === 'sections') return;
        const delegateSub = supabase.channel(`master_list_sync_${activeEventId}`)
          .on('postgres_changes', { event: '*', schema: 'public', table: 'delegates', filter: activeEventId ? `event_id=eq.${activeEventId}` : undefined }, () => loadData(pageRef.current))
          .subscribe();
        const settingsSub = supabase.channel('settings_sync_master')
          .on('postgres_changes', { event: '*', schema: 'public', table: 'system_settings' }, () => loadData(pageRef.current))
          .subscribe();
        return () => { supabase.removeChannel(delegateSub); settingsSub.unsubscribe(); };
    }, [loadData, mode, sourceFilter]);

    const officialDistricts = useMemo(() => {
        return (settings?.districts || [])
            .map(d => d.trim())
            .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true }));
    }, [settings]);

    const displayGroups = useMemo(() => {
        const groups: string[] = [];
        const seen = new Set<string>();
        const officialSet = new Set(officialDistricts.map(d => d.trim().toUpperCase()));
        
        officialDistricts.forEach(d => {
            groups.push(d);
            seen.add(d.trim().toUpperCase());
        });
        
        delegates.forEach(d => {
            const dNorm = (d.district || '').trim();
            if (dNorm && !seen.has(dNorm.toUpperCase())) {
                seen.add(dNorm.toUpperCase());
                groups.push(dNorm);
            }
        });
        
        return groups;
    }, [delegates, officialDistricts]);

    const titles = settings?.titles || ['Mr', 'Mrs', 'Ms', 'Chief', 'Dr', 'Prof', 'Engr', 'Elder'];

    const handleUpdate = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!editingId) return;
        if (!editForm.first_name || !editForm.last_name || !editForm.district) {
            alert("First Name, Last Name, and District are required.");
            return;
        }
        setSaving(true);
        try {
            await db.updateDelegate(editingId, editForm);
            alert("SUCCESS: Delegate record updated and normalized.");
            const editedDistrict = (editForm.district || '').trim();
            setEditingId(null);
            if (mode === 'sections') {
                loadDistrictPage(editedDistrict, districtSections[editedDistrict]?.page || 1);
                db.getDistrictsWithDelegates(activeEventId, sourceFilter || undefined).then(setDistrictList).catch(() => {});
            } else {
                await loadData();
            }
        } catch(err: any) {
            const msg = err?.message || "An error occurred.";
            if (canManage && activeEventId && (String(err?.code) === '23505' || msg.includes('23505') || msg.includes('duplicate key'))) {
                try {
                    const candidates = await db.findIdentityCollision(editingId, editForm, activeEventId);
                    if (candidates.length > 0) {
                        setMergePrompt({ dropId: editingId, candidates });
                        return;
                    }
                } catch (_) {}
            }
            alert("UPDATE FAILED: " + msg);
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async (d: Delegate) => {
        if (!activeEventId) return;
        if (!canDelete) {
            alert("Delete is disabled for this event. Enable \"Allow Admins to Delete Delegates\" in Events & Config first.");
            return;
        }
        const name = `${d.first_name} ${d.last_name}`.trim();
        if (!window.confirm(`PERMANENTLY DELETE "${name}" (${d.district || ''}${d.chapter ? ' / ' + d.chapter : ''})?\n\nThis will also permanently remove this delegate's check-ins, session responses, and badge print history. Use "Merge" instead when the record is a duplicate of another delegate.\n\nThis action cannot be undone.`)) return;
        try {
            await db.deleteDelegate(d.delegate_id, activeEventId);
            setSelected(prev => {
                if (!prev.has(d.delegate_id)) return prev;
                const next = new Map(prev);
                next.delete(d.delegate_id);
                return next;
            });
            alert(`DELETED: ${name}`);
            if (mode === 'sections') {
                db.getDistrictsWithDelegates(activeEventId, sourceFilter || undefined).then(setDistrictList).catch(() => {});
                loadDistrictPage(d.district, districtSections[d.district]?.page || 1);
            } else {
                await loadData();
            }
            refreshEventTotal();
        } catch (e: any) {
            alert("DELETE FAILED: " + (e.message || 'An error occurred.'));
        }
    };

    const handleMergeFix = async () => {
        if (!mergePrompt || !activeEventId) return;
        const keep = mergePrompt.candidates[0];
        setMerging(true);
        try {
            await db.mergeDelegatePair({ keepId: keep.delegate_id, dropId: mergePrompt.dropId, eventId: activeEventId, reason: 'lastname duplicate' });
            alert(`SUCCESS: Records merged into ${keep.first_name} ${keep.last_name}. Check-ins, session responses, and badge history were preserved.`);
            setEditingId(null);
            setMergePrompt(null);
            if (mode === 'sections') {
                loadAllDistricts();
            } else {
                await loadData();
            }
            refreshEventTotal();
        } catch (e: any) {
            alert("MERGE FAILED: " + (e.message || 'An error occurred.'));
        } finally {
            setMerging(false);
        }
    };

    useEffect(() => {
        if (editForm.district) {
            db.getChapters(editForm.district).then(setChapters).catch(() => setChapters([]));
        } else {
            setChapters([]);
        }
    }, [editForm.district]);

    const startEditing = (d: Delegate) => {
        const clean = (val?: string) => (val || '').replace(/\s+/g, ' ').trim();
        setEditingId(d.delegate_id);
        // v1.103: seed ONLY the editable fields. Spreading the fetched row used to
        // pull GENERATED columns (search_text / name_search / last_activity_at)
        // into the form, which Postgres refuses to UPDATE (428C9), breaking every
        // Master List save. Keep generated/system columns out of the form state.
        setEditForm({
            title: clean(d.title),
            first_name: d.first_name || '',
            last_name: d.last_name || '',
            district: clean(d.district),
            chapter: clean(d.chapter),
            phone: d.phone || '',
            email: d.email || '',
            rank: clean(d.rank),
            office: clean(d.office),
            delegate_type: d.delegate_type || '',
        });
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    // Helper: Robust Official Check (PERMANENT FIX: Case-Insensitive)
    const isValueOfficial = (val: string, list: string[]) => {
        if (!val) return true;
        const normalized = val.replace(/\s+/g, ' ').trim().toUpperCase();
        return list.some(item => item.replace(/\s+/g, ' ').trim().toUpperCase() === normalized);
    };

    const [exporting, setExporting] = useState<'pdf' | 'csv' | null>(null);
    const [exportProgress, setExportProgress] = useState<{ done: number; total: number } | null>(null);
    const [exportNotice, setExportNotice] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
    const [eventTotal, setEventTotal] = useState<number | null>(null);

    const refreshEventTotal = useCallback(async () => {
        if (!activeEventId) { setEventTotal(null); return; }
        try {
            setEventTotal(await db.getDelegateCount(activeEventId));
        } catch (err) {
            console.error('[MasterList] event total failed:', err);
            setEventTotal(null);
        }
    }, [activeEventId]);

    useEffect(() => { refreshEventTotal(); }, [refreshEventTotal]);

    const exportFileStem = (district?: string) => {
        const distLabel = district ? district.replace(/[^A-Za-z0-9-]/g, '-') : 'All-Districts';
        const sourceLabel = sourceFilterLabel(sourceFilter);
        const rangeLabel = dateRangeActive ? `${regFrom || 'start'}_to_${regTo || 'end'}${dateBasis === 'created' ? '_created' : ''}` : (importBatchId ? 'import-batch' : '');
        return `Delegate_Master_List_${sourceLabel ? sourceLabel + '_' : ''}${distLabel}${rangeLabel ? '_' + rangeLabel : ''}`;
    };

    const handleExport = async () => {
        if (!activeEventId) return;
        setExporting('pdf');
        setExportProgress(null);
        setExportNotice(null);
        try {
            const district = selectedDistrict || undefined;
            const search = searchTerm || undefined;
            const source = sourceFilter || undefined;
            const all = await db.fetchAllDelegatesForExport(activeEventId, district, search, source, activeDateRange, dateBasis, importBatchId || undefined);
            if (all.length === 0) throw new Error('No delegates match the current filters');
            const sorted = sortDelegatesByDistrict(all);

            const columns: MasterListPdfColumn[] = [
                { label: '#', weight: 4, align: 'right' },
                { label: 'District', weight: 18 },
                { label: 'Title', weight: 6 },
                { label: 'Full Name', weight: 30 },
                { label: 'Chapter', weight: 13 },
                { label: 'Email', weight: 21 },
            ];
            if (showRank) columns.push({ label: 'Rank', weight: 10 });
            if (showOffice) columns.push({ label: 'Office', weight: 11 });
            if (showDelegateType) columns.push({ label: 'Type', weight: 10 });
            columns.push({ label: 'Phone', weight: 14 });
            columns.push({ label: 'Source', weight: 7, align: 'center' });
            columns.push({ label: 'Reg ID', weight: 17 });
            if (dateRangeActive) columns.push({ label: 'Registered', weight: 9 }, { label: 'Last activity', weight: 9 });
            if (showPaymentCols) columns.push({ label: 'Payment', weight: 11, align: 'right' }, { label: 'Payment Ref', weight: 13 });

            const rows: MasterListPdfRow[] = sorted.map((d, i) => {
                const values: string[] = [
                    String(i + 1),
                    (d.district || '').trim() || '-',
                    (d.title || '').trim(),
                    `${d.first_name || ''} ${d.last_name || ''}`.replace(/\s+/g, ' ').trim(),
                    (d.chapter || '').trim() || '-',
                    (d.email || '').trim() || '-',
                ];
                if (showRank) values.push((d.rank || '').trim());
                if (showOffice) values.push((d.office || '').trim());
                if (showDelegateType) values.push((d.delegate_type || 'Member').trim());
                values.push((d.phone || '').trim());
                values.push(sourceFilterLabel(d.reg_type || 'manual') || 'Manual');
                values.push(showRegId(d) ? ((d.external_id || '').trim() || '-') : '-');
                if (dateRangeActive) values.push(regDateOf(d), activityDateOf(d));
                if (showPaymentCols) values.push(
                    d.payment_amount != null ? formatCurrency(d.payment_amount) : '-',
                    (d.payment_reference || '').trim() || '-'
                );
                return { values, district: (d.district || '').trim() };
            });

            const filename = `${exportFileStem(district)}.pdf`;
            const filterBits = [
                district ? `District: ${district}` : 'All Districts',
                source ? `Source: ${sourceFilterLabel(source)}` : '',
                search ? `Search: "${search}"` : '',
                dateRangeActive ? `${dateBasis === 'created' ? 'Registered' : 'Last activity'} ${describeDateRange(dateRange)}` : '',
                importBatchId ? 'Import batch filter' : '',
            ].filter(Boolean) as string[];
            const totalsBit = eventTotal != null && eventTotal !== sorted.length
                ? `${sorted.length.toLocaleString('en-GB')} delegates exported of ${eventTotal.toLocaleString('en-GB')} in this event`
                : `${sorted.length.toLocaleString('en-GB')} delegates exported`;
            const subtitleLines = [
                [activeEvent?.name, activeEvent?.region].filter(Boolean).join(' - ') || 'FGBMFI Nigeria',
                filterBits.join('  |  '),
                `${totalsBit}  |  Generated ${new Date().toLocaleString('en-GB')}`,
            ];

            const result = await exportMasterListPDF({
                filename,
                title: 'FGBMFI NIGERIA - DELEGATE MASTER LIST',
                subtitleLines,
                columns,
                rows,
                groupByDistrict: true,
                onProgress: (done, total) => setExportProgress({ done, total }),
            });
            setExportNotice({
                kind: 'success',
                text: `PDF export complete - ${result.rows.toLocaleString('en-GB')} delegates, ${result.pages} page(s). ${filename}`,
            });
        } catch (err: any) {
            console.error('PDF export error:', err);
            setExportNotice({
                kind: 'error',
                text: `PDF export failed: ${err?.message || 'unknown error'}. Use the CSV button instead, then print from Excel or Google Sheets.`,
            });
        } finally {
            setExporting(null);
            setExportProgress(null);
        }
    };

    const handleCSVExport = async () => {
        if (!activeEventId) return;
        setExporting('csv');
        setExportNotice(null);
        try {
            const district = selectedDistrict || undefined;
            const search = searchTerm || undefined;
            const source = sourceFilter || undefined;
            const all = await db.fetchAllDelegatesForExport(activeEventId, district, search, source, activeDateRange, dateBasis, importBatchId || undefined);
            if (all.length === 0) throw new Error('No delegates match the current filters');
            const sorted = sortDelegatesByDistrict(all);
            const stem = exportFileStem(district);
            const cols = ['district', 'title', 'first_name', 'last_name', 'chapter', 'email'];
            if (showRank) cols.push('rank');
            if (showOffice) cols.push('office');
            if (showDelegateType) cols.push('delegate_type');
            cols.push('phone', 'external_id', 'reg_type');
            if (dateRangeActive) cols.push('created_at', 'last_activity_at');
            if (showPaymentCols) cols.push('payment_amount', 'payment_reference');
            exportToCSV(sorted, `${stem}.csv`, cols);
            setExportNotice({
                kind: 'success',
                text: `CSV export complete - ${sorted.length.toLocaleString('en-GB')} delegates, sorted by district. ${stem}.csv`,
            });
        } catch (err: any) {
            console.error('CSV export error:', err);
            setExportNotice({ kind: 'error', text: `CSV export failed: ${err?.message || 'unknown error'}.` });
        } finally {
            setExporting(null);
        }
    };

    const selectedIds = useMemo(() => Array.from(selected.keys()), [selected]);

    const scopeRecordCount = mode === 'sections'
        ? districtList.reduce((sum, d) => sum + (d.count || 0), 0)
        : totalRecords;

    const selectionByDistrict = useMemo(() => {
        const map = new Map<string, number>();
        selected.forEach(v => {
            const key = v.district || '(no district)';
            map.set(key, (map.get(key) || 0) + 1);
        });
        return Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
    }, [selected]);

    const toggleRow = (d: Delegate) => {
        setSelected(prev => {
            const next = new Map(prev);
            if (next.has(d.delegate_id)) next.delete(d.delegate_id);
            else next.set(d.delegate_id, selectionInfoOf(d));
            return next;
        });
        setBulkNotice(null);
    };

    const togglePage = (rows: Delegate[]) => {
        setSelected(prev => {
            const next = new Map(prev);
            const allSelected = rows.length > 0 && rows.every(r => next.has(r.delegate_id));
            for (const r of rows) {
                if (allSelected) next.delete(r.delegate_id);
                else next.set(r.delegate_id, selectionInfoOf(r));
            }
            return next;
        });
        setBulkNotice(null);
    };

    const clearSelection = () => {
        setSelected(new Map());
        setBulkConfirmOpen(false);
        setConfirmText('');
    };

    const handleSelectAllMatching = async () => {
        if (!activeEventId || bulkBusy) return;
        setBulkBusy(true);
        setBulkNotice(null);
        try {
            const rows = await db.getDelegateSelectionScope(activeEventId, {
                search: searchTerm || undefined,
                district: selectedDistrict || undefined,
                region: scope.region,
                source: sourceFilter || undefined,
                range: activeDateRange,
                basis: dateBasis,
                importBatchId: importBatchId || undefined,
            });
            setSelected(new Map(rows.map(r => [r.delegate_id, { name: r.name, district: r.district }])));
            setBulkNotice(`Selected ${rows.length} delegate(s) matching the current filters.`);
        } catch (e: any) {
            alert('SELECT ALL FAILED: ' + (e.message || 'An error occurred.'));
        } finally {
            setBulkBusy(false);
        }
    };

    const handleBulkBackup = async () => {
        if (!activeEventId || selectedIds.length === 0) return;
        try {
            const rows = await db.fetchDelegatesByIds(activeEventId, selectedIds);
            downloadJSON({
                exported_at: new Date().toISOString(),
                event: activeEvent?.name || activeEventId,
                count: rows.length,
                delegates: rows,
            }, `FGBMFI_Delegate_Backup_${new Date().toISOString().slice(0, 10)}.json`);
        } catch (e: any) {
            alert('BACKUP FAILED: ' + (e.message || 'An error occurred.'));
        }
    };

    const refreshAfterBulk = async () => {
        if (mode === 'sections') {
            await loadAllDistricts();
        } else {
            await loadData(pageRef.current);
        }
        await refreshEventTotal();
    };

    const handleBulkDelete = async () => {
        if (!activeEventId || selectedIds.length === 0 || bulkDeleting) return;
        setBulkDeleting(true);
        try {
            const res = await db.deleteDelegatesBulk(activeEventId, selectedIds);
            const failed = new Set(res.failedIds);
            const kept = new Map<string, SelectionInfo>();
            selected.forEach((info, id) => { if (failed.has(id)) kept.set(id, info); });
            setSelected(kept);
            setBulkConfirmOpen(false);
            setConfirmText('');
            setBulkNotice(res.deleted > 0
                ? `Deleted ${res.deleted} delegate(s).${res.failedIds.length ? ` ${res.failedIds.length} failed and are still selected for retry.` : ''}`
                : 'Nothing was deleted.');
            await refreshAfterBulk();
        } catch (e: any) {
            alert('BULK DELETE FAILED: ' + (e.message || 'An error occurred.'));
        } finally {
            setBulkDeleting(false);
        }
    };

    return (
        <div className="space-y-6">
            {editingId && (
                <div className="bg-blue-50 p-8 rounded-2xl shadow-md border-2 border-blue-200 animate-in fade-in slide-in-from-top-4 duration-300 no-print">
                    <div className="flex justify-between items-center mb-6 border-b border-blue-200 pb-4">
                        <h3 className="text-xl font-black text-blue-900 uppercase tracking-widest">Modify Delegate Record</h3>
                        <button onClick={() => setEditingId(null)} className="text-blue-400 hover:text-red-600 transition-colors font-black uppercase text-[10px]">Cancel [X]</button>
                    </div>
                    <form onSubmit={handleUpdate} className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div className="space-y-1">
                            <label className="text-[10px] font-black text-blue-800 uppercase">Title</label>
                            <select className="w-full p-3 border rounded-xl bg-white font-bold" value={editForm.title} onChange={e => setEditForm({...editForm, title: e.target.value})}>
                                {titles.map(t => <option key={t} value={t}>{t}</option>)}
                            </select>
                        </div>
                        <div className="space-y-1"><label className="text-[10px] font-black text-blue-800 uppercase">First Name</label><input className="w-full p-3 border rounded-xl bg-white font-bold" value={editForm.first_name} onChange={e => setEditForm({...editForm, first_name: e.target.value})} /></div>
                        <div className="space-y-1"><label className="text-[10px] font-black text-blue-800 uppercase">Last Name</label><input className="w-full p-3 border rounded-xl bg-white font-bold" value={editForm.last_name} onChange={e => setEditForm({...editForm, last_name: e.target.value})} /></div>
                        <div className="space-y-1">
                            <label className="text-[10px] font-black text-blue-800 uppercase">District</label>
                            <select className="w-full p-3 border rounded-xl bg-white font-bold" value={editForm.district} onChange={e => setEditForm({...editForm, district: e.target.value})}>
                                <option value="">Select District</option>
                                {officialDistricts.map(d => <option key={d} value={d}>{d}</option>)}
                                {editForm.district && !isValueOfficial(editForm.district, officialDistricts) && (
                                    <option value={editForm.district}>{editForm.district} (Un-normalized Data)</option>
                                )}
                            </select>
                        </div>
                        <div className="space-y-1">
                            <label className="text-[10px] font-black text-blue-800 uppercase">Chapter</label>
                            {chapters.length > 0 ? (
                                <select className="w-full p-3 border rounded-xl bg-white font-bold" value={editForm.chapter} onChange={e => setEditForm({...editForm, chapter: e.target.value})}>
                                    <option value="">Select Chapter</option>
                                    {chapters.map(c => <option key={c.chapter_id} value={c.chapter_name}>{c.chapter_name}</option>)}
                                </select>
                            ) : (
                                <input className="w-full p-3 border rounded-xl bg-white font-bold" value={editForm.chapter} onChange={e => setEditForm({...editForm, chapter: e.target.value})} />
                            )}
                        </div>
                        <div className="space-y-1"><label className="text-[10px] font-black text-blue-800 uppercase">Phone</label><input className="w-full p-3 border rounded-xl bg-white font-bold" value={editForm.phone} onChange={e => setEditForm({...editForm, phone: e.target.value})} /></div>
                        <div className="space-y-1">
                            <label className="text-[10px] font-black text-blue-800 uppercase">Email</label>
                            <input type="email" className="w-full p-3 border rounded-xl bg-white font-bold" value={editForm.email} onChange={e => setEditForm({...editForm, email: e.target.value})} />
                        </div>
                        {showRank && (
                        <div className="space-y-1">
                            <label className="text-[10px] font-black text-blue-800 uppercase">Rank</label>
                            <select className="w-full p-3 border rounded-xl bg-white font-bold" value={editForm.rank} onChange={e => setEditForm({...editForm, rank: e.target.value})}>
                                <option value="">Select Rank</option>
                                {settings?.ranks.map(r => <option key={r} value={r}>{r}</option>)}
                                {editForm.rank && !isValueOfficial(editForm.rank, settings?.ranks || []) && (
                                    <option value={editForm.rank}>{editForm.rank} (Custom)</option>
                                )}
                            </select>
                        </div>
                        )}
                        {showOffice && (
                        <div className="space-y-1">
                            <label className="text-[10px] font-black text-blue-800 uppercase">Office</label>
                            <select className="w-full p-3 border rounded-xl bg-white font-bold" value={editForm.office} onChange={e => setEditForm({...editForm, office: e.target.value})}>
                                <option value="">Select Office</option>
                                {settings?.offices.map(o => <option key={o} value={o}>{o}</option>)}
                                {editForm.office && !isValueOfficial(editForm.office, settings?.offices || []) && (
                                    <option value={editForm.office}>{editForm.office} (Custom)</option>
                                )}
                            </select>
                        </div>
                        )}
                        {showDelegateType && (
                        <div className="space-y-1">
                            <label className="text-[10px] font-black text-blue-800 uppercase">Delegate Type</label>
                            <select className="w-full p-3 border rounded-xl bg-white font-bold" value={editForm.delegate_type} onChange={e => setEditForm({...editForm, delegate_type: e.target.value})}>
                                <option value="">Select Type</option>
                                {(settings?.delegate_types || []).map(dt => <option key={dt} value={dt}>{dt}</option>)}
                            </select>
                        </div>
                        )}
                        <div className="flex items-end">
                            <button type="submit" disabled={saving} className="w-full py-4 bg-blue-900 text-white rounded-xl font-black uppercase text-xs tracking-widest shadow-xl h-[52px]">
                                {saving ? 'SAVING...' : 'SAVE CHANGES'}
                            </button>
                        </div>
                    </form>
                </div>
            )}

            {mergePrompt && mergePrompt.candidates.length > 0 && (
                <div className="bg-red-50 p-8 rounded-2xl shadow-md border-2 border-red-200 no-print">
                    <div className="flex justify-between items-center mb-4 border-b border-red-200 pb-4">
                        <h3 className="text-xl font-black text-red-900 uppercase tracking-widest">Existing Duplicate Found</h3>
                        <button onClick={() => setMergePrompt(null)} className="text-red-400 hover:text-red-600 transition-colors font-black uppercase text-[10px]">Cancel [X]</button>
                    </div>
                    <p className="text-sm font-bold text-gray-600 mb-4">
                        Your edit to <span className="text-red-800 font-black uppercase">{editForm.first_name} {editForm.last_name}</span> collides with an existing delegate record (same name and phone).
                        To keep this delegate's check-in / session / badge history, merge the two records instead of saving a second copy.
                    </p>
                    <div className="space-y-3 mb-6">
                        {mergePrompt.candidates.map(c => (
                            <div key={c.delegate_id} className="bg-white border border-red-100 rounded-xl p-4 flex items-center gap-4">
                                <span className="bg-red-100 text-red-700 rounded-full px-3 py-1 text-[10px] font-black uppercase">Existing</span>
                                <div className="flex-1">
                                    <span className="font-black text-gray-900 uppercase">{c.title} {c.first_name} {c.last_name}</span>
                                    <span className="block text-[10px] font-bold text-gray-400 uppercase">{c.district || '-'} / {c.chapter || '-'}</span>
                                </div>
                                <span className="text-xs font-mono text-blue-700">{c.phone}</span>
                            </div>
                        ))}
                    </div>
                    <button onClick={handleMergeFix} disabled={merging} className="w-full py-4 bg-emerald-600 text-white rounded-xl font-black uppercase text-xs tracking-widest shadow-xl hover:bg-emerald-700 disabled:opacity-50">
                        {merging ? 'MERGING RECORDS...' : '\u2713 REDEEM AS ONE \u2014 MERGE INTO EXISTING RECORD'}
                    </button>
                </div>
            )}

            <div className="bg-white p-6 rounded-xl shadow-sm border flex flex-col md:flex-row gap-4 justify-between items-center no-print">
                <div className="text-center md:text-left">
                    <h2 className="text-xl font-black uppercase tracking-widest text-blue-900">Delegates Master List</h2>
                    <p className="mt-1 text-[10px] font-black uppercase tracking-wider text-gray-500">
                        {eventTotal == null
                            ? 'Counting delegates...'
                            : `${eventTotal.toLocaleString('en-GB')} delegate${eventTotal === 1 ? '' : 's'} across all districts`}
                        {viewFiltersActive && !listLoading && (
                            <span className="text-blue-700"> · {totalRecords.toLocaleString('en-GB')} matching this view</span>
                        )}
                    </p>
                </div>
                <div className="flex flex-1 flex-wrap gap-2 justify-end w-full md:w-auto">
                    <select className="p-2 border rounded-lg bg-gray-50 text-xs font-bold uppercase" value={selectedDistrict} onChange={e => setSelectedDistrict(e.target.value)}>
                        <option value="">All Official Districts</option>
                        {officialDistricts.map(d => <option key={d} value={d}>{d}</option>)}
                    </select>
                    <select className="p-2 border rounded-lg bg-gray-50 text-xs font-bold uppercase" value={sourceFilter} onChange={e => setSourceFilter(e.target.value as 'portal' | 'web' | 'manual' | 'ems' | '')}>
                        <option value="">All Sources</option>
                        <option value="portal">Portal</option>
                        <option value="web">Web</option>
                        <option value="ems">EMS</option>
                        <option value="manual">Manual</option>
                    </select>
                    <select className="p-2 border rounded-lg bg-gray-50 text-xs font-bold uppercase max-w-[240px]"
                        value={importBatchId} onChange={e => setImportBatchId(e.target.value)}
                        title="Every row from one CSV upload is linked to an import batch.">
                        <option value="">All Imports</option>
                        {importBatches.map(b => (
                            <option key={b.batch_id} value={b.batch_id}>
                                {(b.label || 'Import')} · {new Date(b.created_at).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })} ·{' '}
                                {b.stamped != null ? `${b.stamped} delegate${b.stamped === 1 ? '' : 's'} · ${b.row_count} rows` : `${b.row_count} rows`}
                            </option>
                        ))}
                    </select>
                    <div className={`flex items-center gap-1 px-2 py-1 rounded-lg border ${dateRangeActive ? 'bg-blue-50 border-blue-300' : 'bg-gray-50 border-gray-100'}`}
                        title={dateBasis === 'created'
                            ? 'Filter on the date each delegate was first registered / uploaded.'
                            : 'Filter on the delegate\'s latest activity: last detail change, or registration when never updated. Badge printing does not count.'}>
                        <select value={dateBasis} onChange={e => setDateBasis(e.target.value as DateBasis)}
                            className="p-1 border rounded-md bg-white text-[9px] font-black uppercase tracking-wider text-gray-600"
                            title="Which date the range uses">
                            <option value="activity">Last activity</option>
                            <option value="created">Created only</option>
                        </select>
                        <input type="date" className="p-1 border rounded-md bg-white text-[10px] font-bold"
                            value={regFrom} onChange={e => setRegFrom(e.target.value)} />
                        <span className="text-[8px] font-black text-gray-400">to</span>
                        <input type="date" className="p-1 border rounded-md bg-white text-[10px] font-bold"
                            value={regTo} onChange={e => setRegTo(e.target.value)} />
                        {dateRangeActive && (
                            <button onClick={() => { setRegFrom(''); setRegTo(''); }}
                                className="text-[9px] font-black text-red-500 hover:text-red-700 px-1" title="Clear the date range">×</button>
                        )}
                    </div>
                    {dateRangeInvalid && (
                        <span className="text-[9px] font-black uppercase text-red-600 self-center">End date is before start date</span>
                    )}
                    {paymentEnabled && (
                        <label className={`flex items-center gap-2 px-3 py-2 rounded-lg border cursor-pointer select-none transition-all ${showPaymentCols ? 'bg-blue-50 border-blue-300' : 'bg-gray-50 border-gray-100'}`}
                            title="EMS registrations capture Payment Amount & Reference. Toggle to show these columns.">
                            <input
                                type="checkbox"
                                checked={showPaymentCols}
                                onChange={e => {
                                    const next = e.target.checked;
                                    setShowPaymentCols(next);
                                    try { localStorage.setItem('fgbmfi_ml_show_payments', next ? '1' : '0'); } catch {}
                                }}
                                className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                            />
                            <span className="text-[10px] font-black uppercase tracking-widest text-gray-600">Show Payment Details</span>
                        </label>
                    )}
                    <input className="p-2 border rounded-lg text-xs min-w-[200px] font-medium" placeholder="Search by name, phone, email..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} />
                    <button onClick={handleExport} disabled={!!exporting} className="px-6 py-2 bg-slate-900 text-white rounded-lg text-[10px] font-black shadow-lg uppercase tracking-widest disabled:opacity-50">
                        {exporting === 'pdf'
                            ? (exportProgress
                                ? `Exporting ${exportProgress.done.toLocaleString('en-GB')}/${exportProgress.total.toLocaleString('en-GB')}`
                                : 'Exporting PDF...')
                            : 'Export PDF'}
                    </button>
                    <button onClick={handleCSVExport} disabled={!!exporting} className="px-4 py-2 bg-green-700 text-white rounded-lg text-[10px] font-black uppercase disabled:opacity-50">{exporting === 'csv' ? 'Exporting CSV...' : 'CSV'}</button>
                    <button onClick={() => { if (mode === 'sections') loadAllDistricts(); else loadData(); refreshEventTotal(); }} className="px-4 py-2 bg-gray-100 text-gray-600 rounded-lg text-[10px] font-black uppercase border">Refresh</button>
                </div>
            </div>

            {exportNotice && (
                <div className={`no-print flex items-start justify-between gap-3 rounded-lg border px-4 py-2 text-[10px] font-black uppercase tracking-wider ${
                    exportNotice.kind === 'error'
                        ? 'bg-red-50 border-red-200 text-red-800'
                        : 'bg-emerald-50 border-emerald-200 text-emerald-800'
                }`}>
                    <span className="break-words">{exportNotice.text}</span>
                    <button onClick={() => setExportNotice(null)} className="shrink-0 px-1 opacity-60 hover:opacity-100" title="Dismiss">×</button>
                </div>
            )}

            {dateRangeActive && (
                <div className="no-print -mt-2 text-[10px] font-bold text-blue-800 bg-blue-50 border border-blue-100 rounded-lg px-4 py-2">
                    {dateBasis === 'created' ? 'Registered' : 'Last activity'} {describeDateRange(dateRange)}
                    {dateRangeInvalid ? ' — invalid range, showing all dates' : ''}
                    {' · '}{totalRecords} record(s)
                    {dateBasis === 'activity' ? ' · includes records edited in the window (badge printing does not count)' : ''}
                </div>
            )}

            {bulkNotice && (
                <div className="no-print flex items-center justify-between gap-3 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-lg px-4 py-2 text-[10px] font-black uppercase tracking-wider">
                    <span>{bulkNotice}</span>
                    <button onClick={() => setBulkNotice(null)} className="text-emerald-500 hover:text-emerald-800">×</button>
                </div>
            )}

            {canSelect && selected.size > 0 && (
                <div className="no-print bg-slate-900 text-white rounded-xl px-4 py-3 flex flex-wrap items-center gap-3 justify-between">
                    <div className="flex items-center gap-3">
                        <span className="bg-white text-slate-900 rounded-full px-3 py-1 text-[10px] font-black uppercase">{selected.size} selected</span>
                        <span className="text-[9px] font-bold text-slate-300 uppercase tracking-wider">
                            {selectionByDistrict.slice(0, 4).map(([d, n]) => `${d} (${n})`).join(' · ')}
                            {selectionByDistrict.length > 4 ? ` · +${selectionByDistrict.length - 4} more districts` : ''}
                        </span>
                    </div>
                    <div className="flex items-center gap-2">
                        <button onClick={handleSelectAllMatching} disabled={bulkBusy}
                            className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 rounded-lg text-[9px] font-black uppercase tracking-widest disabled:opacity-50">
                            {bulkBusy ? 'Selecting…' : `Select all matching${scopeRecordCount ? ` (${scopeRecordCount})` : ''}`}
                        </button>
                        <button onClick={clearSelection} className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 rounded-lg text-[9px] font-black uppercase tracking-widest">Clear</button>
                        <button onClick={() => { setBulkConfirmOpen(true); setConfirmText(''); }}
                            className="px-4 py-1.5 bg-red-600 hover:bg-red-700 rounded-lg text-[9px] font-black uppercase tracking-widest">Delete selected</button>
                    </div>
                </div>
            )}

            {canSelect && bulkConfirmOpen && selected.size > 0 && (
                <div className="no-print bg-red-50 border-2 border-red-200 rounded-2xl p-6 space-y-4">
                    <div className="flex justify-between items-start border-b border-red-200 pb-3">
                        <div>
                            <h3 className="text-lg font-black text-red-900 uppercase tracking-widest">Confirm bulk delete</h3>
                            <p className="text-[10px] font-bold text-red-700 uppercase tracking-wider">
                                {selected.size} delegate(s) · {selectionByDistrict.map(([d, n]) => `${d}: ${n}`).join(' · ')}
                            </p>
                        </div>
                        <button onClick={() => { setBulkConfirmOpen(false); setConfirmText(''); }} className="text-red-400 hover:text-red-700 font-black uppercase text-[10px]">Cancel [X]</button>
                    </div>
                    <p className="text-xs font-bold text-red-800 leading-relaxed">
                        This permanently removes these delegates and their check-ins, session responses and badge print history.
                        It cannot be undone. Use <span className="font-black">Merge</span> instead when a record is a duplicate of another delegate.
                    </p>
                    <div className="max-h-40 overflow-y-auto bg-white border border-red-100 rounded-xl divide-y divide-red-50">
                        {Array.from(selected.entries()).slice(0, 50).map(([id, info]) => (
                            <div key={id} className="px-3 py-1.5 flex justify-between gap-3 text-[10px] font-bold">
                                <span className="text-gray-800 uppercase truncate">{info.name || id.slice(0, 8)}</span>
                                <span className="text-gray-400 uppercase shrink-0">{info.district || '—'}</span>
                            </div>
                        ))}
                        {selected.size > 50 && (
                            <div className="px-3 py-1.5 text-[9px] font-black text-gray-400 uppercase">…and {selected.size - 50} more</div>
                        )}
                    </div>
                    <div className="flex flex-wrap items-center gap-3">
                        <button onClick={handleBulkBackup} disabled={bulkDeleting}
                            className="px-4 py-2 bg-white border border-red-200 text-red-700 rounded-lg text-[9px] font-black uppercase tracking-widest disabled:opacity-50">Download backup JSON</button>
                        {selected.size > 20 ? (
                            <div className="flex items-center gap-2">
                                <span className="text-[9px] font-black text-red-700 uppercase tracking-wider">Type DELETE to confirm:</span>
                                <input value={confirmText} onChange={e => setConfirmText(e.target.value)}
                                    className="p-2 border-2 border-red-300 rounded-lg font-black text-xs uppercase w-32" placeholder="DELETE" />
                            </div>
                        ) : null}
                        <button onClick={handleBulkDelete}
                            disabled={bulkDeleting || (selected.size > 20 && confirmText.trim().toUpperCase() !== 'DELETE')}
                            className="ml-auto px-6 py-2.5 bg-red-700 text-white rounded-lg text-[10px] font-black uppercase tracking-widest shadow-lg hover:bg-red-800 disabled:opacity-40">
                            {bulkDeleting ? 'DELETING…' : `DELETE ${selected.size} DELEGATE(S)`}
                        </button>
                    </div>
                </div>
            )}

            <div ref={listRef} className="bg-white rounded-xl shadow-sm border p-6 min-h-screen">
                <div className="print-only mb-8 text-center border-b pb-6">
                    <h1 className="text-2xl font-black uppercase tracking-tight text-blue-900">FGBMFI Nigeria</h1>
                    <h3 className="text-sm font-bold uppercase text-gray-400">Delegates Master List</h3>
                </div>

                {(!rpcHealth.paginated || !rpcHealth.districtCounts) && (
                    <div className="no-print mb-4 p-3 rounded-lg border border-amber-300 bg-amber-50">
                        <p className="text-[10px] font-black text-amber-800 uppercase tracking-wide">
                            Slow mode — the Master List server functions are not deployed, so loading falls back to per-page queries.
                        </p>
                        <p className="text-[10px] font-bold text-amber-700 mt-1">
                            {!rpcHealth.districtCounts && <>Run <code className="bg-white px-1 rounded">supabase_migration_district_counts_rpc.sql</code>. </>}
                            {!rpcHealth.paginated && <>Run <code className="bg-white px-1 rounded">supabase_migration_v1.94_import_batches.sql</code>. </>}
                            Then reload this page.
                        </p>
                    </div>
                )}

                {(mode === 'sections' ? districtListLoading : listLoading) ? (
                    <div className="py-20 text-center text-gray-400 font-bold uppercase tracking-widest animate-pulse">Initializing Master Data...</div>
                ) : mode === 'sections' ? (
                    /* --- MULTI-DISTRICT VIEW: per-district sections with independent pagination --- */
                    districtList.length === 0 ? (
                        <div className="py-20 text-center space-y-4">
                            <div className="text-5xl opacity-20">📂</div>
                            <div className="text-gray-400 font-black uppercase tracking-widest text-sm">No delegates {sourceFilter ? `with ${sourceFilterLabel(sourceFilter)} source` : 'in any district'} for this event.</div>
                        </div>
                    ) : (
                        districtList.map(({ district, count }) => {
                            const sec = districtSections[district];
                            const delegates = sec?.delegates || [];
                            const secPage = sec?.page || 1;
                            const secPages = sec?.pages || 0;
                            const secLoading = sec?.loading ?? true;
                            const secTotal = sec?.total || count;
                            const colSpan = 9 + (showRank ? 1 : 0) + (showOffice ? 1 : 0) + (showDelegateType ? 1 : 0) + (showPaymentCols ? 2 : 0) + (canSelect ? 1 : 0) + (dateRangeActive ? 2 : 0);
                            const isOfficial = isValueOfficial(district, officialDistricts);
                            return (
                                <div key={district} className="mb-6 border rounded-xl overflow-hidden shadow-sm print:break-inside-avoid">
                                    <div className={`${isOfficial ? 'bg-slate-900' : 'bg-orange-600'} text-white p-3 font-black flex justify-between items-center uppercase text-[10px] tracking-widest`}>
                                        <span>{district} DISTRICT{sourceFilter ? ` · ${sourceFilterLabel(sourceFilter).toUpperCase()}` : ''}</span>
                                        <span className="bg-white/10 px-3 py-1 rounded-full">{secTotal} RECORDS</span>
                                    </div>
                                    <div className="overflow-x-auto">
                                        <table className="w-full text-[10px] text-left min-w-[1000px]">
                                            <thead className="bg-gray-50 border-b uppercase text-gray-500 font-black">
                                                <tr>{canSelect && <th className="p-3 w-10 no-print text-center"><input type="checkbox" disabled={!canDelete} className="w-4 h-4 rounded border-gray-300 text-red-600 focus:ring-red-500 align-middle disabled:opacity-40" checked={delegates.length > 0 && delegates.every(x => selected.has(x.delegate_id))} onChange={() => togglePage(delegates)} title={canDelete ? 'Select every row on this page' : 'Delete is disabled for this event — enable it in Events & Config'} /></th>}<th className="p-3 w-12">#</th><th className="p-3 w-16">Title</th><th className="p-3">Full Name</th><th className="p-3">Chapter</th><th className="p-3">Email</th>{showRank && <th className="p-3">Rank</th>}{showOffice && <th className="p-3">Office</th>}{showDelegateType && <th className="p-3">Type</th>}<th className="p-3">Phone</th><th className="p-3">Source</th><th className="p-3">Reg ID</th>{dateRangeActive && <><th className="p-3">Registered</th><th className="p-3" title="Latest detail change, or registration when never updated. Badge printing does not count.">Last activity</th></>}{showPaymentCols && <><th className="p-3">Payment</th><th className="p-3">Payment Ref</th></>}<th className="p-3 no-print w-24 text-center">Actions</th></tr>
                                            </thead>
                                            <tbody className="divide-y divide-gray-100">
                                                {secLoading ? (
                                                    <tr><td colSpan={colSpan} className="p-8 text-center text-gray-300 font-mono text-[9px]">Loading...</td></tr>
                                                ) : delegates.length === 0 ? (
                                                    <tr><td colSpan={colSpan} className="p-8 text-center text-gray-300 font-mono text-[9px]">No records on this page</td></tr>
                                                ) : (
                                                    delegates.map((d, i) => (
                                                        <tr key={d.delegate_id} className={`hover:bg-gray-50 transition-colors ${editingId === d.delegate_id ? 'bg-blue-50' : ''}`}>
                                                            {canSelect && (
                                                                <td className="p-3 no-print text-center">
                                                                    <input type="checkbox" disabled={!canDelete} className="w-4 h-4 rounded border-gray-300 text-red-600 focus:ring-red-500 align-middle disabled:opacity-40"
                                                                        checked={selected.has(d.delegate_id)} onChange={() => toggleRow(d)} title={canDelete ? 'Select this delegate' : 'Delete is disabled for this event — enable it in Events & Config'} />
                                                                </td>
                                                            )}
                                                            <td className="p-3 text-[9px] font-mono text-gray-400">{(secPage - 1) * PAGE_SIZE + i + 1}</td>
                                                            <td className="p-3 font-bold text-gray-400 uppercase">{d.title}</td>
                                                            <td className="p-3 font-black text-gray-900 uppercase">{d.first_name} {d.last_name}</td>
                                                            <td className="p-3 font-medium">{d.chapter || '-'}</td>
                                                            <td className="p-3 font-medium lowercase text-blue-600">{d.email || '-'}</td>
                                                            {showRank && <td className="p-3 font-black text-blue-800 uppercase">{d.rank}</td>}
                                                            {showOffice && <td className="p-3 font-medium uppercase text-[9px]">{d.office}</td>}
                                                            {showDelegateType && <td className="p-3 font-medium text-[9px]">{d.delegate_type || 'Member'}</td>}
                                                            <td className="p-3 font-black text-gray-500 tracking-tighter">{d.phone}</td>
                                                            <td className="p-3">{d.reg_type === 'portal' ? <span className="inline-block px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 font-black text-[8px] uppercase">Portal</span> : d.reg_type === 'web' ? <span className="inline-block px-2 py-0.5 rounded-full bg-blue-100 text-blue-800 font-black text-[8px] uppercase">Web</span> : d.reg_type === 'ems' ? <span className="inline-block px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-800 font-black text-[8px] uppercase">EMS</span> : <span className="inline-block px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 font-black text-[8px] uppercase">Manual</span>}</td>
                                                            <td className="p-3 font-mono text-[9px] text-gray-500">{showRegId(d) ? (d.external_id || '-') : '-'}</td>
                                                            {dateRangeActive && <><td className="p-3 font-mono text-[9px] text-gray-500">{regDateOf(d)}</td><td className="p-3 font-mono text-[9px] text-gray-600">{activityDateOf(d)}</td></>}
                                                            {showPaymentCols && <>
                                                                <td className="p-3 font-black text-gray-700">{d.payment_amount != null ? formatCurrency(d.payment_amount) : <span className="text-gray-300">—</span>}</td>
                                                                <td className="p-3 font-mono text-[9px] text-gray-500">{d.payment_reference || <span className="text-gray-300">—</span>}</td>
                                                            </>}
<td className="p-3 no-print text-center">
                                    <button onClick={() => startEditing(d)} className="text-blue-600 font-black uppercase text-[9px] border border-blue-200 px-3 py-1 rounded-lg hover:bg-blue-600 hover:text-white transition-all">Edit</button>
                                    {canManage && (
                                        <button
                                            onClick={() => handleDelete(d)}
                                            disabled={!canDelete}
                                            title={canDelete ? undefined : 'Delete is disabled for this event — enable it in Events & Config'}
                                            className={`ml-1 font-black uppercase text-[9px] border px-3 py-1 rounded-lg transition-all ${canDelete ? 'text-red-600 border-red-200 hover:bg-red-600 hover:text-white' : 'text-gray-300 border-gray-200 cursor-not-allowed'} disabled:opacity-60`}
                                        >
                                            {canDelete ? 'Delete' : 'Delete (off)'}
                                        </button>
                                    )}
                                </td>
                                                        </tr>
                                                    ))
                                                )}
                                                {!secLoading && delegates.length < PAGE_SIZE && Array.from({ length: PAGE_SIZE - delegates.length }, (_, i) => (
                                                    <tr key={`__pad_${district}_${i}`} className="bg-gray-50/50">
                                                        <td colSpan={colSpan} className="p-3 text-center text-[9px] text-gray-300 font-mono">&nbsp;</td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                    {secPages > 1 && (
                                        <div className="no-print flex items-center justify-center gap-2 py-2 px-3 bg-gray-50 border-t border-gray-100">
                                            <button onClick={() => loadDistrictPage(district, 1)} disabled={secPage <= 1} className="px-2 py-1 bg-white hover:bg-gray-100 disabled:opacity-30 rounded text-[8px] font-black uppercase border">First</button>
                                            <button onClick={() => loadDistrictPage(district, secPage - 1)} disabled={secPage <= 1} className="px-3 py-1 bg-white hover:bg-gray-100 disabled:opacity-30 rounded text-[8px] font-black uppercase border">Prev</button>
                                            <span className="text-[8px] font-bold text-gray-400 uppercase px-1">Pg {secPage}/{secPages}</span>
                                            <button onClick={() => loadDistrictPage(district, secPage + 1)} disabled={secPage >= secPages} className="px-3 py-1 bg-white hover:bg-gray-100 disabled:opacity-30 rounded text-[8px] font-black uppercase border">Next</button>
                                            <button onClick={() => loadDistrictPage(district, secPages)} disabled={secPage >= secPages} className="px-2 py-1 bg-white hover:bg-gray-100 disabled:opacity-30 rounded text-[8px] font-black uppercase border">Last</button>
                                        </div>
                                    )}
                                </div>
                            );
                        })
                    )
                ) : delegates.length === 0 ? (
                    <div className="py-20 text-center space-y-4">
                        <div className="text-5xl opacity-20">📂</div>
                        <div className="text-gray-400 font-black uppercase tracking-widest text-sm">No records found matching your filter.</div>
                    </div>
                ) : (
                    /* --- SPECIFIC DISTRICT / SEARCH MODE: unified table --- */
                    <div>
                        {selectedDistrict && (
                            <div className="bg-slate-900 text-white p-3 font-black flex justify-between items-center uppercase text-[10px] tracking-widest rounded-xl mb-4">
                                <span>{selectedDistrict} DISTRICT</span>
                                <span className="bg-white/10 px-3 py-1 rounded-full">{totalRecords} TOTAL</span>
                            </div>
                        )}
                        <div className="overflow-x-auto">
                            <table className="w-full text-[10px] text-left min-w-[1080px]">
                                <thead className="bg-gray-50 border-b uppercase text-gray-500 font-black">
                                    <tr>{canSelect && <th className="p-3 w-10 no-print text-center"><input type="checkbox" disabled={!canDelete} className="w-4 h-4 rounded border-gray-300 text-red-600 focus:ring-red-500 align-middle disabled:opacity-40" checked={delegates.length > 0 && delegates.every(x => selected.has(x.delegate_id))} onChange={() => togglePage(delegates)} title={canDelete ? 'Select every row on this page' : 'Delete is disabled for this event — enable it in Events & Config'} /></th>}<th className="p-3 w-12">#</th><th className="p-3 w-16">Title</th><th className="p-3">Full Name</th>{!selectedDistrict && <th className="p-3">District</th>}<th className="p-3">Chapter</th><th className="p-3">Email</th>{showRank && <th className="p-3">Rank</th>}{showOffice && <th className="p-3">Office</th>}{showDelegateType && <th className="p-3">Type</th>}<th className="p-3">Phone</th><th className="p-3">Source</th><th className="p-3">Reg ID</th>{dateRangeActive && <><th className="p-3">Registered</th><th className="p-3" title="Latest detail change, or registration when never updated. Badge printing does not count.">Last activity</th></>}{showPaymentCols && <><th className="p-3">Payment</th><th className="p-3">Payment Ref</th></>}<th className="p-3 no-print w-24 text-center">Actions</th></tr>
                                </thead>
                                <tbody className="divide-y divide-gray-100">
                                    {delegates.map((d, i) => (
                                        <tr key={d.delegate_id} className={`hover:bg-gray-50 transition-colors ${editingId === d.delegate_id ? 'bg-blue-50' : ''}`}>
                                            {canSelect && (
                                                <td className="p-3 no-print text-center">
                                                    <input type="checkbox" disabled={!canDelete} className="w-4 h-4 rounded border-gray-300 text-red-600 focus:ring-red-500 align-middle disabled:opacity-40"
                                                        checked={selected.has(d.delegate_id)} onChange={() => toggleRow(d)} title={canDelete ? 'Select this delegate' : 'Delete is disabled for this event — enable it in Events & Config'} />
                                                </td>
                                            )}
                                            <td className="p-3 text-[9px] font-mono text-gray-400">{(page - 1) * PAGE_SIZE + i + 1}</td>
                                            <td className="p-3 font-bold text-gray-400 uppercase">{d.title}</td>
                                            <td className="p-3 font-black text-gray-900 uppercase">{d.first_name} {d.last_name}</td>
                                            {!selectedDistrict && <td className="p-3 font-medium uppercase text-[9px] text-gray-700">{(d.district || '').trim() || '-'}</td>}
                                            <td className="p-3 font-medium">{d.chapter || '-'}</td>
                                            <td className="p-3 font-medium lowercase text-blue-600">{d.email || '-'}</td>
                                            {showRank && <td className="p-3 font-black text-blue-800 uppercase">{d.rank}</td>}
                                            {showOffice && <td className="p-3 font-medium uppercase text-[9px]">{d.office}</td>}
                                            {showDelegateType && <td className="p-3 font-medium text-[9px]">{d.delegate_type || 'Member'}</td>}
                                            <td className="p-3 font-black text-gray-500 tracking-tighter">{d.phone}</td>
                                            <td className="p-3">{d.reg_type === 'portal' ? <span className="inline-block px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 font-black text-[8px] uppercase">Portal</span> : d.reg_type === 'web' ? <span className="inline-block px-2 py-0.5 rounded-full bg-blue-100 text-blue-800 font-black text-[8px] uppercase">Web</span> : d.reg_type === 'ems' ? <span className="inline-block px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-800 font-black text-[8px] uppercase">EMS</span> : <span className="inline-block px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 font-black text-[8px] uppercase">Manual</span>}</td>
                                            <td className="p-3 font-mono text-[9px] text-gray-500">{showRegId(d) ? (d.external_id || '-') : '-'}</td>
                                            {dateRangeActive && <><td className="p-3 font-mono text-[9px] text-gray-500">{regDateOf(d)}</td><td className="p-3 font-mono text-[9px] text-gray-600">{activityDateOf(d)}</td></>}
                                            {showPaymentCols && <>
                                                <td className="p-3 font-black text-gray-700">{d.payment_amount != null ? formatCurrency(d.payment_amount) : <span className="text-gray-300">—</span>}</td>
                                                <td className="p-3 font-mono text-[9px] text-gray-500">{d.payment_reference || <span className="text-gray-300">—</span>}</td>
                                            </>}
                                            <td className="p-3 no-print text-center">
                                                <button onClick={() => startEditing(d)} className="text-blue-600 font-black uppercase text-[9px] border border-blue-200 px-3 py-1 rounded-lg hover:bg-blue-600 hover:text-white transition-all">Edit</button>
                                                {canManage && (
                                                    <button
                                                        onClick={() => handleDelete(d)}
                                                        disabled={!canDelete}
                                                        title={canDelete ? undefined : 'Delete is disabled for this event — enable it in Events & Config'}
                                                        className={`ml-1 font-black uppercase text-[9px] border px-3 py-1 rounded-lg transition-all ${canDelete ? 'text-red-600 border-red-200 hover:bg-red-600 hover:text-white' : 'text-gray-300 border-gray-200 cursor-not-allowed'} disabled:opacity-60`}
                                                    >
                                                        {canDelete ? 'Delete' : 'Delete (off)'}
                                                    </button>
                                                )}
                                            </td>
                                        </tr>
                                    ))}
                                    {delegates.length < PAGE_SIZE && Array.from({ length: PAGE_SIZE - delegates.length }, (_, i) => (
                                        <tr key={`__pad_${i}`} className="bg-gray-50/50">
                                            <td colSpan={9 + (showRank ? 1 : 0) + (showOffice ? 1 : 0) + (showDelegateType ? 1 : 0) + (showPaymentCols ? 2 : 0) + (canSelect ? 1 : 0) + (dateRangeActive ? 2 : 0) + (selectedDistrict ? 0 : 1)} className="p-3 text-center text-[9px] text-gray-300 font-mono">&nbsp;</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}
                {totalPages > 1 && (selectedDistrict || searchTerm || sourceFilter || dateRangeActive || importBatchId) && (
                    <div className="no-print mt-6 flex items-center justify-center gap-3 pt-4 border-t border-gray-200">
                        <button onClick={() => loadData(1)} disabled={page <= 1} className="px-3 py-2 bg-gray-100 hover:bg-gray-200 disabled:opacity-40 rounded-lg text-[10px] font-black uppercase">First</button>
                        <button onClick={() => loadData(page - 1)} disabled={page <= 1} className="px-4 py-2 bg-gray-100 hover:bg-gray-200 disabled:opacity-40 rounded-lg text-[10px] font-black uppercase">Prev</button>
                        <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest px-3">
                            Page {page} of {totalPages}
                        </span>
                        <button onClick={() => loadData(page + 1)} disabled={page >= totalPages} className="px-4 py-2 bg-gray-100 hover:bg-gray-200 disabled:opacity-40 rounded-lg text-[10px] font-black uppercase">Next</button>
                        <button onClick={() => loadData(totalPages)} disabled={page >= totalPages} className="px-3 py-2 bg-gray-100 hover:bg-gray-200 disabled:opacity-40 rounded-lg text-[10px] font-black uppercase">Last</button>
                        <span className="text-[9px] font-bold text-gray-400">({totalRecords} total)</span>
                    </div>
                )}
            </div>
        </div>
    );
};

export default MasterListModule;
