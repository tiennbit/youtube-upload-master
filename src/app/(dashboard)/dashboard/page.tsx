"use client";

import { useEffect, useState } from "react";
import { Tv, Upload, CheckCircle, AlertCircle, Monitor, Clock } from "lucide-react";

interface Stats {
  totalChannels: number;
  activeChannels: number;
  pendingUploads: number;
  completedUploads: number;
  failedUploads: number;
}

export default function DashboardPage() {
  const [stats, setStats] = useState<Stats>({
    totalChannels: 0,
    activeChannels: 0,
    pendingUploads: 0,
    completedUploads: 0,
    failedUploads: 0,
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchStats();
  }, []);

  async function fetchStats() {
    try {
      const res = await fetch("/api/stats");
      if (res.ok) {
        const data = await res.json();
        setStats(data);
      }
    } catch {
      // Stats API may not exist yet
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center" style={{ padding: "var(--space-16)", justifyContent: "center" }}>
        <div className="spinner" style={{ width: 32, height: 32 }} />
      </div>
    );
  }

  return (
    <div className="animate-in">
      <div className="page-header">
        <div>
          <h1 className="page-title">Dashboard</h1>
          <p className="page-subtitle">Tổng quan hoạt động upload video</p>
        </div>
      </div>

      {/* Stat Cards */}
      <div className="grid-stats mb-6">
        <div className="stat-card">
          <div className="flex items-center gap-4">
            <div className="stat-icon blue">
              <Tv size={22} />
            </div>
            <div>
              <div className="stat-label">Channels</div>
              <div className="stat-value">{stats.totalChannels}</div>
            </div>
          </div>
          <div className="stat-trend" style={{ color: "var(--success)" }}>
            {stats.activeChannels} đang hoạt động
          </div>
        </div>

        <div className="stat-card">
          <div className="flex items-center gap-4">
            <div className="stat-icon orange">
              <Clock size={22} />
            </div>
            <div>
              <div className="stat-label">Đang chờ</div>
              <div className="stat-value">{stats.pendingUploads}</div>
            </div>
          </div>
          <div className="stat-trend" style={{ color: "var(--warning)" }}>
            video trong hàng đợi
          </div>
        </div>

        <div className="stat-card">
          <div className="flex items-center gap-4">
            <div className="stat-icon green">
              <CheckCircle size={22} />
            </div>
            <div>
              <div className="stat-label">Hoàn thành</div>
              <div className="stat-value">{stats.completedUploads}</div>
            </div>
          </div>
          <div className="stat-trend" style={{ color: "var(--success)" }}>
            upload thành công
          </div>
        </div>

        <div className="stat-card">
          <div className="flex items-center gap-4">
            <div className="stat-icon red">
              <AlertCircle size={22} />
            </div>
            <div>
              <div className="stat-label">Thất bại</div>
              <div className="stat-value">{stats.failedUploads}</div>
            </div>
          </div>
          <div className="stat-trend" style={{ color: "var(--error)" }}>
            cần xử lý
          </div>
        </div>
      </div>

      {/* Quick Actions */}
      <div style={{ marginBottom: "var(--space-4)" }}>
        <h2 className="card-title" style={{ marginBottom: "var(--space-4)" }}>Bắt đầu nhanh</h2>
      </div>
      <div className="flex gap-4" style={{ flexWrap: "wrap" }}>
        <a href="/dashboard/channels" className="action-card">
          <div className="action-card-icon" style={{ background: "var(--accent-muted)", color: "var(--accent)" }}>
            <Tv size={20} />
          </div>
          <div>
            <div className="action-card-text">Thêm Channel</div>
            <div className="action-card-desc">Kết nối kênh YouTube mới</div>
          </div>
        </a>
        <a href="/dashboard/uploads" className="action-card">
          <div className="action-card-icon" style={{ background: "var(--cta-muted)", color: "var(--cta)" }}>
            <Upload size={20} />
          </div>
          <div>
            <div className="action-card-text">Upload Queue</div>
            <div className="action-card-desc">Xem hàng đợi video</div>
          </div>
        </a>
        <a href="/dashboard/agent" className="action-card">
          <div className="action-card-icon" style={{ background: "var(--success-muted)", color: "var(--success)" }}>
            <Monitor size={20} />
          </div>
          <div>
            <div className="action-card-text">Kết nối Agent</div>
            <div className="action-card-desc">Cài đặt Desktop Agent</div>
          </div>
        </a>
      </div>
    </div>
  );
}
