// Context Manager — State Mutations with Rollback

import { StateMutation } from './types.js';

export class ContextManager {
  private state: Record<string, unknown> = {};
  private mutations: StateMutation[] = [];
  private rollbackStack: Array<{ path: string; value: unknown }> = [];
  
  constructor(initialState: Record<string, unknown> = {}) {
    this.state = { ...initialState };
  }
  
  getState(): Record<string, unknown> {
    return { ...this.state };
  }
  
  getValue<T>(path: string): T | undefined {
    return this.getValueAtPath(this.state, path) as T | undefined;
  }
  
  applyMutations(mutations: StateMutation[], agentId: string): boolean {
    const rollbackSnapshot: Array<{ path: string; value: unknown }> = [];
    
    try {
      for (const mutation of mutations) {
        // Save rollback info
        const currentValue = this.getValueAtPath(this.state, mutation.path);
        rollbackSnapshot.push({ path: mutation.path, value: currentValue });
        
        // Apply mutation
        this.applySingleMutation(mutation);
        
        // Record with agent attribution
        this.mutations.push({
          ...mutation,
          agentId: mutation.agentId || agentId
        });
      }
      
      this.rollbackStack.push(...rollbackSnapshot);
      return true;
      
    } catch (err) {
      // Rollback on failure
      for (let i = rollbackSnapshot.length - 1; i >= 0; i--) {
        const { path, value } = rollbackSnapshot[i];
        this.setValueAtPath(this.state, path, value);
      }
      return false;
    }
  }
  
  rollback(steps: number = 1): void {
    for (let i = 0; i < steps && this.rollbackStack.length > 0; i++) {
      const { path, value } = this.rollbackStack.pop()!;
      this.setValueAtPath(this.state, path, value);
    }
  }
  
  getMutations(): StateMutation[] {
    return [...this.mutations];
  }
  
  private applySingleMutation(mutation: StateMutation): void {
    const { path, operation, value } = mutation;
    
    switch (operation) {
      case 'add':
      case 'replace':
        this.setValueAtPath(this.state, path, value);
        break;
        
      case 'remove':
        this.removeValueAtPath(this.state, path);
        break;
        
      case 'append': {
        const arr = this.getValueAtPath(this.state, path) as unknown[] || [];
        arr.push(value);
        this.setValueAtPath(this.state, path, arr);
        break;
      }
        
      case 'merge': {
        const current = this.getValueAtPath(this.state, path) as Record<string, unknown> || {};
        this.setValueAtPath(this.state, path, { ...current, ...(value as Record<string, unknown>) });
        break;
      }
    }
  }
  
  private getValueAtPath(obj: Record<string, unknown>, path: string): unknown {
    const parts = path.split('.');
    let current: unknown = obj;
    
    for (const part of parts) {
      if (current === null || current === undefined) return undefined;
      current = (current as Record<string, unknown>)[part];
    }
    
    return current;
  }
  
  private setValueAtPath(obj: Record<string, unknown>, path: string, value: unknown): void {
    const parts = path.split('.');
    let current: any = obj;
    
    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];
      if (!(part in current) || typeof current[part] !== 'object') {
        current[part] = {};
      }
      current = current[part];
    }
    
    current[parts[parts.length - 1]] = value;
  }
  
  private removeValueAtPath(obj: Record<string, unknown>, path: string): void {
    const parts = path.split('.');
    let current: any = obj;
    
    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];
      if (!(part in current)) return;
      current = current[part];
    }
    
    delete current[parts[parts.length - 1]];
  }
}
