import React from 'react';
import { isStripeKeyDetected } from '../services/supabaseClient';

export const ConfigurationError = () => (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white p-10 rounded-3xl shadow-2xl w-full max-w-2xl border border-red-200">
            <div className="text-5xl mb-6">🛠️</div>
            <h1 className="text-3xl font-black text-red-600 mb-4 uppercase tracking-tighter">Database Connection Required</h1>
            
            <div className="space-y-4 text-gray-600 font-medium">
                <p>The system cannot establish a secure link to the database. Verify your credentials in <code className="bg-gray-100 px-2 py-1 rounded text-red-500">services/supabaseClient.ts</code>.</p>
                
                {isStripeKeyDetected && (
                    <div className="bg-orange-50 border-l-4 border-orange-500 p-4 mt-4">
                        <p className="text-orange-900 font-black uppercase text-xs mb-1">Key Format Warning</p>
                        <p className="text-orange-800 text-sm">
                            The API key provided appears to follow a non-standard prefix for Supabase. 
                            Ensure you are using the <strong>Supabase Anon Public Key</strong>, which typically starts with <code>eyJ...</code>. 
                            If you used a Stripe or other service key by mistake, authentication will fail.
                        </p>
                    </div>
                )}

                <div className="bg-blue-50 p-4 rounded-xl text-sm border border-blue-100">
                    <p className="font-bold text-blue-900 mb-2">Supabase Credential Guide:</p>
                    <ol className="list-decimal ml-5 space-y-1">
                        <li>Log in to your Supabase Project Dashboard.</li>
                        <li>Navigate to <strong>Project Settings</strong> &gt; <strong>API</strong>.</li>
                        <li>Verify the <strong>Project URL</strong> and <strong>Anon Public</strong> key.</li>
                        <li>Update <code>supabaseClient.ts</code> with these values.</li>
                    </ol>
                </div>
            </div>
            
            <button 
                onClick={() => window.location.reload()}
                className="mt-8 w-full py-4 bg-red-600 text-white font-black rounded-xl shadow-lg hover:bg-red-700 transition-all uppercase tracking-widest text-xs"
            >
                Retry System Link
            </button>
        </div>
    </div>
);