import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/auth";

export async function GET() {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const [channels, totalUploads, pendingUploads, completedUploads, failedUploads] =
    await Promise.all([
      prisma.channel.findMany({
        where: { userId },
        select: { id: true, uploadEnabled: true },
      }),
      prisma.upload.count({
        where: { channel: { userId } },
      }),
      prisma.upload.count({
        where: { channel: { userId }, status: "PENDING" },
      }),
      prisma.upload.count({
        where: { channel: { userId }, status: "DONE" },
      }),
      prisma.upload.count({
        where: { channel: { userId }, status: "FAILED" },
      }),
    ]);

  return NextResponse.json({
    totalChannels: channels.length,
    activeChannels: channels.filter((c: { uploadEnabled: boolean }) => c.uploadEnabled).length,
    totalUploads,
    pendingUploads,
    completedUploads,
    failedUploads,
  });
}
