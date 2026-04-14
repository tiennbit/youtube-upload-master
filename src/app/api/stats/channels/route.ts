import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/auth";

// GET /api/stats/channels?range=24h|7d — Channel stats for dashboard
export async function GET(request: Request) {
  const userId = await getCurrentUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const range = searchParams.get("range") || "24h";

  const hours = range === "7d" ? 168 : 24;
  const since = new Date(Date.now() - hours * 60 * 60 * 1000);

  const channels = await prisma.channel.findMany({
    where: { userId },
    orderBy: { name: "asc" },
  });

  const result = [];

  for (const ch of channels) {
    // Latest stats
    const latest = await prisma.channelStats.findFirst({
      where: { channelId: ch.id },
      orderBy: { collectedAt: "desc" },
    });

    // History within range
    const history = await prisma.channelStats.findMany({
      where: {
        channelId: ch.id,
        collectedAt: { gte: since },
      },
      orderBy: { collectedAt: "asc" },
    });

    // Upload counts today
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const uploadedToday = await prisma.upload.count({
      where: {
        channelId: ch.id,
        status: "DONE",
        uploadedAt: { gte: todayStart },
      },
    });
    const pendingCount = await prisma.upload.count({
      where: { channelId: ch.id, status: "PENDING" },
    });

    result.push({
      id: ch.id,
      name: ch.name,
      uploadEnabled: ch.uploadEnabled,
      latestStats: latest
        ? {
            subscriberCount: latest.subscriberCount,
            totalViews: latest.totalViews?.toString() ?? null,
            viewsLast28Days: latest.viewsLast28Days,
            viewsLast48Hours: latest.viewsLast48Hours,
            videoCount: latest.videoCount,
            estimatedRevenue: latest.estimatedRevenue,
            revenueMonth: latest.revenueMonth,
            monetizationEnabled: latest.monetizationEnabled,
            topVideoViews: latest.topVideoViews,
            topVideoTitle: latest.topVideoTitle,
            collectedAt: latest.collectedAt,
          }
        : null,
      uploadedToday,
      pendingCount,
      history: history.map((h) => ({
        subscriberCount: h.subscriberCount,
        viewsLast48Hours: h.viewsLast48Hours,
        estimatedRevenue: h.estimatedRevenue,
        revenueMonth: h.revenueMonth,
        collectedAt: h.collectedAt,
      })),
    });
  }

  return NextResponse.json({ channels: result });
}
