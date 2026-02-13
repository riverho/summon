// Checkpoint Manager — Durable State Persistence

import { Checkpoint, CheckpointOptions } from './types.js';
import * as path from 'path';
import * as fs from 'fs';

export class CheckpointManager {
  private checkpointDir: string;
  private maxHistory: number;
  
  constructor(checkpointDir: string, maxHistory: number = 10) {
    this.checkpointDir = checkpointDir;
    this.maxHistory = maxHistory;
    this.ensureDir();
  }
  
  private ensureDir(): void {
    if (!fs.existsSync(this.checkpointDir)) {
      fs.mkdirSync(this.checkpointDir, { recursive: true });
    }
  }
  
  async save(checkpoint: Checkpoint): Promise<void> {
    const ritualDir = path.join(this.checkpointDir, checkpoint.ritualId);
    if (!fs.existsSync(ritualDir)) {
      fs.mkdirSync(ritualDir, { recursive: true });
    }
    
    const filePath = path.join(ritualDir, `${checkpoint.checkpointId}.json`);
    fs.writeFileSync(filePath, JSON.stringify(checkpoint, null, 2));
    
    // Cleanup old checkpoints
    await this.cleanup(ritualDir);
  }
  
  load(ritualId: string): Checkpoint | null {
    const ritualDir = path.join(this.checkpointDir, ritualId);
    if (!fs.existsSync(ritualDir)) return null;
    
    const files = fs.readdirSync(ritualDir)
      .filter((f: string) => f.endsWith('.json'))
      .map((f: string) => ({
        name: f,
        time: fs.statSync(path.join(ritualDir, f)).mtime.getTime()
      }))
      .sort((a: any, b: any) => b.time - a.time);
    
    if (files.length === 0) return null;
    
    const latestPath = path.join(ritualDir, files[0].name);
    return JSON.parse(fs.readFileSync(latestPath, 'utf-8'));
  }
  
  private async cleanup(ritualDir: string): Promise<void> {
    const files = fs.readdirSync(ritualDir)
      .filter((f: string) => f.endsWith('.json'))
      .map((f: string) => ({
        path: path.join(ritualDir, f),
        time: fs.statSync(path.join(ritualDir, f)).mtime.getTime()
      }))
      .sort((a: any, b: any) => b.time - a.time);
    
    for (let i = this.maxHistory; i < files.length; i++) {
      try {
        fs.unlinkSync(files[i].path);
      } catch {
        // Ignore cleanup errors
      }
    }
  }
}
