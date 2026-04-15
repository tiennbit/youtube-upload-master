import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { sendAlert, sendUploadSuccess } from "@/lib/telegram";

// POST /api/agent/report — Agent reports job result
// Auth: Bearer <agentToken>
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

  const { jobId, status, error, youtubeUrl, youtubeId } = await request.json();
  const normalizedError = typeof error === "string" ? error.trim() : "";
  const persistedError =
    status === "FAILED" ? normalizedError || "Loi khong xac dinh" : null;

  if (!jobId || !status) {
    return NextResponse.json(
      { error: "jobId and status are required" },
      { status: 400 }
    );
  }

  if (!["DONE", "FAILED", "PENDING"].includes(status)) {
    return NextResponse.json(
      { error: "status must be DONE, FAILED, or PENDING" },
      { status: 400 }
    );
  }

  // Verify job belongs to this user
  const upload = await prisma.upload.findFirst({
    where: {
      id: jobId,
      channel: { userId: user.id },
    },
  });

  if (!upload) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  // Update job status
  const updated = await prisma.upload.update({
    where: { id: jobId },
    data: {
      status,
      error: persistedError,
      youtubeUrl: youtubeUrl || undefined,
      youtubeId: youtubeId || undefined,
      uploadedAt: status === "DONE" ? new Date() : undefined,
    },
  });

  const channel = await prisma.channel.findUnique({
    where: { id: upload.channelId },
    select: { id: true, name: true },
  });
  const channelName = channel?.name || `Channel #${upload.channelId}`;

  // Update channel lastUpload if successful
  if (status === "DONE") {
    await prisma.channel.update({
      where: { id: upload.channelId },
      data: { lastUpload: new Date() },
    });

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const totalUploadedToday = await prisma.upload.count({
      where: {
        channelId: upload.channelId,
        status: "DONE",
        uploadedAt: { gte: todayStart },
      },
    });

    const finalYoutubeUrl =
      updated.youtubeUrl ||
      (updated.youtubeId ? `https://youtu.be/${updated.youtubeId}` : "N/A");

    sendUploadSuccess(user.id, {
      channelName,
      youtubeUrl: finalYoutubeUrl,
      totalUploadedToday,
      uploadedAt: updated.uploadedAt || new Date(),
    }).catch(() => {});
  }

  // Send Telegram alert on upload failure (fire-and-forget)
  // Skip alerts for expected/intentional failures.
  if (status === "FAILED") {
    const errorLower = persistedError.toLowerCase();
    const isExpectedContention =
      errorLower.includes("404") ||
      errorLower.includes("locked") ||
      errorLower.includes("all files locked") ||
      errorLower.includes("all newest files");
    const isChannelDisabled = errorLower.includes("channel disabled by user");

    console.error(
      "[AgentReport]",
      JSON.stringify({
        event: "upload_failed",
        jobId,
        channelId: upload.channelId,
        channelName,
        status,
        error: persistedError,
        updatedAt: updated.updatedAt.toISOString(),
      })
    );

    if (!isExpectedContention && !isChannelDisabled) {
      const errMsg = persistedError.substring(0, 200);
      sendAlert(
        user.id,
        `Upload that bai!\n\nKenh: <b>${channelName}</b>\nVideo: ${upload.title}\nLoi: ${errMsg}`
      ).catch(() => {});
    }
  }

  return NextResponse.json({ success: true, upload: updated });
}
