import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

// POST /api/agent/channel-update — Agent auto-updates channel metadata (e.g., studioUrl)
export async function POST(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return NextResponse.json({ error: "Missing agent token" }, { status: 401 });
  }

  const token = authHeader.slice(7);
  const user = await prisma.user.findUnique({
    where: { agentToken: token },
  });

  if (!user) {
    return NextResponse.json({ error: "Invalid agent token" }, { status: 401 });
  }

  const { channelId, studioUrl } = await request.json();

  if (!channelId) {
    return NextResponse.json({ error: "channelId required" }, { status: 400 });
  }

  // Verify channel belongs to this user
  const channel = await prisma.channel.findFirst({
    where: { id: channelId, userId: user.id },
  });

  if (!channel) {
    return NextResponse.json({ error: "Channel not found" }, { status: 404 });
  }

  // Only update studioUrl if not already set (don't overwrite manual config)
  const data: Record<string, string> = {};
  if (studioUrl && !channel.studioUrl) {
    data.studioUrl = studioUrl;
  }

  if (Object.keys(data).length > 0) {
    await prisma.channel.update({
      where: { id: channelId },
      data,
    });
  }

  return NextResponse.json({ success: true });
}
