// Build identity + stale-client detection.
//
// Vite stamps `__APP_BUILD__` at build time and emits /version.json. A client
// that was left open before a deploy keeps running the old bundle (and therefore
// the old export templates) until it is reloaded, which is invisible to the user.
// The app compares its own stamp with /version.json and offers a reload.

declare const __APP_BUILD__: string;

export const APP_BUILD: string = typeof __APP_BUILD__ === 'string' ? __APP_BUILD__ : 'dev';

// `20261114123045` -> `2026-11-14 12:30 UTC` (readable in export headers).
const buildMatch = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})/.exec(APP_BUILD);
export const APP_BUILD_LABEL = buildMatch
    ? `${buildMatch[1]}-${buildMatch[2]}-${buildMatch[3]} ${buildMatch[4]}:${buildMatch[5]} UTC`
    : APP_BUILD;

const CHECK_MIN_INTERVAL_MS = 20_000;
let lastCheckAt = 0;
let inFlight = false;

/** True when the server is serving a newer build than the one this tab is running. */
export const checkForNewBuild = async (): Promise<boolean> => {
    const now = Date.now();
    if (inFlight || now - lastCheckAt < CHECK_MIN_INTERVAL_MS) return false;
    inFlight = true;
    lastCheckAt = now;
    try {
        const res = await fetch(`/version.json?ts=${now}`, { cache: 'no-store' });
        if (!res.ok) return false;
        const data = (await res.json()) as { build?: string };
        return !!data?.build && data.build !== APP_BUILD;
    } catch {
        return false;
    } finally {
        inFlight = false;
    }
};

/** Reloads the tab in place (same hash/route) so the fresh shell is fetched. */
export const reloadForNewBuild = (): void => {
    try {
        sessionStorage.setItem('fgbmfi_build_reload_at', String(Date.now()));
    } catch { /* ignore */ }
    window.location.reload();
};
