import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/auth";

type ChannelItem = {
  id: number;
  name: string;
  uploadEnabled: boolean;
  uploadStartHour: number;
  uploadEndHour: number;
  uploadInterval: number;
  lastUpload: Date | null;
  viewsLast48Hours: number | null;
  revenueMonth: number | null;
  uploadedToday: number;
  pendingCount: number;
  uploadingCount: number;
  failedToday: number;
  nextUploadAt: string | null;
  secondsUntilNextUpload: number | null;
  etaToDispatchSeconds: number | null;
  statusLabel: string;
  statusTone: "success" | "warning" | "error" | "info" | "neutral";
};

type PendingJobForEta = {
  channelId: number;
  createdAt: Date;
  title: string;
  channel: {
    id: number;
    uploadEnabled: boolean;
    uploadStartHour: number;
    uploadEndHour: number;
    lastUpload: Date | null;
  };
};

function isInSchedule(now: Date, startHour: number, endHour: number): boolean {
  if (startHour === endHour) return true;
  const hour = now.getHours();
  if (startHour < endHour) {
    return hour >= startHour && hour < endHour;
  }
  return hour >= startHour || hour < endHour;
}

function getNextScheduleStart(now: Date, startHour: number, endHour: number): Date {
  if (startHour === endHour || isInSchedule(now, startHour, endHour)) {
    return now;
  }

  const next = new Date(now);
  next.setMinutes(0, 0, 0);
  next.setHours(startHour);

  const hour = now.getHours();
  if (startHour < endHour) {
    if (hour >= endHour) {
      next.setDate(next.getDate() + 1);
    }
    return next;
  }

  // Overnight schedule: active [startHour, 24) U [0, endHour)
  // Inactive block is [endHour, startHour), next start is today at startHour.
  if (hour >= endHour && hour < startHour) {
    return next;
  }

  // Fallback for boundary cases.
  if (next.getTime() < now.getTime()) {
    next.setDate(next.getDate() + 1);
  }
  return next;
}

function getNextUploadAt(
  now: Date,
  startHour: number,
  endHour: number,
  uploadInterval: number,
  lastUpload: Date | null
): Date {
  const scheduleReadyAt = getNextScheduleStart(now, startHour, endHour);
  let next = scheduleReadyAt;

  if (lastUpload) {
    const cooldownReadyAt = new Date(lastUpload.getTime() + uploadInterval * 60 * 1000);
    if (cooldownReadyAt.getTime() > next.getTime()) {
      next = cooldownReadyAt;
    }
  }

  return next;
}

