import React from 'react';

interface StatCardProps {
  title: string;
  value: string | number;
  subValue?: string;
  icon?: React.ReactNode;
  color?: string;
}

const StatCard: React.FC<StatCardProps> = ({ title, value, subValue, icon, color = 'blue' }) => {
  return (
    <div className={`bg-white p-6 rounded-xl shadow-sm border-l-4 border-${color}-500 flex items-center justify-between`}>
      <div>
        <h3 className="text-gray-500 text-sm font-medium uppercase tracking-wider">{title}</h3>
        <p className="text-3xl font-bold text-gray-800 mt-2">{value}</p>
        {subValue && <p className="text-sm text-gray-400 mt-1">{subValue}</p>}
      </div>
      {icon && (
        <div className={`p-3 bg-${color}-50 rounded-full text-${color}-600`}>
          {icon}
        </div>
      )}
    </div>
  );
};

export default StatCard;