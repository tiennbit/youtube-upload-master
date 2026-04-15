"use client";

import { startTransition, useEffect, useEffectEvent, useState } from "react";
import {
  CheckCircle,
  Clock3,
  DollarSign,
  Eye,
  Loader2,
  Monitor,
  Tv,
  Upload,
} from "lucide-react";

interface RealtimeChannel {
  id: number;
  name: string;
  uploadEnabled: boolean;
  uploadStartHour: number;
  uploadEndHour: number;
  uploadInterval: number;
  lastUpload: string | null;
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
}

interface RealtimePayload {
  generatedAt: string;
  agent: {
    online: boolean;
    status: string | null;
    activeUploads: number;
    message: string | null;
    version: string | null;
    lastSeen: string | null;
    offlineForSeconds: number | null;
  };
  channels: RealtimeChannel[];
}

function fmtNumber(value: number | null): string {
  if (value === null || Number.isNaN(value)) return "--";
  return value.toLocaleString("en-US");
}

function fmtMoney(value: number | null): string {
  if (value === null || Number.isNaN(value)) return "--";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(value);
}

function fmtDateTime(value: string | null): string {
  if (!value) return "--";
  return new Date(value).toLocaleString("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
  });
}

function fmtCountdown(seconds: number | null): string {
  if (seconds === null) return "--";
  if (seconds <= 0) return "00:00:00";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return [h, m, s].map((x) => String(x).padStart(2, "0")).join(":");
}

function fmtEta(seconds: number | null): string {
  if (seconds === null) return "--";
  if (seconds <= 0) return "Ngay";
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.ceil(seconds / 60);
  if (minutes < 60) return `~${minutes} phut`;
  const hours = Math.floor(minutes / 60);
  const remainMinutes = minutes % 60;
  return remainMinutes === 0 ? `~${hours} gio` : `~${hours}h ${remainMinutes}m`;
}

function toneBadgeClass(tone: RealtimeChannel["statusTone"]): string {
  if (tone === "success") return "badge badge-success";
  if (tone === "warning") return "badge badge-warning";
  if (tone === "error") return "badge badge-error";
  if (tone === "info") return "badge badge-info";
  return "badge badge-neutral";
}

