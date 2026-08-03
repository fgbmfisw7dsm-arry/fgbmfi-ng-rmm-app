import React, { useState, useContext, useEffect, useCallback, useRef } from 'react';
import { db } from '../services/supabaseService';
import { Delegate, Event, UserRole, isAdminRole, isRegistrarRole, getScopeFilter, BadgeFilter, BadgeSortField, BadgeLayout, BadgeBatchSize, BadgeBatch, BadgePrintLog, BatchStatus, BadgeGenerationProgress } from '../types';
import { AppContext } from '../context/AppContext';
import { getBadgePageCount, generateBadgePDF } from '../services/badgePdfGenerator';
import { useQuery } from '@tanstack/react-query';
import BadgePreview from '../components/BadgePreview';
import BatchStatusBadge from '../components/BatchStatusBadge';

type Tab = 'generate' | 'batches' | 'reprint' | 'history';

const BADGE_LAYOUTS: { value: BadgeLayout; label: string }[] = [
  { value: '8-up', label: '8-up Landscape (90×60mm)' },
  { value: '10-up', label: '10-up Landscape (80×55mm)' },
  { value: '6-up-portrait', label: '6-up Portrait (63×95mm)' },
  { value: '9-up-portrait', label: '9-up Portrait (55×80mm)' },
  { value: '8-up-portrait', label: '8-up Portrait (63×90mm)' },
];

const BATCH_SIZES: { value: BadgeBatchSize; label: string }[] = [
  { value: 250, label: '250 Badges' },
  { value: 500, label: '500 Badges' },
  { value: 1000, label: '1,000 Badges' },
];

const SORT_OPTIONS: { value: BadgeSortField; label: string }[] = [
  { value: 'surname', label: 'Surname' },
  { value: 'delegate_number', label: 'Delegate Number' },
  { value: 'district', label: 'District' },
  { value: 'chapter', label: 'Chapter' },
  { value: 'category', label: 'Category' },
  { value: 'registration_date', label: 'Registration Date' },
];

