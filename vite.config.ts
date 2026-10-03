import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
    server: {
        port: 3000,
        host: 'localhost',
    },
    plugins: [react()],
    resolve: {
        alias: {
            '@': path.resolve(__dirname, '.'),
        }
    },
    build: {
        // pdf-lib (~513 kB minified) is a single third-party vendor chunk that
        // cannot be split further. 650 clears it while still surfacing real
        // regressions. The primary win is route-level code splitting (App.tsx),
        // which moves the heavy libs off the initial load entirely.
        chunkSizeWarningLimit: 650,
        rollupOptions: {
            output: {
                manualChunks(id) {
                    if (!id.includes('node_modules')) return;
                    const nid = id.replace(/\\/g, '/');
                    // html5-qrcode is already fetched on demand (dynamic import in
                    // QRScanner) — keep it in its own async chunk.
                    if (nid.includes('html5-qrcode')) return;
                    if (nid.includes('react-router') || /\/react\//.test(nid) || nid.includes('/react-dom/') || nid.includes('/scheduler/')) return 'react-vendor';
                    if (nid.includes('@supabase')) return 'supabase';
                    if (nid.includes('@tanstack')) return 'tanstack-query';
                    if (nid.includes('recharts') || nid.includes('/d3-')) return 'recharts';
                    if (nid.includes('pdf-lib')) return 'pdf-lib';
                    if (nid.includes('/qrcode/')) return 'qrcode';
                    return;
                },
            },
        },
    },
});
