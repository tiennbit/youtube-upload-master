import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

const PICK_AHEAD_WINDOW_MS = 2 * 60 * 1000; // pick job at most 2 minutes before cooldown is done

function isChannelInSchedule(currentHour: number, startHour?: number | null, endHour?: number | null) {
  const start = startHour ?? 0;
  const end = endHour ?? 24;
  if (start === end) return true;
  if (start < end) return currentHour >= start && currentHour < end;
  return currentHour >= start || currentHour < end;
}

function compareNullableDateAsc(a: Date | null, b: Date | null) {
  if (!a && !b) return 0;
  if (!a) return -1;
  if (!b) return 1;
  return a.getTime() - b.getTime();
}

function isSpecialJobTitle(title: string) {
  return title.startsWith("__OPEN_PROFILE__") || title.startsWith("__CHECK_LOGIN__");
}

function isChannelReadyWithinWindow(
  now: Date,
  lastUpload: Date | null | undefined,
  uploadIntervalMinutes: number | null | undefined
) {
  if (!lastUpload) return true;
  const intervalMs = Math.max(1, uploadIntervalMinutes ?? 30) * 60 * 1000;
  const readyAtMs = lastUpload.getTime() + intervalMs;
  return readyAtMs - now.getTime() <= PICK_AHEAD_WINDOW_MS;
}

// GET /api/agent/jobs - Agent polls for next job
// Auth: Bearer <agentToken>
// Query: ?skipChannels=170,171 - exclude channels in cooldown
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

  const url = new URL(request.url);
  const skipChannelsParam = url.searchParams.get("skipChannels");
  const skipChannelIds: number[] = skipChannelsParam
    ? skipChannelsParam.split(",").map(Number).filter((n) => !Number.isNaN(n))
    : [];

  // Self-healing: reset stale UPLOADING jobs.
  const stuckCutoff = new Date(Date.now() - 30 * 60 * 1000);
  const stuckReset = await prisma.upload.updateMany({
    where: {
      channel: { userId: user.id },
      status: "UPLOADING",
      updatedAt: { lt: stuckCutoff },
    },
    data: {
      status: "FAILED",
      error: "Auto-reset: job stuck in UPLOADING > 30 min (agent crash/timeout)",
    },
  });
  if (stuckReset.count > 0) {
    console.log(`[Jobs API] Auto-reset ${stuckReset.count} stuck UPLOADING jobs -> FAILED`);
  }

  const now = new Date();
  const currentHour = now.getHours();
  const settings = user.settings;
  const maxConcurrent = Math.max(1, settings?.maxConcurrent ?? 3);

  const uploadingJobs = await prisma.upload.findMany({
    where: {
      channel: { userId: user.id },
      status: "UPLOADING",
    },
    select: {
      id: true,
      channelId: true,
    },
  });
  const uploadingChannelIds = new Set(uploadingJobs.map((u) => u.channelId));
  const uploadingCount = uploadingJobs.length;

  if (uploadingCount >= maxConcurrent) {
    return NextResponse.json({
      job: null,
      reason: "max_concurrent_reached",
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

  const excludedChannelIds = Array.from(
    new Set([...skipChannelIds, ...Array.from(uploadingChannelIds)])
  );
  const channelExclude =
    excludedChannelIds.length > 0 ? { id: { notIn: excludedChannelIds } } : {};

  const channelSelect = {
    id: true,
    name: true,
    uploadEnabled: true,
    gologinProfileId: true,
    studioUrl: true,
    nextcloudFolder: true,
    uploadVisibility: true,
    uploadInterval: true,
    uploadStartHour: true,
    uploadEndHour: true,
    lastUpload: true,
  } as const;

  const allPendingJobs = await prisma.upload.findMany({
    where: {
      channel: { userId: user.id, ...channelExclude },
      status: "PENDING",
    },
    include: {
      channel: { select: channelSelect },
    },
    orderBy: { createdAt: "desc" },
  });

  // Priority 1: special jobs, oldest first.
  const specialJob = allPendingJobs
    .filter((u) => isSpecialJobTitle(u.title))
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())[0];
  let job = specialJob ?? null;

  // Priority 2: fair dispatch for regular uploads.
  // - At most 1 candidate per channel in one dispatch cycle.
  // - Newest job first inside each channel.
  // - Fair across channels by prioritizing older lastUpload.
  if (!job) {
    const pendingUploads = allPendingJobs.filter(
      (u) => u.channel.uploadEnabled && !isSpecialJobTitle(u.title)
    );

    const newestByChannel = new Map<number, (typeof pendingUploads)[number]>();
    for (const upload of pendingUploads) {
      if (!newestByChannel.has(upload.channel.id)) {
        newestByChannel.set(upload.channel.id, upload);
      }
    }

    const scheduledCandidates = Array.from(newestByChannel.values()).filter((u) =>
      isChannelInSchedule(currentHour, u.channel.uploadStartHour, u.channel.uploadEndHour)
    );
    const readyCandidates = scheduledCandidates.filter((u) =>
      isChannelReadyWithinWindow(now, u.channel.lastUpload, u.channel.uploadInterval)
    );

    readyCandidates.sort((a, b) => {
      const byLastUpload = compareNullableDateAsc(a.channel.lastUpload, b.channel.lastUpload);
      if (byLastUpload !== 0) return byLastUpload;
      const byCreatedAt = a.createdAt.getTime() - b.createdAt.getTime();
      if (byCreatedAt !== 0) return byCreatedAt;
      return a.channel.id - b.channel.id;
    });

    job = readyCandidates[0] ?? null;
    console.log(
      `[Jobs API] Fair dispatch: pending=${pendingUploads.length}, channels=${newestByChannel.size}, scheduled=${scheduledCandidates.length}, ready=${readyCandidates.length}, selected=${job ? job.id : "null"}`
    );
  }

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

  const claimed = await prisma.upload.updateMany({
    where: {
      id: job.id,
      status: "PENDING",
    },
    data: { status: "UPLOADING" },
  });

  if (claimed.count === 0) {
    return NextResponse.json({
      job: null,
      reason: "job_already_claimed",
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
