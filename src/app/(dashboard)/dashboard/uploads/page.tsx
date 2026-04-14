"use client";

import { useEffect, useState, useCallback } from "react";
import { RefreshCw, Trash2, RotateCcw, Upload } from "lucide-react";

interface UploadItem {
  id: number;
  title: string;
  description: string | null;
  status: string;
  visibility: string;
  error: string | null;
  createdAt: string;
  channel: { name: string };
}

export default function UploadsPage() {
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchUploads = useCallback(async () => {
    try {
      const res = await fetch("/api/uploads");
      if (res.ok) setUploads(await res.json());
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchUploads(); }, [fetchUploads]);

  async function handleDelete(id: number) {
    if (!confirm("Xóa upload này?")) return;
    await fetch(`/api/uploads/${id}`, { method: "DELETE" });
    fetchUploads();
  }

  async function handleRetry(id: number) {
    await fetch(`/api/uploads/${id}/retry`, { method: "POST" });
    fetchUploads();
  }

  function getStatusBadge(status: string) {
    switch (status) {
      case "PENDING": return <span className="badge badge-warning">Chờ</span>;
      case "UPLOADING": return <span className="badge badge-info">Đang upload</span>;
      case "DONE": return <span className="badge badge-success">Hoàn thành</span>;
      case "FAILED": return <span className="badge badge-error">Thất bại</span>;
      default: return <span className="badge badge-neutral">{status}</span>;
    }
  }

  if (loading) {
    return (
      <div style={{ padding: "var(--space-16)", textAlign: "center" }}>
        <div className="spinner" style={{ width: 32, height: 32, margin: "0 auto" }} />
      </div>
    );
  }

  return (
    <div className="animate-in">
      <div className="page-header">
        <div>
          <h1 className="page-title">Upload Queue</h1>
          <p className="page-subtitle">Danh sách video đang chờ và đã upload</p>
        </div>
        <button className="btn btn-secondary" onClick={() => { setLoading(true); fetchUploads(); }}>
          <RefreshCw size={16} /> Làm mới
        </button>
      </div>

      {uploads.length === 0 ? (
        <div className="empty-state">
          <div style={{ width: 64, height: 64, borderRadius: "var(--radius-xl)", background: "var(--accent-muted)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto var(--space-5)" }}>
            <Upload size={32} color="var(--accent)" />
          </div>
          <h3>Không có video trong hàng đợi</h3>
          <p>Video sẽ xuất hiện ở đây khi Agent quét nguồn và thêm vào hàng đợi.</p>
        </div>
      ) : (
        <div className="table-container">
          <table className="table">
            <thead>
              <tr>
                <th>Video</th>
                <th>Channel</th>
                <th>Trạng thái</th>
                <th>Visibility</th>
                <th>Thời gian</th>
                <th style={{ width: 100 }}>Hành động</th>
              </tr>
            </thead>
            <tbody>
              {uploads.map((u) => (
                <tr key={u.id}>
                  <td>
                    <div>
                      <strong>{u.title}</strong>
                      {u.error && (
                        <div className="text-xs" style={{ color: "var(--error)", marginTop: "var(--space-1)" }}>
                          {u.error}
                        </div>
                      )}
                    </div>
                  </td>
                  <td className="text-sm text-secondary">{u.channel.name}</td>
                  <td>{getStatusBadge(u.status)}</td>
                  <td>
                    <span className="badge badge-neutral">{u.visibility}</span>
                  </td>
                  <td className="text-sm text-secondary">
                    {new Date(u.createdAt).toLocaleString("vi-VN")}
                  </td>
                  <td>
                    <div className="flex gap-1">
                      {u.status === "FAILED" && (
                        <button className="btn btn-ghost btn-sm" onClick={() => handleRetry(u.id)} title="Thử lại">
                          <RotateCcw size={14} />
                        </button>
                      )}
                      <button className="btn btn-ghost btn-sm" onClick={() => handleDelete(u.id)} title="Xóa" style={{ color: "var(--error)" }}>
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
