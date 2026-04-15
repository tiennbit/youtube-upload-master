/**
 * Nextcloud Scanner — Scan channel folders for new videos via WebDAV
 * 
 * Expected folder structure:
 *   {nextcloudFolder}/
 *   ├── metadata/    — JSON files with title, description, tags
 *   ├── thumbnails/  — PNG images matching metadata base name
 *   └── videos/      — MP4 files matching metadata base name
 * 
 * Naming convention: {prefix}_{id}_{timestamp}.{ext}
 * Base name is shared across metadata/thumbnails/videos.
 */
import axios from 'axios';
import path from 'path';

const VIDEO_EXTENSIONS = ['.mp4', '.mkv', '.avi', '.mov', '.webm'];
const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp'];

interface RemoteFile {
  name: string;
  remotePath: string;
  size: number;
  lastModified: string;
}

export interface VideoEntry {
  /** Base name without extension (e.g. "news_10077_1775384229103") */
  baseName: string;
  /** Full metadata from JSON */
  title: string;
  description: string;
  tags: string[];
  visibility: string;
  /** Remote paths */
  videoPath: string;
  thumbnailPath: string | null;
  metadataPath: string;
  /** Size of video in bytes */
  videoSize: number;
  /** When metadata was created */
  createdAt: string;
}

/**
 * WebDAV PROPFIND to list files in a folder
 */
