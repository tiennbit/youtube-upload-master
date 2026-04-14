import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

// POST /api/agent/open-profile — Request agent to open a GoLogin profile for manual inspection
export async function POST(request: Request) {
  const authHeader = request.headers.get("authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;

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

  // Create a special OPEN_PROFILE upload job that agent will pick up
  const job = await prisma.upload.create({
    data: {
      channelId: channel.id,
      title: `__OPEN_PROFILE__${channel.name}`,
      status: "PENDING",
      visibility: "private",
    },
  });

  return NextResponse.json({
    jobId: job.id,
    message: `Yêu cầu mở profile đã được gửi. Agent sẽ mở GoLogin profile cho channel "${channel.name}" trong vòng 30s.`,
  });
}
