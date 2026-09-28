import React, { useState, useContext, useEffect, useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { db } from '../services/supabaseService';
import { Delegate, FeeCategory, getScopeFilter, isAdminRole, isEventAdminRole } from '../types';
import { AppContext } from '../context/AppContext';
import { generateSingleBadgePDF } from '../services/badgePdfGenerator';

const IndividualBadgePrint = () => {
  const { activeEventId, activeEvent, user } = useContext(AppContext);
  const [searchParams] = useSearchParams();

  const scope = getScopeFilter(user);
  const districtFilter = scope.district;
  const isLocked = activeEvent?.is_active === false;
  // Repairing the external_id needs delegates UPDATE RLS — admin/event_admin only.
  const canRepairExternalId = isAdminRole(user?.role || '') || isEventAdminRole(user?.role || '');

  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Delegate[]>([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<Delegate | null>(null);
  const [feeCategory, setFeeCategory] = useState<FeeCategory>('regular');

  const [generating, setGenerating] = useState(false);
  const [generatedPdfBytes, setGeneratedPdfBytes] = useState<Uint8Array | null>(null);
  const [pdfPreviewUrl, setPdfPreviewUrl] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);
  const previewUrlRef = useRef<string | null>(null);
  const resultsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    return () => {
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    };
  }, []);

  const handleSearch = useCallback(async (q: string) => {
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
  }, [activeEventId, districtFilter]);

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
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = null;
    }
    setGeneratedPdfBytes(null);
    setPdfPreviewUrl(null);
  };

  const buildFileName = (): string => {
    const nameSlug = `${selected?.first_name || 'delegate'}_${selected?.last_name || ''}`.replace(/[^a-zA-Z0-9]/g, '_');
    const feeSlug = feeCategory === 'early_bird' ? 'Early-Bird' : 'Regular';
    const timestamp = new Date().toISOString().replace(/:/g, '').replace(/\..+/, '').replace('T', '_');
    return `FGBMFI_Badge_A6_${nameSlug}_${feeSlug}_${timestamp}.pdf`;
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

      const pdfBytes = await generateSingleBadgePDF(target, activeEvent, feeCategory);

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

      setFeedback({
        type: 'success',
        msg: `A6 badge generated for ${target.title} ${target.first_name} ${target.last_name} — ${feeCategory === 'early_bird' ? 'EARLY BIRD' : 'REGULAR'}. Print on the pre-cut A6 stock.`,
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
    if (!pdfPreviewUrl) return;
    const fileName = buildFileName();
    const originalTitle = document.title;
    document.title = fileName;
    const iframe = document.querySelector('iframe[title="A6 Badge PDF Preview"]') as HTMLIFrameElement | null;
    iframe?.contentWindow?.print();
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
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-black text-blue-900 uppercase tracking-tighter">
            Print Individual Delegate Badge
          </h1>
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mt-1">
            A6 desk printing — pre-cut A6 stock, banner + footer pre-printed
          </p>
        </div>
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
          Select Delegate
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
                {!searching && !searchResults.length && (
                  <p className="p-3 text-[10px] text-gray-400 text-center">No delegates found</p>
                )}
                {searchResults.slice(0, 20).map((d) => (
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
          <h2 className="text-[10px] font-black text-gray-400 uppercase mb-4 tracking-[0.2em]">
            Fee Category Stamp
          </h2>
          <div className="flex gap-1 bg-gray-100 p-1 rounded-xl max-w-md">
            {(['early_bird', 'regular'] as FeeCategory[]).map((cat) => (
              <button
                key={cat}
                onClick={() => setFeeCategory(cat)}
                className={`flex-1 py-3 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${
                  feeCategory === cat ? 'bg-blue-900 text-white shadow-md' : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                {cat === 'early_bird' ? 'Early Bird' : 'Regular'}
              </button>
            ))}
          </div>
          <p className="text-[9px] text-gray-400 leading-tight mt-2">
            EARLY BIRD period has ended — new venue registrations use REGULAR (full charges). Select the applicable category; the stamp prints at the bottom-left rectangle.
          </p>

          <button
            onClick={handleGenerate}
            disabled={generating || isLocked}
            className="w-full mt-6 py-5 bg-blue-900 hover:bg-blue-800 disabled:bg-gray-300 disabled:text-gray-500 text-white font-black rounded-2xl text-sm uppercase tracking-widest shadow-xl transition-all active:scale-95"
          >
            {generating ? 'Generating A6 Badge...' : `Print A6 Badge — ${feeCategory === 'early_bird' ? 'EARLY BIRD' : 'REGULAR'}`}
          </button>
        </div>
      )}

      {generatedPdfBytes && pdfPreviewUrl && (
        <div ref={resultsRef} className="bg-white p-6 rounded-3xl shadow-sm border border-emerald-200">
          <div className="flex flex-col lg:flex-row gap-4">
            <div className="flex-1 min-h-[400px] border border-gray-200 rounded-xl overflow-hidden">
              <iframe
                src={pdfPreviewUrl}
                className="w-full h-full min-h-[400px]"
                title="A6 Badge PDF Preview"
              />
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
              <p className="text-[9px] text-gray-400 text-center leading-relaxed mt-2">
                Only the delegate details, QR code and fee stamp are printed — the banner and footer zones are pre-printed on the A6 shell.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default IndividualBadgePrint;