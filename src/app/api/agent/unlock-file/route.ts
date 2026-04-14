import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

/**
 * POST /api/agent/unlock-file
 * 
 * Release or permanently lock a file across ALL channels.
 * 
 * When deleted=true: Sets lock expiry to year 2099 on ALL records for this file.
 * This ensures no other channel can ever re-lock a deleted file (prevents 404s).
 * 
 * When deleted=false: Releases the lock on ALL records for this file,
 * allowing other channels to pick it up.
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

  const { remoteVideoPath, channelId, deleted } = await request.json();
  if (!remoteVideoPath || !channelId) {
    return NextResponse.json({ error: "remoteVideoPath and channelId required" }, { status: 400 });
  }

  if (deleted) {
    // File was permanently deleted from Nextcloud.
    // Lock ALL records for this file (across ALL channels) with far-future expiry.
    // This prevents ANY channel from trying to download it → no more 404s.
    const farFuture = new Date("2099-12-31T23:59:59.000Z");
    await prisma.upload.updateMany({
      where: {
        remoteVideoPath,
        channel: { userId: user.id },
      },
      data: {
        lockedByChannelId: channelId,
        lockedAt: farFuture,
      },
    });
  } else {
    // Release the lock on ALL records for this file (download failed, file still exists).
    // Only release locks held by this channel.
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
  }

  return NextResponse.json({ success: true });
}
