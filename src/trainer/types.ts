/**
 * DecisionPoint Types
 * 
 * Async decision-point messaging for agent training sessions.
 * Humans can review and chat at specific points without real-time presence.
 */

export type DecisionType = 'gap' | 'fork' | 'failure' | 'milestone' | 'review';
export type DecisionStatus = 'pending' | 'in_review' | 'resolved' | 'dismissed';
export type MessageSender = 'robot' | 'human' | 'system';

export interface Message {
  id: string;
  sender: MessageSender;
  content: string;
  timestamp: Date;
  attachments?: string[]; // artifact paths
}

export interface SuggestedAction {
  id: string;
  label: string;
  description?: string;
  command?: string; // CLI command to execute
}

export interface HumanDecision {
  action: string;
  notes?: string;
  timestamp: Date;
  resolvedBy?: string; // user identifier
}

export interface DecisionContext {
  sessionId: string;
  roundNumber: number;
  agentName: string;
  artifacts?: string[];
  metrics?: {
    duration?: number;
    tokensIn?: number;
    tokensOut?: number;
    turns?: number;
  };
}

export interface DecisionPoint {
  id: string;
  sessionId: string;
  afterRound: number;
  type: DecisionType;
  status: DecisionStatus;
  
  // What triggered this decision point
  trigger: {
    name: string;
    description: string;
    severity: 'info' | 'warning' | 'critical';
  };
  
  // Context at the time of creation
  context: DecisionContext;
  
  // Initial robot message (the "queued message")
  robotMessage: {
    content: string;
    suggestedActions: SuggestedAction[];
    timestamp: Date;
  };
  
  // Chat thread between human and robot
  chatThread: Message[];
  
  // Final resolution
  humanDecision?: HumanDecision;
  
  // Metadata
  createdAt: Date;
  updatedAt: Date;
  expiresAt?: Date; // optional auto-expire
}

// Filters for querying decision points
export interface DecisionFilter {
  sessionId?: string;
  status?: DecisionStatus;
  type?: DecisionType;
  severity?: 'info' | 'warning' | 'critical';
  after?: Date;
  before?: Date;
}

// Event types for decision point lifecycle
export type DecisionEvent = 
  | { type: 'created'; point: DecisionPoint }
  | { type: 'chat_added'; pointId: string; message: Message }
  | { type: 'resolved'; pointId: string; decision: HumanDecision }
  | { type: 'dismissed'; pointId: string; reason?: string };

// Pattern detection result
export interface DetectionResult {
  detected: boolean;
  type?: DecisionType;
  trigger?: {
    name: string;
    description: string;
    severity: 'info' | 'warning' | 'critical';
  };
  message?: string;
  suggestedActions?: SuggestedAction[];
}
