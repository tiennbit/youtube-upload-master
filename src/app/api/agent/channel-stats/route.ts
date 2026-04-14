import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { sendAlert } from "@/lib/telegram";

// POST /api/agent/channel-stats — Agent reports scraped YouTube stats
export async function POST(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return NextResponse.json({ error: "Missing token" }, { status: 401 });
  }

  const token = authHeader.slice(7);
  const user = await prisma.user.findUnique({ where: { agentToken: token } });
  if (!user) {
    return NextResponse.json({ error: "Invalid token" }, { status: 401 });
  }

  const { stats } = await request.json();
  if (!Array.isArray(stats) || stats.length === 0) {
    return NextResponse.json({ error: "stats array is required" }, { status: 400 });
  }

  let saved = 0;

  for (const s of stats) {
    // Verify channel belongs to this user
    const channel = await prisma.channel.findFirst({
      where: { id: s.channelId, userId: user.id },
    });
    if (!channel) continue;

    // Get previous stats for anomaly detection
    const previous = await prisma.channelStats.findFirst({
      where: { channelId: s.channelId },
      orderBy: { collectedAt: "desc" },
    });

    // Insert new stats
    await prisma.channelStats.create({
      data: {
        channelId: s.channelId,
        subscriberCount: s.subscriberCount ?? null,
        totalViews: s.totalViews != null ? BigInt(s.totalViews) : null,
        viewsLast28Days: s.viewsLast28Days ?? null,
        viewsLast48Hours: s.viewsLast48Hours ?? null,
        videoCount: s.videoCount ?? null,
        estimatedRevenue: s.estimatedRevenue ?? null,
        revenueMonth: s.revenueMonth ?? null,
        monetizationEnabled: s.monetizationEnabled ?? null,
        topVideoViews: s.topVideoViews ?? null,
        topVideoTitle: s.topVideoTitle ?? null,
      },
    });
    saved++;

    // ── Anomaly detection: monetization lost ──
    if (
      previous?.monetizationEnabled === true &&
      s.monetizationEnabled === false
    ) {
      sendAlert(
        user.id,
        `Kenh <b>${channel.name}</b> bi <b>TAT kiem tien</b>!\nKiem tra ngay YouTube Studio.`
      ).catch(() => {});
    }
  }

  // ── Cleanup stats older than 7 days ──
  try {
    const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    await prisma.channelStats.deleteMany({
      where: { collectedAt: { lt: cutoff } },
    });
  } catch {
    // non-critical
  }

  // Update statsLastCollect on user settings
  try {
    await prisma.userSettings.update({
      where: { userId: user.id },
      data: { statsLastCollect: new Date() },
    });
  } catch {
    // non-critical
  }

  return NextResponse.json({ saved });
}
