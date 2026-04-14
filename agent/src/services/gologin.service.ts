/**
 * GoLogin Service — Launch/stop anti-detect browser profiles
 * Ported from youtube-uploader with improvements
 * Cookie backup safety: always backup cookies before launch, restore on corruption
 */
import { Browser } from 'puppeteer-core';
import path from 'path';
import os from 'os';
import fs from 'fs';

// @ts-ignore
const { GologinApi } = require('gologin');

const runningInstances: Map<string, any> = new Map();

const COOKIE_BACKUP_DIR = path.join(os.homedir(), '.tubeflow', 'cookie-backups');

/**
 * Backup cookies from GoLogin cloud before any profile operation.
 * This ensures we can restore the YouTube session if cookies get corrupted.
 */
export async function backupCookies(profileId: string, token: string): Promise<boolean> {
  try {
    const res = await fetch(`https://api.gologin.com/browser/${profileId}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      console.warn(`[GoLogin] Cookie backup failed (HTTP ${res.status})`);
      return false;
    }
    const profile = await res.json();

    // Extract cookie-related data
    const backup = {
      profileId,
      backedUpAt: new Date().toISOString(),
      cookies: profile.cookies || [],
      googleServicesAccountId: profile.googleServicesAccountId,
      googleServicesAccountName: profile.googleServicesAccountName,
    };

    if (!fs.existsSync(COOKIE_BACKUP_DIR)) {
      fs.mkdirSync(COOKIE_BACKUP_DIR, { recursive: true });
    }

    const backupPath = path.join(COOKIE_BACKUP_DIR, `${profileId}.json`);
    fs.writeFileSync(backupPath, JSON.stringify(backup, null, 2));
    console.log(`[GoLogin] ✅ Cookie backup saved: ${backupPath} (${backup.cookies.length} cookies)`);
    return true;
  } catch (e: any) {
    console.warn(`[GoLogin] ⚠️ Cookie backup error: ${e.message}`);
    return false;
  }
}

/**
 * Restore cookies to GoLogin profile from local backup.
 * Used when cookie corruption is detected (empty cookie DB after session).
 */
export async function restoreCookies(profileId: string, token: string): Promise<boolean> {
  const backupPath = path.join(COOKIE_BACKUP_DIR, `${profileId}.json`);
  if (!fs.existsSync(backupPath)) {
    console.warn(`[GoLogin] No cookie backup found for ${profileId}`);
    return false;
  }

  try {
    const backup = JSON.parse(fs.readFileSync(backupPath, 'utf-8'));
    if (!backup.cookies || backup.cookies.length === 0) {
      console.warn(`[GoLogin] Cookie backup is empty for ${profileId}`);
      return false;
    }

    const res = await fetch(`https://api.gologin.com/browser/${profileId}`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ cookies: backup.cookies }),
      signal: AbortSignal.timeout(15000),
    });

    if (res.ok) {
      console.log(`[GoLogin] ✅ Cookies restored from backup (${backup.cookies.length} cookies, backed up ${backup.backedUpAt})`);
      return true;
    } else {
      console.warn(`[GoLogin] Cookie restore failed (HTTP ${res.status})`);
      return false;
    }
  } catch (e: any) {
    console.warn(`[GoLogin] ⚠️ Cookie restore error: ${e.message}`);
    return false;
  }
}

/**
 * Check if a GoLogin profile is already running (cloud or local).
 * If running, stop it before re-launching.
 */
async function checkAndStopRunningProfile(profileId: string, token: string): Promise<void> {
  try {
    const res = await fetch(`https://api.gologin.com/browser/${profileId}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return;

    const profile = await res.json();
    const status = profile.status || profile.cloudActiveSession;

    if (status === 'active' || status === 'running' || profile.cloudActiveSession) {
      console.warn(`[GoLogin] ⚠️ Profile ${profileId} đang chạy (status: ${status}) — dừng trước khi launch`);
      try {
        await fetch(`https://api.gologin.com/browser/${profileId}/web`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(10000),
        });
        console.log(`[GoLogin] Đã gửi lệnh dừng cloud profile`);
        await new Promise((r) => setTimeout(r, 5000));
      } catch (e: any) {
        console.warn(`[GoLogin] Không thể dừng cloud profile: ${e.message}`);
      }
    }
  } catch (e: any) {
    // Non-blocking — if API fails, continue anyway
    console.warn(`[GoLogin] Profile status check failed: ${e.message}`);
  }
}

/**
 * Start a GoLogin profile and return a Puppeteer Browser
 */