const BadgePrintingModule = () => {
  const { activeEventId, activeEvent, user } = useContext(AppContext);
  const [activeTab, setActiveTab] = useState<Tab>('generate');

  const scope = getScopeFilter(user);
  const districtFilter = scope.district;
  const isLocked = activeEvent?.is_active === false;
  const isAdmin = isAdminRole(user?.role || '');
  const isRegistrar = isRegistrarRole(user?.role || '');
  const isNationalOrRegional =
    user?.role === UserRole.NATIONAL_ADMIN ||
    user?.role === UserRole.REGIONAL_ADMIN ||
    user?.role === UserRole.NATIONAL_REGISTRAR ||
    user?.role === UserRole.REGIONAL_REGISTRAR ||
    user?.role === UserRole.ADMIN;

  const [filters, setFilters] = useState<BadgeFilter>({
    district: '',
    chapter: '',
    delegateType: '',
    registrationStatus: 'all',
    surnameFrom: '',
    surnameTo: '',
    delegateNumberFrom: '',
    delegateNumberTo: '',
    selectedIds: [],
  });

  const [sortBy, setSortBy] = useState<BadgeSortField>('surname');
  const [layout, setLayout] = useState<BadgeLayout>('8-up');
  const [batchSize, setBatchSize] = useState<BadgeBatchSize>(500);
  const [previewCount, setPreviewCount] = useState(0);
  const [previewDelegates, setPreviewDelegates] = useState<Delegate[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Delegate[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectedDelegates, setSelectedDelegates] = useState<Delegate[]>([]);

  const [generating, setGenerating] = useState(false);
  const [progress, setProgress] = useState<BadgeGenerationProgress | null>(null);
  const [generatedPdfBytes, setGeneratedPdfBytes] = useState<Uint8Array | null>(null);
  const [generatedBatchId, setGeneratedBatchId] = useState<string | null>(null);
  const [generatedBatchNumber, setGeneratedBatchNumber] = useState<number | null>(null);
  const [generatedBatchDistrict, setGeneratedBatchDistrict] = useState<string>('');
  const [pdfPreviewUrl, setPdfPreviewUrl] = useState<string | null>(null);
  const [batches, setBatches] = useState<BadgeBatch[]>([]);
  const [printLogs, setPrintLogs] = useState<BadgePrintLog[]>([]);
  const [availableDistricts, setAvailableDistricts] = useState<string[]>([]);
  const [availableChapters, setAvailableChapters] = useState<{ chapter_name: string; chapter_code?: string }[]>([]);
  const [delegateTypes, setDelegateTypes] = useState<string[]>([]);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);
  const [reprintBatches, setReprintBatches] = useState<string[]>([]);
  const cancellationRef = useRef(false);
  const resultsRef = useRef<HTMLDivElement>(null);
  const previewUrlRef = useRef<string | null>(null);

  useEffect(() => {
    db.getSettings()
      .then((data) => {
        if (data?.districts?.length) setAvailableDistricts(data.districts);
        if (data?.delegate_types?.length) setDelegateTypes(data.delegate_types);
      })
      .catch(() => {});
  }, []);



  useEffect(() => {
    db.getChapters(filters.district || undefined)
      .then((data) => {
        setAvailableChapters(data || []);
        if (filters.chapter) {
          const stillValid = (data || []).some((c: any) => c.chapter_name === filters.chapter);
          if (!stillValid) setFilters((f) => ({ ...f, chapter: undefined }));
        }
      })
      .catch(() => setAvailableChapters([]));
  }, [filters.district]);

  const loadBatches = useCallback(async () => {
    if (!activeEventId) return;
    const data = await db.getBadgeBatches(activeEventId);
    setBatches(data || []);
  }, [activeEventId]);

  const loadPrintLogs = useCallback(async () => {
    if (!activeEventId) return;
    const data = await db.getBadgePrintLogs(activeEventId);
    setPrintLogs(data || []);
  }, [activeEventId]);

  useEffect(() => {
    loadBatches();
    loadPrintLogs();
  }, [loadBatches, loadPrintLogs]);

  const handlePreviewCount = useCallback(async () => {
    if (!activeEventId) return;
    const activeFilters: BadgeFilter = {
      ...filters,
      selectedIds: selectedDelegates.length
        ? selectedDelegates.map((d) => d.delegate_id)
        : undefined,
    };

    if (activeFilters.selectedIds?.length) {
      setPreviewCount(activeFilters.selectedIds.length);
    } else if (
      !activeFilters.district &&
      !activeFilters.chapter &&
      !activeFilters.delegateType &&
      !activeFilters.surnameFrom &&
      !activeFilters.surnameTo &&
      !activeFilters.delegateNumberFrom &&
      !activeFilters.delegateNumberTo &&
      activeFilters.registrationStatus === 'all'
    ) {
      setPreviewCount(0);
    } else {
      const count = await db.getFilteredDelegateCount(activeEventId, activeFilters);
      setPreviewCount(count);
      if (count > 0) {
        const sample = await db.getFilteredDelegates(activeEventId, activeFilters, sortBy, 10, 0);
        setPreviewDelegates(sample);
      } else {
        setPreviewDelegates([]);
      }
    }
  }, [activeEventId, filters, selectedDelegates]);

  useEffect(() => {
    const timeout = setTimeout(handlePreviewCount, 300);
    return () => clearTimeout(timeout);
  }, [handlePreviewCount]);

  useEffect(() => {
    return () => {
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    };
  }, []);

  const clearAllFilters = () => {
    setFilters({
      district: '',
      chapter: '',
      delegateType: '',
      registrationStatus: 'all',
      surnameFrom: '',
      surnameTo: '',
      delegateNumberFrom: '',
      delegateNumberTo: '',
      selectedIds: [],
    });
    setSelectedDelegates([]);
    setSearchQuery('');
    setSearchResults([]);
    setPreviewCount(0);
  };

  const handleSearchDelegates = useCallback(
    async (q: string) => {
      if (!activeEventId || q.trim().length < 2) {
        setSearchResults([]);
        return;
      }
      setSearching(true);
      try {
        const results = await db.searchDelegates(q, activeEventId, districtFilter);
        setSearchResults(results as Delegate[]);
      } catch {
        setSearchResults([]);
      }
      setSearching(false);
    },
    [activeEventId, districtFilter]
  );

  useEffect(() => {
    const timeout = setTimeout(() => handleSearchDelegates(searchQuery), 300);
    return () => clearTimeout(timeout);
  }, [searchQuery, handleSearchDelegates]);

  const toggleDelegateSelection = (delegate: Delegate) => {
    setSelectedDelegates((prev) => {
      const exists = prev.some((d) => d.delegate_id === delegate.delegate_id);
      if (exists) {
        return prev.filter((d) => d.delegate_id !== delegate.delegate_id);
      }
      return [...prev, delegate];
    });
  };

  const removeSelectedDelegate = (delegateId: string) => {
    setSelectedDelegates((prev) => prev.filter((d) => d.delegate_id !== delegateId));
  };

  const getActiveFilterCount = () => {
    const active: BadgeFilter = {
      ...filters,
      selectedIds: selectedDelegates.length
        ? selectedDelegates.map((d) => d.delegate_id)
        : undefined,
    };
    let count = 0;
    if (active.district) count++;
    if (active.chapter) count++;
    if (active.delegateType) count++;
    if (active.registrationStatus && active.registrationStatus !== 'all') count++;
    if (active.surnameFrom || active.surnameTo) count++;
    if (active.delegateNumberFrom || active.delegateNumberTo) count++;
    if (active.selectedIds?.length) count++;
    return count;
  };

  const fetchLogoAsBase64 = async (path: string): Promise<string | undefined> => {
    try {
      const resp = await fetch(path);
      if (!resp.ok) return undefined;
      const blob = await resp.blob();
      return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.readAsDataURL(blob);
      });
    } catch {
      return undefined;
    }
  };

  const handleGenerate = useCallback(async () => {
    if (!activeEventId || !activeEvent || !user?.id) return;

    const allSelected =
      selectedDelegates.length > 0
        ? selectedDelegates
        : [];

    let delegatesToPrint: Delegate[] = allSelected;

    if (!allSelected.length) {
      const activeFilters: BadgeFilter = { ...filters };
      const hasFilters =
        activeFilters.district ||
        activeFilters.chapter ||
        activeFilters.delegateType ||
        activeFilters.surnameFrom ||
        activeFilters.surnameTo ||
        activeFilters.delegateNumberFrom ||
        activeFilters.delegateNumberTo ||
        (activeFilters.registrationStatus && activeFilters.registrationStatus !== 'all');

      if (!hasFilters) {
        setFeedback({
          type: 'error',
          msg: 'Please apply at least one filter or select delegates manually before generating.',
        });
        return;
      }

      let allDelegates: Delegate[] = [];
      let offset = 0;
      const limit = 500;

      while (true) {
        const page = await db.getFilteredDelegates(
          activeEventId,
          activeFilters,
          sortBy,
          limit,
          offset
        );
        if (!page.length) break;
        allDelegates = [...allDelegates, ...page];
        offset += limit;
        if (page.length < limit) break;
        if (allDelegates.length >= 25000) break;
      }

      delegatesToPrint = allDelegates;
    }

    if (!delegatesToPrint.length) {
      setFeedback({ type: 'error', msg: 'No delegates match the selected filters.' });
      return;
    }

    const batches: Delegate[][] = [];
    for (let i = 0; i < delegatesToPrint.length; i += batchSize) {
      batches.push(delegatesToPrint.slice(i, i + batchSize));
    }

    setFeedback(null);
    setGenerating(true);
    setProgress(null);
    setGeneratedPdfBytes(null);
    setGeneratedBatchId(null);
    setGeneratedBatchNumber(null);
    setGeneratedBatchDistrict('');

    try {
      const [fgbmfiLogoBase64, eventLogoBase64, badgeBannerBase64] = await Promise.all([
        fetchLogoAsBase64('/logo-fgbmfi.png'),
        fetchLogoAsBase64('/event-logo.png'),
        fetchLogoAsBase64('/fgbmfi badge banner-2.png'),
      ]);

      const decodeBase64Img = (base64: string): Uint8Array | undefined => {
        try {
          const raw = base64.includes(',') ? base64.split(',')[1] : base64;
          const binary = atob(raw);
          const bytes = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
          return bytes;
        } catch {
          return undefined;
        }
      };

      const fgbmfiLogoBytes = fgbmfiLogoBase64 ? decodeBase64Img(fgbmfiLogoBase64) : undefined;
      const eventLogoBytes = eventLogoBase64 ? decodeBase64Img(eventLogoBase64) : undefined;
      const badgeBannerBytes = badgeBannerBase64 ? decodeBase64Img(badgeBannerBase64) : undefined;

      cancellationRef.current = false;
      let hasError = false;

      for (let batchIdx = 0; batchIdx < batches.length; batchIdx++) {
        if (cancellationRef.current) break;

        const batchDelegates = batches[batchIdx];
        const idxOffset = batchIdx * batchSize;

        const pdfBytes = await generateBadgePDF(
          batchDelegates,
          layout,
          activeEvent,
          fgbmfiLogoBytes,
          eventLogoBytes,
          badgeBannerBytes,
          (pg) => {
            if (cancellationRef.current) return;
            setProgress({
              current: pg.current + idxOffset,
              total: batches.length * batchSize,
              phase: pg.phase,
            } as unknown as BadgeGenerationProgress);
          }
        );

        if (cancellationRef.current) break;

        try {
          const filtersForBatch: BadgeFilter = {
            ...filters,
            selectedIds: selectedDelegates.length
              ? selectedDelegates.map((d) => d.delegate_id)
              : undefined,
          };

          const batch = await db.createBadgeBatch({
            event_id: activeEventId,
            batch_number: 0,
            badge_count: batchDelegates.length,
            page_count: getBadgePageCount(batchDelegates.length, layout),
            layout,
            sort_field: sortBy,
            filters: filtersForBatch,
            status: 'generating',
            generated_by: user.id,
          });

          const districtSlug = (filters.district || 'All-Districts')
            .replace(/[^a-zA-Z0-9]/g, '-')
            .replace(/-+/g, '-')
            .replace(/^-|-$/g, '');
          const timestamp = new Date().toISOString().replace(/:/g, '').replace(/\..+/, '').replace('T', '_');
          const badgeFileName = `FGBMFI_Batch-${batch.batch_number}_${districtSlug}_${timestamp}.pdf`;

          const pdfUrl = await db.uploadBadgePDF(batch.batch_id, pdfBytes, badgeFileName);
          await db.updateBadgeBatchStatus(batch.batch_id, 'ready', pdfUrl);

          const printLogs = batchDelegates.map((d) => ({
            batch_id: batch.batch_id,
            event_id: activeEventId,
            delegate_id: d.delegate_id,
            action: 'generated' as const,
            performed_by: user.id,
          }));
          await db.createBadgePrintLogsBatch(printLogs);

          setGeneratedPdfBytes(pdfBytes);
          setGeneratedBatchId(batch.batch_id);
          setGeneratedBatchNumber(batch.batch_number);
          setGeneratedBatchDistrict(filters.district || '');
          const blob = new Blob([pdfBytes], { type: 'application/pdf' });
          const previewUrl = URL.createObjectURL(blob);
          if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
          previewUrlRef.current = previewUrl;
          setPdfPreviewUrl(previewUrl);
        } catch (uploadErr: any) {
          hasError = true;
          setFeedback({
            type: 'error',
            msg: `Batch ${batchIdx + 1} generated but upload failed: ${uploadErr.message}`,
          });
        }
      }

      setGenerating(false);
      setProgress(null);
      loadBatches();
      loadPrintLogs();

      if (!hasError && !cancellationRef.current) {
        setFeedback({
          type: 'success',
          msg: `All ${batches.length} batch(es) generated and uploaded successfully.`,
        });
        setTimeout(() => {
          resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 200);
      }
    } catch (err: any) {
      setGenerating(false);
      setProgress(null);
      setFeedback({
        type: 'error',
        msg: err?.message || 'PDF generation failed',
      });
    }
  }, [
    activeEventId,
    activeEvent,
    user,
    filters,
    sortBy,
    layout,
    batchSize,
    selectedDelegates,
    loadBatches,
    loadPrintLogs,
  ]);

  const handleCancelGeneration = () => {
    cancellationRef.current = true;
    setGenerating(false);
    setProgress(null);
    setFeedback({ type: 'error', msg: 'Generation cancelled.' });
  };

  const handleDownload = (pdfBytes?: Uint8Array) => {
    const bytes = pdfBytes || generatedPdfBytes;
    if (!bytes) return;
    const blob = new Blob([bytes], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const districtSlug = (generatedBatchDistrict || 'All-Districts')
      .replace(/[^a-zA-Z0-9]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
    const timestamp = new Date().toISOString().replace(/:/g, '').replace(/\..+/, '').replace('T', '_');
    const batchNum = generatedBatchNumber || '0';
    a.download = `FGBMFI_Batch-${batchNum}_${districtSlug}_${timestamp}.pdf`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleMarkPrinted = async (batchId: string) => {
    await db.updateBadgeBatchStatus(batchId, 'printed');
    loadBatches();
  };

  const handleReprintBatch = async (batchId: string) => {
    await db.updateBadgeBatchStatus(batchId, 'printing');
    loadBatches();
    setActiveTab('generate');
    setFeedback({
      type: 'success',
      msg: `Batch ${batchId} queued for reprint. Use the Generate tab to reprint.`,
    });
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return '-';
    return new Date(dateStr).toLocaleString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-black text-blue-900 uppercase tracking-tighter">
            Badge Printing
          </h1>
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mt-1">
            Production badge generation for commercial printing
          </p>
        </div>
      </div>

      {isLocked && (
        <div className="bg-red-600 text-white p-4 rounded-2xl flex items-center justify-center gap-3 shadow-xl">
          <span className="text-xl">&#128274;</span>
          <span className="text-xs font-black uppercase tracking-widest">
            Event Locked: Printing disabled in read-only mode
          </span>
        </div>
      )}

      {feedback && (
        <div
          className={`relative p-4 pr-12 rounded-2xl text-center font-black uppercase text-xs tracking-wider ${
            feedback.type === 'success'
              ? 'bg-green-500 text-white shadow-lg shadow-green-200'
              : 'bg-red-500 text-white shadow-lg shadow-red-200'
          }`}
        >
          {feedback.type === 'success' && <span className="mr-1">&#10003;</span>}
          {feedback.msg}
          <button
            onClick={() => setFeedback(null)}
            className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 flex items-center justify-center rounded-full hover:bg-white/20 transition-colors"
            title="Dismiss"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}

      <div className="flex gap-1 bg-gray-100 p-1 rounded-2xl">
        {(['generate', 'batches', 'reprint', 'history'] as Tab[]).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`flex-1 py-3 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${
              activeTab === tab
                ? 'bg-white text-blue-900 shadow-md'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {tab === 'generate' && '1. Generate'}
            {tab === 'batches' && '2. Batches'}
            {tab === 'reprint' && '3. Reprint'}
            {tab === 'history' && '4. History'}
          </button>
        ))}
      </div>

      {activeTab === 'generate' && (
        <div className="space-y-6">
          <div className="bg-white p-6 rounded-3xl shadow-sm border border-gray-100">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em]">
                Filters
                {getActiveFilterCount() > 0 && (
                  <span className="ml-2 bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full text-[8px]">
                    {getActiveFilterCount()} active
                  </span>
                )}
              </h2>
              <button
                onClick={clearAllFilters}
                className="text-[9px] font-bold text-red-400 hover:text-red-600 uppercase tracking-wider"
              >
                Clear All
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
              <div>
                <label className="text-[8px] font-black text-gray-400 uppercase tracking-wider block mb-1">
                  District
                </label>
                <select
                  className="w-full p-2.5 border border-gray-200 rounded-xl text-xs font-bold focus:border-blue-500 outline-none"
                  value={filters.district || ''}
                  onChange={(e) =>
                    setFilters((f) => ({ ...f, district: e.target.value || undefined, chapter: undefined }))
                  }
                >
                  <option value="">All Districts</option>
                  {availableDistricts.map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-[8px] font-black text-gray-400 uppercase tracking-wider block mb-1">
                  Chapter
                </label>
                <select
                  className="w-full p-2.5 border border-gray-200 rounded-xl text-xs font-bold focus:border-blue-500 outline-none"
                  value={filters.chapter || ''}
                  onChange={(e) =>
                    setFilters((f) => ({ ...f, chapter: e.target.value || undefined }))
                  }
                >
                  <option value="">All Chapters</option>
                  {availableChapters.map((c) => (
                    <option key={c.chapter_code || c.chapter_name} value={c.chapter_name}>
                      {c.chapter_name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-[8px] font-black text-gray-400 uppercase tracking-wider block mb-1">
                  Delegate Type
                </label>
                <select
                  className="w-full p-2.5 border border-gray-200 rounded-xl text-xs font-bold focus:border-blue-500 outline-none"
                  value={filters.delegateType || ''}
                  onChange={(e) =>
                    setFilters((f) => ({ ...f, delegateType: e.target.value || undefined }))
                  }
                >
                  <option value="">All Types</option>
                  {delegateTypes.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-[8px] font-black text-gray-400 uppercase tracking-wider block mb-1">
                  Registration
                </label>
                <select
                  className="w-full p-2.5 border border-gray-200 rounded-xl text-xs font-bold focus:border-blue-500 outline-none"
                  value={filters.registrationStatus || 'all'}
                  onChange={(e) =>
                    setFilters((f) => ({
                      ...f,
                      registrationStatus: e.target.value as 'checked_in' | 'not_checked_in' | 'all',
                    }))
                  }
                >
                  <option value="all">All Statuses</option>
                  <option value="checked_in">Checked In</option>
                  <option value="not_checked_in">Not Checked In</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mt-3">
              <div>
                <label className="text-[8px] font-black text-gray-400 uppercase tracking-wider block mb-1">
                  Surname From
                </label>
                <input
                  className="w-full p-2.5 border border-gray-200 rounded-xl text-xs font-bold focus:border-blue-500 outline-none uppercase"
                  placeholder="A"
                  maxLength={1}
                  value={filters.surnameFrom || ''}
                  onChange={(e) =>
                    setFilters((f) => ({ ...f, surnameFrom: e.target.value.toUpperCase() || undefined }))
                  }
                />
              </div>
              <div>
                <label className="text-[8px] font-black text-gray-400 uppercase tracking-wider block mb-1">
                  Surname To
                </label>
                <input
                  className="w-full p-2.5 border border-gray-200 rounded-xl text-xs font-bold focus:border-blue-500 outline-none uppercase"
                  placeholder="Z"
                  maxLength={1}
                  value={filters.surnameTo || ''}
                  onChange={(e) =>
                    setFilters((f) => ({ ...f, surnameTo: e.target.value.toUpperCase() || undefined }))
                  }
                />
              </div>
              <div>
                <label className="text-[8px] font-black text-gray-400 uppercase tracking-wider block mb-1">
                  Delegate Number From
                </label>
                <input
                  className="w-full p-2.5 border border-gray-200 rounded-xl text-xs font-bold focus:border-blue-500 outline-none font-mono"
                  placeholder="EXT-00001"
                  value={filters.delegateNumberFrom || ''}
                  onChange={(e) =>
                    setFilters((f) => ({
                      ...f,
                      delegateNumberFrom: e.target.value || undefined,
                    }))
                  }
                />
              </div>
              <div>
                <label className="text-[8px] font-black text-gray-400 uppercase tracking-wider block mb-1">
                  Delegate Number To
                </label>
                <input
                  className="w-full p-2.5 border border-gray-200 rounded-xl text-xs font-bold focus:border-blue-500 outline-none font-mono"
                  placeholder="EXT-99999"
                  value={filters.delegateNumberTo || ''}
                  onChange={(e) =>
                    setFilters((f) => ({
                      ...f,
                      delegateNumberTo: e.target.value || undefined,
                    }))
                  }
                />
              </div>
            </div>

            <div className="mt-4 pt-4 border-t border-gray-100">
              <label className="text-[8px] font-black text-gray-400 uppercase tracking-wider block mb-2">
                Manual Selection ({selectedDelegates.length} selected)
              </label>
              <input
                className="w-full p-3 border-2 border-gray-100 rounded-xl text-sm font-bold focus:border-blue-500 outline-none"
                placeholder="Search delegates by name, phone, or ID to add manually..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              {searchQuery.length >= 2 && (
                <div className="mt-2 max-h-60 overflow-y-auto border border-gray-100 rounded-xl divide-y divide-gray-50">
                  {searching && (
                    <p className="p-3 text-[10px] text-gray-400 text-center">Searching...</p>
                  )}
                  {!searching && !searchResults.length && (
                    <p className="p-3 text-[10px] text-gray-400 text-center">No delegates found</p>
                  )}
                  {searchResults.slice(0, 25).map((d) => {
                    const selected = selectedDelegates.some(
                      (s) => s.delegate_id === d.delegate_id
                    );
                    return (
                      <button
                        key={d.delegate_id}
                        onClick={() => toggleDelegateSelection(d)}
                        className={`w-full text-left p-3 flex items-center gap-3 text-xs transition-colors ${
                          selected ? 'bg-blue-50' : 'hover:bg-gray-50'
                        }`}
                      >
                        <span
                          className={`w-4 h-4 rounded border-2 flex items-center justify-center flex-shrink-0 ${
                            selected
                              ? 'bg-blue-600 border-blue-600 text-white'
                              : 'border-gray-300'
                          }`}
                        >
                          {selected && (
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={4} d="M5 13l4 4L19 7" />
                            </svg>
                          )}
                        </span>
                        <div>
                          <span className="font-bold text-gray-800">
                            {d.title} {d.first_name} {d.last_name}
                          </span>
                          <span className="text-gray-400 ml-2">
                            {d.district} · {d.external_id || d.delegate_id?.slice(0, 8)}
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
              {selectedDelegates.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {selectedDelegates.map((d) => (
                    <span
                      key={d.delegate_id}
                      className="inline-flex items-center gap-1 px-2 py-1 bg-blue-100 text-blue-700 rounded-lg text-[9px] font-bold"
                    >
                      {d.first_name} {d.last_name}
                      <button
                        onClick={() => removeSelectedDelegate(d.delegate_id)}
                        className="text-blue-400 hover:text-red-500"
                      >
                        &times;
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="bg-white p-6 rounded-3xl shadow-sm border border-gray-100">
            <h2 className="text-[10px] font-black text-gray-400 uppercase mb-4 tracking-[0.2em]">
              Sort & Layout
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="text-[8px] font-black text-gray-400 uppercase tracking-wider block mb-1">
                  Sort By
                </label>
                <select
                  className="w-full p-3 border border-gray-200 rounded-xl text-xs font-bold focus:border-blue-500 outline-none"
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as BadgeSortField)}
                >
                  {SORT_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-[8px] font-black text-gray-400 uppercase tracking-wider block mb-1">
                  Layout
                </label>
                <select
                  className="w-full p-3 border border-gray-200 rounded-xl text-xs font-bold focus:border-blue-500 outline-none"
                  value={layout}
                  onChange={(e) => setLayout(e.target.value as BadgeLayout)}
                >
                  {BADGE_LAYOUTS.map((l) => (
                    <option key={l.value} value={l.value}>
                      {l.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-[8px] font-black text-gray-400 uppercase tracking-wider block mb-1">
                  Batch Size
                </label>
                <select
                  className="w-full p-3 border border-gray-200 rounded-xl text-xs font-bold focus:border-blue-500 outline-none"
                  value={batchSize}
                  onChange={(e) => setBatchSize(Number(e.target.value) as BadgeBatchSize)}
                >
                  {BATCH_SIZES.map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          <BadgePreview
            layout={layout}
            badgeCount={previewCount}
            pageCount={getBadgePageCount(previewCount, layout)}
          />

          {previewDelegates.length > 0 && (
            <div className="bg-white p-6 rounded-3xl shadow-sm border border-gray-100">
              <h2 className="text-[10px] font-black text-gray-400 uppercase mb-3 tracking-[0.2em]">
                Matching Delegates (first {previewDelegates.length} of {previewCount})
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
                {previewDelegates.map((d) => (
                  <div key={d.delegate_id} className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl">
                    <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center text-[10px] font-black text-blue-700">
                      {d.first_name?.[0]}{d.last_name?.[0]}
                    </div>
                    <div>
                      <p className="text-[11px] font-bold text-gray-800">
                        {d.title} {d.first_name} {d.last_name}
                      </p>
                      <p className="text-[9px] text-gray-400">
                        {d.district}{d.chapter ? ` · ${d.chapter}` : ''}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {generating && progress && (
            <div className="bg-white p-6 rounded-3xl shadow-sm border border-blue-100">
              <h2 className="text-xs font-black text-blue-900 uppercase tracking-wider mb-4">
                Generating PDF
              </h2>
              <div className="w-full bg-gray-200 rounded-full h-4 overflow-hidden">
                <div
                  className="bg-blue-600 h-full rounded-full transition-all duration-300"
                  style={{
                    width: `${Math.round(
                      (progress.current / Math.max(progress.total || 1, 1)) * 100
                    )}%`,
                  }}
                />
              </div>
              <div className="flex justify-between mt-2">
                <p className="text-[9px] font-bold text-gray-500 uppercase">
                  Page {progress.current} / {progress.total || '?'}
                </p>
                <p className="text-[9px] font-bold text-gray-400 uppercase">{progress.phase}</p>
              </div>
              <button
                onClick={handleCancelGeneration}
                className="mt-4 px-6 py-2.5 bg-red-500 hover:bg-red-600 text-white font-black rounded-xl text-[10px] uppercase tracking-widest shadow transition-all active:scale-95"
              >
                Cancel
              </button>
            </div>
          )}

          <div className="flex gap-3">
            <button
              onClick={handleGenerate}
              disabled={generating || isLocked || previewCount === 0}
              className="flex-1 py-5 bg-blue-900 hover:bg-blue-800 disabled:bg-gray-300 disabled:text-gray-500 text-white font-black rounded-2xl text-sm uppercase tracking-widest shadow-xl transition-all active:scale-95"
            >
              {generating ? 'Generating...' : `Generate ${previewCount || ''} Badges`}
            </button>
          </div>

          {generatedPdfBytes && pdfPreviewUrl && (
            <div ref={resultsRef} className="bg-white p-6 rounded-3xl shadow-sm border border-emerald-200 mt-6">
              <h2 className="text-[10px] font-black text-emerald-600 uppercase mb-4 tracking-[0.2em]">
                Generated PDF
              </h2>
              <div className="flex flex-col lg:flex-row gap-4">
                <div className="flex-1 min-h-[400px] border border-gray-200 rounded-xl overflow-hidden">
                  <iframe
                    src={pdfPreviewUrl}
                    className="w-full h-full min-h-[400px]"
                    title="Badge PDF Preview"
                  />
                </div>
                <div className="lg:w-64 space-y-2">
                  <button
                    onClick={() => handleDownload()}
                    className="w-full py-4 bg-emerald-600 hover:bg-emerald-500 text-white font-black rounded-xl text-xs uppercase tracking-widest shadow transition-all active:scale-95 flex items-center justify-center gap-2"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    Download PDF
                  </button>
                  <button
                    onClick={() => {
                      if (pdfPreviewUrl) window.open(pdfPreviewUrl, '_blank');
                    }}
                    className="w-full py-4 bg-blue-600 hover:bg-blue-500 text-white font-black rounded-xl text-xs uppercase tracking-widest shadow transition-all active:scale-95 flex items-center justify-center gap-2"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                    </svg>
                    Open in New Tab
                  </button>
                  <button
                    onClick={() => {
                      const iframe = document.querySelector('iframe[title="Badge PDF Preview"]') as HTMLIFrameElement | null;
                      iframe?.contentWindow?.print();
                    }}
                    className="w-full py-4 bg-gray-700 hover:bg-gray-600 text-white font-black rounded-xl text-xs uppercase tracking-widest shadow transition-all active:scale-95 flex items-center justify-center gap-2"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
                    </svg>
                    Print PDF
                  </button>
                  <p className="text-[9px] text-gray-400 text-center leading-relaxed mt-2">
                    Click <strong>Print PDF</strong> to send directly to your printer. Use <strong>Download PDF</strong> to save for commercial printing.
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {activeTab === 'batches' && (
        <div className="bg-white p-6 rounded-3xl shadow-sm border border-gray-100 overflow-x-auto">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em]">
              Print Queue ({batches.length} batches)
            </h2>
            <button onClick={loadBatches} className="text-[9px] font-bold text-blue-600 hover:text-blue-800 uppercase tracking-wider">
              Refresh
            </button>
          </div>
          {!batches.length ? (
            <p className="text-center text-gray-400 py-12 text-xs font-bold uppercase tracking-wider">
              No badge batches yet. Generate badges to see them here.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b border-gray-100">
                    <th className="p-3 text-[8px] font-black text-gray-400 uppercase tracking-widest">Batch</th>
                    <th className="p-3 text-[8px] font-black text-gray-400 uppercase tracking-widest">Badges</th>
                    <th className="p-3 text-[8px] font-black text-gray-400 uppercase tracking-widest">Pages</th>
                    <th className="p-3 text-[8px] font-black text-gray-400 uppercase tracking-widest">Layout</th>
                    <th className="p-3 text-[8px] font-black text-gray-400 uppercase tracking-widest">Date</th>
                    <th className="p-3 text-[8px] font-black text-gray-400 uppercase tracking-widest">Status</th>
                    <th className="p-3 text-[8px] font-black text-gray-400 uppercase tracking-widest">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {batches.map((batch) => (
                    <tr key={batch.batch_id} className="hover:bg-gray-50">
                      <td className="p-3 text-xs font-black text-gray-800">
                        #{batch.batch_number}
                      </td>
                      <td className="p-3 text-xs font-bold text-gray-600">{batch.badge_count}</td>
                      <td className="p-3 text-xs font-bold text-gray-600">{batch.page_count}</td>
                      <td className="p-3 text-[9px] font-bold text-gray-500 uppercase">{batch.layout}</td>
                      <td className="p-3 text-[9px] text-gray-500">{formatDate(batch.created_at)}</td>
                      <td className="p-3">
                        <BatchStatusBadge status={batch.status} />
                      </td>
                      <td className="p-3">
                        <div className="flex gap-1">
                          {batch.status === 'ready' && (
                            <>
                              <button
                                onClick={() => {
                                  const url = batch.pdf_url;
                                  if (url) window.open(url, '_blank');
                                }}
                                className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-lg text-[8px] uppercase tracking-wider"
                              >
                                Download
                              </button>
                              <button
                                onClick={() => handleMarkPrinted(batch.batch_id)}
                                className="px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white font-bold rounded-lg text-[8px] uppercase tracking-wider"
                              >
                                Printed
                              </button>
                            </>
                          )}
                          {batch.status === 'printing' && (
                            <button
                              onClick={() => handleMarkPrinted(batch.batch_id)}
                              className="px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white font-bold rounded-lg text-[8px] uppercase tracking-wider"
                            >
                              Mark Printed
                            </button>
                          )}
                          {(batch.status === 'printed' || batch.status === 'failed') && (
                            <button
                              onClick={() => handleReprintBatch(batch.batch_id)}
                              className="px-3 py-1.5 bg-amber-500 hover:bg-amber-600 text-white font-bold rounded-lg text-[8px] uppercase tracking-wider"
                            >
                              Reprint
                            </button>
                          )}
                          {batch.status !== 'generating' && (
                            <button
                              onClick={() => {
                                if (window.confirm(`Delete batch #${batch.batch_number}? This will remove the PDF and all logs.`)) {
                                  db.deleteBadgeBatch(batch.batch_id).then(() => loadBatches()).catch(() => {});
                                }
                              }}
                              className="px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white font-bold rounded-lg text-[8px] uppercase tracking-wider ml-1"
                            >
                              Delete
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {activeTab === 'reprint' && (
        <div className="space-y-6">
          <div className="bg-white p-6 rounded-3xl shadow-sm border border-gray-100">
            <h2 className="text-[10px] font-black text-gray-400 uppercase mb-4 tracking-[0.2em]">
              Batch Reprint
            </h2>
            <p className="text-xs text-gray-500 mb-4">
              Select completed batch(es) to reprint. This regenerates the PDF for the same set of delegates.
            </p>
            {batches.filter((b) => b.status === 'printed' || b.status === 'failed' || b.status === 'ready').length === 0 ? (
              <p className="text-center text-gray-400 py-8 text-xs font-bold uppercase tracking-wider">
                No completed batches available for reprint.
              </p>
            ) : (
              <div className="space-y-3">
                {batches
                  .filter((b) => b.status === 'printed' || b.status === 'failed' || b.status === 'ready')
                  .map((batch) => (
                    <div
                      key={batch.batch_id}
                      className="flex items-center justify-between p-4 border border-gray-100 rounded-xl hover:bg-gray-50"
                    >
                      <div>
                        <p className="text-xs font-black text-gray-800">
                          Batch #{batch.batch_number} &mdash; {batch.badge_count} badges ({batch.layout})
                        </p>
                        <p className="text-[9px] text-gray-400">
                          {formatDate(batch.created_at)}
                        </p>
                      </div>
                      <button
                        onClick={() => handleReprintBatch(batch.batch_id)}
                        disabled={isLocked}
                        className="px-4 py-2 bg-amber-500 hover:bg-amber-600 disabled:bg-gray-400 text-white font-bold rounded-xl text-[9px] uppercase tracking-wider"
                      >
                        Reprint
                      </button>
                    </div>
                  ))}
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'history' && (
        <div className="bg-white p-6 rounded-3xl shadow-sm border border-gray-100 overflow-x-auto">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em]">
              Print History ({printLogs.length} entries)
            </h2>
            <button onClick={loadPrintLogs} className="text-[9px] font-bold text-blue-600 hover:text-blue-800 uppercase tracking-wider">
              Refresh
            </button>
          </div>
          {!printLogs.length ? (
            <p className="text-center text-gray-400 py-12 text-xs font-bold uppercase tracking-wider">
              No print history yet.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b border-gray-100">
                    <th className="p-3 text-[8px] font-black text-gray-400 uppercase tracking-widest">Date/Time</th>
                    <th className="p-3 text-[8px] font-black text-gray-400 uppercase tracking-widest">Delegate</th>
                    <th className="p-3 text-[8px] font-black text-gray-400 uppercase tracking-widest">Action</th>
                    <th className="p-3 text-[8px] font-black text-gray-400 uppercase tracking-widest">Batch</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {printLogs.map((log) => (
                    <tr key={log.log_id} className="hover:bg-gray-50">
                      <td className="p-3 text-[9px] text-gray-500">{formatDate(log.created_at)}</td>
                      <td className="p-3 text-xs font-bold text-gray-800">
                        {log.delegate_name || log.delegate_id?.slice(0, 8)}
                      </td>
                      <td className="p-3">
                        <span
                          className={`px-2 py-1 rounded-full text-[8px] font-bold uppercase tracking-wider ${
                            log.action === 'generated'
                              ? 'bg-blue-100 text-blue-700'
                              : log.action === 'reprinted'
                              ? 'bg-amber-100 text-amber-700'
                              : 'bg-red-100 text-red-700'
                          }`}
                        >
                          {log.action}
                        </span>
                      </td>
                      <td className="p-3 text-[9px] text-gray-500">{log.batch_id?.slice(0, 8) || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default BadgePrintingModule;
