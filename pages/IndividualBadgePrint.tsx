import React, { useState, useContext, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useSearchParams } from 'react-router-dom';
import { db } from '../services/supabaseService';
import { Delegate, getScopeFilter, isAdminRole, isEventAdminRole } from '../types';
import { AppContext } from '../context/AppContext';
import { generateSingleBadgePDF } from '../services/badgePdfGenerator';
import { generateBadgeImage } from '../services/badgeImageGenerator';

const SEARCH_PAGE_SIZE = 25;

const IndividualBadgePrint = () => {
  const { activeEventId, activeEvent, user } = useContext(AppContext);
  const [searchParams] = useSearchParams();

  const scope = getScopeFilter(user);
  const districtFilter = scope.district;
  const regionFilter = scope.region;
  const isLocked = activeEvent?.is_active === false;
  // Repairing the external_id needs delegates UPDATE RLS — admin/event_admin only.
  const canRepairExternalId = isAdminRole(user?.role || '') || isEventAdminRole(user?.role || '');
  const eventConfig = (activeEvent?.event_config || {}) as Record<string, boolean>;
  const showRank = eventConfig.show_rank !== false;
  const showOffice = eventConfig.show_office !== false;

  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Delegate[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searchPage, setSearchPage] = useState(1);
  const [searchTotal, setSearchTotal] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [selected, setSelected] = useState<Delegate | null>(null);

  const [generating, setGenerating] = useState(false);
  const [generatedPdfBytes, setGeneratedPdfBytes] = useState<Uint8Array | null>(null);
  const [pdfPreviewUrl, setPdfPreviewUrl] = useState<string | null>(null);
  // Content-only A6 canvas image used by the @page-locked Print (the banner +
  // footer zones are pre-printed on the shell, so the design is omitted).
  const [a6PrintImageUrl, setA6PrintImageUrl] = useState<string>('');
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);
  const previewUrlRef = useRef<string | null>(null);
  const resultsRef = useRef<HTMLDivElement>(null);

  // Flag the page for A6-only printing: while mounted, Print hides the ENTIRE app
  // shell (via #root) and shows only the A6 sheet, with @page locked to 105×148mm.
  useEffect(() => {
    document.body.classList.add('a6-print-active');
    return () => document.body.classList.remove('a6-print-active');
  }, []);

  const handleClose = () => {
    if (window.history.length > 1) {
      window.history.back();
    } else {
      window.location.hash = '#/register-new';
    }
  };

  useEffect(() => {
    return () => {
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    };
  }, []);

  const handleSearch = useCallback(async (q: string) => {
    if (!activeEventId || q.trim().length < 2) {
      setSearchResults([]);
      setSearchTotal(0);
      setSearchError(null);
      setSearchPage(1);
      return;
    }
    setSearching(true);
    setSearchError(null);
    setSearchPage(1);
    try {
      const { data, total } = await db.searchDelegatesPaged(q, activeEventId, districtFilter, undefined, regionFilter, 1, SEARCH_PAGE_SIZE);
      setSearchResults(data as Delegate[]);
      setSearchTotal(total);
    } catch (e: any) {
      setSearchResults([]);
      setSearchTotal(0);
      setSearchError(e?.message || 'Search failed. Check your connection and retry.');
    }
    setSearching(false);
  }, [activeEventId, districtFilter, regionFilter]);

  const handleLoadMore = useCallback(async () => {
    if (!activeEventId || searching || loadingMore || searchResults.length >= searchTotal) return;
    const next = searchPage + 1;
    setLoadingMore(true);
    try {
      const { data } = await db.searchDelegatesPaged(searchQuery, activeEventId, districtFilter, undefined, regionFilter, next, SEARCH_PAGE_SIZE);
      setSearchResults(prev => {
        const seen = new Set(prev.map(d => d.delegate_id));
        return [...prev, ...(data as Delegate[]).filter(d => !seen.has(d.delegate_id))];
      });
      setSearchPage(next);
    } catch (e: any) {
      setSearchError(e?.message || 'Could not load more results.');
    }
    setLoadingMore(false);
  }, [activeEventId, districtFilter, regionFilter, searching, loadingMore, searchPage, searchQuery, searchResults.length, searchTotal]);

  useEffect(() => {
    const timeout = setTimeout(() => handleSearch(searchQuery), 300);
    return () => clearTimeout(timeout);
  }, [searchQuery, handleSearch]);

  // Deep link from the New Delegate success panel: #/print-badge?delegate=<id>
  useEffect(() => {
    const delegateId = searchParams.get('delegate');
    if (delegateId && activeEventId) {
      db.getDelegateById(delegateId, activeEventId)
        .then((del) => {
          if (del) {
            setSelected(del);
            setFeedback({ type: 'success', msg: `Delegate loaded — ready to print the A6 badge.` });
            setTimeout(() => setFeedback(null), 4000);
          }
        })
        .catch(() => {});
    }
  }, [searchParams, activeEventId]);

  const clearSelection = () => {
    setSelected(null);
    setSearchQuery('');
    setSearchResults([]);
    setSearchPage(1);
    setSearchTotal(0);
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = null;
    }
    setGeneratedPdfBytes(null);
    setPdfPreviewUrl(null);
  };

  const buildFileName = (): string => {
    const nameSlug = `${selected?.first_name || 'delegate'}_${selected?.last_name || ''}`.replace(/[^a-zA-Z0-9]/g, '_');
    const timestamp = new Date().toISOString().replace(/:/g, '').replace(/\..+/, '').replace('T', '_');
    return `FGBMFI_Badge_A6_${nameSlug}_${timestamp}.pdf`;
  };

  const handleGenerate = async () => {
    if (!activeEventId || !activeEvent || !selected || !user?.id) return;
    setGenerating(true);
    setFeedback(null);
    try {
      let target = selected;
      if (canRepairExternalId && activeEvent.is_active === true && !selected.external_id?.startsWith('CON26')) {
        const repaired = await db.repairExternalId(selected.delegate_id);
        if (repaired) target = { ...selected, external_id: repaired };
      }

      const pdfBytes = await generateSingleBadgePDF(target, activeEvent);

      await db.markDelegateBadgePrinted(target.delegate_id, activeEventId, 'reprinted');
      await db.createBadgePrintLog({
        batch_id: null,
        event_id: activeEventId,
        delegate_id: target.delegate_id,
        action: 'reprinted',
        performed_by: user.id,
      });

      if (previewUrlRef.current) {
        URL.revokeObjectURL(previewUrlRef.current);
        previewUrlRef.current = null;
      }
      const blob = new Blob([pdfBytes], { type: 'application/pdf' });
      const previewUrl = URL.createObjectURL(blob);
      previewUrlRef.current = previewUrl;
      setGeneratedPdfBytes(pdfBytes);
      setPdfPreviewUrl(previewUrl);

      // Content-only 100×140mm canvas (no design — shell banner/footer are
      // pre-printed) used by the @page A6 print. No fee stamp: the category is
      // pre-printed on the template.
      try {
        const { badgeUrl: a6Image } = await generateBadgeImage(target, {
          showRank,
          showOffice,
          sizeMm: { width: 100, height: 139.7 },
          includeDesign: false,
        });
        setA6PrintImageUrl(a6Image);
      } catch {
        setA6PrintImageUrl('');
      }

      setFeedback({
        type: 'success',
        msg: `A6 badge generated for ${target.title} ${target.first_name} ${target.last_name}. Print on the pre-cut A6 stock.`,
      });
      setTimeout(() => {
        resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 200);
    } catch (e: any) {
      setFeedback({ type: 'error', msg: e?.message || 'A6 badge generation failed.' });
    } finally {
      setGenerating(false);
    }
  };

  const handlePrint = () => {
    if (!a6PrintImageUrl && !pdfPreviewUrl) return;
    const fileName = buildFileName();
    const originalTitle = document.title;
    document.title = fileName;
    // Preferred: print the content-only A6 canvas at 100×140mm via a hidden
    // print node whose @page rule locks the OS dialog to A6 (105×148mm). The
    // banner + footer are pre-printed on the shell. Falls back to the PDF iframe.
    if (a6PrintImageUrl) {
      window.print();
    } else {
      const iframe = document.querySelector('iframe[title="A6 Badge PDF Preview"]') as HTMLIFrameElement | null;
      iframe?.contentWindow?.print();
    }
    window.addEventListener('afterprint', () => { document.title = originalTitle; }, { once: true });
    setTimeout(() => { document.title = originalTitle; }, 15000);
  };

  const handleDownload = async () => {
    const bytes = generatedPdfBytes;
    if (!bytes) return;
    const fileName = buildFileName();
    try {
      if ('showSaveFilePicker' in window) {
        const handle = await (window as any).showSaveFilePicker({
          suggestedName: fileName,
          types: [{ description: 'PDF Document', accept: { 'application/pdf': ['.pdf'] } }],
        });
        const writable = await handle.createWritable();
        await writable.write(bytes);
        await writable.close();
        return;
      }
    } catch (e: any) {
      if (e.name === 'AbortError') return;
    }
    const blob = new Blob([bytes], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <>
    <style>{`
      @media print {
        html, body { margin: 0 !important; padding: 0 !important; background: white !important; }
        body.a6-print-active > #root > * { display: none !important; }
        #a6-print-sheet { display: none; }
        body.a6-print-active #a6-print-sheet { display: flex !important; align-items: center; justify-content: center; }
      }
    `}</style>
    <div className="space-y-6 print:hidden">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-black text-blue-900 uppercase tracking-tighter">
            Print Individual Delegate Badge
          </h1>
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mt-1">
            A6 desk printing — pre-cut A6 stock, banner + footer pre-printed
          </p>
        </div>
        <button
          onClick={handleClose}
          className="px-4 py-2.5 bg-slate-700 hover:bg-slate-600 text-white font-black rounded-xl text-[10px] uppercase tracking-widest shadow transition-all active:scale-95"
        >
          Close
        </button>
      </div>

      {isLocked && (
        <div className="bg-red-600 text-white p-4 rounded-2xl flex items-center justify-center gap-3 shadow-xl">
          <span className="text-xl">&#128274;</span>
          <span className="text-xs font-black uppercase tracking-widest">
            Event Locked: Individual badge printing disabled in read-only mode
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

      <div className="bg-white p-6 rounded-3xl shadow-sm border border-gray-100">
        <h2 className="text-[10px] font-black text-gray-400 uppercase mb-4 tracking-[0.2em]">
          Select Delegate{activeEvent?.name ? ` — ${activeEvent.name}` : ''}
        </h2>
        {!selected ? (
          <>
            <input
              className="w-full p-3 border-2 border-gray-100 rounded-xl text-sm font-bold focus:border-blue-500 outline-none"
              placeholder="Search delegates by name or phone to print one badge..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              autoFocus
            />
            {searchQuery.length >= 2 && (
              <div className="mt-2 max-h-72 overflow-y-auto border border-gray-100 rounded-xl divide-y divide-gray-50">
                {searching && <p className="p-3 text-[10px] text-gray-400 text-center">Searching...</p>}
                {!searching && searchError && (
                  <p className="p-3 text-[10px] text-red-600 font-bold text-center">{searchError}</p>
                )}
                {!searching && !searchError && !searchResults.length && (
                  <p className="p-3 text-[10px] text-gray-400 text-center">No delegates found</p>
                )}
                {!searching && !searchError && searchResults.length > 0 && (
                  <p className="px-3 py-2 text-[9px] font-bold text-gray-400 text-center bg-gray-50 uppercase tracking-widest">
                    Showing {searchResults.length} of {searchTotal} — scroll to find your delegate
                  </p>
                )}
                {searchResults.map((d) => (
                  <button
                    key={d.delegate_id}
                    onClick={() => setSelected(d)}
                    className="w-full text-left p-3 flex items-center gap-3 text-xs hover:bg-blue-50 transition-colors"
                  >
                    <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center text-[10px] font-black text-blue-700 flex-shrink-0">
                      {d.first_name?.[0]}{d.last_name?.[0]}
                    </div>
                    <div>
                      <span className="font-bold text-gray-800">
                        {d.title} {d.first_name} {d.last_name}
                      </span>
                      <span className="text-gray-400 ml-2">
                        {d.district} · {d.chapter || '-'} · {d.delegate_type}
                      </span>
                    </div>
                  </button>
                ))}
                {searchResults.length > 0 && searchResults.length < searchTotal && (
                  <button
                    onClick={handleLoadMore}
                    disabled={loadingMore}
                    className="w-full p-3 text-[10px] font-black uppercase tracking-widest text-blue-600 bg-blue-50 hover:bg-blue-100 disabled:opacity-50 transition-colors"
                  >
                    {loadingMore ? 'Loading…' : `Load more (${searchResults.length} of ${searchTotal})`}
                  </button>
                )}
              </div>
            )}
          </>
        ) : (
          <div className="flex items-center justify-between gap-3 p-4 bg-blue-50 rounded-2xl border border-blue-100">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-blue-700 rounded-full flex items-center justify-center text-xs font-black text-white">
                {selected.first_name?.[0]}{selected.last_name?.[0]}
              </div>
              <div>
                <p className="text-sm font-black text-blue-900">
                  {selected.title} {selected.first_name} {selected.last_name}
                </p>
                <p className="text-[10px] font-bold text-blue-500">
                  {selected.district} · {selected.chapter || '-'} · {selected.delegate_type} · ID {selected.external_id?.startsWith('CON26') ? selected.external_id : selected.delegate_id?.slice(0, 8)}
                </p>
              </div>
            </div>
            <button
              onClick={clearSelection}
              className="px-3 py-1.5 text-[9px] font-black bg-white border border-blue-200 text-blue-600 rounded-lg uppercase tracking-wider hover:bg-blue-100"
            >
              Change
            </button>
          </div>
        )}
      </div>

      {selected && (
        <div className="bg-white p-6 rounded-3xl shadow-sm border border-gray-100">
          <button
            onClick={handleGenerate}
            disabled={generating || isLocked}
            className="w-full py-5 bg-blue-900 hover:bg-blue-800 disabled:bg-gray-300 disabled:text-gray-500 text-white font-black rounded-2xl text-sm uppercase tracking-widest shadow-xl transition-all active:scale-95"
          >
            {generating ? 'Generating A6 Badge...' : 'Print A6 Badge'}
          </button>
        </div>
      )}

      {generatedPdfBytes && pdfPreviewUrl && (
        <div ref={resultsRef} className="bg-white p-6 rounded-3xl shadow-sm border border-emerald-200">
          <div className="flex flex-col lg:flex-row gap-4">
            <div className="flex-1 min-h-[400px] border border-gray-200 rounded-xl overflow-hidden flex items-center justify-center bg-white p-4">
              {a6PrintImageUrl ? (
                // Image-based on-screen preview (PNG data URL) — renders on ALL devices.
                // Android browsers do not render PDFs inline inside iframes ("Open" button),
                // but the same content-only A6 canvas prints identically to the PDF.
                <img
                  src={a6PrintImageUrl}
                  alt="A6 Badge Preview"
                  className="max-h-[520px] w-auto shadow-lg rounded-sm"
                />
              ) : (
                <iframe
                  src={pdfPreviewUrl}
                  className="w-full h-full min-h-[400px]"
                  title="A6 Badge PDF Preview"
                />
              )}
            </div>
            <div className="lg:w-64 space-y-2">
              <h2 className="text-[10px] font-black text-emerald-600 uppercase tracking-[0.2em]">
                A6 Badge Ready
              </h2>
              <button
                onClick={handlePrint}
                disabled={isLocked}
                className="w-full py-4 bg-gray-700 hover:bg-gray-600 text-white font-black rounded-xl text-xs uppercase tracking-widest shadow transition-all active:scale-95"
              >
                Print
              </button>
              <button
                onClick={handleDownload}
                className="w-full py-4 bg-emerald-600 hover:bg-emerald-500 text-white font-black rounded-xl text-xs uppercase tracking-widest shadow transition-all active:scale-95"
              >
                Download PDF
              </button>
              <button
                onClick={() => { if (pdfPreviewUrl) window.open(pdfPreviewUrl, '_blank'); }}
                className="w-full py-3 bg-blue-600 hover:bg-blue-500 text-white font-black rounded-xl text-xs uppercase tracking-widest shadow transition-all active:scale-95"
              >
                View PDF
              </button>
              <p className="text-[9px] text-gray-400 text-center leading-relaxed mt-2">
                Overlay prints only the delegate details and QR code — the banner, footer and fee category are already pre-printed on the A6 shell.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>

    {a6PrintImageUrl && createPortal(
      <div id="a6-print-sheet">
        <img
          src={a6PrintImageUrl}
          alt="A6 Badge"
          style={{ width: '100mm', height: '140mm', display: 'block', boxShadow: 'none' }}
        />
      </div>,
      document.body
    )}
    </>
  );
};

export default IndividualBadgePrint;