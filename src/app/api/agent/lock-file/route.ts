import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

const LOCK_TTL_MS = 10 * 60 * 1000; // 10 minutes

/**
 * POST /api/agent/lock-file
 * 
 * GLOBAL file lock across ALL channels sharing the same Nextcloud folder.
 * 
 * Problem: Multiple channels (news 4, news 6, news 7, ...) share the same
 * Nextcloud folder (ks-news). Each channel has its OWN Upload record for
 * the same file. The old per-record lock only locked ONE channel's record,
 * allowing other channels to "lock" their own record and download a file
 * that was already being processed (or deleted) by another channel → 404.
 * 
 * Solution: Before locking, check ALL Upload records for this file path
 * across ALL channels. If ANY other channel has a valid lock → deny.
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

  // ══════════════════════════════════════════════════════════════
  // STEP 1: GLOBAL CHECK — Is ANY other channel holding a valid lock?
  // This looks across ALL Upload records for this file, not just
  // the requesting channel's record.
  // ══════════════════════════════════════════════════════════════
  const conflictingLock = await prisma.upload.findFirst({
    where: {
      remoteVideoPath,
      channel: { userId: user.id },
      lockedAt: { gte: lockExpiry },    // lock is still valid (not expired)
      NOT: [
        { lockedByChannelId: null },    // must have a lock holder
        { lockedByChannelId: channelId }, // ignore self-locks (idempotent)
      ],
    },
  });

  if (conflictingLock) {
    return NextResponse.json({ 
      success: false, 
      reason: "locked_by_other",
      lockedBy: conflictingLock.lockedByChannelId 
    });
  }

  // ══════════════════════════════════════════════════════════════
  // STEP 2: LOCK — No conflict found. Lock THIS channel's record.
  // Also lock ALL records for this file (across all channels)
  // to prevent any other channel from claiming it.
  // ══════════════════════════════════════════════════════════════
  const result = await prisma.upload.updateMany({
    where: {
      remoteVideoPath,
      channel: { userId: user.id },
      OR: [
        { lockedByChannelId: null },       // not locked
        { lockedByChannelId: channelId },   // already locked by same channel
        { lockedAt: { lt: lockExpiry } },   // lock expired
      ],
    },
    data: {
      lockedByChannelId: channelId,
      lockedAt: new Date(),
    },
  });

  if (result.count === 0) {
    return NextResponse.json({ success: false, reason: "no_matching_record" });
  }

  return NextResponse.json({ success: true, lockedRecords: result.count });
}
