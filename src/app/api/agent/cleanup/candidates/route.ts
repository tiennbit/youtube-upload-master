import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

// GET /api/agent/cleanup/candidates?before=ISO&limit=200&excludeChannels=1,2
// Auth: Bearer <agentToken>
export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return NextResponse.json({ error: "Missing agent token" }, { status: 401 });
  }

  const token = authHeader.slice(7);
  const user = await prisma.user.findUnique({ where: { agentToken: token } });
  if (!user) {
    return NextResponse.json({ error: "Invalid agent token" }, { status: 401 });
  }

  const url = new URL(request.url);
  const beforeParam = url.searchParams.get("before");
  const before = beforeParam ? new Date(beforeParam) : new Date(Date.now() - 72 * 60 * 60 * 1000);
  if (Number.isNaN(before.getTime())) {
    return NextResponse.json({ error: "Invalid before timestamp" }, { status: 400 });
  }

  const limitParam = Number(url.searchParams.get("limit") || 200);
  const limit = Number.isFinite(limitParam)
    ? Math.max(1, Math.min(500, Math.floor(limitParam)))
    : 200;

  const excludeChannelsParam = url.searchParams.get("excludeChannels") || "";
  const excludeChannelIds = excludeChannelsParam
    .split(",")
    .map((v) => Number(v.trim()))
    .filter((v) => Number.isFinite(v));

  const candidates = await prisma.upload.findMany({
    where: {
      channel: { userId: user.id },
      createdAt: { lt: before },
      ...(excludeChannelIds.length > 0 ? { channelId: { notIn: excludeChannelIds } } : {}),
    },
    orderBy: { createdAt: "asc" },
    take: limit,
    select: {
      id: true,
      channelId: true,
      remoteVideoPath: true,
      remoteThumbnailPath: true,
      createdAt: true,
      status: true,
    },
  });

  return NextResponse.json({
    candidates,
    hasMore: candidates.length >= limit,
  });
}
