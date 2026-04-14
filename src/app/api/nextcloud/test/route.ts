import { NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/auth";
import prisma from "@/lib/prisma";

// POST /api/nextcloud/test — Test Nextcloud connection and optionally list folder contents
export async function POST(request: Request) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const { folder } = body; // optional: test a specific folder

  const settings = await prisma.userSettings.findUnique({ where: { userId } });
  if (!settings?.nextcloudUrl || !settings?.nextcloudUsername || !settings?.nextcloudPassword) {
    return NextResponse.json({
      success: false,
      error: "Chưa cấu hình đầy đủ Nextcloud (URL, Username, Password) trong Cài đặt.",
    }, { status: 400 });
  }

  const baseUrl = settings.nextcloudUrl.replace(/\/$/, "");
  const username = settings.nextcloudUsername;
  const password = settings.nextcloudPassword;

  // Build WebDAV URL
  const folderPath = folder
    ? `${baseUrl}/remote.php/dav/files/${username}/${folder.replace(/^\//, "").replace(/\/$/, "")}`
    : `${baseUrl}/remote.php/dav/files/${username}`;

  try {
    const res = await fetch(folderPath, {
      method: "PROPFIND",
      headers: {
        Authorization: "Basic " + Buffer.from(`${username}:${password}`).toString("base64"),
        Depth: "1",
        "Content-Type": "application/xml",
      },
      body: `<?xml version="1.0" encoding="UTF-8"?>
<d:propfind xmlns:d="DAV:" xmlns:oc="http://owncloud.org/ns">
  <d:prop>
    <d:displayname/>
    <d:getcontentlength/>
    <d:getlastmodified/>
    <d:getcontenttype/>
    <d:resourcetype/>
  </d:prop>
</d:propfind>`,
    });

    if (res.status === 401) {
      return NextResponse.json({
        success: false,
        error: "Sai Username hoặc Password Nextcloud.",
      });
    }

    if (res.status === 404) {
      return NextResponse.json({
        success: false,
        error: folder
          ? `Folder "${folder}" không tồn tại trên Nextcloud.`
          : "Không tìm thấy thư mục gốc của user.",
      });
    }

    if (!res.ok) {
      return NextResponse.json({
        success: false,
        error: `Nextcloud trả về lỗi ${res.status}: ${res.statusText}`,
      });
    }

    const xml = await res.text();
    const VIDEO_EXTENSIONS = [".mp4", ".mkv", ".avi", ".mov", ".webm"];

    // Parse entries
    const entries = xml.split(/<d:response>/i).slice(1);
    const files: { name: string; size: number; type: string }[] = [];
    let folderCount = 0;

    for (const entry of entries) {
      const hrefMatch = entry.match(/<d:href>([^<]+)<\/d:href>/i);
      if (!hrefMatch) continue;

      const href = decodeURIComponent(hrefMatch[1]);
      const name = href.split("/").filter(Boolean).pop() || "";
      const isCollection = /<d:collection\s*\/?>/.test(entry);

      if (isCollection) {
        folderCount++;
        continue;
      }

      const ext = name.includes(".") ? "." + name.split(".").pop()!.toLowerCase() : "";
      const sizeMatch = entry.match(/<d:getcontentlength>(\d+)<\/d:getcontentlength>/i);
      const size = sizeMatch ? parseInt(sizeMatch[1]) : 0;

      if (VIDEO_EXTENSIONS.includes(ext)) {
        files.push({ name, size, type: "video" });
      }
    }

    return NextResponse.json({
      success: true,
      url: folderPath,
      folder: folder || "/",
      videoCount: files.length,
      videos: files.slice(0, 10), // max 10 preview
      message: folder
        ? `Folder "${folder}" OK — ${files.length} video tìm thấy.`
        : `Kết nối Nextcloud thành công!`,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({
      success: false,
      error: `Không thể kết nối Nextcloud: ${message}`,
    });
  }
}
