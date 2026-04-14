import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

// GET /api/agent/jobs — Agent polls for next job
// Auth: Bearer <agentToken>
// Query: ?skipChannels=170,171 — exclude channels in cooldown
export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return NextResponse.json({ error: "Missing agent token" }, { status: 401 });
  }

  const token = authHeader.slice(7);
  const user = await prisma.user.findUnique({
    where: { agentToken: token },
    include: { settings: true },
  });

  if (!user) {
    return NextResponse.json({ error: "Invalid agent token" }, { status: 401 });
  }

  // Parse skipChannels from query params
  const url = new URL(request.url);
  const skipChannelsParam = url.searchParams.get("skipChannels");
  const skipChannelIds: number[] = skipChannelsParam
    ? skipChannelsParam.split(",").map(Number).filter((n) => !isNaN(n))
    : [];

  // Find next pending upload
  const now = new Date();
  const currentHour = now.getHours();

  // Build channel exclusion filter
  const channelExclude = skipChannelIds.length > 0
    ? { id: { notIn: skipChannelIds } }
    : {};

  // Priority 1: Special jobs (open profile, check login) — always process, no time window
  let job = await prisma.upload.findFirst({
    where: {
      channel: { userId: user.id, ...channelExclude },
      status: "PENDING",
      title: { startsWith: "__" },
    },
    include: {
      channel: {
        select: {
          id: true,
          name: true,
          gologinProfileId: true,
          studioUrl: true,
          nextcloudFolder: true,
          uploadVisibility: true,
          uploadInterval: true,
          uploadStartHour: true,
          uploadEndHour: true,
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  // Priority 2: Regular upload jobs — respect time window
  // Handle 3 cases: (1) startHour === endHour → 24/7, (2) normal 8h-22h, (3) overnight 22h-6h
  if (!job) {
    // Prisma can't self-reference columns (startHour vs endHour) in WHERE.
    // Fetch all pending uploads, then filter schedule in JS (matches agent logic exactly).
    const pendingUploads = await prisma.upload.findMany({
      where: {
        channel: {
          userId: user.id,
          uploadEnabled: true,
          ...channelExclude,
        },
        status: "PENDING",
        NOT: { title: { startsWith: "__" } },
      },
      include: {
        channel: {
          select: {
            id: true,
            name: true,
            gologinProfileId: true,
            studioUrl: true,
            nextcloudFolder: true,
            uploadVisibility: true,
            uploadInterval: true,
            uploadStartHour: true,
            uploadEndHour: true,
          },
        },
      },
      orderBy: { createdAt: "asc" },
    });

    console.log(`[Jobs API] pendingUploads count: ${pendingUploads.length}, currentHour: ${currentHour}, channelExclude:`, channelExclude);
    if (pendingUploads.length > 0) {
      console.log(`[Jobs API] First upload channel: start=${pendingUploads[0].channel.uploadStartHour}, end=${pendingUploads[0].channel.uploadEndHour}`);
    }

    // Filter by schedule in JS (matches agent-side logic exactly)
    job = pendingUploads.find((u) => {
      const start = u.channel.uploadStartHour ?? 0;
      const end = u.channel.uploadEndHour ?? 24;
      // 24/7 mode: startHour === endHour
      if (start === end) return true;
      // Normal range: 8h-22h
      if (start < end) return currentHour >= start && currentHour < end;
      // Overnight range: 22h-6h
      return currentHour >= start || currentHour < end;
    }) || null;
    console.log(`[Jobs API] After schedule filter: job=${job ? job.id : 'null'}`);
  }

  const settings = user.settings;

  if (!job) {
    return NextResponse.json({
      job: null,
      reason: "no_pending_jobs",
      settings: settings
        ? {
            gologinToken: settings.gologinToken,
            nextcloudUrl: settings.nextcloudUrl,
            nextcloudUsername: settings.nextcloudUsername,
            nextcloudPassword: settings.nextcloudPassword,
            maxConcurrent: settings.maxConcurrent ?? 3,
            autoUploadEnabled: settings.autoUploadEnabled ?? false,
          }
        : null,
    });
  }

  // Mark as UPLOADING
  await prisma.upload.update({
    where: { id: job.id },
    data: { status: "UPLOADING" },
  });

  return NextResponse.json({
    job: {
      id: job.id,
      title: job.title,
      description: job.description,
      tags: job.tags,
      videoPath: job.videoPath,
      thumbPath: job.thumbPath,
      remoteVideoPath: job.remoteVideoPath,
      remoteThumbnailPath: job.remoteThumbnailPath,
      visibility: job.visibility,
      channel: job.channel,
    },
    settings: settings
      ? {
          gologinToken: settings.gologinToken,
          nextcloudUrl: settings.nextcloudUrl,
          nextcloudUsername: settings.nextcloudUsername,
          nextcloudPassword: settings.nextcloudPassword,
          maxConcurrent: settings.maxConcurrent ?? 3,
          autoUploadEnabled: settings.autoUploadEnabled ?? false,
        }
      : null,
  });
}
