/**
 * TubeFlow Agent - API Client
 * Communicates with the TubeFlow server to fetch jobs and report results
 */

export interface JobData {
  id: number;
  title: string;
  description: string | null;
  tags: string | null;
  videoPath: string | null;
  thumbPath: string | null;
  remoteVideoPath: string | null;
  remoteThumbnailPath: string | null;
  visibility: string;
  channel: {
    id: number;
    name: string;
    gologinProfileId: string | null;
    studioUrl: string | null;
    nextcloudFolder: string | null;
    uploadVisibility: string;
    uploadInterval: number;
    uploadStartHour: number;
    uploadEndHour: number;
  };
}

export interface AgentSettings {
  gologinToken: string | null;
  nextcloudUrl: string | null;
  nextcloudUsername: string | null;
  nextcloudPassword: string | null;
  maxConcurrent: number;
  autoUploadEnabled: boolean;
}

export interface JobResponse {
  job: JobData | null;
  reason?: string;
  settings?: AgentSettings | null;
}

export interface ChannelInfo {
  id: number;
  name: string;
  nextcloudFolder: string | null;
  uploadEnabled: boolean;
  gologinProfileId: string | null;
  lastUpload: string | null;
}

export interface ExpiredUploadCandidate {
  id: number;
  channelId: number;
  remoteVideoPath: string | null;
  remoteThumbnailPath: string | null;
  createdAt: string;
  status: string;
}

export class ApiClient {
  private serverUrl: string;
  private agentToken: string;

  constructor(serverUrl: string, agentToken: string) {
    this.serverUrl = serverUrl.replace(/\/$/, '');
    this.agentToken = agentToken;
  }

  private get headers() {
    return { Authorization: `Bearer ${this.agentToken}` };
  }

  async fetchJob(skipChannelIds?: number[], localHour?: number): Promise<JobResponse> {
    const params = new URLSearchParams();
    if (skipChannelIds && skipChannelIds.length > 0) {
      params.set('skipChannels', skipChannelIds.join(','));
    }
    if (localHour !== undefined) {
      params.set('localHour', String(localHour));
    }
    const query = params.toString();
    const url = `${this.serverUrl}/api/agent/jobs${query ? `?${query}` : ''}`;
    const res = await fetch(url, {
      headers: this.headers,
    });

    if (res.status === 401) {
      throw new Error('Agent token is invalid. Please re-check token on dashboard.');
    }

    if (!res.ok) {
      throw new Error(`Server error: ${res.status} ${res.statusText}`);
    }

    return res.json() as Promise<JobResponse>;
  }

  async getSettings(): Promise<AgentSettings | null> {
    const res = await fetch(`${this.serverUrl}/api/agent/settings`, {
      headers: this.headers,
    });

    if (res.status === 401) {
      throw new Error('Agent token is invalid. Please re-check token on dashboard.');
    }

    if (!res.ok) {
      throw new Error(`Server error: ${res.status} ${res.statusText}`);
    }

    const data = await res.json() as { settings?: AgentSettings | null };
    return data.settings ?? null;
  }

