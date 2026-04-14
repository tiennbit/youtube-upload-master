import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

// POST /api/agent/scan-jobs — Agent reports new videos found in Nextcloud
// Creates upload jobs for files not yet in the DB
export async function POST(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return NextResponse.json({ error: "Missing agent token" }, { status: 401 });
  }

  const token = authHeader.slice(7);
  const user = await prisma.user.findUnique({ where: { agentToken: token } });
  if (!user) {
    return NextResponse.json({ error: "Invalid agent token" }, { status: 401 });
  }

  const { channelId, files } = await request.json();

  if (!channelId || !Array.isArray(files)) {
    return NextResponse.json({ error: "channelId and files required" }, { status: 400 });
  }

  // Verify channel belongs to user
  const channel = await prisma.channel.findFirst({
    where: { id: channelId, userId: user.id },
  });
  if (!channel) {
    return NextResponse.json({ error: "Channel not found" }, { status: 404 });
  }

  // Get existing uploads for this channel (to avoid duplicates)
  const existing = await prisma.upload.findMany({
    where: { channelId },
    select: { remoteVideoPath: true },
  });
  const existingPaths = new Set(existing.map((u) => u.remoteVideoPath));

  // Create jobs for new files only
  const newJobs = [];
  for (const file of files) {
    if (existingPaths.has(file.videoPath || file.remotePath)) continue;

    // Use metadata title if available, otherwise derive from filename
    const title = file.title || file.name
      ?.replace(/\.[^.]+$/, "")
      .replace(/[_-]/g, " ")
      .replace(/\s+/g, " ")
      .trim() || "Untitled";

    newJobs.push({
      channelId,
      title,
      description: file.description || null,
      tags: file.tags ? JSON.stringify(file.tags) : null,
      remoteVideoPath: file.videoPath || file.remotePath,
      remoteThumbnailPath: file.thumbnailPath || null,
      visibility: file.visibility || channel.uploadVisibility || "public",
      status: "PENDING",
    });
  }

  if (newJobs.length > 0) {
    await prisma.upload.createMany({ data: newJobs });
  }

  return NextResponse.json({
    created: newJobs.length,
    skipped: files.length - newJobs.length,
  });
}