export async function startProfile(
  profileId: string,
  gologinToken: string,
  headless: boolean = false
): Promise<{ browser: Browser }> {
  if (!gologinToken) throw new Error('GoLogin Token chưa được cấu hình');

  // Stop if already running
  if (runningInstances.has(profileId)) {
    console.log(`[GoLogin] Profile ${profileId} đang chạy, dừng trước...`);
    await stopProfile(profileId);
  }

  console.log(`[GoLogin] Khởi động profile: ${profileId}`);

  // Pre-launch: check if profile is already running elsewhere
  await checkAndStopRunningProfile(profileId, gologinToken);

  // Pre-launch: backup cookies from GoLogin cloud (safety net)
  await backupCookies(profileId, gologinToken);

  // Disable font masking
  try {
    const res = await fetch(`https://api.gologin.com/browser/${profileId}`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${gologinToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ fonts: { enableMasking: false, families: [] } }),
    });
    if (res.ok) console.log(`[GoLogin] Đã tắt font masking`);
  } catch (e: any) {
    console.warn(`[GoLogin] Không thể tắt font masking: ${e.message}`);
  }

  // Clean entire temp profile directory AND zip cache (fresh start every launch)
  // GoLogin npm caches profile as zip + extracted folder — delete BOTH
  // to force a fresh download from S3 cloud every time
  const tempDir = path.join(os.tmpdir(), `gologin_profile_${profileId}`);
  const tempZip = path.join(os.tmpdir(), `gologin_${profileId}.zip`);
  const tempUploadZip = path.join(os.tmpdir(), `gologin_${profileId}_upload.zip`);
  for (const target of [tempDir, tempZip, tempUploadZip]) {
    try {
      if (fs.existsSync(target)) {
        fs.rmSync(target, { recursive: true, force: true });
        console.log(`[GoLogin] 🧹 Đã xóa: ${path.basename(target)}`);
      }
    } catch (e: any) {
      console.warn(`[GoLogin] ⚠️ Không thể xóa ${path.basename(target)}: ${e.message}`);
    }
  }

  // NOTE: Do NOT force --proxy-server via extra_params!
  // GoLogin npm handles proxy via browser preferences internally.
  // Testing proved that adding --proxy-server causes YouTube Studio "Oops" errors.
  // The profiles work perfectly when launched without forced proxy args.

  const api = GologinApi({ token: gologinToken });

  // Retry launch up to 5 times
  let browser: Browser | null = null;
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      const result = await api.launch({
        profileId,
        cloud: false,
        headless,
        writeCookiesFromServer: true,
        uploadCookiesToServer: true,
      });
      browser = result.browser as Browser;
      break;
    } catch (err: any) {
      lastError = err;
      console.error(`[GoLogin] Lần thử ${attempt}/5 thất bại: ${err.message}`);
      if (attempt < 5) {
        console.log(`[GoLogin] Thử lại sau 5s...`);
        await new Promise((r) => setTimeout(r, 5000));
      }
    }
  }

  if (!browser) throw lastError || new Error('GoLogin launch failed');

  console.log(`[GoLogin] ✅ Profile đã khởi động: ${profileId}`);
  runningInstances.set(profileId, api);
  return { browser };
}

/**
 * Stop a GoLogin profile (with cookie commit protection)
 */
export async function stopProfile(profileId: string, gologinToken?: string): Promise<void> {
  const api = runningInstances.get(profileId);
  if (!api) return;

  console.log(`[GoLogin] Đang dừng profile: ${profileId}`);
  await new Promise((r) => setTimeout(r, 3000));

  // Check cookie size before committing
  const tempDir = path.join(os.tmpdir(), `gologin_profile_${profileId}`);
  const cookiePaths = [
    path.join(tempDir, 'Default', 'Network', 'Cookies'),
    path.join(tempDir, 'Default', 'Cookies'),
  ];
  let cookieSize = 0;
  for (const cp of cookiePaths) {
    if (fs.existsSync(cp)) {
      cookieSize = Math.max(cookieSize, fs.statSync(cp).size);
    }
  }

  if (cookieSize <= 16384) {
    console.warn(`[GoLogin] ⚠️ Cookie DB rỗng (${cookieSize} bytes) — KHÔNG commit để bảo vệ session`);

    // Auto-restore from backup if token available
    if (gologinToken) {
      console.log(`[GoLogin] Attempting auto-restore from cookie backup...`);
      await restoreCookies(profileId, gologinToken);
    }

    try { await api.exit(); } catch {}
    runningInstances.delete(profileId);
    return;
  }

  try {
    await api.exit();
    console.log(`[GoLogin] ✅ Profile đã dừng và commit: ${profileId} (cookie: ${cookieSize} bytes)`);

    // After successful commit, update backup with fresh cookies
    if (gologinToken) {
      await backupCookies(profileId, gologinToken);
    }
  } catch (err: any) {
    console.error(`[GoLogin] Lỗi khi dừng: ${err.message}`);
  }
  runningInstances.delete(profileId);
}

/**
 * Stop a profile WITHOUT committing (when upload fails)
 */
export async function stopProfileNoCommit(profileId: string): Promise<void> {
  const api = runningInstances.get(profileId);
  if (!api) return;
  try { await api.exit(); } catch {}
  runningInstances.delete(profileId);
  console.log(`[GoLogin] Profile dừng (không commit): ${profileId}`);
}

/**
 * Stop all running profiles (cleanup)
 */
export async function stopAll(): Promise<void> {
  for (const [id] of runningInstances) {
    await stopProfile(id);
  }
}

/**
 * Get list of currently active GoLogin profile IDs (for lock mechanism)
 */
export function getActiveProfileIds(): string[] {
  return Array.from(runningInstances.keys());
}
