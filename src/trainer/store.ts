/**
 * DecisionPoint Store
 * 
 * File-based storage for decision points and chat threads.
 * Structure: ~/.summon_mem/decisions/{sessionId}/{pointId}.json
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, appendFileSync } from 'fs';
import { dirname, join } from 'path';
import { homedir } from 'os';
import type { DecisionPoint, DecisionFilter, Message, HumanDecision } from './types';

const BASE_PATH = join(homedir(), '.summon_mem', 'decisions');

function ensureDir(path: string): void {
  if (!existsSync(path)) {
    mkdirSync(path, { recursive: true });
  }
}

function getSessionPath(sessionId: string): string {
  return join(BASE_PATH, sessionId);
}

function getPointPath(sessionId: string, pointId: string): string {
  return join(getSessionPath(sessionId), `${pointId}.json`);
}

function getChatPath(sessionId: string, pointId: string): string {
  return join(getSessionPath(sessionId), `${pointId}.chat.jsonl`);
}

function getManifestPath(sessionId: string): string {
  return join(getSessionPath(sessionId), 'manifest.json');
}

// Generate unique ID
function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

/**
 * Save or update a decision point
 */
export function saveDecisionPoint(point: DecisionPoint): void {
  const sessionPath = getSessionPath(point.sessionId);
  ensureDir(sessionPath);
  
  // Save point data
  const pointPath = getPointPath(point.sessionId, point.id);
  writeFileSync(pointPath, JSON.stringify(point, null, 2));
  
  // Update manifest
  const manifestPath = getManifestPath(point.sessionId);
  let manifest: { points: string[] } = { points: [] };
  
  if (existsSync(manifestPath)) {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
  }
  
  if (!manifest.points.includes(point.id)) {
    manifest.points.push(point.id);
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  }
  
  // Ensure chat file exists
  const chatPath = getChatPath(point.sessionId, point.id);
  if (!existsSync(chatPath)) {
    writeFileSync(chatPath, '');
  }
}

/**
 * Load a decision point by ID
 */
export function loadDecisionPoint(pointId: string): DecisionPoint | null {
  // Find which session owns this point
  const sessions = listSessions();
  
  for (const sessionId of sessions) {
    const pointPath = getPointPath(sessionId, pointId);
    if (existsSync(pointPath)) {
      const data = readFileSync(pointPath, 'utf-8');
      return JSON.parse(data) as DecisionPoint;
    }
  }
  
  return null;
}

/**
 * Load decision point by session + ID
 */
export function loadDecisionPointBySession(sessionId: string, pointId: string): DecisionPoint | null {
  const pointPath = getPointPath(sessionId, pointId);
  if (!existsSync(pointPath)) return null;
  
  const data = readFileSync(pointPath, 'utf-8');
  return JSON.parse(data) as DecisionPoint;
}

/**
 * List all decision points matching filter
 */
export function listDecisionPoints(filter?: DecisionFilter): DecisionPoint[] {
  const sessions = listSessions();
  const results: DecisionPoint[] = [];
  
  for (const sessionId of sessions) {
    const manifestPath = getManifestPath(sessionId);
    if (!existsSync(manifestPath)) continue;
    
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8')) as { points: string[] };
    
    for (const pointId of manifest.points) {
      const point = loadDecisionPointBySession(sessionId, pointId);
      if (!point) continue;
      
      if (matchesFilter(point, filter)) {
        results.push(point);
      }
    }
  }
  
  // Sort by createdAt desc
  return results.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

/**
 * Append a chat message to a decision point
 */
export function appendChatMessage(pointId: string, message: Message): void {
  const point = loadDecisionPoint(pointId);
  if (!point) throw new Error(`Decision point not found: ${pointId}`);
  
  // Append to chat file
  const chatPath = getChatPath(point.sessionId, pointId);
  const line = JSON.stringify(message) + '\n';
  appendFileSync(chatPath, line);
  
  // Update point's chat thread
  point.chatThread.push(message);
  point.updatedAt = new Date();
  saveDecisionPoint(point);
}

/**
 * Load chat history for a decision point
 */
export function loadChatHistory(pointId: string): Message[] {
  const point = loadDecisionPoint(pointId);
  if (!point) throw new Error(`Decision point not found: ${pointId}`);
  
  const chatPath = getChatPath(point.sessionId, pointId);
  if (!existsSync(chatPath)) return [];
  
  const lines = readFileSync(chatPath, 'utf-8')
    .split('\n')
    .filter(line => line.trim());
  
  return lines.map(line => JSON.parse(line) as Message);
}

/**
 * Resolve a decision point with human decision
 */
export function resolveDecisionPoint(
  pointId: string, 
  decision: HumanDecision
): void {
  const point = loadDecisionPoint(pointId);
  if (!point) throw new Error(`Decision point not found: ${pointId}`);
  
  point.humanDecision = decision;
  point.status = 'resolved';
  point.updatedAt = new Date();
  
  saveDecisionPoint(point);
}

/**
 * Mark decision point as dismissed
 */
export function dismissDecisionPoint(pointId: string, reason?: string): void {
  const point = loadDecisionPoint(pointId);
  if (!point) throw new Error(`Decision point not found: ${pointId}`);
  
  point.status = 'dismissed';
  point.updatedAt = new Date();
  
  saveDecisionPoint(point);
}

/**
 * Create a new decision point
 */
export function createDecisionPoint(
  sessionId: string,
  afterRound: number,
  partial: Omit<DecisionPoint, 'id' | 'sessionId' | 'afterRound' | 'status' | 'chatThread' | 'createdAt' | 'updatedAt'>
): DecisionPoint {
  const now = new Date();
  const point: DecisionPoint = {
    id: generateId(),
    sessionId,
    afterRound,
    status: 'pending',
    chatThread: [],
    createdAt: now,
    updatedAt: now,
    ...partial,
  };
  
  saveDecisionPoint(point);
  return point;
}

// Helper: list all session IDs
function listSessions(): string[] {
  if (!existsSync(BASE_PATH)) return [];
  return readdirSync(BASE_PATH, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name);
}

// Helper: check if point matches filter
function matchesFilter(point: DecisionPoint, filter?: DecisionFilter): boolean {
  if (!filter) return true;
  
  if (filter.sessionId && point.sessionId !== filter.sessionId) return false;
  if (filter.status && point.status !== filter.status) return false;
  if (filter.type && point.type !== filter.type) return false;
  if (filter.severity && point.trigger.severity !== filter.severity) return false;
  if (filter.after && point.createdAt < filter.after) return false;
  if (filter.before && point.createdAt > filter.before) return false;
  
  return true;
}
