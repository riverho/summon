// Braddy environment configuration for portable use

import { join, dirname } from 'path';
import { homedir } from 'os';
import { SUMMON_HOME } from '../config/paths.js';

export function getInstallDir(): string {
  return dirname(import.meta.url.replace('file://', ''));
}

export function getSummonHome(): string {
  return SUMMON_HOME;
}

export function resolvePath(inputPath: string): string {
  if (inputPath.startsWith('summon://')) {
    return join(getInstallDir(), '..', inputPath.slice(9));
  }
  if (inputPath.startsWith('~/')) {
    return join(homedir(), inputPath.slice(2));
  }
  return inputPath;
}

export function getDefaultAgentsDir(): string {
  return join(getSummonHome(), 'agents');
}

export function getDefaultConfigPath(agentName: string): string {
  return join(getDefaultAgentsDir(), `${agentName}.yaml`);
}
