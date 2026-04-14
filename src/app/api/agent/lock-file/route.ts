import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

const LOCK_TTL_MS = 10 * 60 * 1000; // 10 minutes

/**
 * POST /api/agent/lock-file
 * Atomically lock a Nextcloud file path for a specific channel.
 *
 * Uses a single conditional UPDATE (not SELECT + UPDATE) to prevent
 * TOCTOU race conditions when two channels request the same file simultaneously.
 * PostgreSQL row-level locking ensures only one channel wins.
 *
 * Returns { success: true } if lock acquired, { success: false } if already locked.
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

  const lockExpiry = new Date(Date.now() - LOCK_TTL_MS);

  // Single atomic UPDATE: only succeeds if not locked by another channel (or lock expired).
  // If two requests arrive simultaneously, PostgreSQL row-level lock ensures only one wins.
  const result = await prisma.upload.updateMany({
    where: {
      remoteVideoPath,
      channel: { userId: user.id },
      OR: [
        { lockedByChannelId: null },           // not locked
        { lockedByChannelId: channelId },       // already locked by same channel (idempotent)
        { lockedAt: { lt: lockExpiry } },       // lock expired (TTL = 10 min)
      ],
    },
    data: {
      lockedByChannelId: channelId,
      lockedAt: new Date(),
    },
  });

  if (result.count === 0) {
    // No rows updated → locked by another channel
    return NextResponse.json({ success: false, reason: "locked_by_other" });
  }

  return NextResponse.json({ success: true });
}
