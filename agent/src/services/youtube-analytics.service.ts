/**
 * YouTube Analytics Scraper Service
 * Scrapes channel stats from YouTube Studio via GoLogin + Puppeteer.
 * Data: subscribers, views, revenue, monetization, video count.
 */
import { Browser, Page } from 'puppeteer-core';
import { startProfile, stopProfileNoCommit } from './gologin.service';

export interface ChannelStatsData {
  channelId: number;
  subscriberCount?: number;
  totalViews?: number;
  viewsLast28Days?: number;
  viewsLast48Hours?: number;
  videoCount?: number;
  estimatedRevenue?: number;
  revenueMonth?: number;
  monetizationEnabled?: boolean;
  topVideoViews?: number;
  topVideoTitle?: string;
}

function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function log(msg: string) {
  const time = new Date().toLocaleTimeString('vi-VN');
  console.log(`[${time}] [Analytics] ${msg}`);
}

/**
 * Parse number from text like "12,500", "1.2K", "1.2M", "N/A", etc.
 */
function parseNum(text: string | null | undefined): number | undefined {
  if (!text) return undefined;
  const cleaned = text.replace(/[^0-9.,KMBkmbÑñ]/g, '').trim();
  if (!cleaned) return undefined;

  const upper = cleaned.toUpperCase();
  const numPart = parseFloat(upper.replace(/[KMB,]/g, ''));
  if (isNaN(numPart)) return undefined;

  if (upper.includes('B')) return Math.round(numPart * 1_000_000_000);
  if (upper.includes('M')) return Math.round(numPart * 1_000_000);
  if (upper.includes('K')) return Math.round(numPart * 1_000);
  return Math.round(numPart);
}

/**
 * Parse money from text like "$45.20", "US$1,234.56", "45.20 USD"
 */
function parseMoney(text: string | null | undefined): number | undefined {
  if (!text) return undefined;
  const match = text.match(/[\d,.]+/);
  if (!match) return undefined;
  const num = parseFloat(match[0].replace(/,/g, ''));
  return isNaN(num) ? undefined : num;
}

/**
 * Try to get text content from page using multiple selectors
 */
async function getText(page: Page, selectors: string[], timeout = 5000): Promise<string | null> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    for (const sel of selectors) {
      try {
        const el = await page.$(sel);
        if (el) {
          const text = await el.evaluate((node: Element) => node.textContent?.trim() || '');
          if (text) return text;
        }
      } catch {}
    }
    await delay(500);
  }
  return null;
}

/**
 * Scrape YouTube Studio analytics for a single channel.
 * Opens GoLogin profile → YouTube Studio → scrapes stats → closes.
 */
