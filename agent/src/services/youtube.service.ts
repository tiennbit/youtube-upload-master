/**
 * YouTube Upload Service — Puppeteer-based upload via YouTube Studio
 * Based on proven youtube-uploader reference (verified 2026-01-07)
 * Adapted for TubeFlow Desktop Agent with GoLogin integration
 */
import { Browser, Page } from 'puppeteer-core';
import fs from 'fs';
import path from 'path';
import { startProfile, stopProfile, stopProfileNoCommit } from './gologin.service';

// YouTube Studio selectors (verified 2026-01-07 from reference)
const SELECTORS = {
  CREATE_BUTTON: [
    'button[aria-label="Create"]',
    'button[aria-label="만들기"]',
    'button[aria-label="Tạo"]',
    '#create-icon',
    'ytcp-button#create-icon',
    '#upload-icon',
    'button[aria-label="Upload videos"]',
    'button[aria-label="동영상 업로드"]',
  ],
  UPLOAD_OPTION: [
    'tp-yt-paper-item#text-item-0',
    '#text-item-0',
    'tp-yt-paper-item:first-child',
  ],
  FILE_INPUT: 'input[type="file"]',
  TITLE_TEXTAREA: '#title-textarea #textbox, #textbox[aria-label*="title"]',
  DESCRIPTION_TEXTAREA: '#description-textarea #textbox, #description-container #textbox',
  THUMBNAIL_INPUT: '#file-loader, input[accept="image/*"]',
  NOT_FOR_KIDS_RADIO: 'tp-yt-paper-radio-button[name="VIDEO_MADE_FOR_KIDS_NOT_MFK"]',
  NEXT_BUTTON: '#next-button, ytcp-button#next-button',
  PUBLIC_RADIO: 'tp-yt-paper-radio-button[name="PUBLIC"]',
  UNLISTED_RADIO: 'tp-yt-paper-radio-button[name="UNLISTED"]',
  PRIVATE_RADIO: 'tp-yt-paper-radio-button[name="PRIVATE"]',
  DONE_BUTTON: '#done-button, ytcp-button#done-button',
  CLOSE_BUTTON: '#close-button, ytcp-button#close-button',
};

export interface UploadOptions {
  videoPath: string;
  title: string;
  description?: string;
  thumbnailPath?: string;
  visibility?: 'public' | 'unlisted' | 'private';
  studioUrl?: string;
}

export interface UploadResult {
  success: boolean;
  message: string;
  videoUrl?: string;
  videoId?: string;
  detectedStudioUrl?: string;  // Auto-detected studio URL for this channel
}

function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Try multiple selectors and return the first one that exists
 */
async function findElement(page: Page, selectors: string | string[], timeout = 15000): Promise<any> {
  const list = Array.isArray(selectors) ? selectors : selectors.split(', ');
  const start = Date.now();
  while (Date.now() - start < timeout) {
    for (const sel of list) {
      try {
        const el = await page.$(sel);
        if (el) {
          console.log(`[Selector] Found: ${sel}`);
          return el;
        }
      } catch {}
    }
    await delay(500);
  }
  throw new Error(`No selector found: ${list.join(', ')}`);
}

async function waitAndClick(page: Page, selectors: string | string[], timeout = 15000) {
  const el = await findElement(page, selectors, timeout);
  
  // Scroll element into view first
  try {
    await el.scrollIntoView();
  } catch {}
  await delay(300);
  
  // Try native click first, fallback to JS click if element not visible
  try {
    await el.click();
  } catch (clickErr: any) {
    if (clickErr.message?.includes('not visible') || clickErr.message?.includes('not an HTMLElement')) {
      console.log(`[Click] Native click failed, trying JS click fallback...`);
      try {
        await el.evaluate((node: any) => node.click());
      } catch (jsErr: any) {
        console.log(`[Click] JS click also failed: ${jsErr.message}`);
        throw clickErr; // throw original error
      }
    } else {
      throw clickErr;
    }
  }
}

/**
 * Upload video to YouTube via GoLogin profile + YouTube Studio
 * Based on proven reference: https://github.com/tiennbit/youtube-uploader
 */