function keyByChannelId<T extends { channelId: number }>(rows: T[]) {
  const map = new Map<number, T[]>();
  for (const row of rows) {
    const bucket = map.get(row.channelId);
    if (bucket) {
      bucket.push(row);
    } else {
      map.set(row.channelId, [row]);
    }
  }
  return map;
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

export const dynamic = "force-dynamic";

// GET /api/dashboard/realtime
export async function GET() {
  const userId = await getCurrentUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);

  const [
    channels,
    uploadGrouped,
    doneTodayGrouped,
    failedTodayGrouped,
    latestStats,
    userSettings,
    pendingJobsForEta,
  ] =
    await Promise.all([
      prisma.channel.findMany({
        where: { userId },
        select: {
          id: true,
          name: true,
          uploadEnabled: true,
          uploadStartHour: true,
          uploadEndHour: true,
          uploadInterval: true,
          lastUpload: true,
        },
        orderBy: { name: "asc" },
      }),
      prisma.upload.groupBy({
        by: ["channelId", "status"],
        where: {
          channel: { userId },
          status: { in: ["PENDING", "UPLOADING"] },
        },
        _count: { _all: true },
      }),
      prisma.upload.groupBy({
        by: ["channelId"],
        where: {
          channel: { userId },
          status: "DONE",
          uploadedAt: { gte: todayStart },
        },
        _count: { _all: true },
      }),
      prisma.upload.groupBy({
        by: ["channelId"],
        where: {
          channel: { userId },
          status: "FAILED",
          updatedAt: { gte: todayStart },
        },
        _count: { _all: true },
      }),
      prisma.channelStats.findMany({
        where: { channel: { userId } },
        distinct: ["channelId"],
        orderBy: [{ channelId: "asc" }, { collectedAt: "desc" }],
        select: {
          channelId: true,
          viewsLast48Hours: true,
          revenueMonth: true,
        },
      }),
      prisma.userSettings.findUnique({
        where: { userId },
        select: {
          agentLastSeen: true,
          agentStatus: true,
          agentActiveUploads: true,
          agentMessage: true,
          agentVersion: true,
          maxConcurrent: true,
        },
      }),
      prisma.upload.findMany({
        where: {
          channel: { userId },
          status: "PENDING",
        },
        select: {
          channelId: true,
          createdAt: true,
          title: true,
          channel: {
            select: {
              id: true,
              uploadEnabled: true,
              uploadStartHour: true,
              uploadEndHour: true,
              lastUpload: true,
            },
          },
        },
        orderBy: { createdAt: "desc" },
      }),
    ]);

  const groupedStatus = keyByChannelId(uploadGrouped);
  const doneTodayMap = new Map(doneTodayGrouped.map((r) => [r.channelId, r._count._all]));
  const failedTodayMap = new Map(failedTodayGrouped.map((r) => [r.channelId, r._count._all]));
  const latestStatsMap = new Map(latestStats.map((s) => [s.channelId, s]));
  const etaByChannel = new Map<number, number>();
  const maxConcurrent = Math.max(1, userSettings?.maxConcurrent ?? 3);
  const activeUploads = Math.max(0, userSettings?.agentActiveUploads ?? 0);
  const dispatchStaggerSeconds = 180;

  const regularPending = (pendingJobsForEta as PendingJobForEta[]).filter(
    (u) => u.channel.uploadEnabled && !isSpecialJobTitle(u.title)
  );
  const newestByChannel = new Map<number, PendingJobForEta>();
  for (const upload of regularPending) {
    if (!newestByChannel.has(upload.channelId)) {
      newestByChannel.set(upload.channelId, upload);
    }
  }

  const scheduledCandidates = Array.from(newestByChannel.values()).filter((u) =>
    isInSchedule(now, u.channel.uploadStartHour, u.channel.uploadEndHour)
  );
  scheduledCandidates.sort((a, b) => {
    const byLastUpload = compareNullableDateAsc(a.channel.lastUpload, b.channel.lastUpload);
    if (byLastUpload !== 0) return byLastUpload;
    const byCreatedAt = a.createdAt.getTime() - b.createdAt.getTime();
    if (byCreatedAt !== 0) return byCreatedAt;
    return a.channelId - b.channelId;
  });

  for (let index = 0; index < scheduledCandidates.length; index += 1) {
    const candidate = scheduledCandidates[index];
    const queueDelay = index * dispatchStaggerSeconds;
    const capacityDelay = activeUploads >= maxConcurrent ? dispatchStaggerSeconds : 0;
    etaByChannel.set(candidate.channelId, queueDelay + capacityDelay);
  }

  const channelItems: ChannelItem[] = channels.map((channel) => {
    const statusRows = groupedStatus.get(channel.id) || [];
    const pendingCount = statusRows
      .filter((s) => s.status === "PENDING")
      .reduce((sum, row) => sum + row._count._all, 0);
    const uploadingCount = statusRows
      .filter((s) => s.status === "UPLOADING")
      .reduce((sum, row) => sum + row._count._all, 0);
    const uploadedToday = doneTodayMap.get(channel.id) || 0;
    const failedToday = failedTodayMap.get(channel.id) || 0;
    const stats = latestStatsMap.get(channel.id);

    if (!channel.uploadEnabled) {
      return {
        id: channel.id,
        name: channel.name,
        uploadEnabled: false,
        uploadStartHour: channel.uploadStartHour,
        uploadEndHour: channel.uploadEndHour,
        uploadInterval: channel.uploadInterval,
        lastUpload: channel.lastUpload,
        viewsLast48Hours: stats?.viewsLast48Hours ?? null,
        revenueMonth: stats?.revenueMonth ?? null,
        uploadedToday,
        pendingCount,
        uploadingCount,
        failedToday,
        nextUploadAt: null,
        secondsUntilNextUpload: null,
        etaToDispatchSeconds: null,
        statusLabel: "Đã tắt",
        statusTone: "neutral",
      };
    }

    const nextUploadAtDate = getNextUploadAt(
      now,
      channel.uploadStartHour,
      channel.uploadEndHour,
      channel.uploadInterval,
      channel.lastUpload
    );
    const secondsUntilNextUpload = Math.max(
      0,
      Math.ceil((nextUploadAtDate.getTime() - now.getTime()) / 1000)
    );
    const inSchedule = isInSchedule(now, channel.uploadStartHour, channel.uploadEndHour);
    const queueEta = etaByChannel.get(channel.id) ?? null;
    const etaToDispatchSeconds =
      queueEta === null
        ? null
        : Math.max(queueEta, secondsUntilNextUpload > 0 ? secondsUntilNextUpload : 0);

    let statusLabel = "Sẵn sàng";
    let statusTone: ChannelItem["statusTone"] = "success";

    if (uploadingCount > 0) {
      statusLabel = "Đang upload";
      statusTone = "info";
    } else if (pendingCount === 0) {
      statusLabel = inSchedule ? "Chờ video mới" : "Ngoài khung giờ";
      statusTone = "neutral";
    } else if (!inSchedule) {
      statusLabel = "Đợi tới khung giờ";
      statusTone = "warning";
    } else if (secondsUntilNextUpload > 0) {
      statusLabel = "Đang cooldown";
      statusTone = "warning";
    }

    return {
      id: channel.id,
      name: channel.name,
      uploadEnabled: true,
      uploadStartHour: channel.uploadStartHour,
      uploadEndHour: channel.uploadEndHour,
      uploadInterval: channel.uploadInterval,
      lastUpload: channel.lastUpload,
      viewsLast48Hours: stats?.viewsLast48Hours ?? null,
      revenueMonth: stats?.revenueMonth ?? null,
      uploadedToday,
      pendingCount,
      uploadingCount,
      failedToday,
      nextUploadAt: nextUploadAtDate.toISOString(),
      secondsUntilNextUpload,
      etaToDispatchSeconds:
        uploadingCount > 0
          ? 0
          : pendingCount > 0
            ? etaToDispatchSeconds
            : null,
      statusLabel,
      statusTone,
    };
  });

  const lastSeen = userSettings?.agentLastSeen ?? null;
  const offlineForSeconds = lastSeen
    ? Math.floor((now.getTime() - new Date(lastSeen).getTime()) / 1000)
    : null;
  const online = offlineForSeconds !== null ? offlineForSeconds < 90 : false;

  return NextResponse.json({
    generatedAt: now.toISOString(),
    agent: {
      online,
      status: userSettings?.agentStatus ?? null,
      activeUploads: userSettings?.agentActiveUploads ?? 0,
      message: userSettings?.agentMessage ?? null,
      version: userSettings?.agentVersion ?? null,
      lastSeen,
      offlineForSeconds,
    },
    channels: channelItems,
  });
}