export default function DashboardPage() {
  const [data, setData] = useState<RealtimePayload | null>(null);
  const [tickNowMs, setTickNowMs] = useState(Date.now());
  const [loading, setLoading] = useState(true);

  const fetchRealtime = useEffectEvent(async () => {
    try {
      const res = await fetch("/api/dashboard/realtime", { cache: "no-store" });
      if (res.ok) {
        const payload: RealtimePayload = await res.json();
        startTransition(() => setData(payload));
        setTickNowMs(Date.now());
      }
    } catch {
      // Keep current view if realtime poll fails.
    } finally {
      setLoading(false);
    }
  });

  useEffect(() => {
    fetchRealtime();
    const pollTimer = setInterval(fetchRealtime, 10000);
    const tickTimer = setInterval(() => setTickNowMs(Date.now()), 1000);
    return () => {
      clearInterval(pollTimer);
      clearInterval(tickTimer);
    };
  }, []);

  if (loading) {
    return (
      <div className="flex items-center" style={{ padding: "var(--space-16)", justifyContent: "center" }}>
        <div className="spinner" style={{ width: 32, height: 32 }} />
      </div>
    );
  }

  const channels = data?.channels || [];
  const totalChannels = channels.length;
  const activeChannels = channels.filter((c) => c.uploadEnabled).length;
  const pendingUploads = channels.reduce((sum, c) => sum + c.pendingCount, 0);
  const activeUploads = channels.reduce((sum, c) => sum + c.uploadingCount, 0);
  const completedToday = channels.reduce((sum, c) => sum + c.uploadedToday, 0);
  const failedToday = channels.reduce((sum, c) => sum + c.failedToday, 0);

  return (
    <div className="animate-in">
      <div className="page-header">
        <div>
          <h1 className="page-title">Dashboard Realtime</h1>
          <p className="page-subtitle">Theo doi countdown upload, trang thai va KPI moi kenh theo thoi gian thuc</p>
        </div>
        <div className="card" style={{ padding: "var(--space-4)", minWidth: 320 }}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className={data?.agent.online ? "status-dot status-dot-online" : "status-dot status-dot-offline"} />
              <span className="font-semibold" style={{ fontSize: "var(--text-sm)" }}>
                Agent {data?.agent.online ? "Online" : "Offline"}
              </span>
            </div>
            <span className="badge badge-neutral">
              <Loader2 size={12} style={{ animation: "spin 1s linear infinite" }} />
              realtime
            </span>
          </div>
          <div className="mt-2 text-sm text-secondary">
            Trang thai: {data?.agent.status || "--"} • Active uploads: {data?.agent.activeUploads ?? 0}
          </div>
          <div className="text-xs text-secondary mt-2">
            Last heartbeat: {fmtDateTime(data?.agent.lastSeen || null)}
          </div>
        </div>
      </div>

      <div className="grid-stats mb-6">
        <div className="stat-card">
          <div className="flex items-center gap-4">
            <div className="stat-icon blue">
              <Tv size={22} />
            </div>
            <div>
              <div className="stat-label">Channels</div>
              <div className="stat-value">{totalChannels}</div>
            </div>
          </div>
          <div className="stat-trend" style={{ color: "var(--success)" }}>
            {activeChannels} dang hoat dong
          </div>
        </div>

        <div className="stat-card">
          <div className="flex items-center gap-4">
            <div className="stat-icon orange">
              <Clock3 size={22} />
            </div>
            <div>
              <div className="stat-label">Dang cho</div>
              <div className="stat-value">{pendingUploads}</div>
            </div>
          </div>
          <div className="stat-trend" style={{ color: "var(--warning)" }}>
            video trong hang doi
          </div>
        </div>

        <div className="stat-card">
          <div className="flex items-center gap-4">
            <div className="stat-icon green">
              <CheckCircle size={22} />
            </div>
            <div>
              <div className="stat-label">Dang hom nay</div>
              <div className="stat-value">{completedToday}</div>
            </div>
          </div>
          <div className="stat-trend" style={{ color: "var(--success)" }}>
            upload thanh cong trong ngay
          </div>
        </div>

        <div className="stat-card">
          <div className="flex items-center gap-4">
            <div className="stat-icon red">
              <Clock3 size={22} />
            </div>
            <div>
              <div className="stat-label">Loi hom nay</div>
              <div className="stat-value">{failedToday}</div>
            </div>
          </div>
          <div className="stat-trend" style={{ color: "var(--error)" }}>
            can xu ly
          </div>
        </div>

        <div className="stat-card">
          <div className="flex items-center gap-4">
            <div className="stat-icon blue">
              <Upload size={22} />
            </div>
            <div>
              <div className="stat-label">Dang upload</div>
              <div className="stat-value">{activeUploads}</div>
            </div>
          </div>
          <div className="stat-trend" style={{ color: "var(--info)" }}>
            upload dang chay
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <h2 className="card-title">Kenh realtime</h2>
          <div className="text-xs text-secondary">
            Cap nhat moi 10 giay • ticker {new Date(tickNowMs).toLocaleTimeString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })}
          </div>
        </div>

        {channels.length === 0 ? (
          <div className="empty-state">
            <h3>Chua co kenh</h3>
            <p>Them channel de bat dau theo doi countdown upload va so lieu doanh thu/view.</p>
          </div>
        ) : (
          <div className="table-container">
            <table className="table">
              <thead>
                <tr>
                  <th>Kenh</th>
                  <th>Trang thai</th>
                  <th>Countdown</th>
                  <th>ETA toi luot</th>
                  <th>Video hom nay</th>
                  <th>Views 48h</th>
                  <th>Doanh thu thang</th>
                  <th>Queue</th>
                </tr>
              </thead>
              <tbody>
                {channels.map((ch) => {
                  let liveCountdown = ch.secondsUntilNextUpload;
                  if (liveCountdown !== null && ch.nextUploadAt) {
                    const nextAtMs = new Date(ch.nextUploadAt).getTime();
                    liveCountdown = Math.max(0, Math.ceil((nextAtMs - tickNowMs) / 1000));
                  }

                  return (
                    <tr key={ch.id}>
                      <td>
                        <div className="flex items-center gap-2">
                          <Tv size={14} />
                          <span className="font-semibold">{ch.name}</span>
                        </div>
                        <div className="text-xs text-secondary mt-2">
                          Khung gio: {String(ch.uploadStartHour).padStart(2, "0")}:00 - {String(ch.uploadEndHour).padStart(2, "0")}:00 • moi {ch.uploadInterval} phut
                        </div>
                        <div className="text-xs text-secondary mt-2">
                          Upload gan nhat: {fmtDateTime(ch.lastUpload)}
                        </div>
                      </td>
                      <td>
                        <span className={toneBadgeClass(ch.statusTone)}>{ch.statusLabel}</span>
                        {ch.uploadingCount > 0 ? (
                          <div className="text-xs text-secondary mt-2">Dang chay: {ch.uploadingCount}</div>
                        ) : null}
                      </td>
                      <td>
                        <div className="font-semibold">{fmtCountdown(liveCountdown)}</div>
                        <div className="text-xs text-secondary mt-2">
                          Moc ke tiep: {fmtDateTime(ch.nextUploadAt)}
                        </div>
                      </td>
                      <td>
                        <div className="font-semibold">{fmtEta(ch.etaToDispatchSeconds)}</div>
                        <div className="text-xs text-secondary mt-2">
                          Uoc tinh toi luc duoc dispatch
                        </div>
                      </td>
                      <td>
                        <div className="flex items-center gap-2">
                          <CheckCircle size={14} style={{ color: "var(--success)" }} />
                          <span className="font-semibold">{fmtNumber(ch.uploadedToday)}</span>
                        </div>
                        <div className="text-xs text-secondary mt-2">
                          Loi hom nay: {fmtNumber(ch.failedToday)}
                        </div>
                      </td>
                      <td>
                        <div className="flex items-center gap-2">
                          <Eye size={14} style={{ color: "var(--info)" }} />
                          <span className="font-semibold">{fmtNumber(ch.viewsLast48Hours)}</span>
                        </div>
                      </td>
                      <td>
                        <div className="flex items-center gap-2">
                          <DollarSign size={14} style={{ color: "var(--warning)" }} />
                          <span className="font-semibold">{fmtMoney(ch.revenueMonth)}</span>
                        </div>
                      </td>
                      <td>
                        <div className="font-semibold">PENDING: {fmtNumber(ch.pendingCount)}</div>
                        <div className="text-xs text-secondary mt-2">
                          UPLOADING: {fmtNumber(ch.uploadingCount)}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="flex gap-4 mt-4" style={{ flexWrap: "wrap" }}>
        <a href="/dashboard/channels" className="action-card">
          <div className="action-card-icon" style={{ background: "var(--accent-muted)", color: "var(--accent)" }}>
            <Tv size={20} />
          </div>
          <div>
            <div className="action-card-text">Quan ly Channel</div>
            <div className="action-card-desc">Cap nhat profile, khung gio va interval upload</div>
          </div>
        </a>
        <a href="/dashboard/uploads" className="action-card">
          <div className="action-card-icon" style={{ background: "var(--cta-muted)", color: "var(--cta)" }}>
            <Upload size={20} />
          </div>
          <div>
            <div className="action-card-text">Upload Queue</div>
            <div className="action-card-desc">Xem cac job dang cho va trang thai xu ly</div>
          </div>
        </a>
        <a href="/dashboard/agent" className="action-card">
          <div className="action-card-icon" style={{ background: "var(--success-muted)", color: "var(--success)" }}>
            <Monitor size={20} />
          </div>
          <div>
            <div className="action-card-text">Agent Status</div>
            <div className="action-card-desc">Kiem tra heartbeat, active uploads, phien ban agent</div>
          </div>
        </a>
      </div>
    </div>
  );
}
