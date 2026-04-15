/**
 * TubeFlow — Telegram Notification Service
 * Sends periodic reports and alerts via Telegram Bot API.
 * Global per user (botToken + chatId stored in UserSettings).
 */
import prisma from "@/lib/prisma";

// ─── Base send ───────────────────────────────────────────────

async function sendMessage(
  botToken: string,
  chatId: string,
  text: string
): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10_000);

    const res = await fetch(
      `https://api.telegram.org/bot${botToken}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML" }),
        signal: controller.signal,
      }
    );

    clearTimeout(timeoutId);

    if (!res.ok) {
      const err = await res.text();
      console.error(`[Telegram] API error ${res.status}: ${err}`);
      return false;
    }
    return true;
  } catch (e: unknown) {
    const err = e as { name?: string; message?: string };
    if (err.name === "AbortError") {
      console.error("[Telegram] Request timed out (10 s)");
    } else {
      console.error(`[Telegram] ${err.message || "Unknown error"}`);
    }
    return false;
  }
}

// ─── Helpers ─────────────────────────────────────────────────

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function now() {
  return new Date().toLocaleString("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
    hour: "2-digit",
    minute: "2-digit",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function pct(cur: number | null, prev: number | null): string {
  if (cur == null || prev == null || prev === 0) return "";
  const p = Math.round(((cur - prev) / prev) * 100);
  if (p === 0) return "";
  return p > 0 ? ` (+${p}%)` : ` (${p}%)`;
}

function fmt(n: number | bigint | null | undefined): string {
  if (n == null) return "N/A";
  return Number(n).toLocaleString("en-US");
}

function fmtMoney(n: number | null | undefined): string {
  if (n == null) return "N/A";
  return `$${n.toFixed(2)}`;
}

// ─── Public API ──────────────────────────────────────────────

/**
 * Send a simple test message to verify bot + chatId work.
 */
export async function sendTestMessage(
  botToken: string,
  chatId: string
): Promise<boolean> {
  const text = [
    `<b>TubeFlow — Test ket noi</b>`,
    ``,
    `Telegram da ket noi thanh cong!`,
    `Bot san sang gui bao cao va canh bao.`,
    `${now()}`,
  ].join("\n");
  return sendMessage(botToken, chatId, text);
}

/**
 * Send a periodic 30-min report for a given user.
 * Aggregates channel stats from DB + upload counts.
 */
export async function sendPeriodicReport(userId: string): Promise<boolean> {
  // Load user settings
  const settings = await prisma.userSettings.findUnique({
    where: { userId },
  });
  if (
    !settings?.telegramEnabled ||
    !settings.telegramBotToken ||
    !settings.telegramChatId
  ) {
    return false;
  }

  // Load channels
  const channels = await prisma.channel.findMany({
    where: { userId },
    orderBy: { name: "asc" },
  });

  if (channels.length === 0) return false;

  // Time boundaries
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);

  const lines: string[] = [];
  const timeStr = new Date().toLocaleTimeString("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
    hour: "2-digit",
    minute: "2-digit",
  });
  const dateStr = new Date().toLocaleDateString("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
  });

  lines.push(`TubeFlow — Bao cao ${timeStr}`);
  lines.push("\u2501".repeat(22));
  lines.push("");

  let totalUploaded = 0;
  let totalPending = 0;
  let totalRevMonth = 0;

  for (const ch of channels) {
    // Latest stats for this channel
    const latest = await prisma.channelStats.findFirst({
      where: { channelId: ch.id },
      orderBy: { collectedAt: "desc" },
    });

    // Previous stats (for trend %)
    const previous = latest
      ? await prisma.channelStats.findFirst({
          where: {
            channelId: ch.id,
            collectedAt: { lt: latest.collectedAt },
          },
          orderBy: { collectedAt: "desc" },
        })
      : null;

    // Upload counts today
    const doneToday = await prisma.upload.count({
      where: {
        channelId: ch.id,
        status: "DONE",
        uploadedAt: { gte: todayStart },
      },
    });
    const pendingCount = await prisma.upload.count({
      where: { channelId: ch.id, status: "PENDING" },
    });

    totalUploaded += doneToday;
    totalPending += pendingCount;

    // Revenue this month — use latest revenueMonth from stats
    const revMonth = latest?.revenueMonth ?? null;
    if (revMonth != null) totalRevMonth += revMonth;

    const viewsTrend = pct(
      latest?.viewsLast48Hours ?? null,
      previous?.viewsLast48Hours ?? null
    );
    const revTrend = pct(
      latest?.estimatedRevenue ?? null,
      previous?.estimatedRevenue ?? null
    );

    const monetLabel =
      latest?.monetizationEnabled == null
        ? "N/A"
        : latest.monetizationEnabled
          ? "BAT"
          : "TAT";

    lines.push(`<b>${ch.name}</b>`);
    lines.push(
      `   Views 48h:  <b>${fmt(latest?.viewsLast48Hours)}</b>${viewsTrend}`
    );
    lines.push(
      `   Revenue:    <b>${fmtMoney(latest?.estimatedRevenue)}</b>${revTrend}`
    );

    // Monthly revenue line
    const dayNow = new Date().getDate();
    const monthNow = String(new Date().getMonth() + 1).padStart(2, "0");
    const dayNowStr = String(dayNow).padStart(2, "0");
    lines.push(
      `   Rev thang:  <b>${fmtMoney(revMonth)}</b> (01~${dayNowStr}/${monthNow})`
    );

    lines.push(`   Kiem tien:  ${monetLabel}`);
    lines.push(
      `   Upload:     <b>${doneToday}/${pendingCount}</b> (done/pending)`
    );
    lines.push(
      `   Subs: ${fmt(latest?.subscriberCount)}  |  Video: ${fmt(latest?.videoCount)}`
    );
    lines.push("");
  }

  lines.push("\u2501".repeat(22));
  lines.push(`${totalUploaded} uploaded | ${totalPending} pending`);
  lines.push(`Rev thang: <b>${fmtMoney(totalRevMonth)}</b>`);

  // Agent status
  const agentStatus = settings.agentStatus || "offline";
  const scrapeTime = settings.statsLastCollect
    ? new Date(settings.statsLastCollect).toLocaleTimeString("vi-VN", {
        timeZone: "Asia/Ho_Chi_Minh",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "N/A";
  lines.push(`Agent: ${agentStatus === "offline" ? "Offline" : "Online"} | Scrape: ${scrapeTime}`);
  lines.push(dateStr);

  return sendMessage(settings.telegramBotToken, settings.telegramChatId, lines.join("\n"));
}

/**
 * Send an alert for abnormal events.
 */
export async function sendAlert(
  userId: string,
  alertText: string
): Promise<boolean> {
  const settings = await prisma.userSettings.findUnique({
    where: { userId },
  });
  if (
    !settings?.telegramEnabled ||
    !settings.telegramBotToken ||
    !settings.telegramChatId
  ) {
    return false;
  }

  const text = [
    `<b>TubeFlow — Canh bao</b>`,
    `\u2501`.repeat(22),
    ``,
    alertText,
    ``,
    now(),
  ].join("\n");

  return sendMessage(settings.telegramBotToken, settings.telegramChatId, text);
}

/**
 * Send a success notification when one video upload completes.
 * "Tong da dang trong ngay" is counted per-channel.
 */
export async function sendUploadSuccess(
  userId: string,
  payload: {
    channelName: string;
    youtubeUrl: string;
    totalUploadedToday: number;
    uploadedAt: Date;
  }
): Promise<boolean> {
  const settings = await prisma.userSettings.findUnique({
    where: { userId },
  });
  if (
    !settings?.telegramEnabled ||
    !settings.telegramBotToken ||
    !settings.telegramChatId
  ) {
    return false;
  }

  const postedAt = payload.uploadedAt.toLocaleString("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
    hour: "2-digit",
    minute: "2-digit",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });

  const text = [
    "✅ Upload thành công!",
    "",
    `📺 Kênh: <b>${escapeHtml(payload.channelName)}</b>`,
    `🎬 Link video: ${escapeHtml(payload.youtubeUrl)}`,
    `📊 Tổng đã đăng trong ngày: <b>${payload.totalUploadedToday}</b>`,
    `⏰ Thời gian đăng thành công: ${postedAt}`,
  ].join("\n");

  return sendMessage(settings.telegramBotToken, settings.telegramChatId, text);
}

/**
 * Check if it's time to send a periodic report, and send if due.
 * Called from heartbeat handler. Returns true if a report was sent.
 */
export async function maybeFireReport(userId: string): Promise<boolean> {
  const settings = await prisma.userSettings.findUnique({
    where: { userId },
  });
  if (
    !settings?.telegramEnabled ||
    !settings.telegramBotToken ||
    !settings.telegramChatId
  ) {
    return false;
  }

  const intervalMs = (settings.telegramReportCron || 30) * 60 * 1000;
  const lastReport = settings.telegramLastReport
    ? new Date(settings.telegramLastReport).getTime()
    : 0;

  if (Date.now() - lastReport < intervalMs) {
    return false; // not yet time
  }

  // Fire report
  const sent = await sendPeriodicReport(userId);
  if (sent) {
    await prisma.userSettings.update({
      where: { userId },
      data: { telegramLastReport: new Date() },
    });
  }
  return sent;
}
