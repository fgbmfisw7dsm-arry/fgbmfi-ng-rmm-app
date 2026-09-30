import React from 'react';

interface StatCardProps {
  title: string;
  value: string | number;
  subValue?: string;
  icon?: React.ReactNode;
  color?: keyof typeof ACCENTS;
}

const ACCENTS = {
  blue: { border: 'border-blue-500', bg: 'bg-blue-50', text: 'text-blue-600' },
  green: { border: 'border-green-500', bg: 'bg-green-50', text: 'text-green-600' },
  amber: { border: 'border-amber-500', bg: 'bg-amber-50', text: 'text-amber-600' },
  purple: { border: 'border-purple-500', bg: 'bg-purple-50', text: 'text-purple-600' },
  red: { border: 'border-red-500', bg: 'bg-red-50', text: 'text-red-600' },
} as const;

const StatCard: React.FC<StatCardProps> = ({ title, value, subValue, icon, color = 'blue' }) => {
  const accent = ACCENTS[color] || ACCENTS.blue;
  return (
    <div className={`bg-white p-6 rounded-xl shadow-sm border-l-4 ${accent.border} flex items-center justify-between`}>
      <div>
        <h3 className="text-gray-500 text-sm font-medium uppercase tracking-wider">{title}</h3>
        <p className="text-3xl font-bold text-gray-800 mt-2">{value}</p>
        {subValue && <p className="text-sm text-gray-400 mt-1">{subValue}</p>}
      </div>
      {icon && (
        <div className={`p-3 ${accent.bg} rounded-full ${accent.text}`}>
          {icon}
        </div>
      )}
    </div>
  );
};

export default StatCard;