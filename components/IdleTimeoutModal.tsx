import React from 'react';

interface IdleTimeoutModalProps {
  secondsLeft: number;
  onStay: () => void;
  onSignOut: () => void;
}

const IdleTimeoutModal: React.FC<IdleTimeoutModalProps> = ({ secondsLeft, onStay, onSignOut }) => (
  <div className="fixed inset-0 z-[9999] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
    <div className="bg-white rounded-3xl shadow-2xl border border-amber-100 w-full max-w-md p-8 text-center animate-in fade-in zoom-in duration-300">
      <div className="w-16 h-16 mx-auto bg-amber-100 rounded-full flex items-center justify-center mb-5">
        <svg className="w-8 h-8 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      </div>
      <h2 className="text-xl font-black text-gray-900 uppercase tracking-tight">Are you still there?</h2>
      <p className="text-sm font-bold text-gray-500 mt-2 leading-relaxed">
        For security, this device will be signed out due to inactivity.
      </p>
      <div className="mt-6 mb-6">
        <div className="text-4xl font-black text-amber-600 tabular-nums">{secondsLeft}</div>
        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mt-1">seconds remaining</p>
      </div>
      <div className="flex flex-col sm:flex-row gap-3">
        <button
          onClick={onStay}
          className="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-black py-4 rounded-2xl transition-all shadow-xl shadow-blue-100 uppercase tracking-[0.15em] text-xs active:scale-[0.98]"
        >
          Stay signed in
        </button>
        <button
          onClick={onSignOut}
          className="flex-1 bg-gray-100 hover:bg-gray-200 text-gray-600 font-black py-4 rounded-2xl transition-all uppercase tracking-[0.15em] text-xs active:scale-[0.98]"
        >
          Sign out now
        </button>
      </div>
    </div>
  </div>
);

export default IdleTimeoutModal;