export async function scrapeChannelStats(
  channelId: number,
  gologinProfileId: string,
  gologinToken: string,
  studioUrl?: string | null
): Promise<ChannelStatsData> {
  const stats: ChannelStatsData = { channelId };
  let browser: Browser | undefined;

  try {
    log(`Scraping channel #${channelId} (profile: ${gologinProfileId})`);
    const result = await startProfile(gologinProfileId, gologinToken, false);
    browser = result.browser;
    const page = await browser.newPage();

    // Close other tabs
    const existingPages = await browser.pages();
    for (const p of existingPages) {
      if (p !== page) try { await p.close(); } catch {}
    }

    // ── Navigate to YouTube Studio Dashboard ──
    const target = studioUrl || 'https://studio.youtube.com';
    log(`Navigating to: ${target}`);
    await page.goto(target, { waitUntil: 'networkidle2', timeout: 60000 });
    await delay(5000);

    // Check if logged in
    const bodyText = await page.evaluate(() => document.body?.innerText || '');
    if (bodyText.includes('Sign in') || bodyText.includes('Đăng nhập')) {
      log(`Channel #${channelId}: NOT logged in — skipping`);
      await page.close();
      await stopProfileNoCommit(gologinProfileId);
      return stats;
    }

    // ── Scrape Dashboard: subscriber count ──
    try {
      const subText = await getText(page, [
        '.subscriber-count',
        '#subscriber-count',
        'div[class*="subscriber"] span',
        '.ytcd-channel-dashboard-header-renderer .subscriber-count',
      ], 8000);
      stats.subscriberCount = parseNum(subText);
      if (stats.subscriberCount != null) log(`  Subscribers: ${stats.subscriberCount}`);
    } catch {}

    // ── Navigate to Analytics page ──
    try {
      const analyticsUrl = target.replace(/\/?$/, '/analytics');
      await page.goto(analyticsUrl, { waitUntil: 'networkidle2', timeout: 30000 });
      await delay(5000);

      // Scrape overview card values from Analytics page
      // YouTube Studio Analytics shows metric cards at the top
      const pageText = await page.evaluate(() => document.body?.innerText || '');

      // Extract views (look for views metrics)
      const viewsMatch = pageText.match(/(?:Views|Lượt xem)[\s\S]{0,100}?([\d,.]+[KMBkmb]?)/i);
      if (viewsMatch) {
        stats.viewsLast28Days = parseNum(viewsMatch[1]);
        if (stats.viewsLast28Days != null) log(`  Views 28d: ${stats.viewsLast28Days}`);
      }

      // Try to get 48h views from a secondary metric or "Last 48 hours" section
      const views48hMatch = pageText.match(/(?:48\s*(?:hours|giờ|h))[\s\S]{0,80}?([\d,.]+[KMBkmb]?)/i);
      if (views48hMatch) {
        stats.viewsLast48Hours = parseNum(views48hMatch[1]);
        if (stats.viewsLast48Hours != null) log(`  Views 48h: ${stats.viewsLast48Hours}`);
      }

      // Extract estimated revenue
      const revMatch = pageText.match(/(?:Estimated revenue|Revenue|Doanh thu|Doanh thu ước tính)[\s\S]{0,80}?([\$€£][\d,.]+|[\d,.]+\s*(?:USD|VND|\$))/i);
      if (revMatch) {
        stats.estimatedRevenue = parseMoney(revMatch[1]);
        if (stats.estimatedRevenue != null) log(`  Revenue: $${stats.estimatedRevenue}`);
      }

      // Check monetization by looking for "Earn" or "Kiếm tiền" tab
      const hasMonetization = pageText.includes('Earn') ||
        pageText.includes('Kiếm tiền') ||
        pageText.includes('Monetization');
      stats.monetizationEnabled = hasMonetization;
      log(`  Monetization: ${hasMonetization ? 'ON' : 'OFF/unknown'}`);

    } catch (e: any) {
      log(`  Analytics scrape error: ${e.message}`);
    }

    // ── Navigate to Analytics > Revenue for monthly revenue ──
    try {
      const revenueUrl = target.replace(/\/?$/, '/analytics/tab-revenue');
      await page.goto(revenueUrl, { waitUntil: 'networkidle2', timeout: 30000 });
      await delay(4000);

      const revText = await page.evaluate(() => document.body?.innerText || '');

      // Look for monthly revenue pattern
      const monthRevMatch = revText.match(/(?:Your estimated revenue|RPM|Doanh thu)[\s\S]{0,200}?([\$€£][\d,.]+)/i);
      if (monthRevMatch) {
        stats.revenueMonth = parseMoney(monthRevMatch[1]);
        if (stats.revenueMonth != null) log(`  Revenue (month): $${stats.revenueMonth}`);
      }
    } catch (e: any) {
      log(`  Revenue tab scrape error: ${e.message}`);
    }

    // ── Navigate to Content page for video count + latest video ──
    try {
      const contentUrl = target.replace(/\/?$/, '/videos');
      await page.goto(contentUrl, { waitUntil: 'networkidle2', timeout: 30000 });
      await delay(4000);

      const contentText = await page.evaluate(() => document.body?.innerText || '');

      // Video count from filter chip or header (e.g. "Videos (156)")
      const vcMatch = contentText.match(/(?:Videos|Video)\s*\((\d+)\)/i);
      if (vcMatch) {
        stats.videoCount = parseInt(vcMatch[1], 10);
        log(`  Video count: ${stats.videoCount}`);
      }

      // Latest video title + views (first row in content table)
      try {
        const firstRow = await page.$('ytcp-video-row:first-child, #video-list .video-row:first-child');
        if (firstRow) {
          const rowText = await firstRow.evaluate((el: Element) => el.textContent?.trim() || '');
          // Title is usually the first text block
          const titleEl = await firstRow.$('a#video-title, .video-title-text, h3');
          if (titleEl) {
            stats.topVideoTitle = await titleEl.evaluate((el: Element) => el.textContent?.trim() || '');
          }
          // Views in the row
          const rowViewsMatch = rowText.match(/([\d,.]+[KMBkmb]?)\s*(?:views|lượt xem)/i);
          if (rowViewsMatch) {
            stats.topVideoViews = parseNum(rowViewsMatch[1]);
          }
        }
      } catch {}

    } catch (e: any) {
      log(`  Content page scrape error: ${e.message}`);
    }

    // ── Done — close ──
    await page.close();
    await stopProfileNoCommit(gologinProfileId);

    log(`Channel #${channelId} scrape complete`);
    return stats;

  } catch (e: any) {
    log(`Channel #${channelId} scrape FAILED: ${e.message}`);
    if (browser) {
      try { await stopProfileNoCommit(gologinProfileId); } catch {}
    }
    return stats;
  }
}
