import React, { useEffect, useMemo, useRef, useState } from 'react';
import { COUNTRY_DIAL_CODES } from '../services/dialCodes';

interface CountryDialSelectProps {
    value: string;
    onChange: (code: string) => void;
}

const CountryDialSelect = ({ value, onChange }: CountryDialSelectProps) => {
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState('');
    const [highlight, setHighlight] = useState(0);
    const rootRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    const selected = useMemo(
        () => COUNTRY_DIAL_CODES.find(c => c.code === value) || COUNTRY_DIAL_CODES[0],
        [value]
    );

    const filtered = useMemo(() => {
        const q = query.trim().toLowerCase();
        if (!q) return COUNTRY_DIAL_CODES;
        return COUNTRY_DIAL_CODES.filter(c =>
            c.label.toLowerCase().includes(q) || c.code.toLowerCase().includes(q)
        );
    }, [query]);

    useEffect(() => {
        const onDocClick = (e: MouseEvent) => {
            if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
        };
        document.addEventListener('mousedown', onDocClick);
        return () => document.removeEventListener('mousedown', onDocClick);
    }, []);

    useEffect(() => {
        if (open && inputRef.current) inputRef.current.focus();
    }, [open]);

    useEffect(() => {
        if (open && filtered.length > 0 && highlight >= filtered.length) {
            setHighlight(filtered.length - 1);
        }
    }, [open, filtered, highlight]);

    const pick = (code: string) => {
        onChange(code);
        setOpen(false);
        setQuery('');
    };

    const onKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            setHighlight(h => Math.min(h + 1, filtered.length - 1));
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setHighlight(h => Math.max(h - 1, 0));
        } else if (e.key === 'Enter') {
            e.preventDefault();
            if (filtered[highlight]) pick(filtered[highlight].code);
        } else if (e.key === 'Escape') {
            setOpen(false);
        }
    };

    return (
        <div ref={rootRef} className="relative shrink-0 min-w-0">
            <button
                type="button"
                role="combobox"
                aria-expanded={open}
                aria-haspopup="listbox"
                aria-label="International Dialing Code"
                onClick={() => { if (open) { setOpen(false); } else { setOpen(true); setQuery(''); setHighlight(0); } }}
                className={`flex items-center justify-between gap-2 p-4 border-2 rounded-2xl bg-gray-50 font-black text-xs whitespace-nowrap outline-none focus:bg-white transition-all ${open ? 'border-blue-500 bg-white' : 'border-gray-50 focus:border-blue-500'}`}
            >
                <span>{selected.label}</span>
                <svg className={`w-3.5 h-3.5 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" /></svg>
            </button>

            {open && (
                <div className="absolute z-50 mt-2 w-72 max-w-[92vw] rounded-2xl bg-white border border-gray-200 shadow-2xl overflow-hidden">
                    <div className="p-3 border-b border-gray-100">
                        <input
                            ref={inputRef}
                            value={query}
                            onChange={e => { setQuery(e.target.value); setHighlight(0); }}
                            onKeyDown={onKeyDown}
                            placeholder="Search country or code..."
                            className="w-full p-3 border-2 border-gray-100 rounded-xl bg-gray-50 font-bold text-xs outline-none focus:border-blue-500"
                        />
                    </div>
                    <ul role="listbox" className="max-h-64 overflow-y-auto">
                        {filtered.length === 0 && (
                            <li className="p-4 text-center text-[10px] font-black uppercase tracking-widest text-gray-400">No country found</li>
                        )}
                        {filtered.map((c, i) => (
                            <li
                                key={c.code}
                                role="option"
                                aria-selected={c.code === value}
                                onMouseDown={(e) => { e.preventDefault(); pick(c.code); }}
                                onMouseEnter={() => setHighlight(i)}
                                className={`px-4 py-2.5 cursor-pointer font-bold text-xs uppercase tracking-wide whitespace-nowrap ${i === highlight ? 'bg-blue-50 text-blue-900' : c.code === value ? 'bg-teal-50 text-gray-700' : 'text-gray-600'}`}
                            >
                                {c.label}
                            </li>
                        ))}
                    </ul>
                </div>
            )}
        </div>
    );
};

export default CountryDialSelect;