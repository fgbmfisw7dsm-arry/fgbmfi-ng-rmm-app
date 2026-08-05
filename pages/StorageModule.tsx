import React, { useEffect, useState } from 'react';
import { db } from '../services/supabaseService';

interface StorageFile {
  name: string;
  size: number;
  created_at: string;
  batchId: string | null;
}

const StorageModule: React.FC = () => {
  const [files, setFiles] = useState<StorageFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());

  const loadFiles = async () => {
    setLoading(true);
    try {
      const data = await db.listBadgePDFs();
      setFiles(data);
    } catch {
      setFiles([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadFiles();
  }, []);

  const handleDelete = async (fileName: string) => {
    if (!window.confirm(`Delete ${fileName}?`)) return;
    setFeedback(null);
    try {
      const ok = await db.deleteStorageFile(fileName);
      if (ok) {
        setFeedback({ type: 'success', msg: `Deleted ${fileName}` });
        setFiles(prev => prev.filter(f => f.name !== fileName));
        setSelectedFiles(prev => { const next = new Set(prev); next.delete(fileName); return next; });
      } else {
        setFeedback({ type: 'error', msg: 'Delete failed. Check permissions.' });
      }
    } catch {
      setFeedback({ type: 'error', msg: 'Delete failed.' });
    }
    setTimeout(() => setFeedback(null), 3000);
  };

  const handleBulkDelete = async () => {
    if (selectedFiles.size === 0) return;
    if (!window.confirm(`Delete ${selectedFiles.size} file(s)?`)) return;
    setFeedback(null);
    let deleted = 0;
    for (const fileName of selectedFiles) {
      try {
        const ok = await db.deleteStorageFile(fileName);
        if (ok) deleted++;
      } catch {}
    }
    const failed = selectedFiles.size - deleted;
    if (deleted === 0) {
      setFeedback({ type: 'error', msg: 'Delete failed. No files were removed — check permissions.' });
    } else if (failed > 0) {
      setFeedback({ type: 'error', msg: `Deleted ${deleted}/${selectedFiles.size} files — ${failed} file(s) failed.` });
    } else {
      setFeedback({ type: 'success', msg: `Deleted ${deleted}/${selectedFiles.size} files` });
    }
    setSelectedFiles(new Set());
    loadFiles();
    setTimeout(() => setFeedback(null), 3000);
  };

  const toggleFile = (name: string) => {
    setSelectedFiles(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const toggleAll = () => {
    if (selectedFiles.size === files.length) {
      setSelectedFiles(new Set());
    } else {
      setSelectedFiles(new Set(files.map(f => f.name)));
    }
  };

  const totalSize = files.reduce((sum, f) => sum + f.size, 0);

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-black text-blue-900 uppercase tracking-tighter">Storage Management</h1>
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mt-1">
            badge-pdfs bucket — {files.length} file(s) — {(totalSize / (1024 * 1024)).toFixed(2)} MB
          </p>
        </div>
        <button
          onClick={loadFiles}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl text-[10px] uppercase tracking-widest transition-all"
        >
          Refresh
        </button>
      </div>

      {feedback && (
        <div className={`p-3 rounded-xl text-xs font-bold uppercase tracking-wider ${feedback.type === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
          {feedback.msg}
        </div>
      )}

      {loading ? (
        <div className="bg-white p-12 rounded-3xl shadow-sm border border-gray-100 text-center">
          <div className="w-8 h-8 border-2 border-blue-400 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-xs font-bold text-gray-400 uppercase tracking-wider">Loading storage files...</p>
        </div>
      ) : !files.length ? (
        <div className="bg-white p-12 rounded-3xl shadow-sm border border-gray-100 text-center">
          <p className="text-xs font-bold text-gray-400 uppercase tracking-wider">No badge PDFs in storage.</p>
        </div>
      ) : (
        <div className="bg-white rounded-3xl shadow-sm border border-gray-100 overflow-x-auto">
          <div className="p-4 border-b border-gray-100 flex justify-between items-center">
            <label className="flex items-center gap-2 text-[9px] font-bold text-gray-500 uppercase tracking-wider cursor-pointer select-none">
              <input type="checkbox" checked={selectedFiles.size === files.length && files.length > 0} onChange={toggleAll} className="rounded" />
              {selectedFiles.size > 0 ? `${selectedFiles.size} selected` : 'Select All'}
            </label>
            {selectedFiles.size > 0 && (
              <button
                onClick={handleBulkDelete}
                className="px-4 py-1.5 bg-red-600 hover:bg-red-700 text-white font-bold rounded-lg text-[9px] uppercase tracking-wider"
              >
                Delete Selected
              </button>
            )}
          </div>
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="p-3 w-8 text-[8px] font-black text-gray-400 uppercase tracking-widest"></th>
                <th className="p-3 text-[8px] font-black text-gray-400 uppercase tracking-widest">File Name</th>
                <th className="p-3 text-[8px] font-black text-gray-400 uppercase tracking-widest">Batch ID</th>
                <th className="p-3 text-[8px] font-black text-gray-400 uppercase tracking-widest">Size</th>
                <th className="p-3 text-[8px] font-black text-gray-400 uppercase tracking-widest">Created</th>
                <th className="p-3 text-[8px] font-black text-gray-400 uppercase tracking-widest">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {files.map((file) => (
                <tr key={file.name} className="hover:bg-gray-50">
                  <td className="p-3">
                    <input type="checkbox" checked={selectedFiles.has(file.name)} onChange={() => toggleFile(file.name)} className="rounded" />
                  </td>
                  <td className="p-3 text-xs font-bold text-gray-800 font-mono">{file.name}</td>
                  <td className="p-3 text-[10px] font-bold text-gray-500 font-mono">{file.batchId?.slice(0, 8) || '-'}</td>
                  <td className="p-3 text-[10px] font-bold text-gray-500">{(file.size / 1024).toFixed(1)} KB</td>
                  <td className="p-3 text-[10px] text-gray-500">{file.created_at ? new Date(file.created_at).toLocaleDateString() : '-'}</td>
                  <td className="p-3">
                    <button
                      onClick={() => handleDelete(file.name)}
                      className="px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white font-bold rounded-lg text-[8px] uppercase tracking-wider"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default StorageModule;
