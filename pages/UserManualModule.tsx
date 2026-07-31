
import React, { useRef, useState } from 'react';
import { exportToPDF } from '../services/utils';

const UserManualModule = () => {
    const manualRef = useRef<HTMLDivElement>(null);
    const [activeTab, setActiveTab] = useState<'manual' | 'training'>('manual');

    const handleExport = () => {
        if (manualRef.current) {
            const fileName = activeTab === 'manual' 
                ? "FGBMFI_EMS_Operations_Manual.pdf" 
                : "FGBMFI_EMS_Volunteer_Training_Guide.pdf";
            exportToPDF(manualRef.current, fileName, 'portrait');
        }
    };

    return (
        <div className="max-w-4xl mx-auto space-y-6 pb-20">
            {/* Header & Controls */}
            <div className="bg-white p-6 rounded-2xl shadow-sm border no-print space-y-6">
                <div className="flex justify-between items-center">
                    <div>
                        <h2 className="text-xl font-black uppercase tracking-widest text-blue-900">System Documentation</h2>
                        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Training & Reference Center</p>
                    </div>
                    <button 
                        onClick={handleExport}
                        className="px-8 py-3 bg-slate-900 text-white rounded-xl text-xs font-black uppercase tracking-widest hover:bg-black shadow-xl transition-all"
                    >
                        Export Active View (PDF)
                    </button>
                </div>

                {/* Tab Switcher */}
                <div className="flex p-1 bg-gray-100 rounded-2xl">
                    <button 
                        onClick={() => setActiveTab('manual')}
                        className={`flex-1 py-3 text-[10px] font-black uppercase tracking-widest rounded-xl transition-all ${activeTab === 'manual' ? 'bg-white text-blue-900 shadow-sm' : 'text-gray-400 hover:text-gray-600'}`}
                    >
                        Technical Operations Manual
                    </button>
                    <button 
                        onClick={() => setActiveTab('training')}
                        className={`flex-1 py-3 text-[10px] font-black uppercase tracking-widest rounded-xl transition-all ${activeTab === 'training' ? 'bg-white text-blue-900 shadow-sm' : 'text-gray-400 hover:text-gray-600'}`}
                    >
                        Volunteer Training Guide
                    </button>
                </div>
            </div>

            <div ref={manualRef} className="bg-white p-12 md:p-16 rounded-[2.5rem] shadow-sm border min-h-screen text-slate-800 leading-relaxed">
                
                {activeTab === 'manual' ? (
                    /* FULL 8-SECTION OPERATIONS MANUAL (RESTORED) */
                    <>
                        <div className="text-center mb-12 border-b-4 border-blue-900 pb-10">
                            <h1 className="text-4xl font-black uppercase text-blue-900 mb-2 tracking-tighter">Operations Manual</h1>
                            <p className="text-sm font-bold text-gray-500 uppercase tracking-[0.3em]">Regional Events Management System (EMS)</p>
                            <div className="mt-6 flex justify-center gap-4">
                                <span className="bg-blue-50 text-blue-700 px-4 py-1 rounded-full text-[10px] font-black uppercase border border-blue-100">FGBMFI Nigeria</span>
                                <span className="bg-blue-50 text-blue-700 px-4 py-1 rounded-full text-[10px] font-black uppercase border border-blue-100">Version 2.7</span>
                            </div>
                        </div>

                        {/* Section 01: Login */}
                        <section className="mb-12 break-inside-avoid">
                            <h2 className="text-xl font-black text-blue-900 uppercase mb-4 flex items-center gap-3 border-b pb-2">
                                <span className="bg-blue-900 text-white w-8 h-8 rounded-lg flex items-center justify-center text-sm font-mono">01</span>
                                System Access & Security
                            </h2>
                            <div className="space-y-4 text-sm text-gray-600">
                                <p>Accessing the system requires a verified account. Follow these steps to begin:</p>
                                <ol className="list-decimal ml-5 space-y-2 font-medium">
                                    <li>Enter your <strong>System Username</strong> (Email) and <strong>Security Password</strong>.</li>
                                    <li>Click <strong>"Sign In To System"</strong>. A blue "Verifying" status indicates the secure link is establishing.</li>
                                    <li><strong>Session Recovery:</strong> If the screen hangs or the login button stays on "Verifying", click the <span className="text-blue-600 font-bold">"Reset Connection"</span> button at the bottom. This clears browser cache and forces a fresh secure handshake.</li>
                                </ol>
                            </div>
                        </section>

                        {/* Section 02: Navigation & Context */}
                        <section className="mb-12 break-inside-avoid">
                            <h2 className="text-xl font-black text-blue-900 uppercase mb-4 flex items-center gap-3 border-b pb-2">
                                <span className="bg-blue-900 text-white w-8 h-8 rounded-lg flex items-center justify-center text-sm font-mono">02</span>
                                Event Selection (Context)
                            </h2>
                            <div className="bg-blue-50 p-6 rounded-2xl border border-blue-100">
                                <p className="text-sm font-bold text-blue-900 mb-3 uppercase tracking-tight">Activating the Event</p>
                                <p className="text-xs text-blue-800 leading-relaxed">
                                    The system is designed for multi-event management. After logging in, you <strong>must</strong> select the active event from the <strong>"Event Context"</strong> dropdown at the top-right of the screen. Until an event is selected, most modules (Check-In, Financials, Reports) will remain locked or empty.
                                </p>
                            </div>
                        </section>

                        {/* Section 03: Dashboard */}
                        <section className="mb-12 break-inside-avoid">
                            <h2 className="text-xl font-black text-blue-900 uppercase mb-4 flex items-center gap-3 border-b pb-2">
                                <span className="bg-blue-900 text-white w-8 h-8 rounded-lg flex items-center justify-center text-sm font-mono">03</span>
                                Dashboard & Analytics
                            </h2>
                            <p className="mb-4 text-sm text-gray-600 font-medium">The Dashboard provides a real-time summary of the event status. Data refreshes automatically when you select a different event.</p>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs font-bold text-gray-700">
                                <div className="p-4 border rounded-xl bg-gray-50"><span className="text-blue-600 block mb-1">4 STAT CARDS</span> Total Delegates, Event Arrivals (with %), Session Attendance Count, and Total Financials.</div>
                                <div className="p-4 border rounded-xl bg-gray-50"><span className="text-blue-600 block mb-1">DYNAMIC CHARTS</span> Attendance by Rank pie chart and Attendance by District bar chart. The Rank chart and Live Feed Rank/Office columns respect per-event field visibility settings.</div>
                                <div className="p-4 border rounded-xl bg-gray-50"><span className="text-blue-600 block mb-1">LIVE FEED</span> A scrolling log of the 10 most recent check-ins with real-time updates via Supabase Realtime.</div>
                                <div className="p-4 border rounded-xl bg-gray-50"><span className="text-blue-600 block mb-1">AUTO-LOAD</span> Selecting a new event from the dropdown immediately refreshes all dashboard data.</div>
                            </div>
                        </section>

                        {/* Section 04: Arrival Verification (Existing Delegates) */}
                        <section className="mb-12 break-inside-avoid">
                            <h2 className="text-xl font-black text-blue-900 uppercase mb-4 flex items-center gap-3 border-b pb-2">
                                <span className="bg-blue-900 text-white w-8 h-8 rounded-lg flex items-center justify-center text-sm font-mono">04</span>
                                Operations: Arrival & QR Code Verification
                            </h2>
                            <p className="mb-4 text-sm text-gray-600">The majority of delegates are already in the Master Database (via bulk import). Three verification methods are supported:</p>
                            <div className="bg-slate-900 p-8 rounded-[2rem] text-white shadow-xl">
                                <h4 className="text-xs font-black uppercase text-blue-400 mb-4 tracking-widest">Method 1: QR Code Scan (Fastest)</h4>
                                <ol className="space-y-4">
                                    <li className="flex gap-4 items-start text-sm">
                                        <span className="bg-white/10 w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-black shrink-0 border border-white/20">1</span>
                                        <span>Each delegate has a <strong>name badge with a unique QR code</strong>. On the Check-In page, tap the <strong>"SCAN QR"</strong> button to activate the camera.</span>
                                    </li>
                                    <li className="flex gap-4 items-start text-sm">
                                        <span className="bg-white/10 w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-black shrink-0 border border-white/20">2</span>
                                        <span>Point the camera at the delegate's badge QR code. The system auto-decodes it and verifies arrival instantly.</span>
                                    </li>
                                    <li className="flex gap-4 items-start text-sm">
                                        <span className="bg-white/10 w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-black shrink-0 border border-white/20">3</span>
                                        <span>A green "Verified!" flash confirms success. The delegate's information and 4-digit backup code appear.</span>
                                    </li>
                                </ol>
                                <h4 className="text-xs font-black uppercase text-blue-400 mt-6 mb-4 tracking-widest">Method 2: Manual Lookup</h4>
                                <ol className="space-y-4">
                                    <li className="flex gap-4 items-start text-sm">
                                        <span className="bg-white/10 w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-black shrink-0 border border-white/20">1</span>
                                        <span>Go to the <strong>"Check-In"</strong> module. Ensure "Event Arrival" is selected as the scope.</span>
                                    </li>
                                    <li className="flex gap-4 items-start text-sm">
                                        <span className="bg-white/10 w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-black shrink-0 border border-white/20">2</span>
                                        <span>Use the <strong>"Manual Lookup"</strong> search bar to type the member's Name or Phone.</span>
                                    </li>
                                    <li className="flex gap-4 items-start text-sm">
                                        <span className="bg-white/10 w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-black shrink-0 border border-white/20">3</span>
                                        <span>Find the matching record and click <strong>"Verify Entry"</strong>.</span>
                                    </li>
                                </ol>
                                <h4 className="text-xs font-black uppercase text-blue-400 mt-6 mb-4 tracking-widest">Method 3: 4-Digit Code Entry</h4>
                                <ol className="space-y-4">
                                    <li className="flex gap-4 items-start text-sm">
                                        <span className="bg-white/10 w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-black shrink-0 border border-white/20">1</span>
                                        <span>Type the delegate's <strong>4-Digit Backup Code</strong> into the large input field or scan it via QR.</span>
                                    </li>
                                    <li className="flex gap-4 items-start text-sm">
                                        <span className="bg-white/10 w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-black shrink-0 border border-white/20">2</span>
                                        <span>The system auto-verifies the code and records the check-in instantly.</span>
                                    </li>
                                    <li className="flex gap-4 items-start text-sm">
                                        <span className="bg-green-500/20 text-green-400 p-4 rounded-xl border border-green-500/30 font-black">
                                            Step 3: The 4-Digit Code appears on the verified delegate's card. Give this code to the delegate for all future session check-ins. <strong>Badge Reprint:</strong> Tap "Reprint Badge" to print, download as PDF/image, or share the e-badge via WhatsApp.
                                        </span>
                                    </li>
                                </ol>
                            </div>
                        </section>

                        {/* Section 05: New Delegate Registration */}
                        <section className="mb-12 break-inside-avoid">
                            <h2 className="text-xl font-black text-blue-900 uppercase mb-4 flex items-center gap-3 border-b pb-2">
                                <span className="bg-blue-900 text-white w-8 h-8 rounded-lg flex items-center justify-center text-sm font-mono">05</span>
                                Operations: New Delegate Registration
                            </h2>
                            <p className="mb-4 text-sm text-gray-600">For delegates not found in the database (e.g., visitors from other regions or National Officers). The form adapts per event via the Events Catalog configuration.</p>
                            <div className="space-y-4">
                                <div className="border-l-4 border-blue-600 pl-6 py-2">
                                    <h4 className="text-xs font-black uppercase text-blue-700 mb-1">Step 1: Complete the Form</h4>
                                    <p className="text-sm text-gray-600">Navigate to <strong>"New Delegate"</strong>. Fill in Title, First Name, Last Name, District (dropdown of all 25 FGBMFI Nigeria Districts), Chapter (cascaded dropdown filtered by the selected District), Phone, and Email.</p>
                                </div>
                                <div className="border-l-4 border-blue-600 pl-6 py-2">
                                    <h4 className="text-xs font-black uppercase text-blue-700 mb-1">Step 2: Configurable Fields</h4>
                                    <p className="text-sm text-gray-600">Fields like <strong>Rank, Office, and Delegate Type</strong> (Member, National Guest, Free Guest, Dependant, International etc.) appear or hide based on the active event's configuration set in the Events Catalog. Admins can toggle these per event.</p>
                                </div>
                                <div className="border-l-4 border-green-600 pl-6 py-2">
                                    <h4 className="text-xs font-black uppercase text-green-700 mb-1">Step 3: Register & Verify</h4>
                                    <p className="text-sm text-gray-600 font-bold">Click <strong>"Complete Registration & Verify Arrival"</strong>. The system adds them to the master list and records their event arrival simultaneously. A 4-digit code is generated for the delegate.</p>
                                </div>
                            </div>
                        </section>

                        {/* Section 06: Session Check-In (Verification) */}
                        <section className="mb-12 break-inside-avoid">
                            <h2 className="text-xl font-black text-blue-900 uppercase mb-4 flex items-center gap-3 border-b pb-2">
                                <span className="bg-blue-900 text-white w-8 h-8 rounded-lg flex items-center justify-center text-sm font-mono">06</span>
                                Active Session Verification (QR & Code)
                            </h2>
                            <p className="mb-4 text-sm text-gray-600">Used for checking into specific sessions (Business Session, Banquet, etc.). QR scanning and 4-digit codes are both supported.</p>
                            <div className="bg-blue-900 p-8 rounded-2xl text-white shadow-xl">
                                <ol className="space-y-3 text-sm">
                                    <li className="flex gap-4"><span className="text-blue-300 font-black">1.</span> Go to <strong>"Check-In"</strong> and select the current session from the dropdown. Sessions match the event program schedule.</li>
                                    <li className="flex gap-4"><span className="text-blue-300 font-black">2.</span> <strong>QR Scan:</strong> Tap "SCAN QR" and point the camera at the delegate's badge. The system auto-decodes, auto-verifies arrival (if needed), and marks session attendance.</li>
                                    <li className="flex gap-4"><span className="text-blue-300 font-black">3.</span> <strong>4-Digit Code:</strong> Type the delegate's backup code into the input field — it auto-submits after the 4th digit.</li>
                                    <li className="flex gap-4"><span className="text-blue-300 font-black">4.</span> <strong>Manual Lookup:</strong> Search by name or phone, then click "Verify Entry" for the current session.</li>
                                    <li className="flex gap-4"><span className="text-blue-300 font-black">5.</span> <strong>Auto-Arrival Cascade:</strong> If the delegate has NOT yet completed Event Arrival check-in, the system automatically records arrival first, then verifies session attendance — all in one scan.</li>
                                    <li className="flex gap-4"><span className="text-blue-300 font-black">6.</span> For new visitors not yet in the database, the Quick Registration form provides District and Chapter dropdowns populated from the 25-district, 1,447-chapter registry.</li>
                                </ol>
                            </div>
                        </section>

                        {/* Section 06A: Session Details Tracking (Alter Calls) */}
                        <section className="mb-12 break-inside-avoid">
                            <h2 className="text-xl font-black text-blue-900 uppercase mb-4 flex items-center gap-3 border-b pb-2">
                                <span className="bg-blue-900 text-white w-8 h-8 rounded-lg flex items-center justify-center text-sm font-mono">6A</span>
                                Session Details: Alter Call Recording & Tracking
                            </h2>
                            <p className="text-sm text-gray-600 mb-4">The <strong>Session Details</strong> page (<span className="font-mono bg-gray-100 px-1 rounded">#/ministry</span>) captures delegate responses to altar calls during each session. Four response types are tracked per delegate:</p>
                            <div className="space-y-4">
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs font-bold">
                                    <div className="p-4 border rounded-xl bg-amber-50"><span className="text-amber-700 block mb-1 font-black">FT — First Timers</span> Delegates attending for the first time. Tracked individually for follow-up.</div>
                                    <div className="p-4 border rounded-xl bg-emerald-50"><span className="text-emerald-700 block mb-1 font-black">SLV — Salvation</span> Delegates who gave their life to Christ. Tracked individually for discipleship.</div>
                                    <div className="p-4 border rounded-xl bg-blue-50"><span className="text-blue-700 block mb-1 font-black">MI — Membership Intention</span> Delegates intending to join FGBMFI. Tracked individually for follow-up.</div>
                                    <div className="p-4 border rounded-xl bg-red-50"><span className="text-red-700 block mb-1 font-black">HGB — Holy Ghost Baptism</span> Delegates who received the Holy Ghost Baptism. Tracked individually.</div>
                                </div>
                                <div className="p-4 border rounded-xl bg-yellow-50">
                                    <span className="text-yellow-700 block mb-1 text-xs font-black">VD — Voice Distribution (Aggregate)</span>
                                    <span className="text-xs text-gray-600">Voice Magazine distribution is recorded as a total figure per session, not per-delegate. Enter the total number of copies distributed.</span>
                                </div>
                            </div>
                            <div className="bg-slate-900 p-8 rounded-2xl text-white shadow-xl mt-6">
                                <h4 className="text-xs font-black uppercase text-blue-400 mb-4 tracking-widest">Three Recording Methods</h4>
                                <div className="space-y-6">
                                    <div>
                                        <h5 className="text-[10px] font-black text-green-400 uppercase mb-2">Method 1: QR Code Scan (Fastest)</h5>
                                        <ol className="space-y-2 text-sm">
                                            <li className="flex gap-3"><span className="text-blue-300 font-black shrink-0">1.</span> Select the active session and the Alter Call type (FT/SLV/MI/HGB) from the selector buttons.</li>
                                            <li className="flex gap-3"><span className="text-blue-300 font-black shrink-0">2.</span> Tap <strong>"SCAN QR"</strong> and scan the delegate's badge QR code. The system auto-records the response for the selected call type instantly.</li>
                                            <li className="flex gap-3"><span className="text-blue-300 font-black shrink-0">3.</span> A green "Recorded!" flash confirms success. The counter updates immediately.</li>
                                        </ol>
                                    </div>
                                    <div>
                                        <h5 className="text-[10px] font-black text-green-400 uppercase mb-2">Method 2: 4-Digit Code or Manual Lookup</h5>
                                        <ol className="space-y-2 text-sm">
                                            <li className="flex gap-3"><span className="text-blue-300 font-black shrink-0">1.</span> Type the delegate's 4-digit code or search by name/phone in the <strong>"Database Lookup & Manual Record"</strong> section.</li>
                                            <li className="flex gap-3"><span className="text-blue-300 font-black shrink-0">2.</span> Click <strong>"Record as FT/SLV/MI/HGB"</strong> for each delegate. The system prevents double-recording the same call type per session.</li>
                                        </ol>
                                    </div>
                                    <div>
                                        <h5 className="text-[10px] font-black text-green-400 uppercase mb-2">Method 3: Manual Totals Entry (Open-Air Sessions)</h5>
                                        <ol className="space-y-2 text-sm">
                                            <li className="flex gap-3"><span className="text-blue-300 font-black shrink-0">1.</span> For sessions like Market Place Outreach (MPO) or Fire Team Outreach (FTO) where individual tracking is difficult, tap <strong>"Enter Total"</strong> for any call type.</li>
                                            <li className="flex gap-3"><span className="text-blue-300 font-black shrink-0">2.</span> Enter the aggregate headcount. This is recorded separately from individual scans and is clearly distinguished in all reports.</li>
                                        </ol>
                                    </div>
                                </div>
                            </div>
                            <div className="mt-6 space-y-3 text-xs font-bold text-gray-700">
                                <div className="p-4 border rounded-xl bg-gray-50">
                                    <span className="text-blue-600 block mb-1">RULE: ONE PER TYPE</span>
                                    A delegate can respond to <strong>multiple different</strong> altar calls in one session (FT + SLV + MI + HGB), but only <strong>once per call type</strong>. The system blocks duplicate recordings per delegate per type.
                                </div>
                                <div className="p-4 border rounded-xl bg-gray-50">
                                    <span className="text-blue-600 block mb-1">SESSIONS SUMMARY TABLE</span>
                                    At the bottom of the page, the <strong>"Sessions Summary (All Sessions)"</strong> table shows ATT, FT, SLV, MI, HGB, and VD totals for every session. Export to PDF or Excel using the buttons above the table.
                                </div>
                                <div className="p-4 border rounded-xl bg-gray-50">
                                    <span className="text-blue-600 block mb-1">NEW DELEGATE REGISTRATION</span>
                                    If a delegate's QR code is not found in the database, the system opens the Quick Registration form (same as Check-In). After registration, the alter call response is recorded automatically.
                                </div>
                            </div>
                        </section>

                        {/* Section 07: Financial Management */}
                        <section className="mb-12 break-inside-avoid">
                            <h2 className="text-xl font-black text-blue-900 uppercase mb-4 flex items-center gap-3 border-b pb-2">
                                <span className="bg-blue-900 text-white w-8 h-8 rounded-lg flex items-center justify-center text-sm font-mono">07</span>
                                Financials: Offerings & Pledges
                            </h2>
                            <div className="space-y-6">
                                <div className="p-5 border rounded-2xl bg-gray-50">
                                    <h4 className="text-xs font-black text-blue-900 uppercase mb-2">Recording Offerings</h4>
                                    <p className="text-xs text-gray-600">Navigate to <strong>"Financials"</strong>. Select the session, enter the amount, and click "Record Offering". This records bulk collections.</p>
                                </div>
                                <div className="p-5 border rounded-2xl bg-gray-50">
                                    <h4 className="text-xs font-black text-blue-900 uppercase mb-2">New Pledges</h4>
                                    <p className="text-xs text-gray-600">In the "New Pledge" tab, search for the donor by name. Enter the total promised amount and save. This creates an active debt record.</p>
                                </div>
                                <div className="p-5 border rounded-2xl bg-gray-50">
                                    <h4 className="text-xs font-black text-blue-900 uppercase mb-2">Redemption (Payments)</h4>
                                    <p className="text-xs text-gray-600">Search for the donor in the "Redemption" tab. Select their active pledge, enter the payment amount, and save. The system calculates the remaining balance automatically.</p>
                                </div>
                            </div>
                        </section>

                        {/* Section 08: Reports & Exports */}
                        <section className="mb-12 break-inside-avoid">
                            <h2 className="text-xl font-black text-blue-900 uppercase mb-4 flex items-center gap-3 border-b pb-2">
                                <span className="bg-blue-900 text-white w-8 h-8 rounded-lg flex items-center justify-center text-sm font-mono">08</span>
                                Reports Center
                            </h2>
                            <p className="text-sm text-gray-600 mb-4">The Reports Center (<span className="font-mono bg-gray-100 px-1 rounded">#/admin/reports</span>) generates Attendance Lists, Attendance Matrices, Financial Ledgers, Pledge Summaries, and Session Reports. Reports respect per-event field visibility settings.</p>
                            <ul className="space-y-4 text-xs font-bold text-gray-700">
                                <li className="flex gap-3"><span className="text-blue-600">•</span> <span><strong>Attendance List:</strong> Full list grouped by district with Name, Chapter, Rank, Office, Phone, and Check-in Time columns. Chapter column is always shown. Rank and Office columns are conditionally displayed based on event configuration. Filter by session or view Master (All Sessions).</span></li>
                                <li className="flex gap-3"><span className="text-blue-600">•</span> <span><strong>Attendance Matrix:</strong> Grid views showing Rank vs District, Office vs District, and Delegate Type vs District headcounts. Each matrix is conditionally shown based on event configuration.</span></li>
                                <li className="flex gap-3"><span className="text-blue-600">•</span> <span><strong>Financial Matrix:</strong> A summary of funds collected across all sessions.</span></li>
                                <li className="flex gap-3"><span className="text-blue-600">•</span> <span><strong>Pledge Summary & Detail:</strong> Per-district pledge summary with pledged/redeemed/balance columns, plus detailed donor-level lists.</span></li>
                                <li className="flex gap-3"><span className="text-blue-600">•</span> <span><strong>Sessions Report:</strong> Per-session breakdown with Attendance (ATT), FT, SLV, MI, HGB, and VD totals. The <strong>Alter Call</strong> dropdown filter isolates a specific call type (e.g., show only Salvation responders). Individual records per response type list each delegate with Name, District, Chapter, Phone, Rank, and Office — exportable to CSV via the <strong>"Export CSV"</strong> button for follow-up planning.</span></li>
                                <li className="flex gap-3"><span className="text-blue-600">•</span> <span><strong>PDF Export:</strong> Switch to your desired report tab and click <strong>"Export PDF"</strong>. The system generates a landscape-oriented document with the active filter settings applied.</span></li>
                                <li className="flex gap-3"><span className="text-blue-600">•</span> <span><strong>CSV Export:</strong> The Delegate Master List supports CSV export for offline processing. Alter Call respondent lists in the Sessions report are individually exportable to CSV.</span></li>
                            </ul>
                        </section>

                        {/* Section 08A: Badge Management & E-Badge Distribution */}
                        <section className="mb-12 break-inside-avoid">
                            <h2 className="text-xl font-black text-blue-900 uppercase mb-4 flex items-center gap-3 border-b pb-2">
                                <span className="bg-blue-900 text-white w-8 h-8 rounded-lg flex items-center justify-center text-sm font-mono">8A</span>
                                Badge Management & E-Badge Distribution
                            </h2>
                            <p className="text-sm text-gray-600 mb-4">Every verified delegate receives a 60mm × 70mm badge with a scannable QR code. The badge can be reprinted, downloaded, or shared digitally.</p>
                            <div className="space-y-4">
                                <div className="p-5 border rounded-2xl bg-gray-50">
                                    <h4 className="text-xs font-black text-blue-900 uppercase mb-2">Badge Reprint</h4>
                                    <p className="text-xs text-gray-600">In the Check-In search results, a verified delegate shows a <strong>"Reprint Badge"</strong> button. Tap it to open the badge preview modal showing the FGBMFI Nigeria header, delegate name, district, chapter, rank, 28mm QR code, and 4-digit backup code.</p>
                                </div>
                                <div className="p-5 border rounded-2xl bg-gray-50">
                                    <h4 className="text-xs font-black text-blue-900 uppercase mb-2">Four Export Options</h4>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs font-bold mt-3">
                                        <div className="p-3 border rounded-xl bg-blue-50"><span className="text-blue-800 block mb-1">Print</span> Opens the browser print dialog. Select "Actual Size" (100% scale) for the exact 60×70mm badge. Use for physical badge printing.</div>
                                        <div className="p-3 border rounded-xl bg-slate-100"><span className="text-slate-800 block mb-1">PDF</span> Downloads the badge as a 60×70mm PDF at exact scale. Ready for emailing or professional printing.</div>
                                        <div className="p-3 border rounded-xl bg-emerald-50"><span className="text-emerald-800 block mb-1">Image</span> Downloads a high-resolution PNG image of the badge. Perfect for saving to a mobile gallery and displaying at check-in points.</div>
                                        <div className="p-3 border rounded-xl bg-purple-50"><span className="text-purple-800 block mb-1">Share</span> Opens the native device share sheet (WhatsApp, Telegram, email, etc.). The officer can instantly send the e-badge to the delegate's phone without saving a file first.</div>
                                    </div>
                                </div>
                                <div className="p-5 border rounded-2xl bg-gray-50">
                                    <h4 className="text-xs font-black text-blue-900 uppercase mb-2">E-Badge for Delegates</h4>
                                    <p className="text-xs text-gray-600">Delegates receive the badge image via WhatsApp or Telegram, save it to their phone gallery, and display it full-screen at check-in points. The 28mm QR code renders clearly on mobile screens (approx. 300-400px on standard devices) for reliable scanning at arm's length. The badge includes the delegate's name, district, and backup code for verification.</p>
                                </div>
                                <div className="p-5 border rounded-2xl bg-gray-50">
                                    <h4 className="text-xs font-black text-blue-900 uppercase mb-2">Lost Badge Recovery</h4>
                                    <p className="text-xs text-gray-600">If a delegate loses their physical badge, tap the <strong>"Lost Badge"</strong> button. This generates a new QR code (invalidating the old one) and reprints the badge. The 4-digit backup code remains unchanged.</p>
                                </div>
                            </div>
                        </section>

                        {/* Section 09: Admin Configuration */}
                        <section className="mb-12 break-inside-avoid">
                            <h2 className="text-xl font-black text-blue-900 uppercase mb-4 flex items-center gap-3 border-b pb-2">
                                <span className="bg-blue-900 text-white w-8 h-8 rounded-lg flex items-center justify-center text-sm font-mono">09</span>
                                Admin: Events Catalog & Configuration
                            </h2>
                            <p className="text-sm text-gray-600 mb-4">The <strong>Events Catalog</strong> (formerly Regional Events) is where Admins manage events and their settings.</p>
                            <div className="space-y-4 text-xs font-bold text-gray-700">
                                <div className="p-4 border rounded-xl bg-gray-50">
                                    <span className="text-blue-600 block mb-1">EVENT LIFECYCLE</span>
                                    Each event has a Live (Open) or Locked (Final) status. Locked events are read-only — all registration, check-in, and financial writes are blocked.
                                </div>
                                <div className="p-4 border rounded-xl bg-gray-50">
                                    <span className="text-blue-600 block mb-1">SESSION MANAGEMENT</span>
                                    Admins can create and edit sessions (sub-events) with start/end times. Session times are stored in UTC and display correctly in local Nigeria time.
                                </div>
                                <div className="p-4 border rounded-xl bg-gray-50">
                                    <span className="text-blue-600 block mb-1">FIELD VISIBILITY TOGGLES</span>
                                    For each event, Admins can toggle which delegate fields appear in forms and reports: <strong>Show Rank</strong>, <strong>Show Office</strong>, and <strong>Show Delegate Type</strong>. For example, a Convention may hide Rank and Office while a Council Meeting shows them. Changes apply instantly across Dashboard, New Delegate, Master List, Check-In, and Reports.
                                </div>
                                <div className="p-4 border rounded-xl bg-gray-50">
                                    <span className="text-blue-600 block mb-1">CSV IMPORT</span>
                                    Bulk-import delegates via 10-column CSV (Title, FirstName, LastName, District, Chapter, Phone, Email, Rank, Office, DelegateType).
                                </div>
                            </div>
                        </section>

                        {/* Section 10: System Setup & Chapters Registry */}
                        <section className="mb-12 break-inside-avoid">
                            <h2 className="text-xl font-black text-blue-900 uppercase mb-4 flex items-center gap-3 border-b pb-2">
                                <span className="bg-blue-900 text-white w-8 h-8 rounded-lg flex items-center justify-center text-sm font-mono">10</span>
                                System Setup & Chapters Registry
                            </h2>
                            <p className="text-sm text-gray-600 mb-4">The <strong>System Setup</strong> module is where Admins configure global reference data that drives all dropdowns across the application.</p>
                            <div className="space-y-4 text-xs font-bold text-gray-700">
                                <div className="p-4 border rounded-xl bg-gray-50">
                                    <span className="text-blue-600 block mb-1">CONFIGURABLE LISTS</span>
                                    Manage Titles, Regions, Districts, Ranks, Offices, and Delegate Types. Changes sync instantly and propagate to all forms and reports.
                                </div>
                                <div className="p-4 border rounded-xl bg-gray-50">
                                    <span className="text-blue-600 block mb-1">DELEGATE TYPES</span>
                                    Define the types of delegates expected at events: Member, National Guest, Free Guest, Dependant-Adult, Dependant-Teen, Dependant-Children, International. The list is expandable/compressible via add/edit/delete controls.
                                </div>
                                <div className="p-4 border rounded-xl bg-gray-50">
                                    <span className="text-blue-600 block mb-1">CHAPTERS REGISTRY (1,447 Chapters)</span>
                                    A master registry of all FGBMFI Nigeria chapters across 25 districts. Filter by district, search by name. The <strong>"Import Chapters"</strong> button loads the official consolidated chapter list. Once imported, the Chapter dropdown in all delegate forms cascades automatically — selecting a District filters the Chapter list to only show chapters in that district.
                                </div>
                                <div className="p-4 border rounded-xl bg-gray-50">
                                    <span className="text-blue-600 block mb-1">25 FGBMFI DISTRICTS</span>
                                    The system supports all 25 FGBMFI Nigeria Districts: North Central (1-5), North East (1-2), North West (1-3), South East (1-3), South South (1-4), and South West (1-8). The district dropdown in all forms merges official districts from settings with those found in the chapters registry.
                                </div>
                            </div>
                        </section>
                    </>
                ) : (
                    /* VOLUNTEER TRAINING GUIDE CONTENT (SCENARIO-BASED) */
                    <>
                        <div className="text-center mb-12 border-b-4 border-blue-900 pb-10">
                            <h1 className="text-4xl font-black uppercase text-blue-900 mb-2 tracking-tighter">Volunteer Training Guide</h1>
                            <p className="text-sm font-bold text-gray-500 uppercase tracking-[0.3em]">Scenario-Based Workflow & Procedures</p>
                            <div className="mt-6 flex justify-center gap-4">
                                <span className="bg-blue-50 text-blue-700 px-4 py-1 rounded-full text-[10px] font-black uppercase border border-blue-100">FGBMFI Nigeria</span>
                                <span className="bg-blue-50 text-blue-700 px-4 py-1 rounded-full text-[10px] font-black uppercase border border-blue-100">Volunteer Handout</span>
                            </div>
                        </div>

                        {/* Track 1: Registrars */}
                        <section className="mb-12 break-inside-avoid">
                            <div className="flex items-center gap-4 mb-6">
                                <div className="bg-blue-900 text-white px-4 py-2 rounded-xl text-xs font-black uppercase">Track A</div>
                                <h2 className="text-2xl font-black text-blue-900 uppercase tracking-tight">The Registrar’s Scenarios</h2>
                            </div>
                            
                            <div className="space-y-6">
                                <div className="p-6 bg-gray-50 rounded-2xl border border-gray-100">
                                    <h4 className="text-xs font-black text-blue-700 uppercase mb-2">Scenario 1: The "QR Scan" Fast-Track</h4>
                                    <p className="text-sm text-gray-600 italic">"The delegate has their printed badge with QR code."</p>
                                    <div className="mt-3 text-[11px] font-bold text-gray-800 uppercase space-y-1">
                                        <p>1. Open Check-In Tab.</p>
                                        <p>2. Select active session (e.g., Banquet).</p>
                                        <p>3. Tap "SCAN QR" and scan the badge. Arrival auto-verifies if needed. Done.</p>
                                    </div>
                                </div>

                                <div className="p-6 bg-gray-50 rounded-2xl border border-gray-100">
                                    <h4 className="text-xs font-black text-blue-700 uppercase mb-2">Scenario 2: The "I Have My Code" Member</h4>
                                    <p className="text-sm text-gray-600 italic">"I have my 4-digit code from the last session."</p>
                                    <div className="mt-3 text-[11px] font-bold text-gray-800 uppercase space-y-1">
                                        <p>1. Open Check-In Tab.</p>
                                        <p>2. Select active session (e.g. Banquet).</p>
                                        <p>3. Type the 4 digits on the keypad — auto-submits on 4th digit.</p>
                                        <p>4. System auto-verifies arrival if not already done. Done.</p>
                                    </div>
                                </div>

                                <div className="p-6 bg-gray-50 rounded-2xl border border-gray-100">
                                    <h4 className="text-xs font-black text-blue-700 uppercase mb-2">Scenario 3: The "Forgotten Code" Member</h4>
                                    <p className="text-sm text-gray-600 italic">"I forgot my code or lost my slip."</p>
                                    <div className="mt-3 text-[11px] font-bold text-gray-800 uppercase space-y-1">
                                        <p>1. Use the "Database Lookup" search bar.</p>
                                        <p>2. Search by Name or Phone.</p>
                                        <p>3. Verify arrival. Code appears on screen — issue it again.</p>
                                    </div>
                                </div>

                                <div className="p-6 bg-blue-900 text-white rounded-2xl shadow-xl">
                                    <h4 className="text-xs font-black text-blue-400 uppercase mb-2">Scenario 4: The "New Visitor" (External)</h4>
                                    <p className="text-sm text-gray-300 italic">"I'm from a different region/national office and not in the database."</p>
                                    <div className="mt-3 text-[11px] font-black uppercase space-y-1">
                                        <p>1. Scan the badge QR — system opens Quick Registration form.</p>
                                        <p>2. Select District from dropdown (25 options).</p>
                                        <p>3. Chapter field auto-filters to that district only.</p>
                                        <p>4. Fill remaining details and click "Register & Verify".</p>
                                    </div>
                                </div>

                                <div className="p-6 bg-green-900 text-white rounded-2xl shadow-xl mt-6">
                                    <h4 className="text-xs font-black text-green-400 uppercase mb-2">Scenario 5: The "Altar Call Response" Recording</h4>
                                    <p className="text-sm text-gray-300 italic">"A delegate has responded to the altar call — I need to record it."</p>
                                    <div className="mt-3 text-[11px] font-black uppercase space-y-1">
                                        <p>1. Go to <strong>"Session Details"</strong> page (sidebar).</p>
                                        <p>2. Select the active session. Choose the response type: FT/SLV/MI/HGB.</p>
                                        <p>3. Scan the delegate's QR code — the response is recorded instantly.</p>
                                        <p>4. For open-air sessions (MPO/FTO), use <strong>"Enter Total"</strong> to record aggregate headcounts.</p>
                                        <p>5. Enter Voice Distribution totals at the bottom of the page.</p>
                                    </div>
                                </div>
                            </div>
                        </section>

                        {/* Track 2: Finance */}
                        <section className="mb-12 break-inside-avoid">
                            <div className="flex items-center gap-4 mb-6">
                                <div className="bg-green-600 text-white px-4 py-2 rounded-xl text-xs font-black uppercase">Track B</div>
                                <h2 className="text-2xl font-black text-blue-900 uppercase tracking-tight">The Finance Officer’s Track</h2>
                            </div>
                            
                            <div className="space-y-4">
                                <div className="border-l-4 border-green-600 pl-6">
                                    <h4 className="text-sm font-black uppercase mb-1">Workflow: Session Collection</h4>
                                    <p className="text-xs text-gray-600">Immediately after a session offering is counted: Navigate to <strong>Financials &gt; Offerings</strong>. Select the session, enter the bulk total, and record.</p>
                                </div>
                                <div className="border-l-4 border-green-600 pl-6">
                                    <h4 className="text-sm font-black uppercase mb-1">Workflow: Handling Redemptions</h4>
                                    <p className="text-xs text-gray-600 italic mb-2">"I want to pay towards my pledge from last year."</p>
                                    <p className="text-xs text-gray-600">Go to <strong>Financials &gt; Redemption</strong>. Search for the donor. Enter the payment amount. The system will auto-calculate the remaining debt.</p>
                                </div>
                            </div>
                        </section>

                        {/* Troubleshooting Sheet */}
                        <section className="mb-12 break-inside-avoid">
                            <h2 className="text-xl font-black text-red-600 uppercase mb-4 border-b pb-2">Quick Troubleshooting Cheat-Sheet</h2>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div className="p-4 bg-red-50 rounded-xl border border-red-100">
                                    <p className="text-[10px] font-black text-red-800 uppercase">Q: The app is frozen!</p>
                                    <p className="text-[10px] font-medium text-red-700 mt-1">A: Click "Reset Connection" at the bottom of the login page. It clears the cache instantly.</p>
                                </div>
                                <div className="p-4 bg-red-50 rounded-xl border border-red-100">
                                    <p className="text-[10px] font-black text-red-800 uppercase">Q: I can't see any delegates!</p>
                                    <p className="text-[10px] font-medium text-red-700 mt-1">A: Check the "Event Context" in the top header. You must select an active event first.</p>
                                </div>
                                <div className="p-4 bg-red-50 rounded-xl border border-red-100">
                                    <p className="text-[10px] font-black text-red-800 uppercase">Q: Code is rejected!</p>
                                    <p className="text-[10px] font-medium text-red-700 mt-1">A: Ensure you have selected a "Session" (e.g. Banquet) for fast check-in. Master arrival uses manual lookup.</p>
                                </div>
                                <div className="p-4 bg-red-50 rounded-xl border border-red-100">
                                    <p className="text-[10px] font-black text-red-800 uppercase">Q: Mistake in Registration!</p>
                                    <p className="text-[10px] font-medium text-red-700 mt-1">A: Only Admins can edit Master List records. Call the System Admin to fix typos in the Master List module.</p>
                                </div>
                                <div className="p-4 bg-red-50 rounded-xl border border-red-100">
                                    <p className="text-[10px] font-black text-red-800 uppercase">Q: Chapter dropdown is empty!</p>
                                    <p className="text-[10px] font-medium text-red-700 mt-1">A: Go to System Setup &gt; Chapters Registry and click "Import Chapters". This loads all 1,447 official FGBMFI Nigeria chapters.</p>
                                </div>
                                <div className="p-4 bg-red-50 rounded-xl border border-red-100">
                                    <p className="text-[10px] font-black text-red-800 uppercase">Q: Session time shows wrong hour!</p>
                                    <p className="text-[10px] font-medium text-red-700 mt-1">A: Refresh the page. Session times are now stored as UTC and should display correctly in Nigeria time (UTC+1).</p>
                                </div>
                                <div className="p-4 bg-red-50 rounded-xl border border-red-100">
                                    <p className="text-[10px] font-black text-red-800 uppercase">Q: QR scanner won't open!</p>
                                    <p className="text-[10px] font-medium text-red-700 mt-1">A: Ensure camera permission is granted in your browser settings. Tap "SCAN QR" — the camera should activate. If on desktop, ensure a webcam is connected.</p>
                                </div>
                                <div className="p-4 bg-red-50 rounded-xl border border-red-100">
                                    <p className="text-[10px] font-black text-red-800 uppercase">Q: "Already Recorded" for alter call!</p>
                                    <p className="text-[10px] font-medium text-red-700 mt-1">A: A delegate can only be recorded once per call type (FT/SLV/MI/HGB) per session. They can still respond to other call types. Use the search results — "Recorded" status is shown for each type.</p>
                                </div>
                                <div className="p-4 bg-red-50 rounded-xl border border-red-100">
                                    <p className="text-[10px] font-black text-red-800 uppercase">Q: E-badge sharing doesn't work!</p>
                                    <p className="text-[10px] font-medium text-red-700 mt-1">A: On desktop browsers without native share support, the Share button falls back to downloading the image. Share the downloaded file manually via WhatsApp or email.</p>
                                </div>
                                <div className="p-4 bg-red-50 rounded-xl border border-red-100">
                                    <p className="text-[10px] font-black text-red-800 uppercase">Q: Voice Distribution count not saving!</p>
                                    <p className="text-[10px] font-medium text-red-700 mt-1">A: Ensure you've selected a session first. Enter the total number and click "Save". For locked events, all writes are blocked — check if the event is finalized.</p>
                                </div>
                            </div>
                        </section>
                    </>
                )}

                {/* Shared Footer */}
                <div className="print-only mt-20 pt-10 border-t border-gray-100 flex justify-between text-[9px] font-black uppercase text-gray-400 tracking-widest">
                    <span>© 2025 FGBMFI Nigeria EMS</span>
                    <span>Document: EMS-USER-V2.7</span>
                    <span>System Training & Operations Reference</span>
                </div>
            </div>
        </div>
    );
};

export default UserManualModule;
