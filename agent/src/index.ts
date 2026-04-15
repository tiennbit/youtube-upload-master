#!/usr/bin/env node
/**
 * TubeFlow Desktop Agent — Main Entry Point
 * Parallel multi-channel agent that:
 * - Scans Nextcloud folders for new videos
 * - Creates upload jobs automatically
 * - Uploads to YouTube via GoLogin + Puppeteer
 * - Deletes source files after successful upload
 */
import readline from 'readline';
import { loadConfig, saveConfig } from './config';
import { ApiClient, JobData } from './api-client';
import { uploadVideo } from './services/youtube.service';
import { downloadFromNextcloud, cleanupDownload } from './services/downloader.service';
import { scanChannelFolder, deleteFromNextcloud, deleteVideoBundle, deleteVideoBundleWithStats } from './services/scanner.service';
import { stopAll, getActiveProfileIds } from './services/gologin.service';
import { scrapeChannelStats } from './services/youtube-analytics.service';

const AGENT_VERSION = '1.0.0';
const POLL_INTERVAL = 30000; // 30 seconds
const SCAN_INTERVAL = 120000; // 2 minutes
const DEFAULT_STATS_INTERVAL = 2 * 60 * 60 * 1000; // 2 hours
const CLEANUP_INTERVAL = 24 * 60 * 60 * 1000; // 24 hours
const RETENTION_HOURS = 72;
const CLEANUP_BATCH_SIZE = 200;
const CLEANUP_FILE_CONCURRENCY = 4;

function log(msg: string) {
  const time = new Date().toLocaleTimeString('vi-VN');
  console.log(`[${time}] ${msg}`);
}

function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function setup(): Promise<{ serverUrl: string; agentToken: string }> {
  console.log('\n╔══════════════════════════════════════╗');
  console.log('║     🚀 TubeFlow Desktop Agent        ║');
  console.log('║     Phiên bản: ' + AGENT_VERSION + '                 ║');
  console.log('╚══════════════════════════════════════╝\n');

  const existing = loadConfig();
  if (existing) {
    console.log(`📋 Cấu hình hiện tại:`);
    console.log(`   Server: ${existing.serverUrl}`);
    console.log(`   Token:  ${existing.agentToken.slice(0, 8)}...`);
    const use = await prompt('\nDùng cấu hình này? (Y/n): ');
    if (use.toLowerCase() !== 'n') {
      return existing;
    }
  }

  console.log('📝 Thiết lập cấu hình mới:\n');
  const serverUrl = await prompt('Server URL (ví dụ: https://tubeflow.com): ');
  const agentToken = await prompt('Agent Token (copy từ web dashboard): ');

  if (!serverUrl || !agentToken) {
    console.error('❌ Server URL và Agent Token là bắt buộc!');
    process.exit(1);
  }

  const config = { serverUrl, agentToken };
  saveConfig(config);
  return config;
}

// Track per-channel last upload time to respect intervals
const channelLastUpload = new Map<number, number>();
const activeUploads = new Set<number>(); // channelIds currently uploading

