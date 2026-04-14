import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { sendAlert } from "@/lib/telegram";

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
      error: error || null,
      youtubeUrl: youtubeUrl || undefined,
      youtubeId: youtubeId || undefined,
      uploadedAt: status === "DONE" ? new Date() : undefined,
    },
  });

  // Update channel lastUpload if successful
  if (status === "DONE") {
    await prisma.channel.update({
      where: { id: upload.channelId },
      data: { lastUpload: new Date() },
    });
  }

  // Send Telegram alert on upload failure (fire-and-forget)
  if (status === "FAILED") {
    const channel = await prisma.channel.findUnique({
      where: { id: upload.channelId },
    });
    const chName = channel?.name || `Channel #${upload.channelId}`;
    const errMsg = error ? error.substring(0, 200) : "Loi khong xac dinh";
    sendAlert(
      user.id,
      `Upload that bai!\n\nKenh: <b>${chName}</b>\nVideo: ${upload.title}\nLoi: ${errMsg}`
    ).catch(() => {});
  }

  return NextResponse.json({ success: true, upload: updated });
}