async function listFolder(
  baseUrl: string,
  username: string,
  password: string,
  folderPath: string
): Promise<RemoteFile[]> {
  const encodedFolder = folderPath
    .replace(/^\//, '')
    .split('/')
    .map((seg) => encodeURIComponent(seg))
    .join('/');
  const davUrl = `${baseUrl}/remote.php/dav/files/${encodeURIComponent(username)}/${encodedFolder}`;

  const response = await axios({
    method: 'PROPFIND',
    url: davUrl,
    auth: { username, password },
    headers: { Depth: '1', 'Content-Type': 'application/xml' },
    data: `<?xml version="1.0" encoding="UTF-8"?>
<d:propfind xmlns:d="DAV:" xmlns:oc="http://owncloud.org/ns">
  <d:prop>
    <d:displayname/>
    <d:getcontentlength/>
    <d:getlastmodified/>
    <d:getcontenttype/>
  </d:prop>
</d:propfind>`,
    timeout: 30000,
  });

  const files: RemoteFile[] = [];
  const xml = response.data as string;
  const responses = xml.split(/<d:response>/i).slice(1);

  for (const entry of responses) {
    const hrefMatch = entry.match(/<d:href>([^<]+)<\/d:href>/i);
    if (!hrefMatch) continue;

    const href = decodeURIComponent(hrefMatch[1]);
    const fileName = path.basename(href);
    if (!fileName || fileName === folderPath.split('/').pop()) continue;

    const sizeMatch = entry.match(/<d:getcontentlength>(\d+)<\/d:getcontentlength>/i);
    const dateMatch = entry.match(/<d:getlastmodified>([^<]+)<\/d:getlastmodified>/i);

    files.push({
      name: fileName,
      remotePath: `${folderPath}/${fileName}`,
      size: sizeMatch ? parseInt(sizeMatch[1]) : 0,
      lastModified: dateMatch ? dateMatch[1] : '',
    });
  }

  return files;
}

/**
 * Download and parse a metadata JSON file
 */
async function downloadMetadataJSON(
  baseUrl: string,
  username: string,
  password: string,
  remotePath: string
): Promise<Record<string, any> | null> {
  const encodedPath = remotePath
    .replace(/^\//, '')
    .split('/')
    .map((seg) => encodeURIComponent(seg))
    .join('/');
  const davUrl = `${baseUrl}/remote.php/dav/files/${encodeURIComponent(username)}/${encodedPath}`;
  try {
    const res = await axios.get(davUrl, {
      auth: { username, password },
      timeout: 10000,
    });
    return res.data;
  } catch {
    return null;
  }
}

/**
 * Scan a channel folder using the metadata-first approach.
 * 
 * 1. List metadata/*.json files
 * 2. For each JSON, parse title/description/tags
 * 3. Map to corresponding video and thumbnail by base name
 * 4. Return VideoEntry[] ready to create upload jobs
 */
export async function scanChannelFolder(
  nextcloudUrl: string,
  username: string,
  password: string,
  channelFolder: string
): Promise<VideoEntry[]> {
  const baseUrl = nextcloudUrl.replace(/\/$/, '');
  const cleanFolder = channelFolder.trim().replace(/^\//, '').replace(/\/$/, '');

  console.log(`[Scanner] Quét channel folder: ${cleanFolder}`);

  // Step 1: List metadata JSON files
  const metadataFolder = `${cleanFolder}/metadata`;
  let metaFiles: RemoteFile[];
  try {
    metaFiles = await listFolder(baseUrl, username, password, metadataFolder);
  } catch (err: any) {
    console.log(`[Scanner] ⚠️ Không tìm thấy metadata/ folder, dùng fallback`);
    // Fallback: scan videos/ directly (old behavior)
    return scanNextcloudFolder(nextcloudUrl, username, password, channelFolder);
  }

  const jsonFiles = metaFiles.filter(f => f.name.endsWith('.json'));
  console.log(`[Scanner] Tìm thấy ${jsonFiles.length} metadata files`);

  if (jsonFiles.length === 0) return [];

  // Step 2: List video and thumbnail files for matching
  let videoFiles: RemoteFile[] = [];
  let thumbFiles: RemoteFile[] = [];

  try {
    videoFiles = await listFolder(baseUrl, username, password, `${cleanFolder}/videos`);
    videoFiles = videoFiles.filter(f => VIDEO_EXTENSIONS.includes(path.extname(f.name).toLowerCase()));
  } catch {
    console.log(`[Scanner] ⚠️ Không tìm thấy videos/ folder`);
  }

  try {
    thumbFiles = await listFolder(baseUrl, username, password, `${cleanFolder}/thumbnails`);
    thumbFiles = thumbFiles.filter(f => IMAGE_EXTENSIONS.includes(path.extname(f.name).toLowerCase()));
  } catch {
    console.log(`[Scanner] ⚠️ Không tìm thấy thumbnails/ folder`);
  }

  // Build lookup maps by base name (without extension)
  const videoMap = new Map<string, RemoteFile>();
  for (const v of videoFiles) {
    const base = path.basename(v.name, path.extname(v.name));
    videoMap.set(base, v);
  }

  const thumbMap = new Map<string, RemoteFile>();
  for (const t of thumbFiles) {
    const base = path.basename(t.name, path.extname(t.name));
    thumbMap.set(base, t);
  }

  // Step 3: Parse each metadata JSON → build VideoEntry
  const entries: VideoEntry[] = [];

  // Process in batches of 10 to avoid overwhelming the server
  const BATCH_SIZE = 10;
  for (let i = 0; i < jsonFiles.length; i += BATCH_SIZE) {
    const batch = jsonFiles.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(
      batch.map(async (metaFile) => {
        const baseName = path.basename(metaFile.name, '.json');
        const video = videoMap.get(baseName);

        // Skip if no matching video file
        if (!video) {
          return null;
        }

        // Download and parse JSON
        const meta = await downloadMetadataJSON(baseUrl, username, password, metaFile.remotePath);
        if (!meta) return null;

        const thumb = thumbMap.get(baseName);

        return {
          baseName,
          title: meta.title || baseName.replace(/[_-]/g, ' '),
          description: meta.description || '',
          tags: Array.isArray(meta.tags) ? meta.tags : [],
          visibility: meta.visibility || 'public',
          videoPath: video.remotePath,
          thumbnailPath: thumb?.remotePath || null,
          metadataPath: metaFile.remotePath,
          videoSize: video.size,
          createdAt: meta.createdAt || meta.syncedAt || metaFile.lastModified,
        } as VideoEntry;
      })
    );

    for (const r of results) {
      if (r) entries.push(r);
    }
  }

  // Sort by createdAt (oldest first = upload in order)
  entries.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

  console.log(`[Scanner] ✅ ${entries.length} video sẵn sàng upload (có metadata + video file)`);
  return entries;
}

/**
 * Fallback: List video files in a Nextcloud folder directly (old behavior)
 * Used when metadata/ subfolder doesn't exist
 */
export async function scanNextcloudFolder(
  nextcloudUrl: string,
  username: string,
  password: string,
  folderPath: string
): Promise<VideoEntry[]> {
  const baseUrl = nextcloudUrl.replace(/\/$/, '');
  const cleanPath = folderPath.replace(/^\//, '').replace(/\/$/, '');

  // Try scanning videos/ subfolder first, then root
  let videoFolder = `${cleanPath}/videos`;
  let files: RemoteFile[];

  try {
    files = await listFolder(baseUrl, username, password, videoFolder);
  } catch {
    videoFolder = cleanPath;
    files = await listFolder(baseUrl, username, password, videoFolder);
  }

  const videoFiles = files.filter(f => VIDEO_EXTENSIONS.includes(path.extname(f.name).toLowerCase()));

  // Sort by lastModified ASC (oldest first)
  videoFiles.sort((a, b) => new Date(a.lastModified).getTime() - new Date(b.lastModified).getTime());

  console.log(`[Scanner] Tìm thấy ${videoFiles.length} video (fallback mode)`);

  return videoFiles.map(f => ({
    baseName: path.basename(f.name, path.extname(f.name)),
    title: path.basename(f.name, path.extname(f.name)).replace(/[_-]/g, ' ').trim(),
    description: '',
    tags: [],
    visibility: 'public',
    videoPath: f.remotePath,
    thumbnailPath: null,
    metadataPath: '',
    videoSize: f.size,
    createdAt: f.lastModified,
  }));
}

/**
 * Delete a file on Nextcloud via WebDAV
 */
export async function deleteFromNextcloud(
  nextcloudUrl: string,
  username: string,
  password: string,
  remotePath: string
): Promise<void> {
  const baseUrl = nextcloudUrl.replace(/\/$/, '');
  const cleanPath = remotePath.replace(/^\//, '');
  const encodedPath = cleanPath
    .replace(/^\//, '')
    .split('/')
    .map((seg) => encodeURIComponent(seg))
    .join('/');
  const davUrl = `${baseUrl}/remote.php/dav/files/${encodeURIComponent(username)}/${encodedPath}`;

  console.log(`[Scanner] Xóa file Nextcloud: ${cleanPath}`);

  await axios.delete(davUrl, {
    auth: { username, password },
    timeout: 30000,
  });

  console.log(`[Scanner] ✅ Đã xóa: ${path.basename(remotePath)}`);
}

/**
 * Delete all 3 files (video + thumbnail + metadata) after successful upload
 */
export async function deleteVideoBundle(
  nextcloudUrl: string,
  username: string,
  password: string,
  entry: Pick<VideoEntry, 'videoPath' | 'thumbnailPath' | 'metadataPath'>
): Promise<void> {
  const paths = [entry.videoPath, entry.thumbnailPath, entry.metadataPath].filter(Boolean) as string[];
  for (const p of paths) {
    try {
      await deleteFromNextcloud(nextcloudUrl, username, password, p);
    } catch (err: any) {
      console.log(`[Scanner] ⚠️ Không thể xóa ${path.basename(p)}: ${err.message}`);
    }
  }
}

export interface DeleteBundleStats {
  attemptedFiles: number;
  deletedFiles: number;
  failedFiles: number;
}

/**
 * Same behavior as deleteVideoBundle, but returns stats for cleanup reporting.
 */
export async function deleteVideoBundleWithStats(
  nextcloudUrl: string,
  username: string,
  password: string,
  entry: Pick<VideoEntry, 'videoPath' | 'thumbnailPath' | 'metadataPath'>
): Promise<DeleteBundleStats> {
  const paths = [entry.videoPath, entry.thumbnailPath, entry.metadataPath].filter(Boolean) as string[];
  const stats: DeleteBundleStats = {
    attemptedFiles: paths.length,
    deletedFiles: 0,
    failedFiles: 0,
  };

  for (const p of paths) {
    try {
      await deleteFromNextcloud(nextcloudUrl, username, password, p);
      stats.deletedFiles += 1;
    } catch (err: any) {
      stats.failedFiles += 1;
      console.log(`[Scanner] Cleanup skip ${path.basename(p)}: ${err.message}`);
    }
  }

  return stats;
}
