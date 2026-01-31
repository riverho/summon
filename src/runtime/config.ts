import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { homedir } from 'os';

const BRADDY_DIR = '.braddy';
const SETTINGS_FILE = 'settings.json';

/**
 * Get the braddy config directory path
 */
function getConfigDir(): string {
  return join(homedir(), BRADDY_DIR);
}

/**
 * Get the settings file path
 */
function getSettingsPath(): string {
  return join(getConfigDir(), SETTINGS_FILE);
}

interface Config {
  provider?: string;
  modelId?: string;
  [key: string]: unknown;
}

export function loadConfig(): Config {
  const settingsPath = getSettingsPath();
  if (!existsSync(settingsPath)) {
    return {};
  }

  try {
    const content = readFileSync(settingsPath, 'utf-8');
    return JSON.parse(content);
  } catch {
    return {};
  }
}

export function saveConfig(config: Config): boolean {
  try {
    const configDir = getConfigDir();
    if (!existsSync(configDir)) {
      mkdirSync(configDir, { recursive: true });
    }
    writeFileSync(getSettingsPath(), JSON.stringify(config, null, 2));
    return true;
  } catch {
    return false;
  }
}

export function getSetting<T>(key: string, defaultValue: T): T {
  const config = loadConfig();
  return (config[key] as T) ?? defaultValue;
}

export function setSetting(key: string, value: unknown): boolean {
  const config = loadConfig();
  config[key] = value;
  return saveConfig(config);
}