async function processJob(
  api: ApiClient,
  job: JobData,
  settings: {
    gologinToken: string | null;
    nextcloudUrl: string | null;
    nextcloudUsername: string | null;
    nextcloudPassword: string | null;
    maxConcurrent: number;
    autoUploadEnabled: boolean;
  } | null
) {
  const { channel } = job;
  // Note: activeUploads.add() is now called in main loop BEFORE processJob
  // to prevent race condition. We still add here as safety net.
  activeUploads.add(channel.id);

  // Handle CHECK_LOGIN jobs (test if GoLogin profile is logged into YouTube)
  if (job.title.startsWith('__CHECK_LOGIN__')) {
    log(`🔑 Check Login: Channel "${channel.name}"`);
    if (!channel.gologinProfileId || !settings?.gologinToken) {
      await api.reportResult(job.id, 'FAILED', 'Thiếu GoLogin profile hoặc token');
      activeUploads.delete(channel.id);
      return;
    }
    try {
      const { startProfile, stopProfileNoCommit } = await import('./services/gologin.service');
      const { browser } = await startProfile(channel.gologinProfileId, settings.gologinToken, false);
      const page = await browser.newPage();
      await page.goto('https://studio.youtube.com', { waitUntil: 'networkidle2', timeout: 60000 });
      await new Promise((r) => setTimeout(r, 5000));
      const content = await page.evaluate(() => document.body?.innerText || '');
      const isLoggedIn = !content.includes('Sign in') && !content.includes('Đăng nhập') &&
                          !content.includes('Switch account') && content.includes('Dashboard');
      await page.close();
      await stopProfileNoCommit(channel.gologinProfileId);

      if (isLoggedIn) {
        log(`✅ Channel "${channel.name}": Đã đăng nhập YouTube`);
        await api.reportResult(job.id, 'DONE');
      } else {
        log(`❌ Channel "${channel.name}": Chưa đăng nhập YouTube`);
        await api.reportResult(job.id, 'FAILED', 'Chưa đăng nhập YouTube. Mở GoLogin → chạy profile → đăng nhập YouTube.');
      }
    } catch (err: any) {
      log(`❌ Check login lỗi: ${err.message}`);
      await api.reportResult(job.id, 'FAILED', err.message);
    }
    activeUploads.delete(channel.id);
    return;
  }

  // Handle OPEN_PROFILE jobs (open GoLogin profile for manual inspection — keep open)
  if (job.title.startsWith('__OPEN_PROFILE__')) {
    log(`🌐 Mở Profile: Channel "${channel.name}"`);
    if (!channel.gologinProfileId || !settings?.gologinToken) {
      await api.reportResult(job.id, 'FAILED', 'Thiếu GoLogin profile hoặc token');
      activeUploads.delete(channel.id);
      return;
    }
    try {
      const { startProfile } = await import('./services/gologin.service');
      const { browser } = await startProfile(channel.gologinProfileId, settings.gologinToken, false);
      const page = await browser.newPage();
      await page.goto('https://studio.youtube.com', { waitUntil: 'networkidle2', timeout: 60000 });
      log(`✅ Profile đã mở cho channel "${channel.name}" — YouTube Studio đang hiển thị`);
      log(`   ⏳ Profile sẽ tự đóng sau 5 phút hoặc khi bạn dừng agent`);
      await api.reportResult(job.id, 'DONE');

      // Keep profile open for 5 minutes for manual inspection
      await new Promise((r) => setTimeout(r, 300000));

      try {
        const { stopProfileNoCommit } = await import('./services/gologin.service');
        await page.close();
        await stopProfileNoCommit(channel.gologinProfileId);
        log(`🔒 Profile channel "${channel.name}" đã được đóng`);
      } catch {
        // Profile may have been closed manually
      }
    } catch (err: any) {
      log(`❌ Mở profile lỗi: ${err.message}`);
      await api.reportResult(job.id, 'FAILED', err.message);
    }
    activeUploads.delete(channel.id);
    return;
  }

  log(`📹 Job #${job.id}: "${job.title}"`);
  log(`   Channel: ${channel.name}`);
  log(`   Profile: ${channel.gologinProfileId || 'N/A'}`);

  // Re-check channel status from server (user may have disabled while job was queued)
  try {
    const channels = await api.getChannels();
    const freshChannel = channels.find((c: any) => c.id === channel.id);
    if (freshChannel && !freshChannel.uploadEnabled) {
      log(`⏹️ Channel "${channel.name}" đã bị TẮT trên web — bỏ qua job`);
      await api.reportResult(job.id, 'FAILED', 'Channel disabled by user');
      activeUploads.delete(channel.id);
      return;
    }
  } catch {
    // If check fails, continue with upload (fail-open)
  }

  // Check upload schedule (uploadStartHour ~ uploadEndHour)
  const currentHour = new Date().getHours();
  const startHour = channel.uploadStartHour ?? 0;
  const endHour = channel.uploadEndHour ?? 24;
  if (startHour !== endHour) {
    let inSchedule: boolean;
    if (startHour < endHour) {
      // e.g. 8 ~ 22: active from 8:00 to 21:59
      inSchedule = currentHour >= startHour && currentHour < endHour;
    } else {
      // e.g. 22 ~ 6: active from 22:00 to 05:59 (overnight)
      inSchedule = currentHour >= startHour || currentHour < endHour;
    }
    if (!inSchedule) {
      log(`⏰ Channel "${channel.name}": ngoài giờ hẹn (${startHour}h - ${endHour}h), hiện tại ${currentHour}h — bỏ qua`);
      activeUploads.delete(channel.id);
      return;
    }
  }

  // Validate GoLogin profile
  if (!channel.gologinProfileId) {
    log(`❌ Channel "${channel.name}" chưa có GoLogin profile`);
    await api.reportResult(job.id, 'FAILED', 'Channel chưa có GoLogin profile');
    activeUploads.delete(channel.id);
    return;
  }

  if (!settings?.gologinToken) {
    log(`❌ GoLogin Token chưa được cấu hình`);
    await api.reportResult(job.id, 'FAILED', 'GoLogin Token chưa được cấu hình');
    activeUploads.delete(channel.id);
    return;
  }

  // ============================================================
  // UNIFIED SCAN → LOCK → DOWNLOAD LOOP
  // 
  // Race condition root cause: Between scanning Nextcloud (PROPFIND)
  // and downloading a file, another channel can delete it → 404.
  // No amount of locking can fix this because the lock and download
  // are separate network calls.
  //
  // Solution: Merge lock + download into ONE retry loop.
  // If download returns 404 → file was taken by another channel →
  // permanently lock it and silently try the next file.
  // ============================================================
  let uploadTitle = job.title;
  let uploadDescription = job.description || '';
  let uploadVisibility = (job.visibility as 'public' | 'unlisted' | 'private') || 'public';
  let remoteVideoPath = job.remoteVideoPath;
  let remoteThumbnailPath = job.remoteThumbnailPath;
  let remoteMetadataPath: string | null = null;
  let videoPath = job.videoPath;
  let downloadedFile: string | null = null;

  if (!videoPath && channel.nextcloudFolder && settings.nextcloudUrl && settings.nextcloudUsername && settings.nextcloudPassword) {
    try {
      log(`🔄 Re-scan Nextcloud trước upload: ${channel.nextcloudFolder}`);
      const entries = await scanChannelFolder(
        settings.nextcloudUrl,
        settings.nextcloudUsername,
        settings.nextcloudPassword,
        channel.nextcloudFolder,
        30 // Only download 30 newest metadata (need 15 candidates + margin)
      );

      if (entries.length === 0) {
        log(`⚠️ Không còn video nào trên Nextcloud cho channel "${channel.name}"`);
        await api.reportResult(job.id, 'FAILED', 'No videos available on Nextcloud');
        activeUploads.delete(channel.id);
        return;
      }

      const tryCount = Math.min(entries.length, 15);
      log(`🔍 Scan-Lock-Download: thử ${tryCount} file mới nhất (${entries.length} tổng)...`);
      let foundFile = false;

      for (let i = entries.length - 1; i >= entries.length - tryCount; i--) {
        const entry = entries[i];
        const fileName = entry.videoPath.split('/').pop() || entry.videoPath;

        // Step 1: Try to lock this file
        const locked = await api.lockFile(entry.videoPath, channel.id);
        if (!locked) {
          continue; // Locked by another channel, try next
        }

        // Step 2: Try to download the locked file
        try {
          log(`☁️ Tải video: ${fileName}`);
          downloadedFile = await downloadFromNextcloud(
            settings.nextcloudUrl,
            settings.nextcloudUsername,
            settings.nextcloudPassword,
            entry.videoPath
          );

          // SUCCESS: File downloaded! Set metadata and break out.
          videoPath = downloadedFile;
          uploadTitle = entry.title;
          uploadDescription = entry.description;
          uploadVisibility = (entry.visibility as 'public' | 'unlisted' | 'private') || 'public';
          remoteVideoPath = entry.videoPath;
          remoteThumbnailPath = entry.thumbnailPath;
          remoteMetadataPath = entry.metadataPath;
          foundFile = true;

          log(`📌 ĐÃ TẢI THÀNH CÔNG: "${entry.title}"`);
          break;

        } catch (dlErr: any) {
          if (dlErr.message && dlErr.message.includes('404')) {
            // 404 = File was already taken and deleted by another channel.
            // Mark as permanently locked so no one else tries either.
            log(`⏭️ File đã bị xoá bởi kênh khác (404): ${fileName} — thử file tiếp...`);
            await api.unlockFile(entry.videoPath, channel.id, true);
            continue; // Try next file
          }
          // Non-404 error (network, server down, etc.) — real failure
          log(`❌ Lỗi tải video: ${dlErr.message}`);
          await api.unlockFile(entry.videoPath, channel.id, false);
          await api.reportResult(job.id, 'FAILED', `Download failed: ${dlErr.message}`);
          activeUploads.delete(channel.id);
          return;
        }
      }

      if (!foundFile) {
        log(`⚠️ Tất cả ${tryCount} file đều đang bị xử lý hoặc đã xoá. Chờ lượt sau.`);
        await api.reportResult(job.id, 'FAILED', 'All files locked or already processed by other channels');
        activeUploads.delete(channel.id);
        return;
      }

    } catch (err: any) {
      log(`⚠️ Scan error: ${err.message} — thử dùng job data gốc`);
    }
  }

  // Fallback: If video is on Nextcloud but scan loop didn't run (no nextcloudFolder set)
  const effectiveRemoteVideo = remoteVideoPath || job.remoteVideoPath;
  if (!videoPath && effectiveRemoteVideo && settings.nextcloudUrl && settings.nextcloudUsername && settings.nextcloudPassword) {
    const lockAcquired = await api.lockFile(effectiveRemoteVideo, channel.id);
    if (!lockAcquired) {
      log(`🔒 File đã bị lock bởi kênh khác — bỏ qua job này`);
      await api.reportResult(job.id, 'FAILED', 'File locked by another channel');
      activeUploads.delete(channel.id);
      return;
    }
    try {
      downloadedFile = await downloadFromNextcloud(
        settings.nextcloudUrl, settings.nextcloudUsername, settings.nextcloudPassword,
        effectiveRemoteVideo
      );
      videoPath = downloadedFile;
    } catch (err: any) {
      await api.unlockFile(effectiveRemoteVideo, channel.id, err.message?.includes('404'));
      if (!err.message?.includes('404')) {
        await api.reportResult(job.id, 'FAILED', `Download failed: ${err.message}`);
      }
      activeUploads.delete(channel.id);
      return;
    }
  }

  if (!videoPath) {
    log(`❌ Không có video path và không thể tải từ Nextcloud`);
    await api.reportResult(job.id, 'FAILED', 'No video path available');
    activeUploads.delete(channel.id);
    return;
  }

  // Download thumbnail if remote
  const effectiveRemoteThumb = remoteThumbnailPath || job.remoteThumbnailPath;
  let thumbPath = job.thumbPath;
  if (!thumbPath && effectiveRemoteThumb && settings.nextcloudUrl && settings.nextcloudUsername && settings.nextcloudPassword) {
    try {
      thumbPath = await downloadFromNextcloud(
        settings.nextcloudUrl,
        settings.nextcloudUsername,
        settings.nextcloudPassword,
        effectiveRemoteThumb
      );
    } catch {
      log(`⚠️ Không thể tải thumbnail, tiếp tục upload...`);
    }
  }

  // Xóa files trên Nextcloud NGAY SAU KHI DOWNLOAD (giải phóng storage, tránh upload trùng)
  const cleanupVideoPath = effectiveRemoteVideo;
  let nextcloudCleaned = false;
  if (cleanupVideoPath && settings.nextcloudUrl && settings.nextcloudUsername && settings.nextcloudPassword) {
    try {
      const videoBase = cleanupVideoPath.replace(/\.[^.]+$/, '');
      const baseName = videoBase.split('/').pop() || '';
      const folderPrefix = videoBase.replace(/\/videos\/[^/]+$/, '');

      await deleteVideoBundle(
        settings.nextcloudUrl,
        settings.nextcloudUsername,
        settings.nextcloudPassword,
        {
          videoPath: cleanupVideoPath,
          thumbnailPath: effectiveRemoteThumb || `${folderPrefix}/thumbnails/${baseName}.png`,
          metadataPath: remoteMetadataPath || `${folderPrefix}/metadata/${baseName}.json`,
        }
      );
      log(`🗑️ Đã xóa bộ video trên Nextcloud (trước upload): ${baseName}`);
      
      // PERMANENT LOCK: Immediately tell the server this file is deleted.
      // This sets lock expiry to the Year 2099, preventing any 10-minute TTL expiry 
      // from letting other channels grab this file while we are uploading it.
      await api.unlockFile(cleanupVideoPath, channel.id, true);
      log(`🔒 File lock vĩnh viễn (đã xoá), ngăn các kênh khác lấy file gây 404.`);
      
      nextcloudCleaned = true;
    } catch (err: any) {
      log(`⚠️ Lỗi xóa files trên Nextcloud: ${err.message}`);
    }
  }

  // Upload to YouTube
  try {
    const result = await uploadVideo(channel.gologinProfileId, settings.gologinToken, {
      videoPath,
      title: uploadTitle,
      description: uploadDescription,
      thumbnailPath: thumbPath || undefined,
      visibility: uploadVisibility,
      studioUrl: channel.studioUrl || undefined,
    });

    if (result.success) {
      log(`✅ Upload hoàn thành: "${uploadTitle}"${result.videoId ? ` → https://youtu.be/${result.videoId}` : ''}`);
      await api.reportResult(job.id, 'DONE', undefined, result.videoUrl, result.videoId);
      channelLastUpload.set(channel.id, Date.now());

      // Auto-save detected studioUrl for this channel (prevents wrong-channel on future uploads)
      if (result.detectedStudioUrl && !channel.studioUrl) {
        log(`📎 Auto-detected Studio URL: ${result.detectedStudioUrl}`);
        await api.updateChannelStudioUrl(channel.id, result.detectedStudioUrl);
      }

      if (nextcloudCleaned) {
        log(`   📁 Nextcloud đã được dọn dẹp từ trước upload`);
      }
    } else {
      log(`❌ Upload thất bại: ${result.message}`);
      await api.reportResult(job.id, 'FAILED', result.message);
    }
  } catch (err: any) {
    log(`❌ Lỗi không mong đợi: ${err.message}`);
    await api.reportResult(job.id, 'FAILED', err.message);
  } finally {
    // Cleanup downloaded files
    if (downloadedFile) cleanupDownload(downloadedFile);
    if (thumbPath && thumbPath !== job.thumbPath) cleanupDownload(thumbPath);
    // Release file lock ONLY IF we didn't delete it (i.e. download failed).
    // If deleted, it was already permanently locked earlier.
    const effectiveRemoteVideoFinal = remoteVideoPath || job.remoteVideoPath;
    if (effectiveRemoteVideoFinal && !nextcloudCleaned) {
      await api.unlockFile(effectiveRemoteVideoFinal, channel.id, false);
    }
    activeUploads.delete(channel.id);
  }
}

/**
 * Collect YouTube analytics stats for all channels.
 * Opens each GoLogin profile sequentially, scrapes YouTube Studio, reports to server.
 * Only runs when agent is idle (no active uploads).
 */
async function collectAllChannelStats(
  api: ApiClient,
  gologinToken: string | null
) {
  if (!gologinToken) {
    log('⚠️ Stats: GoLogin token chưa cấu hình — bỏ qua');
    return;
  }

  try {
    const channels = await api.getChannels();
    if (!channels?.length) return;

    const eligibleChannels = channels.filter(
      (ch) => ch.gologinProfileId && ch.uploadEnabled
    );
    if (eligibleChannels.length === 0) return;

    log(`📊 Thu thập stats cho ${eligibleChannels.length} kênh...`);

    const allStats = [];

    for (const ch of eligibleChannels) {
      // Abort if an upload has started while we're scraping
      if (activeUploads.size > 0) {
        log('📊 Upload bắt đầu — dừng thu thập stats');
        break;
      }

      try {
        const stats = await scrapeChannelStats(
          ch.id,
          ch.gologinProfileId!,
          gologinToken,
          // studioUrl not available from getChannels(), but scraper handles it
        );
        allStats.push(stats);
      } catch (err: any) {
        log(`⚠️ Stats error for "${ch.name}": ${err.message}`);
      }

      // Small delay between channels
      await new Promise((r) => setTimeout(r, 3000));
    }

    // Report all stats to server
    if (allStats.length > 0) {
      const result = await api.reportChannelStats(allStats);
      log(`📊 Stats reported: ${result.saved}/${allStats.length} kênh`);
    }
  } catch (err: any) {
    log(`⚠️ Stats collection error: ${err.message}`);
  }
}

/**
 * Scan Nextcloud folders for all channels — ensure at least 1 PENDING job per channel
 * The agent's re-scan logic will pick the actual newest video at upload time.
 */
async function scanForNewVideos(api: ApiClient) {
  try {
    const settings = await api.getSettings();

    if (!settings?.nextcloudUrl || !settings?.nextcloudUsername || !settings?.nextcloudPassword) return;
    if (!settings?.autoUploadEnabled) return;

    // Fetch channels list
    const channelsRes = await api.getChannels();
    if (!channelsRes?.length) return;

    for (const channel of channelsRes) {
      if (!channel.nextcloudFolder || !channel.uploadEnabled) continue;

      try {
        const entries = await scanChannelFolder(
          settings.nextcloudUrl,
          settings.nextcloudUsername,
          settings.nextcloudPassword,
          channel.nextcloudFolder,
          20 // Only download 20 newest metadata (only need 1 for job creation)
        );

        if (entries.length > 0) {
          // Only create 1 job (newest video) — agent will re-scan at upload time anyway
          const newest = entries[entries.length - 1];
          const files = [{
            videoPath: newest.videoPath,
            thumbnailPath: newest.thumbnailPath,
            metadataPath: newest.metadataPath,
            title: newest.title,
            description: newest.description,
            tags: newest.tags,
            visibility: newest.visibility,
          }];
          const result = await api.reportScannedFiles(channel.id, files);
          if (result.created > 0) {
            log(`📂 Channel "${channel.name}": tạo ${result.created} job mới từ Nextcloud (với metadata)`);
          }
        }
      } catch (err: any) {
        log(`⚠️ Scan lỗi cho channel "${channel.name}": ${err.message}`);
      }
    }
  } catch (err: any) {
    log(`⚠️ Scan error: ${err.message}`);
  }
}

function buildCleanupBundlePaths(candidate: {
  remoteVideoPath: string | null;
  remoteThumbnailPath: string | null;
}) {
  if (!candidate.remoteVideoPath) return null;
  const videoPath = candidate.remoteVideoPath;
  const videoBase = videoPath.replace(/\.[^.]+$/, '');
  const baseName = videoBase.split('/').pop() || '';
  const folderPrefix = videoBase.replace(/\/videos\/[^/]+$/, '');

  return {
    videoPath,
    thumbnailPath: candidate.remoteThumbnailPath || `${folderPrefix}/thumbnails/${baseName}.png`,
    metadataPath: `${folderPrefix}/metadata/${baseName}.json`,
  };
}

async function runRetentionCleanup(
  api: ApiClient,
  activeChannelIds: number[]
) {
  const startMs = Date.now();
  let candidateJobs = 0;
  let attemptedFiles = 0;
  let deletedFiles = 0;
  let failedFiles = 0;
  let deletedJobs = 0;
  let rounds = 0;
  const cleanedVideoPaths = new Set<string>();

  const settings = await api.getSettings();
  if (!settings?.nextcloudUrl || !settings.nextcloudUsername || !settings.nextcloudPassword) {
    log(`[Cleanup] Skip - Nextcloud is not configured`);
    return;
  }

  const cutoff = new Date(Date.now() - RETENTION_HOURS * 60 * 60 * 1000).toISOString();

  for (;;) {
    rounds += 1;
    const { candidates } = await api.getCleanupCandidates(
      cutoff,
      CLEANUP_BATCH_SIZE,
      activeChannelIds
    );
    if (candidates.length === 0) break;

    candidateJobs += candidates.length;
    const jobIds: number[] = [];

    for (let i = 0; i < candidates.length; i += CLEANUP_FILE_CONCURRENCY) {
      const chunk = candidates.slice(i, i + CLEANUP_FILE_CONCURRENCY);
      const chunkResults = await Promise.all(
        chunk.map(async (candidate) => {
          if (candidate.remoteVideoPath && cleanedVideoPaths.has(candidate.remoteVideoPath)) {
            return {
              attemptedFiles: 0,
              deletedFiles: 0,
              failedFiles: 0,
              jobId: candidate.id,
            };
          }

          const bundle = buildCleanupBundlePaths(candidate);
          if (!bundle) {
            return {
              attemptedFiles: 0,
              deletedFiles: 0,
              failedFiles: 0,
              jobId: candidate.id,
            };
          }
          const stats = await deleteVideoBundleWithStats(
            settings.nextcloudUrl!,
            settings.nextcloudUsername!,
            settings.nextcloudPassword!,
            bundle
          );
          if (candidate.remoteVideoPath) {
            cleanedVideoPaths.add(candidate.remoteVideoPath);
          }
          return { ...stats, jobId: candidate.id };
        })
      );

      for (const result of chunkResults) {
        attemptedFiles += result.attemptedFiles;
        deletedFiles += result.deletedFiles;
        failedFiles += result.failedFiles;
        jobIds.push(result.jobId);
      }
    }

    if (jobIds.length > 0) {
      deletedJobs += await api.deleteCleanupJobs(jobIds);
    }
  }

  const elapsedMs = Date.now() - startMs;
  log(
    `[Cleanup] ${JSON.stringify({
      retentionHours: RETENTION_HOURS,
      rounds,
      candidateJobs,
      attemptedFiles,
      deletedFiles,
      failedFiles,
      deletedJobs,
      elapsedMs,
    })}`
  );
}

async function main() {
  const config = await setup();
  const api = new ApiClient(config.serverUrl, config.agentToken);

  // Verify connection
  log('🔌 Kiểm tra kết nối server...');
  try {
    const version = await api.checkVersion();
    log(`✅ Kết nối thành công! Server version: ${version.latestVersion}`);

    if (version.latestVersion !== AGENT_VERSION) {
      log(`⚠️ Có phiên bản mới: ${version.latestVersion}. Phiên bản hiện tại: ${AGENT_VERSION}`);
    }
  } catch (err: any) {
    log(`❌ Không thể kết nối server: ${err.message}`);
    process.exit(1);
  }

  // Verify token
  try {
    await api.getSettings();
    log('✅ Agent Token hợp lệ');
  } catch (err: any) {
    log(`❌ ${err.message}`);
    process.exit(1);
  }

  // Pre-populate channelLastUpload from server data (survive restarts)
  try {
    const channels = await api.getChannels();
    for (const ch of channels) {
      if (ch.lastUpload) {
        const ts = new Date(ch.lastUpload).getTime();
        if (!isNaN(ts)) {
          channelLastUpload.set(ch.id, ts);
        }
      }
    }
    if (channelLastUpload.size > 0) {
      log(`📋 Loaded upload history: ${channelLastUpload.size} channels từ server`);
    }
  } catch (err: any) {
    log(`⚠️ Không thể load upload history: ${err.message}`);
  }

  log(`\n🤖 Agent đang chạy — poll mỗi ${POLL_INTERVAL / 1000}s`);
  log('   Nhấn Ctrl+C để dừng\n');

  // Trigger a restart heartbeat to clear out any stuck UPLOADING jobs globally
  // This helps the system self-heal from agent crashes or hard stops
  try {
    await api.sendHeartbeat({
      version: AGENT_VERSION,
      status: 'starting',
      activeUploads: 0,
      message: 'Khởi động agent... dọn dẹp job kẹt',
      isRestart: true
    });
  } catch (err) {}

  // Graceful shutdown
  let running = true;
  process.on('SIGINT', async () => {
    log('\n⏹️ Đang dừng agent...');
    running = false;
    await stopAll();
    process.exit(0);
  });

  let lastScan = 0;
  let lastStatsCollect = 0;
  let statsInterval = DEFAULT_STATS_INTERVAL;
  let lastCleanup = 0;
  let cleanupRunning = false;

  // Main polling loop
  while (running) {
    try {
      // Periodic retention cleanup (non-blocking)
      if (!cleanupRunning && Date.now() - lastCleanup > CLEANUP_INTERVAL) {
        cleanupRunning = true;
        const activeChannelIds = Array.from(activeUploads);
        runRetentionCleanup(api, activeChannelIds)
          .catch((err: any) => {
            log(`[Cleanup] Error: ${err.message}`);
          })
          .finally(() => {
            lastCleanup = Date.now();
            cleanupRunning = false;
          });
      }

      // Send heartbeat
      const currentStatus = activeUploads.size > 0 ? 'uploading' : 'idle';
      const statusMsg = activeUploads.size > 0
        ? `Đang upload ${activeUploads.size} channel`
        : 'Sẵn sàng';
      await api.sendHeartbeat({
        version: AGENT_VERSION,
        status: currentStatus,
        activeUploads: activeUploads.size,
        message: statusMsg,
        activeProfiles: getActiveProfileIds(),
      });

      // Periodic Nextcloud scan
      if (Date.now() - lastScan > SCAN_INTERVAL) {
        await api.sendHeartbeat({
          version: AGENT_VERSION,
          status: 'scanning',
          activeUploads: activeUploads.size,
          message: 'Đang quét Nextcloud...',
          activeProfiles: getActiveProfileIds(),
        });
        await scanForNewVideos(api);
        lastScan = Date.now();
      }

      // Periodic YouTube analytics stats collection (only when idle) - TEMPORARILY DISABLED
      if (false && activeUploads.size === 0 && Date.now() - lastStatsCollect > statsInterval) {
        const settings = await api.getSettings();
        const gologinToken = settings?.gologinToken || null;
        // Update statsInterval from server settings if available
        const statsSettings = await api.getStatsSettings();
        if (statsSettings?.statsCollectInterval) {
          statsInterval = statsSettings.statsCollectInterval * 60 * 1000;
        }
        await api.sendHeartbeat({
          version: AGENT_VERSION,
          status: 'collecting_stats',
          activeUploads: 0,
          message: 'Đang thu thập analytics...',
          activeProfiles: getActiveProfileIds(),
        });
        await collectAllChannelStats(api, gologinToken);
        lastStatsCollect = Date.now();
      }

      // Compute which channels to skip: currently uploading OR recently uploaded (cooldown)
      const skipChannelIds: number[] = [];
      for (const chId of activeUploads) {
        skipChannelIds.push(chId);
      }
      for (const [chId, lastTime] of channelLastUpload.entries()) {
        if (skipChannelIds.includes(chId)) continue;
        const elapsed = Date.now() - lastTime;
        if (elapsed < 10 * 60 * 1000) { // Conservative 10min threshold — real interval checked below
          skipChannelIds.push(chId);
        }
      }

      const response = await api.fetchJob(skipChannelIds.length > 0 ? skipChannelIds : undefined);
      const settings = response.settings;
      const maxConcurrent = settings?.maxConcurrent ?? 3;

      if (response.job && activeUploads.size < maxConcurrent) {
        const job = response.job;
        const channelId = job.channel.id;

        // Double-check: skip if channel is already uploading
        if (activeUploads.has(channelId)) {
          log(`⏭️ Channel "${job.channel.name}" đang upload — bỏ qua`);
          await new Promise((r) => setTimeout(r, POLL_INTERVAL));
          continue;
        }

        // Informational per-channel interval check.
        // Dispatch gating is handled by server-side scheduler (pick-ahead window).
        const lastUploadTime = channelLastUpload.get(channelId) || 0;
        const intervalMs = (job.channel.uploadInterval || 30) * 60 * 1000;
        const elapsed = Date.now() - lastUploadTime;
        const remainingMs = intervalMs - elapsed;

        if (remainingMs > 0 && lastUploadTime > 0) {
          const remaining = Math.ceil(remainingMs / 60000);
          log(`⏳ Prefetch: "${job.channel.name}" còn ~${remaining}ph tới cooldown mốc, bắt đầu chuẩn bị upload`);
        }

        // ★ Add to activeUploads BEFORE starting async processJob
        activeUploads.add(channelId);

        // Wrap processJob with 25-minute timeout to prevent infinite hangs
        // Phase 1 (upload): up to 8 min + Phase 2 (checks): up to 8 min + overhead = ~20 min max
        const UPLOAD_TIMEOUT = 25 * 60 * 1000; // 25 minutes
        const timeoutPromise = new Promise<void>((_, reject) =>
          setTimeout(() => reject(new Error('Upload timeout (25 min)')), UPLOAD_TIMEOUT)
        );

        Promise.race([
          processJob(api, job, settings || null),
          timeoutPromise,
        ]).catch(async (err) => {
          log(`❌ Job #${job.id} error: ${err.message}`);
          try { await api.reportResult(job.id, 'FAILED', err.message); } catch {}
          activeUploads.delete(channelId);
        });

        // ★ Stagger delay: wait 3 minutes between starting concurrent jobs
        // This creates a pipeline effect:
        //   t=0   Job#1: download + navigate (no YouTube bandwidth)
        //   t=3m  Job#2: download + navigate | Job#1: uploading to YouTube
        //   t=6m  Job#3: download | Job#2: uploading | Job#1: nearly done
        // → At most ~2 concurrent YouTube uploads at any time
        const STAGGER_DELAY = 3 * 60 * 1000; // 3 minutes
        log(`🔄 Job dispatched: ${job.channel.name} — stagger ${STAGGER_DELAY / 1000}s trước job tiếp`);
        await new Promise((r) => setTimeout(r, STAGGER_DELAY));
        continue; // Poll for next job
      }

      // Wait before next poll
      await new Promise((r) => setTimeout(r, POLL_INTERVAL));
    } catch (err: any) {
      log(`⚠️ Poll error: ${err.message}`);
      await new Promise((r) => setTimeout(r, POLL_INTERVAL));
    }
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
