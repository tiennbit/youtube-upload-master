/**
 * TubeFlow Agent — Configuration Management
 * Stores agent token and server URL in a local config file
 */
import fs from 'fs';
import path from 'path';
import os from 'os';

const CONFIG_DIR = path.join(os.homedir(), '.tubeflow');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

export interface AgentConfig {
  serverUrl: string;
  agentToken: string;
}

export function loadConfig(): AgentConfig | null {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
    }
  } catch {}
  return null;
}

export function saveConfig(config: AgentConfig): void {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
  console.log(`[Config] Đã lưu cấu hình tại: ${CONFIG_FILE}`);
}

export function getConfigPath(): string {
  return CONFIG_FILE;
}