  async reportResult(jobId: number, status: 'DONE' | 'FAILED', error?: string, youtubeUrl?: string, youtubeId?: string): Promise<void> {
    const res = await fetch(`${this.serverUrl}/api/agent/report`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...this.headers,
      },
      body: JSON.stringify({ jobId, status, error, youtubeUrl, youtubeId }),
    });

    if (!res.ok) {
      console.error(`[API] Report failed: ${res.status}`);
    }
  }

  async checkVersion(): Promise<{ latestVersion: string; downloadUrl?: string }> {
    const res = await fetch(`${this.serverUrl}/api/agent/version`);
    return res.json() as Promise<{ latestVersion: string; downloadUrl?: string }>;
  }

  async getChannels(): Promise<ChannelInfo[]> {
    const res = await fetch(`${this.serverUrl}/api/agent/channels`, {
      headers: this.headers,
    });

    if (!res.ok) return [];
    const data = await res.json();
    return data.channels || [];
  }

  async reportScannedFiles(
    channelId: number,
    files: {
      videoPath: string;
      thumbnailPath?: string | null;
      metadataPath?: string;
      title: string;
      description?: string;
      tags?: string[];
      visibility?: string;
    }[]
  ): Promise<{ created: number; skipped: number }> {
    const res = await fetch(`${this.serverUrl}/api/agent/scan-jobs`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...this.headers,
      },
      body: JSON.stringify({ channelId, files }),
    });

    if (!res.ok) {
      throw new Error(`Scan report failed: ${res.status}`);
    }

    return res.json() as Promise<{ created: number; skipped: number }>;
  }

  async sendHeartbeat(data: {
    version: string;
    status: string;
    activeUploads: number;
    message?: string;
    activeProfiles?: string[];
    isRestart?: boolean;
  }): Promise<void> {
    try {
      await fetch(`${this.serverUrl}/api/agent/heartbeat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...this.headers,
        },
        body: JSON.stringify(data),
      });
    } catch {
      // Silent fail - heartbeat is non-critical
    }
  }

  async updateChannelStudioUrl(channelId: number, studioUrl: string): Promise<void> {
    try {
      await fetch(`${this.serverUrl}/api/agent/channel-update`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...this.headers,
        },
        body: JSON.stringify({ channelId, studioUrl }),
      });
    } catch {
      // Silent fail - non-critical
    }
  }

  async resetJob(jobId: number): Promise<void> {
    try {
      await fetch(`${this.serverUrl}/api/agent/report`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...this.headers,
        },
        body: JSON.stringify({ jobId, status: 'PENDING' }),
      });
    } catch {}
  }

  async reportChannelStats(stats: {
    channelId: number;
    subscriberCount?: number;
    totalViews?: number;
    viewsLast28Days?: number;
    viewsLast48Hours?: number;
    videoCount?: number;
    estimatedRevenue?: number;
    revenueMonth?: number;
    monetizationEnabled?: boolean;
    topVideoViews?: number;
    topVideoTitle?: string;
  }[]): Promise<{ saved: number }> {
    try {
      const res = await fetch(`${this.serverUrl}/api/agent/channel-stats`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...this.headers,
        },
        body: JSON.stringify({ stats }),
      });

      if (!res.ok) {
        console.error(`[API] Channel stats report failed: ${res.status}`);
        return { saved: 0 };
      }

      return res.json() as Promise<{ saved: number }>;
    } catch (e: any) {
      console.error(`[API] Channel stats report error: ${e.message}`);
      return { saved: 0 };
    }
  }

  async getStatsSettings(): Promise<{
    statsCollectInterval: number;
    statsLastCollect: string | null;
  } | null> {
    try {
      const res = await fetch(`${this.serverUrl}/api/agent/channels`, {
        headers: this.headers,
      });
      if (!res.ok) return null;
      const data = await res.json();
      return {
        statsCollectInterval: data.statsCollectInterval ?? 120,
        statsLastCollect: data.statsLastCollect ?? null,
      };
    } catch {
      return null;
    }
  }

  async lockFile(remoteVideoPath: string, channelId: number): Promise<boolean> {
    try {
      const res = await fetch(`${this.serverUrl}/api/agent/lock-file`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...this.headers },
        body: JSON.stringify({ remoteVideoPath, channelId }),
      });
      if (!res.ok) return true;
      const data = await res.json();
      return data.success === true;
    } catch {
      return true;
    }
  }

  async unlockFile(remoteVideoPath: string, channelId: number, deleted: boolean = false): Promise<void> {
    try {
      await fetch(`${this.serverUrl}/api/agent/unlock-file`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...this.headers },
        body: JSON.stringify({ remoteVideoPath, channelId, deleted }),
      });
    } catch {
      // Silent fail - non-critical
    }
  }

  async getCleanupCandidates(
    before: string,
    limit: number,
    excludeChannelIds: number[]
  ): Promise<{ candidates: ExpiredUploadCandidate[]; hasMore: boolean }> {
    const query = new URLSearchParams({
      before,
      limit: String(limit),
    });
    if (excludeChannelIds.length > 0) {
      query.set('excludeChannels', excludeChannelIds.join(','));
    }

    const res = await fetch(`${this.serverUrl}/api/agent/cleanup/candidates?${query.toString()}`, {
      headers: this.headers,
    });

    if (!res.ok) {
      throw new Error(`Cleanup candidates failed: ${res.status}`);
    }

    return res.json() as Promise<{ candidates: ExpiredUploadCandidate[]; hasMore: boolean }>;
  }

  async deleteCleanupJobs(jobIds: number[]): Promise<number> {
    const res = await fetch(`${this.serverUrl}/api/agent/cleanup/delete`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...this.headers,
      },
      body: JSON.stringify({ jobIds }),
    });

    if (!res.ok) {
      throw new Error(`Cleanup delete failed: ${res.status}`);
    }

    const data = await res.json() as { deleted?: number };
    return data.deleted ?? 0;
  }
}
