import React from 'react';
import { BatchStatus } from '../types';

interface Props {
  status: BatchStatus;
}

const STATUS_STYLES: Record<BatchStatus, string> = {
  pending: 'bg-gray-100 text-gray-600 border-gray-300',
  generating: 'bg-blue-50 text-blue-700 border-blue-300',
  ready: 'bg-green-50 text-green-700 border-green-300',
  printing: 'bg-orange-50 text-orange-700 border-orange-300',
  printed: 'bg-emerald-50 text-emerald-700 border-emerald-300',
  failed: 'bg-red-50 text-red-700 border-red-300',
};

const STATUS_DOTS: Record<BatchStatus, string> = {
  pending: 'bg-gray-400',
  generating: 'bg-blue-500 animate-pulse',
  ready: 'bg-green-500',
  printing: 'bg-orange-500 animate-pulse',
  printed: 'bg-emerald-500',
  failed: 'bg-red-500',
};

const BatchStatusBadge: React.FC<Props> = ({ status }) => (
  <span
    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-[9px] font-black uppercase tracking-widest ${
      STATUS_STYLES[status] || STATUS_STYLES.pending
    }`}
  >
    <span className={`w-2 h-2 rounded-full ${STATUS_DOTS[status] || STATUS_DOTS.pending}`} />
    {status}
  </span>
);

export default BatchStatusBadge;
