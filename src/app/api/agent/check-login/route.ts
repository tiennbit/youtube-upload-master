import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

// POST /api/agent/check-login — Request agent to check if a GoLogin profile is logged into YouTube
export async function POST(request: Request) {
  const authHeader = request.headers.get("authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;

  // Support both agent token auth AND cookie auth
  let userId: string | null = null;

  if (token) {
    const user = await prisma.user.findUnique({ where: { agentToken: token } });
    userId = user?.id || null;
  } else {
    const { getCurrentUserId } = await import("@/lib/auth");
    userId = await getCurrentUserId();
  }

  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { channelId } = await request.json();
  if (!channelId) {
    return NextResponse.json({ error: "channelId required" }, { status: 400 });
  }

  const channel = await prisma.channel.findFirst({
    where: { id: channelId, userId },
    select: { id: true, name: true, gologinProfileId: true },
  });

  if (!channel) {
    return NextResponse.json({ error: "Channel not found" }, { status: 404 });
  }

  if (!channel.gologinProfileId) {
    return NextResponse.json({ error: "Channel chưa có GoLogin profile" }, { status: 400 });
  }

  // Create a special CHECK_LOGIN upload job
  const job = await prisma.upload.create({
    data: {
      channelId: channel.id,
      title: `__CHECK_LOGIN__${channel.name}`,
      status: "PENDING",
      visibility: "private",
    },
  });

  return NextResponse.json({ jobId: job.id, message: "Check login job created. Agent sẽ kiểm tra trong vòng 30s." });
}

// GET /api/agent/check-login?channelId=X — Get login status for a channel
export async function GET(request: Request) {
  const { getCurrentUserId } = await import("@/lib/auth");
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const channelId = url.searchParams.get("channelId");
  if (!channelId) return NextResponse.json({ error: "channelId required" }, { status: 400 });

  const channel = await prisma.channel.findFirst({
    where: { id: Number(channelId), userId },
    select: { isLoggedIn: true },
  });

  return NextResponse.json({ isLoggedIn: channel?.isLoggedIn ?? false });
}
