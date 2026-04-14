/**
 * Video Downloader — Download files from Nextcloud via WebDAV
 */
import axios from 'axios';
import fs from 'fs';
import path from 'path';
import os from 'os';

const DOWNLOAD_DIR = path.join(os.homedir(), '.tubeflow', 'downloads');

export async function downloadFromNextcloud(
  nextcloudUrl: string,
  username: string,
  password: string,
  remotePath: string
): Promise<string> {
  if (!fs.existsSync(DOWNLOAD_DIR)) {
    fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });
  }

  const fileName = path.basename(remotePath);
  const localPath = path.join(DOWNLOAD_DIR, `${Date.now()}_${fileName}`);

  // Build WebDAV URL
  const baseUrl = nextcloudUrl.replace(/\/$/, '');
  const davUrl = `${baseUrl}/remote.php/dav/files/${username}/${remotePath.replace(/^\//, '')}`;

  console.log(`[Download] Đang tải: ${fileName}`);
  console.log(`[Download] URL: ${davUrl}`);

  const response = await axios.get(davUrl, {
    auth: { username, password },
    responseType: 'stream',
    timeout: 300000, // 5 minutes
  });

  const writer = fs.createWriteStream(localPath);
  response.data.pipe(writer);

  await new Promise<void>((resolve, reject) => {
    writer.on('finish', resolve);
    writer.on('error', reject);
  });

  const stats = fs.statSync(localPath);
  console.log(`[Download] ✅ Hoàn thành: ${fileName} (${(stats.size / 1024 / 1024).toFixed(1)} MB)`);
  return localPath;
}

/**
 * Clean up downloaded files
 */
export function cleanupDownload(filePath: string): void {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      console.log(`[Cleanup] Đã xóa: ${path.basename(filePath)}`);
    }
  } catch {}
}
