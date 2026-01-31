// Braddy environment configuration for portable use

import { join, dirname } from 'path';
import { homedir } from 'os';

export function getInstallDir(): string {
  return dirname(import.meta.url.replace('file://', ''));
}

export function getBraddyHome(): string {
  return process.env.BRADDY_HOME || join(homedir(), '.braddy');
}

export function resolvePath(inputPath: string): string {
  if (inputPath.startsWith('braddy://')) {
    return join(getInstallDir(), '..', inputPath.slice(9));
  }
  if (inputPath.startsWith('~/')) {
    return join(homedir(), inputPath.slice(2));
  }
  return inputPath;
}

export function getDefaultAgentsDir(): string {
  return join(getBraddyHome(), 'agents');
}

export function getDefaultConfigPath(agentName: string): string {
  return join(getDefaultAgentsDir(), `${agentName}.yaml`);
}