export async function uploadVideo(
  gologinProfileId: string,
  gologinToken: string,
  options: UploadOptions
): Promise<UploadResult> {
  const {
    videoPath,
    title,
    description = '',
    thumbnailPath,
    visibility = 'public',
    studioUrl,
  } = options;

  if (!fs.existsSync(videoPath)) {
    return { success: false, message: `Video file not found: ${videoPath}` };
  }

  let uploadSucceeded = false;
  let page!: Page;
  let currentStep = 'init';
  const uploadStartTime = Date.now();

  try {
    // Start GoLogin profile (non-headless for file uploads)
    currentStep = 'init-gologin';
    const { browser } = await startProfile(gologinProfileId, gologinToken);
    currentStep = 'init-newpage';
    page = await browser.newPage();

    // Close old tabs (keep new one)
    const existingPages = await browser.pages();
    for (const p of existingPages) {
      if (p !== page) try { await p.close(); } catch {}
    }

    // ========== PRE-NAVIGATION: Warm up channel session ==========
    // YouTube Studio always loads the "default" channel first.
    // To force it to load the CORRECT channel, we must first visit
    // youtube.com/channel/<ID> to set the active channel cookie.
    // This was validated by extensive debug testing.
    const expectedMatch = studioUrl?.match(/channel\/(UC[a-zA-Z0-9_-]+)/);
    const expectedChannelId = expectedMatch?.[1];

    if (expectedChannelId) {
      currentStep = 'init-warmup';
      console.log(`[Upload] Pre-warming channel session: ${expectedChannelId}`);
      try {
        // Step 1: Visit the channel's YouTube page (sets active channel cookie)
        await page.goto(`https://www.youtube.com/channel/${expectedChannelId}`, {
          waitUntil: 'networkidle2', timeout: 30000,
        });
        await delay(3000);
        console.log(`[Upload] Channel warm-up done. URL: ${page.url()}`);
      } catch (e: any) {
        console.warn(`[Upload] Channel warm-up failed (non-fatal): ${e.message}`);
      }
    }

    // Navigate to YouTube Studio (with channel ID in URL)
    currentStep = 'init-navigate';
    const target = studioUrl || 'https://studio.youtube.com';
    console.log(`[Upload] Navigating to: ${target}`);
    await page.goto(target, { waitUntil: 'networkidle2', timeout: 60000 });
    await delay(5000);

    // Diagnostic: log URL after navigation
    let currentUrl = page.url();
    let pageTitle = '';
    try { pageTitle = await page.title(); } catch {}
    console.log(`[Upload] After navigation — URL: ${currentUrl}, Title: ${pageTitle}`);

    // Detect "Oops" error page and retry with reload
    if (pageTitle === 'Oops' || pageTitle.toLowerCase().includes('oops')) {
      console.warn(`[Upload] ⚠️ YouTube Studio "Oops" page detected — retrying...`);
      for (let oopsRetry = 1; oopsRetry <= 3; oopsRetry++) {
        console.log(`[Upload] Oops retry ${oopsRetry}/3: reloading page...`);
        await delay(5000 * oopsRetry); // Progressive backoff: 5s, 10s, 15s
        try {
          await page.goto(target, { waitUntil: 'networkidle2', timeout: 60000 });
          await delay(5000);
          currentUrl = page.url();
          try { pageTitle = await page.title(); } catch {}
          console.log(`[Upload] Oops retry ${oopsRetry} — URL: ${currentUrl}, Title: ${pageTitle}`);
          if (pageTitle !== 'Oops' && !pageTitle.toLowerCase().includes('oops')) {
            console.log(`[Upload] ✅ Oops resolved after retry ${oopsRetry}`);
            break;
          }
        } catch (e: any) {
          console.warn(`[Upload] Oops retry ${oopsRetry} error: ${e.message}`);
        }
      }
      // Final check — if still Oops, abort
      if (pageTitle === 'Oops' || pageTitle.toLowerCase().includes('oops')) {
        return { success: false, message: `YouTube Studio "Oops" error page — không thể truy cập Studio sau 3 lần thử` };
      }

      // After Oops resolved: ensure we're on Studio (not youtube.com)
      currentUrl = page.url();
      if (!currentUrl.includes('studio.youtube.com')) {
        console.log(`[Upload] Post-Oops: redirected to ${currentUrl} — navigating back to Studio`);
        await page.goto(target, { waitUntil: 'networkidle2', timeout: 60000 });
        await delay(5000);
        currentUrl = page.url();
        try { pageTitle = await page.title(); } catch {}
        console.log(`[Upload] Post-Oops re-navigation — URL: ${currentUrl}, Title: ${pageTitle}`);
      }
    }

    // Detect actual channel from URL
    let detectedStudioUrl: string | undefined;
    const channelMatch = currentUrl.match(/studio\.youtube\.com\/channel\/(UC[a-zA-Z0-9_-]+)/);
    if (channelMatch) {
      detectedStudioUrl = `https://studio.youtube.com/channel/${channelMatch[1]}`;
      console.log(`[Upload] Detected channel: ${channelMatch[1]}`);

      // Verify correct channel
      if (expectedChannelId && expectedChannelId !== channelMatch[1]) {
        console.warn(`[Upload] ⚠️ WRONG CHANNEL after warm-up! Expected: ${expectedChannelId}, Got: ${channelMatch[1]}`);
        
        let switchSucceeded = false;

        // Fallback switch attempts
        for (let attempt = 1; attempt <= 3 && !switchSucceeded; attempt++) {
          try {
            console.log(`[Upload] Fallback switch attempt ${attempt}/3...`);
            
            if (attempt === 1) {
              // Visit youtube.com/account to activate multi-channel session
              await page.goto('https://www.youtube.com/account', { waitUntil: 'networkidle2', timeout: 30000 });
              await delay(3000);
            } else if (attempt === 2) {
              // Visit channel_switcher
              await page.goto('https://www.youtube.com/channel_switcher', { waitUntil: 'networkidle2', timeout: 30000 });
              await delay(3000);
            }
            // Navigate to target Studio URL
            await page.goto(`https://studio.youtube.com/channel/${expectedChannelId}`, {
              waitUntil: 'networkidle2', timeout: 60000,
            });
            await delay(5000);

            const checkUrl = page.url();
            const checkMatch = checkUrl.match(/channel\/(UC[a-zA-Z0-9_-]+)/);
            console.log(`[Upload] Attempt ${attempt} result: ${checkUrl}`);
            
            if (checkMatch && checkMatch[1] === expectedChannelId) {
              switchSucceeded = true;
              detectedStudioUrl = `https://studio.youtube.com/channel/${expectedChannelId}`;
              console.log(`[Upload] ✅ Channel switch SUCCESS (attempt ${attempt})`);
            } else {
              console.warn(`[Upload] ❌ Attempt ${attempt}: still on ${checkMatch?.[1] || 'unknown'}`);
            }
          } catch (e: any) {
            console.warn(`[Upload] Switch attempt ${attempt} error: ${e.message}`);
          }
        }

        if (!switchSucceeded) {
          console.error(`[Upload] ALL SWITCH ATTEMPTS FAILED.`);
          return {
            success: false,
            message: `Sai channel! Expected: ${expectedChannelId}, Got: ${channelMatch[1]}. Switch thất bại.`,
          };
        }
      } else if (expectedChannelId) {
        console.log(`[Upload] ✅ Correct channel confirmed: ${expectedChannelId}`);
      }
    }

    // Check for login/session issues
    // IMPORTANT: Only use URL-based checks. Text-based checks like 'Switch account',
    // "don't have permission", 'Sign in' cause false positives because these strings
    // appear in normal YouTube Studio pages (avatar menu, footer, help text).
    const isNotLoggedIn = currentUrl.includes('accounts.google.com') || currentUrl.includes('signin');

    if (isNotLoggedIn) {
      console.log(`[Upload] ⚠️ NOT LOGGED IN! URL: ${currentUrl}`);
      return { success: false, message: `Session expired — cần re-login GoLogin profile. URL: ${currentUrl}` };
    }

    // Handle browser upgrade page
    try {
      const skipLink = await page.$('a[href*="skip"]');
      if (skipLink) { await skipLink.click(); await delay(3000); }
    } catch {}

    // Step 1: Click Create button (with retry)
    currentStep = 'S1-CreateBtn';
    console.log('[Upload] Step 1: Click Create button');
    let createButtonFound = false;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        await waitAndClick(page, SELECTORS.CREATE_BUTTON, attempt === 1 ? 30000 : 20000);
        createButtonFound = true;
        break;
      } catch {
        console.log(`[Upload] Create button not found (attempt ${attempt}/2)`);
        if (attempt === 1) {
          console.log('[Upload] Retrying — reloading Studio page...');
          try {
            await page.reload({ waitUntil: 'networkidle2', timeout: 60000 });
            await delay(8000);
          } catch {}
        }
      }
    }
    if (!createButtonFound) {
      throw new Error('Create button not found after 2 attempts. Session may be expired.');
    }
    await delay(2000);

    // Step 2: Click Upload option
    console.log('[Upload] Step 2: Click Upload option');
    await waitAndClick(page, SELECTORS.UPLOAD_OPTION, 10000);
    await delay(2000);

    // Step 3: Upload video file via CDP (bypasses Puppeteer evaluate which crashes Orbita)
    currentStep = 'S3-FileUpload';
    console.log(`[Upload] Step 3: Upload file via CDP`);
    const absolutePath = path.resolve(videoPath);
    console.log(`[Upload] File path: ${absolutePath}`);

    const client = await (page as any).target().createCDPSession();
    try {
      const doc = await client.send('DOM.getDocument');
      const { nodeId } = await client.send('DOM.querySelector', {
        nodeId: doc.root.nodeId,
        selector: 'input[type="file"]',
      });
      if (!nodeId) throw new Error('File input node not found via CDP');

      await client.send('DOM.setFileInputFiles', {
        nodeId,
        files: [absolutePath],
      });
      console.log('[Upload] ✅ File set via CDP DOM.setFileInputFiles');
    } finally {
      await client.detach().catch(() => {});
    }
    await delay(5000);

    // Step 4: Wait for title textarea (confirms upload dialog appeared)
    console.log('[Upload] Step 4: Wait for title textarea...');
    let titleFound = false;
    for (let retry = 0; retry < 3; retry++) {
      try {
        await delay(15000); // Wait 15s for dialog to process
        await findElement(page, SELECTORS.TITLE_TEXTAREA, 30000);
        titleFound = true;
        console.log('[Upload] ✅ Title textarea found — video processing!');
        break;
      } catch {
        console.log(`[Upload] Title textarea not found (attempt ${retry + 1}/3)...`);
        if (retry < 2) {
          // Debug: dump page state
          try {
            const debugUrl = page.url();
            const debugTitle = await page.title();
            console.log(`[Upload] Debug — URL: ${debugUrl}, Title: ${debugTitle}`);
          } catch {}
          await delay(5000);
        }
      }
    }
    if (!titleFound) {
      throw new Error('Upload dialog did not progress — title textarea not found after 3 retries');
    }

    // Step 5: Set Title
    console.log('[Upload] Step 5: Set title');
    try {
      await page.click(SELECTORS.TITLE_TEXTAREA, { clickCount: 3 });
      await delay(300);
      await page.keyboard.press('Backspace');
      await delay(300);
      await page.type(SELECTORS.TITLE_TEXTAREA, title.slice(0, 100));
      console.log(`[Upload] ✅ Title set: "${title.slice(0, 50)}..."`);
    } catch (e: any) {
      console.warn(`[Upload] ⚠️ Cannot set title: ${e.message}`);
    }
    await delay(1000);

    // Step 6: Set Description
    if (description) {
      console.log('[Upload] Step 6: Set description');
      try {
        await page.click(SELECTORS.DESCRIPTION_TEXTAREA);
        await page.type(SELECTORS.DESCRIPTION_TEXTAREA, description.slice(0, 5000));
        console.log('[Upload] ✅ Description set');
      } catch (e: any) {
        console.warn(`[Upload] ⚠️ Cannot set description: ${e.message}`);
      }
      await delay(1000);
    }

    // Step 7: Upload Thumbnail via CDP
    if (thumbnailPath && fs.existsSync(thumbnailPath)) {
      console.log('[Upload] Step 7: Upload thumbnail via CDP');
      try {
        const thumbClient = await (page as any).target().createCDPSession();
        try {
          const doc = await thumbClient.send('DOM.getDocument');
          const { nodeId } = await thumbClient.send('DOM.querySelector', {
            nodeId: doc.root.nodeId,
            selector: '#file-loader, input[accept="image/*"]',
          });
          if (nodeId) {
            await thumbClient.send('DOM.setFileInputFiles', {
              nodeId,
              files: [path.resolve(thumbnailPath)],
            });
            console.log('[Upload] ✅ Thumbnail set via CDP');
            await delay(8000);
          } else {
            console.log('[Upload] Thumbnail input nodeId not found');
          }
        } finally {
          await thumbClient.detach().catch(() => {});
        }
      } catch (e: any) {
        console.warn(`[Upload] ⚠️ Thumbnail upload failed: ${e.message}`);
      }
    }

    // Step 8: Not for kids
    currentStep = 'S8-NotForKids';
    console.log('[Upload] Step 8: Mark not for kids');
    try { await waitAndClick(page, SELECTORS.NOT_FOR_KIDS_RADIO, 10000); } catch {}
    await delay(1000);

    // Step 9: Navigate through tabs (Details → Monetization? → Ad Suitability? → Video Elements → Checks → Visibility)

    // Helper: safely evaluate without crashing on session loss
    const safeEvaluate = async <T>(fn: (...args: any[]) => T, defaultValue: T, ...args: any[]): Promise<T> => {
      try {
        return await page.evaluate(fn, ...args);
      } catch {
        return defaultValue;
      }
    };

    // Helper: check if on Visibility tab
    const isOnVisibilityTab = async (): Promise<boolean> => {
      return safeEvaluate(() => {
        const privacyRadios = document.querySelector('#privacy-radios');
        const radios = document.querySelectorAll('tp-yt-paper-radio-button[name="PUBLIC"], tp-yt-paper-radio-button[name="PRIVATE"]');
        return !!(privacyRadios || radios.length >= 2);
      }, false);
    };



    // Click Next: Details → next tab
    console.log('[Upload] Step 9.1: Next (Details → next tab)');
    await waitAndClick(page, SELECTORS.NEXT_BUTTON, 10000);
    await delay(3000);

    // Try to handle Monetization (may or may not exist)
    console.log('[Upload] Step 9.2: Handle Monetization');
    try {
      await page.waitForSelector('#child-input ytcp-video-monetization', { visible: true, timeout: 5000 });
      await delay(1500);
      await page.click('#child-input ytcp-video-monetization');
      console.log('[Upload] Monetization: clicked panel');
      await delay(2000);

      try {
        const onRadioSelector = 'ytcp-video-monetization-edit-dialog.cancel-button-hidden .ytcp-video-monetization-edit-dialog #radioContainer #onRadio';
        await page.waitForSelector(onRadioSelector, { visible: true, timeout: 5000 });
        await page.evaluate((sel: string) => {
          const radio = document.querySelector(sel) as HTMLElement;
          if (radio) radio.click();
        }, onRadioSelector);
      } catch {
        await page.evaluate(() => {
          const radio = document.querySelector('#onRadio, #radioContainer #onRadio') as HTMLElement;
          if (radio) radio.click();
        });
      }
      console.log('[Upload] Monetization: clicked ON');
      await delay(1500);

      try {
        const saveBtn = 'ytcp-video-monetization-edit-dialog.cancel-button-hidden .ytcp-video-monetization-edit-dialog #save-button';
        await page.waitForSelector(saveBtn, { visible: true, timeout: 5000 });
        await page.click(saveBtn);
      } catch {
        await page.evaluate(() => {
          const btn = document.querySelector('#save-button, ytcp-button#save-button') as HTMLElement;
          if (btn) btn.click();
        });
      }
      await delay(1500);
      console.log('[Upload] Monetization: completed');

      console.log('[Upload] Step 9.3: Next after Monetization');
      await waitAndClick(page, SELECTORS.NEXT_BUTTON, 10000);
      await delay(3000);
    } catch {
      console.log('[Upload] Monetization skipped (not on this channel)');
    }

    // Try to handle Ad Suitability (may or may not exist)
    console.log('[Upload] Step 9.4: Handle Ad Suitability');
    try {
      const checkboxSel = '.ytpp-self-certification-questionnaire .ytpp-self-certification-questionnaire #checkbox-container';
      await page.waitForSelector(checkboxSel, { visible: true, timeout: 5000 });
      await page.evaluate(() => {
        const checkbox = document.querySelector('.ytpp-self-certification-questionnaire .ytpp-self-certification-questionnaire #checkbox-container') as HTMLElement;
        if (checkbox) checkbox.click();
      });
      console.log('[Upload] Ad Suitability: clicked checkbox');
      await delay(1500);

      await page.evaluate(() => {
        const btn = document.querySelector('.ytpp-self-certification-questionnaire .ytpp-self-certification-questionnaire #submit-questionnaire-button') as HTMLElement;
        if (btn) btn.click();
      });
      console.log('[Upload] Ad Suitability: clicked submit');
      await delay(1500);

      console.log('[Upload] Step 9.5: Next after Ad Suitability');
      await waitAndClick(page, SELECTORS.NEXT_BUTTON, 10000);
      await delay(2000);
    } catch {
      console.log('[Upload] Ad Suitability skipped (not on this channel)');
    }

    // Try to handle "Submit Rating" dialog (appears on some channels after Ad Suitability)
    // This dialog asks user to confirm content rating before proceeding
    console.log('[Upload] Step 9.6: Handle Submit Rating dialog (if present)');
    try {
      // Detect rating dialog by looking for submit/rating-related buttons or text
      const ratingDialogFound = await safeEvaluate(() => {
        const body = document.body?.innerText || '';
        const hasRating = body.includes('Submit for rating') || body.includes('Submit rating')
          || body.includes('Gửi để đánh giá') || body.includes('Content rating')
          || body.includes('Xếp hạng nội dung');
        return hasRating;
      }, false);

      if (ratingDialogFound) {
        console.log('[Upload] Submit Rating dialog detected — attempting to submit...');

        // Try clicking the submit/confirm button inside the rating dialog
        const submitted = await page.evaluate(() => {
          // Common selectors for the rating submit button
          const candidates = Array.from(document.querySelectorAll('ytcp-button, button, tp-yt-paper-button'));
          for (const btn of candidates) {
            const text = (btn.textContent || '').trim().toLowerCase();
            if (
              text === 'submit' || text === 'gửi' ||
              text === 'continue' || text === 'tiếp tục' ||
              text === 'confirm' || text === 'xác nhận' ||
              text.includes('submit for rating') || text.includes('gửi để đánh giá')
            ) {
              const el = btn as HTMLElement;
              const disabled = el.hasAttribute('disabled') || el.getAttribute('aria-disabled') === 'true';
              if (!disabled) {
                el.scrollIntoView({ block: 'center' });
                el.click();
                return `clicked: "${text}"`;
              }
            }
          }
          return null;
        });

        if (submitted) {
          console.log(`[Upload] ✅ Submit Rating: ${submitted}`);
          await delay(2000);
        } else {
          console.log('[Upload] Submit Rating: no clickable submit button found — skipping');
        }
      } else {
        console.log('[Upload] Submit Rating dialog not present — skipping');
      }
    } catch (e: any) {
      console.log(`[Upload] Submit Rating handler error (non-fatal): ${e.message}`);
    }

    // Navigate through remaining tabs until Visibility
    // Just click Next repeatedly — no need to wait for "Checks" since the tab label
    // "Checks"/"Kiểm tra" appears on ALL pages and causes false detection
    currentStep = 'S9-NavVisibility';
    console.log('[Upload] Step 9.6: Navigate to Visibility tab');
    let reachedVisibility = await isOnVisibilityTab();
    let navAttempts = 0;
    const MAX_NAV = 6;

    while (!reachedVisibility && navAttempts < MAX_NAV) {
      navAttempts++;
      console.log(`[Upload] Clicking Next (${navAttempts}/${MAX_NAV})...`);

      // Try clicking Next — YouTube may disable it during Checks processing
      // If disabled, retry every 10s for up to 60s before giving up
      let nextClicked = false;
      for (let retry = 0; retry < 6; retry++) {
        try {
          // Check if Next button is disabled
          const btnState = await safeEvaluate(() => {
            const btn = document.querySelector('#next-button, ytcp-button#next-button') as HTMLElement;
            if (!btn) return 'not_found';
            const disabled = btn.hasAttribute('disabled') || btn.getAttribute('aria-disabled') === 'true';
            return disabled ? 'disabled' : 'enabled';
          }, 'not_found');

          if (btnState === 'disabled') {
            if (retry === 0) console.log('[Upload] Next button disabled (YouTube đang kiểm tra video)...');
            if (retry > 0 && retry % 3 === 0) console.log(`[Upload] Vẫn đang chờ YouTube kiểm tra... (${retry * 10}s)`);
            await delay(10000);
            continue;
          }

          await waitAndClick(page, SELECTORS.NEXT_BUTTON, 5000);
          nextClicked = true;
          break;
        } catch {
          try {
            await page.evaluate(() => {
              const btn = document.querySelector('#next-button, ytcp-button#next-button') as HTMLElement;
              if (btn) btn.click();
            });
            nextClicked = true;
            break;
          } catch {
            if (retry < 5) await delay(10000);
          }
        }
      }

      if (!nextClicked) {
        console.log('[Upload] Next: button not clickable after retries');
        break;
      }
      await delay(3000);

      reachedVisibility = await isOnVisibilityTab();
      if (reachedVisibility) {
        console.log(`[Upload] ✅ Reached Visibility tab (after ${navAttempts} Next clicks)`);
      }
    }

    if (!reachedVisibility) {
      console.log('[Upload] ⚠️ Could not confirm Visibility tab, continuing...');
    }

    // Step 10: Set Visibility
    currentStep = 'S10-Visibility';
    console.log(`[Upload] Step 10: Set visibility: ${visibility}`);
    await delay(5000);

    const visibilityName = visibility === 'public' ? 'PUBLIC'
      : visibility === 'unlisted' ? 'UNLISTED' : 'PRIVATE';

    let visibilitySet = false;

    // Strategy 1: CDP click
    try {
      const visClient = await (page as any).target().createCDPSession();
      try {
        const doc = await visClient.send('DOM.getDocument');
        const selectors = [
          `tp-yt-paper-radio-button[name="${visibilityName}"]`,
          `#privacy-radios tp-yt-paper-radio-button[name="${visibilityName}"]`,
        ];
        for (const sel of selectors) {
          try {
            const { nodeId } = await visClient.send('DOM.querySelector', {
              nodeId: doc.root.nodeId,
              selector: sel,
            });
            if (nodeId) {
              const { object } = await visClient.send('DOM.resolveNode', { nodeId });
              await visClient.send('Runtime.callFunctionOn', {
                objectId: object.objectId,
                functionDeclaration: 'function() { this.scrollIntoView({block:"center"}); this.click(); }',
                returnByValue: true,
              });
              console.log(`[Upload] Visibility: clicked via CDP (${sel})`);
              visibilitySet = true;
              break;
            }
          } catch {}
        }
      } finally {
        await visClient.detach().catch(() => {});
      }
    } catch {}

    // Strategy 2: Puppeteer page.$
    if (!visibilitySet) {
      try {
        const el = await page.$(`tp-yt-paper-radio-button[name="${visibilityName}"]`);
        if (el) {
          await el.click();
          console.log(`[Upload] Visibility: clicked via Puppeteer`);
          visibilitySet = true;
        }
      } catch {}
    }

    // Strategy 3: Text-based click
    if (!visibilitySet) {
      console.log('[Upload] Visibility: trying text-based click...');
      const textMap: Record<string, string[]> = {
        'PUBLIC': ['Public', 'Công khai'],
        'UNLISTED': ['Unlisted', 'Không công khai'],
        'PRIVATE': ['Private', 'Riêng tư'],
      };
      const searchTexts = textMap[visibilityName] || ['Public'];
      try {
        await page.evaluate((texts: string[]) => {
          const radios = Array.from(document.querySelectorAll('tp-yt-paper-radio-button, paper-radio-button'));
          for (const radio of radios) {
            const text = (radio.textContent || '').toLowerCase();
            for (const search of texts) {
              if (text.includes(search.toLowerCase())) {
                (radio as HTMLElement).scrollIntoView({ block: 'center' });
                (radio as HTMLElement).click();
                return;
              }
            }
          }
        }, searchTexts);
        console.log('[Upload] Visibility: text-based click attempted');
      } catch {}
    }

    await delay(2000);

    // Step 11: UNIFIED wait loop — wait for Done button to become clickable, then click it
    // This replaces the old Phase 1 + Phase 2 + Step 12 which had a critical bug:
    // Phase 2 was SKIPPED when Phase 1 timed out, giving only 13 min total wait
    // instead of the 20+ min needed for large videos.
    //
    // New logic: single loop, check every 15s, max 20 min (80 iterations × 15s)
    // When Done button is enabled → click immediately
    currentStep = 'S11-WaitDone';
    console.log('[Upload] Step 11: Waiting for upload + checks + Done button (max 20 min)...');
    let sessionAlive = true;
    let saveClicked = false;

    // Helper: get detailed upload/check status from YouTube Studio UI
    const getUploadStatus = async () => {
      return safeEvaluate(() => {
        const body = document.body?.innerText || '';
        const uploading = body.includes('Uploading') || body.includes('Đang tải lên');

        const progressRows = Array.from(document.querySelectorAll(
          '.progress-label, .label, .ytcp-video-upload-progress, [class*="progress"]'
        ));
        let checksInProgress = false;
        let checksComplete = false;
        for (const row of progressRows) {
          const text = (row.textContent || '').trim();
          if (text.includes('Checking') || text.includes('Đang kiểm tra')) {
            checksInProgress = true;
          }
          if (text.includes('No issues') || text.includes('Không tìm thấy')
            || text.includes('Complete') || text.includes('Hoàn tất')
            || text.includes('None found') || text.includes('issues found')) {
            checksComplete = true;
          }
        }

        const checkStepStatus = document.querySelector('#checks-step, [step="STEP_REVIEW"]');
        if (checkStepStatus) {
          const stepText = (checkStepStatus.textContent || '').trim();
          if (stepText.includes('In progress') || stepText.includes('Đang thực hiện')
            || stepText.includes('Checking') || stepText.includes('Đang kiểm tra')) {
            checksInProgress = true;
          }
          if (stepText.includes('No issues') || stepText.includes('Complete')
            || stepText.includes('Không tìm thấy') || stepText.includes('Hoàn tất')) {
            checksComplete = true;
          }
        }

        if (checksComplete) checksInProgress = false;

        const doneBtn = document.querySelector('#done-button') as HTMLElement;
        const btnDisabled = doneBtn?.hasAttribute('disabled') || doneBtn?.getAttribute('aria-disabled') === 'true';
        const btnExists = !!doneBtn;

        return { uploading, checksInProgress, checksComplete, btnDisabled, btnExists };
      }, { uploading: false, checksInProgress: false, checksComplete: false, btnDisabled: true, btnExists: false });
    };

    // Helper: try to click Done button, returns true if succeeded
    const tryClickDone = async (): Promise<boolean> => {
      try {
        const result = await page.evaluate(() => {
          const selectors = ['#done-button', 'ytcp-button#done-button'];
          for (const sel of selectors) {
            const btn = document.querySelector(sel) as HTMLElement;
            if (btn && btn.offsetParent !== null) {
              const disabled = btn.hasAttribute('disabled') || btn.getAttribute('aria-disabled') === 'true';
              if (!disabled) {
                btn.click();
                return `clicked: ${sel}`;
              }
            }
          }
          // Fallback: find by text
          const buttons = Array.from(document.querySelectorAll('ytcp-button, button'));
          for (const btn of buttons) {
            const text = (btn.textContent || '').trim();
            if (text === 'Save' || text === 'Lưu' || text === 'Publish' || text === 'Xuất bản') {
              (btn as HTMLElement).click();
              return `clicked by text: ${text}`;
            }
          }
          return 'not_ready';
        });

        if (result.startsWith('clicked')) {
          console.log(`[Upload] ✅ Done/Save: ${result}`);
          return true;
        }
        return false;
      } catch {
        return false;
      }
    };

    // Unified loop: max 20 min = 80 × 15s
    // IMPORTANT: require minimum 30s wait + 2 consecutive "ready" checks
    // to avoid clicking Done during YouTube's brief transient enabled state
    const MAX_WAIT_ITERATIONS = 80;
    const MIN_WAIT_SECONDS = 30; // Don't click Done before this time
    let lastLogState = '';
    let consecutiveReady = 0; // Track consecutive "button enabled" checks
    const loopStartTime = Date.now();

    for (let i = 0; i < MAX_WAIT_ITERATIONS; i++) {
      // First iteration: wait 10s, subsequent: wait 15s
      await delay(i === 0 ? 10000 : 15000);

      try {
        const status = await getUploadStatus();

        // Build state string for smart logging
        const state = status.uploading ? 'uploading' :
          status.btnDisabled ? (status.checksInProgress ? 'checks' : 'processing') :
          'ready';

        // Log state changes + periodic updates every 60s
        if (state !== lastLogState || i % 4 === 0) {
          const elapsed = Math.round((Date.now() - loopStartTime) / 1000);
          console.log(`[Upload] [${elapsed}s] uploading=${status.uploading} checks=${status.checksInProgress} btnDisabled=${status.btnDisabled} ready=${consecutiveReady}/2`);
          lastLogState = state;
        }

        // Track consecutive "ready" states (button enabled + not uploading)
        if (!status.btnDisabled && !status.uploading) {
          consecutiveReady++;
        } else {
          consecutiveReady = 0; // Reset if button becomes disabled again
        }

        // Click Done ONLY if:
        // 1. Minimum 30s elapsed (avoid transient early-enabled state)
        // 2. Button enabled at least once (Step 12 handles "still checking" modal)
        const elapsedMs = Date.now() - loopStartTime;
        if (consecutiveReady >= 1 && elapsedMs >= MIN_WAIT_SECONDS * 1000) {
          const clicked = await tryClickDone();
          if (clicked) {
            saveClicked = true;
            console.log(`[Upload] ✅ Published! (after ~${Math.round(elapsedMs / 60000)} min)`);
            break;
          }
        }
      } catch (e: any) {
        console.log(`[Upload] Poll ${i + 1} error: ${e.message?.substring(0, 80)}`);
        if (e.message?.includes('WebSocket') || e.message?.includes('Target closed') || e.message?.includes('Session closed')) {
          console.log('[Upload] ❌ Session lost!');
          sessionAlive = false;
          break;
        }
      }
    }

    if (!sessionAlive) {
      throw new Error('Session closed trước khi Save — video bị lưu bản nháp');
    }

    if (!saveClicked) {
      // Last resort: try clicking anyway even if status says disabled
      console.log('[Upload] ⚠️ 20 phút chưa click được Done — thử force click lần cuối...');
      saveClicked = await tryClickDone();

      if (!saveClicked) {
        throw new Error('Done/Save button click thất bại sau 20 phút — video bị lưu bản nháp');
      }
    }

    await delay(5000);

    // Step 12: Handle confirmation popup (Public → YouTube shows confirm dialog)
    // THIS IS CRITICAL — without clicking the confirm button, video stays as Draft!
    currentStep = 'S12-ConfirmPublish';
    console.log('[Upload] Step 12: Handle confirmation popup...');
    try {
      // Take screenshot BEFORE trying to click confirm (for debugging)
      try {
        const screenshotPath = require('path').join(
          process.env.USERPROFILE || '', '.tubeflow', 'debug',
          `confirm_popup_${Date.now()}.png`
        );
        require('fs').mkdirSync(require('path').dirname(screenshotPath), { recursive: true });
        await page.screenshot({ path: screenshotPath, fullPage: true });
        console.log(`[Upload] 📸 Confirm popup screenshot: ${screenshotPath}`);
      } catch {}

      await delay(3000);

      // Log ALL visible buttons for diagnosis
      const buttonInfo = await page.evaluate(() => {
        const buttons = Array.from(document.querySelectorAll('ytcp-button, button, ytcp-icon-button'));
        return buttons
          .filter(b => (b as HTMLElement).offsetParent !== null)
          .map(b => ({
            tag: b.tagName,
            id: b.id || '',
            text: (b.textContent || '').trim().substring(0, 50),
            ariaLabel: b.getAttribute('aria-label') || '',
          }));
      });
      console.log(`[Upload] Visible buttons: ${JSON.stringify(buttonInfo)}`);

      // Try to click the confirm/publish button in the popup
      if (visibility !== 'public') {
        const confirmResult = await page.evaluate(() => {
          const buttons = Array.from(document.querySelectorAll('ytcp-button, button'));
          const confirmTexts = ['save', 'lưu', '게시', '저장', 'done'];

          for (const btn of buttons) {
            const text = (btn.textContent || '').trim().toLowerCase();
            const ariaLabel = (btn.getAttribute('aria-label') || '').toLowerCase();
            const isVisible = (btn as HTMLElement).offsetParent !== null;

            if (!isVisible) continue;

            for (const key of confirmTexts) {
              if (text.includes(key) || ariaLabel.includes(key)) {
                (btn as HTMLElement).click();
                return `clicked confirm: "${text}" (matched: ${key})`;
              }
            }
          }
          return 'no confirm button found';
        });
        console.log(`[Upload] Confirm result: ${confirmResult}`);

        // If no text match, try clicking #done-button again (some versions reuse it)
        if (confirmResult.includes('not found')) {
          console.log('[Upload] Trying #done-button again as confirm...');
          const retryResult = await page.evaluate(() => {
            const doneBtn = document.querySelector('#done-button') as HTMLElement;
            if (doneBtn && doneBtn.offsetParent !== null) {
              doneBtn.click();
              return 'clicked #done-button again';
            }
            return 'no done button';
          });
          console.log(`[Upload] Retry confirm: ${retryResult}`);
        }
      }

      // Public mode must explicitly hit "Publish" on the "still checking" modal.
      if (visibility === 'public') {
        let publishClicked = false;
        for (let attempt = 1; attempt <= 6; attempt++) {
          // Step A: Find the Publish button coordinates in the modal
          const btnInfo = await page.evaluate(() => {
            const body = (document.body?.innerText || '').toLowerCase();
            const hasCheckingModal =
              body.includes("we're still checking your video") ||
              body.includes('still checking your video') ||
              body.includes('wait for our checks to finish');

            const buttons = Array.from(document.querySelectorAll('ytcp-button, button'))
              .filter((b) => (b as HTMLElement).offsetParent !== null);

            for (const btn of buttons) {
              const text = (btn.textContent || '').trim().toLowerCase();
              const aria = (btn.getAttribute('aria-label') || '').toLowerCase();
              const merged = `${text} ${aria}`;
              if (merged.includes('change visibility')) continue;
              if (
                merged.includes('publish') ||
                merged.includes('xuất bản') ||
                merged.includes('게시') ||
                merged.includes('게시하기')
              ) {
                const rect = (btn as HTMLElement).getBoundingClientRect();
                return {
                  hasCheckingModal,
                  found: true,
                  label: text || aria,
                  x: rect.x + rect.width / 2,
                  y: rect.y + rect.height / 2,
                };
              }
            }
            return { hasCheckingModal, found: false, label: '', x: 0, y: 0 };
          });

          if (btnInfo.found) {
            // Step B: Use Puppeteer mouse click (real mouse events, not DOM click)
            console.log(`[Upload] 🖱️ Modal Publish button found at (${Math.round(btnInfo.x)}, ${Math.round(btnInfo.y)}) — clicking via mouse...`);
            await page.mouse.click(btnInfo.x, btnInfo.y);
            await delay(3000);

            // Step C: Verify modal actually closed
            const modalGone = await safeEvaluate(() => {
              const body = (document.body?.innerText || '').toLowerCase();
              return !body.includes("we're still checking your video") &&
                     !body.includes('still checking your video');
            }, false);

            if (modalGone) {
              publishClicked = true;
              console.log(`[Upload] ✅ Publish confirmation clicked & modal closed (${btnInfo.label})`);
              break;
            } else {
              console.log(`[Upload] ⚠️ Modal still open after click — retrying (${attempt}/6)...`);
              await delay(2000);
            }
          } else if (!btnInfo.hasCheckingModal) {
            // No modal at all — publish went through without modal
            publishClicked = true;
            console.log('[Upload] ✅ No checking modal — publish successful');
            break;
          } else {
            console.log(`[Upload] Waiting for publish button on checking modal... (${attempt}/6)`);
            await delay(2000);
          }
        }

        if (!publishClicked) {
          // Check if the upload dialog has already closed (= publish succeeded)
          const dialogState = await safeEvaluate(() => {
            const dialog = document.querySelector('ytcp-uploads-dialog');
            const dialogOpen = dialog && (dialog as HTMLElement).offsetParent !== null;
            const body = (document.body?.innerText || '').toLowerCase();
            const hasSuccessIndicators =
              body.includes('go to video analytic') ||
              body.includes('see comments') ||
              body.includes('video published') ||
              body.includes('video link');
            const hasCheckingText =
              body.includes("we're still checking your video") ||
              body.includes('still checking your video');
            return { dialogOpen, hasSuccessIndicators, hasCheckingText };
          }, { dialogOpen: true, hasSuccessIndicators: false, hasCheckingText: false });

          if (!dialogState.dialogOpen || dialogState.hasSuccessIndicators) {
            // Dialog closed or success elements visible — publish actually succeeded!
            publishClicked = true;
            console.log('[Upload] ✅ Upload dialog closed — publish succeeded (was looking for modal unnecessarily)');
          } else if (dialogState.hasCheckingText) {
            throw new Error('Chưa bấm được nút Publish trên popup "still checking your video"');
          }
        }
      }

      await delay(3000);

      // Take screenshot AFTER confirm attempt
      try {
        const screenshotPath2 = require('path').join(
          process.env.USERPROFILE || '', '.tubeflow', 'debug',
          `after_confirm_${Date.now()}.png`
        );
        await page.screenshot({ path: screenshotPath2, fullPage: true });
        console.log(`[Upload] 📸 After confirm screenshot: ${screenshotPath2}`);
      } catch {}
    } catch (e: any) {
      console.log(`[Upload] Confirm popup error: ${e.message?.substring(0, 80)}`);
      throw e;
    }
    await delay(5000);

    // Note: "saved as private" check removed — YouTube UI takes time to update
    // the header text even after a successful Publish. Step 12 now verifies
    // the modal actually closed, which is a more reliable success indicator.

    // Verify: check if dialog closed (means save was successful)
    let dialogClosed = false;
    try {
      dialogClosed = await page.evaluate(() => {
        const dialog = document.querySelector('ytcp-uploads-dialog');
        return !dialog || (dialog as HTMLElement).offsetParent === null;
      });
    } catch {
      // Session may have closed after save — that's OK
      dialogClosed = true;
    }

    if (!dialogClosed) {
      // Try closing dialog manually
      try {
        await page.evaluate(() => {
          const closeBtn = document.querySelector('#close-button, ytcp-button#close-button, [aria-label="Close"]') as HTMLElement;
          if (closeBtn) closeBtn.click();
        });
      } catch {}
    }

    // Step 13: Extract YouTube video URL/ID to verify upload
    console.log('[Upload] Step 13: Extract YouTube video URL/ID');
    let videoUrl: string | undefined;
    let videoId: string | undefined;

    try {
      // Strategy A: Look for video link in success dialog or page
      const extractedUrl = await safeEvaluate(() => {
        // Check for youtu.be links in dialog
        const links = Array.from(document.querySelectorAll('a[href*="youtu.be"], a[href*="youtube.com/video"]'));
        for (const link of links) {
          const href = (link as HTMLAnchorElement).href;
          if (href) return href;
        }
        // Check for studio video URL pattern in any link
        const studioLinks = Array.from(document.querySelectorAll('a[href*="/video/"]'));
        for (const link of studioLinks) {
          const href = (link as HTMLAnchorElement).href;
          if (href && href.includes('studio.youtube.com')) return href;
        }
        return null;
      }, null as string | null);

      if (extractedUrl) {
        videoUrl = extractedUrl;
        // Extract ID from URL
        const idMatch = extractedUrl.match(/(?:youtu\.be\/|\/video\/)([a-zA-Z0-9_-]{11})/);
        if (idMatch) videoId = idMatch[1];
        console.log(`[Upload] ✅ Video URL found: ${videoUrl} (ID: ${videoId})`);
      }
    } catch {}

    // Strategy B: Check current page URL (Studio may redirect to /video/ID/edit)
    if (!videoId) {
      try {
        const currentPageUrl = page.url();
        const urlIdMatch = currentPageUrl.match(/\/video\/([a-zA-Z0-9_-]{11})/);
        if (urlIdMatch) {
          videoId = urlIdMatch[1];
          videoUrl = `https://youtu.be/${videoId}`;
          console.log(`[Upload] ✅ Video ID from URL: ${videoId}`);
        }
      } catch {}
    }

    // Strategy C: Scan page text for video ID pattern near "published" or share link
    if (!videoId) {
      try {
        const scannedId = await safeEvaluate(() => {
          const body = document.body?.innerText || '';
          // Look for youtu.be/ID pattern in text
          const shareMatch = body.match(/youtu\.be\/([a-zA-Z0-9_-]{11})/);
          if (shareMatch) return shareMatch[1];
          // Look for video ID in studio URL pattern
          const studioMatch = body.match(/studio\.youtube\.com\/video\/([a-zA-Z0-9_-]{11})/);
          if (studioMatch) return studioMatch[1];
          return null;
        }, null as string | null);

        if (scannedId) {
          videoId = scannedId;
          videoUrl = `https://youtu.be/${videoId}`;
          console.log(`[Upload] ✅ Video ID from page text: ${videoId}`);
        }
      } catch {}
    }

    if (!videoId) {
      console.warn('[Upload] ⚠️ Could not extract YouTube video ID — upload likely succeeded but unverified');
    }

    if (videoId) {
      videoUrl = `https://youtu.be/${videoId}`;
    }

    uploadSucceeded = true;
    console.log(`[Upload] ✅ Upload hoàn thành: "${title}"${videoId ? ` → https://youtu.be/${videoId}` : ''}`);

    return { success: true, message: `Upload thành công: ${title}`, videoUrl, videoId, detectedStudioUrl };
  } catch (err: any) {
    const elapsed = Math.round((Date.now() - uploadStartTime) / 1000);
    const elapsedStr = elapsed >= 60 ? `${Math.floor(elapsed / 60)}m${elapsed % 60}s` : `${elapsed}s`;

    // Capture page state for diagnostics
    let pageUrl = 'N/A';
    let pageState = '';
    try {
      pageUrl = page?.url?.() || 'N/A';
      pageState = await page?.evaluate?.(() => {
        const body = (document.body?.innerText || '').substring(0, 300);
        const btns = Array.from(document.querySelectorAll('ytcp-button, button'))
          .filter(b => (b as HTMLElement).offsetParent !== null)
          .map(b => (b.textContent || '').trim().substring(0, 20))
          .filter(t => t.length > 0)
          .slice(0, 8);
        return `buttons=[${btns.join(', ')}]`;
      }) || '';
    } catch {}

    const diagMsg = `[Step: ${currentStep}] [${elapsedStr}] ${err.message}`;
    const diagDetail = pageState ? `\n📋 ${pageState}` : '';
    console.error(`[Upload] ❌ ${diagMsg}${diagDetail}`);
    console.error(`[Upload] 📍 URL: ${pageUrl}`);
    return { success: false, message: `${diagMsg}${diagDetail}` };
  } finally {
    try { await page?.close(); } catch {}
    if (uploadSucceeded) {
      await stopProfile(gologinProfileId, gologinToken);
    } else {
      await stopProfileNoCommit(gologinProfileId);
    }
  }
}

/**
 * Open a GoLogin profile browser for manual inspection
 * Used for "Mở Profile" button on dashboard
 */
export async function openProfileForInspection(
  gologinProfileId: string,
  gologinToken: string,
  studioUrl?: string
): Promise<UploadResult> {
  try {
    const { browser } = await startProfile(gologinProfileId, gologinToken);
    const page = await browser.newPage();

    // Close old tabs
    const existingPages = await browser.pages();
    for (const p of existingPages) {
      if (p !== page) try { await p.close(); } catch {}
    }

    const target = studioUrl || 'https://studio.youtube.com';
    await page.goto(target, { waitUntil: 'networkidle2', timeout: 60000 });

    console.log('[Profile] ✅ Profile opened — auto-close in 5 min');

    // Auto-close after 5 minutes
    setTimeout(async () => {
      try {
        await stopProfile(gologinProfileId);
        console.log('[Profile] Auto-closed after 5 min');
      } catch {}
    }, 5 * 60 * 1000);

    return { success: true, message: 'Profile đã mở — YouTube Studio đang hiển thị' };
  } catch (err: any) {
    console.error(`[Profile] ❌ Lỗi: ${err.message}`);
    return { success: false, message: err.message };
  }
}
