import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

/**
 * POST /api/agent/unlock-file
 * Release the lock on a file after upload completes or fails.
 */
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

  const { remoteVideoPath, channelId } = await request.json();
  if (!remoteVideoPath || !channelId) {
    return NextResponse.json({ error: "remoteVideoPath and channelId required" }, { status: 400 });
  }

  await prisma.upload.updateMany({
    where: {
      remoteVideoPath,
      lockedByChannelId: channelId,
      channel: { userId: user.id },
    },
    data: {
      lockedByChannelId: null,
      lockedAt: null,
    },
  });

  return NextResponse.json({ success: true });
}
