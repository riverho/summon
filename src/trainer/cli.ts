/**
 * Trainer CLI Commands
 * 
 * summon trainer decisions list [--pending|--session <id>]
 * summon trainer decisions chat <pointId>
 * summon trainer decisions resolve <pointId> --action <action>
 */

import { Command } from 'commander';
import * as readline from 'readline';
import {
  listDecisionPoints,
  loadDecisionPoint,
  appendChatMessage,
  resolveDecisionPoint,
  dismissDecisionPoint,
  createDecisionPoint,
} from './store';
import { runAllDetectors } from './detector';
import type { Message, HumanDecision } from './types';

// Generate ID helper
function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

/**
 * Register trainer commands with the commander program
 */
export function registerTrainerCommands(program: Command): void {
  const trainer = program
    .command('trainer')
    .description('Agent trainer management');
  
  // Decision commands
  const decisions = trainer
    .command('decisions')
    .alias('d')
    .description('Manage decision points');
  
  // List decisions
  decisions
    .command('list')
    .alias('ls')
    .description('List decision points')
    .option('-p, --pending', 'Show only pending decisions')
    .option('-s, --session <id>', 'Filter by session ID')
    .option('--severity <level>', 'Filter by severity (info|warning|critical)')
    .option('-l, --limit <n>', 'Limit results', '20')
    .action(async (options) => {
      const filter: any = {};
      
      if (options.pending) filter.status = 'pending';
      if (options.session) filter.sessionId = options.session;
      if (options.severity) filter.severity = options.severity;
      
      const points = listDecisionPoints(filter);
      const limit = parseInt(options.limit, 10);
      const display = points.slice(0, limit);
      
      if (display.length === 0) {
        console.log('No decision points found.');
        return;
      }
      
      console.log(`\nFound ${points.length} decision point(s):\n`);
      
      for (const p of display) {
        const icon = p.status === 'pending' ? '🔴' : 
                     p.status === 'resolved' ? '✅' : '⚪';
        const severity = p.trigger.severity === 'critical' ? '🔥' :
                         p.trigger.severity === 'warning' ? '⚠️' : 'ℹ️';
        
        console.log(`${icon} ${p.id.slice(0, 8)}... ${severity} ${p.type}`);
        console.log(`   Session: ${p.sessionId} | Round ${p.afterRound} | ${p.status}`);
        console.log(`   ${p.trigger.description}`);
        
        if (p.humanDecision) {
          console.log(`   → Resolved: ${p.humanDecision.action}`);
        }
        
        console.log('');
      }
      
      if (points.length > limit) {
        console.log(`... and ${points.length - limit} more (use -l to show more)`);
      }
    });
  
  // Chat with a decision point
  decisions
    .command('chat <pointId>')
    .description('Interactive chat with a decision point')
    .option('-m, --message <text>', 'Send single message (non-interactive)')
    .action(async (pointId, options) => {
      const point = loadDecisionPoint(pointId);
      
      if (!point) {
        console.error(`❌ Decision point not found: ${pointId}`);
        process.exit(1);
      }
      
      console.log(`\n🎯 Decision Point: ${point.type}`);
      console.log(`Session: ${point.sessionId} | After Round ${point.afterRound}`);
      console.log(`Status: ${point.status} | Severity: ${point.trigger.severity}`);
      console.log(`\n${'='.repeat(60)}`);
      
      // Show robot message
      console.log(`\n🤖 ${point.robotMessage.content}\n`);
      
      // Show suggested actions
      if (point.robotMessage.suggestedActions.length > 0) {
        console.log('Suggested actions:');
        point.robotMessage.suggestedActions.forEach((a, i) => {
          console.log(`  ${i + 1}. ${a.label}${a.description ? ` - ${a.description}` : ''}`);
        });
        console.log('');
      }
      
      // Show existing chat
      if (point.chatThread.length > 0) {
        console.log('Previous messages:');
        point.chatThread.forEach(m => {
          const icon = m.sender === 'robot' ? '🤖' : m.sender === 'human' ? '👤' : '⚙️';
          console.log(`${icon} ${m.content}`);
        });
        console.log('');
      }
      
      if (point.status === 'resolved') {
        console.log(`✅ Already resolved: ${point.humanDecision?.action}`);
        return;
      }
      
      // Single message mode
      if (options.message) {
        const message: Message = {
          id: generateId(),
          sender: 'human',
          content: options.message,
          timestamp: new Date(),
        };
        appendChatMessage(pointId, message);
        console.log(`✅ Message sent to ${pointId}`);
        return;
      }
      
      // Interactive mode
      console.log('Enter your message (or action number, or "quit"):\n');
      
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });
      
      const askQuestion = () => {
        rl.question('> ', (input) => {
          const trimmed = input.trim();
          
          if (trimmed.toLowerCase() === 'quit' || trimmed.toLowerCase() === 'exit') {
            console.log('\n👋 Chat closed. Decision point still pending.');
            rl.close();
            return;
          }
          
          // Check if it's a number (action selection)
          const actionNum = parseInt(trimmed, 10);
          if (!isNaN(actionNum) && actionNum > 0 && 
              actionNum <= point.robotMessage.suggestedActions.length) {
            const action = point.robotMessage.suggestedActions[actionNum - 1];
            const decision: HumanDecision = {
              action: action.id,
              notes: `Selected via chat: ${action.label}`,
              timestamp: new Date(),
              resolvedBy: 'cli-user',
            };
            resolveDecisionPoint(pointId, decision);
            console.log(`✅ Decision recorded: ${action.label}`);
            rl.close();
            return;
          }
          
          // Regular message
          const message: Message = {
            id: generateId(),
            sender: 'human',
            content: trimmed,
            timestamp: new Date(),
          };
          appendChatMessage(pointId, message);
          console.log('👤 Message sent. Robot will respond in next round.');
          
          askQuestion();
        });
      };
      
      askQuestion();
    });
  
  // Resolve a decision point
  decisions
    .command('resolve <pointId>')
    .description('Resolve a decision point')
    .requiredOption('-a, --action <action>', 'Action taken')
    .option('-n, --notes <notes>', 'Additional notes')
    .action(async (pointId, options) => {
      const point = loadDecisionPoint(pointId);
      
      if (!point) {
        console.error(`❌ Decision point not found: ${pointId}`);
        process.exit(1);
      }
      
      const decision: HumanDecision = {
        action: options.action,
        notes: options.notes,
        timestamp: new Date(),
        resolvedBy: 'cli-user',
      };
      
      resolveDecisionPoint(pointId, decision);
      console.log(`✅ Decision point ${pointId.slice(0, 8)}... resolved`);
      console.log(`   Action: ${options.action}`);
      if (options.notes) console.log(`   Notes: ${options.notes}`);
    });
  
  // Dismiss a decision point
  decisions
    .command('dismiss <pointId>')
    .description('Dismiss a decision point without resolving')
    .option('-r, --reason <reason>', 'Reason for dismissal')
    .action(async (pointId, options) => {
      dismissDecisionPoint(pointId, options.reason);
      console.log(`⚪ Decision point ${pointId.slice(0, 8)}... dismissed`);
      if (options.reason) console.log(`   Reason: ${options.reason}`);
    });
  
  // Create a decision point (manual)
  decisions
    .command('create')
    .description('Manually create a decision point')
    .requiredOption('-s, --session <id>', 'Session ID')
    .requiredOption('-r, --round <n>', 'Round number')
    .requiredOption('-t, --type <type>', 'Type (gap|fork|failure|milestone|review)')
    .requiredOption('-m, --message <message>', 'Robot message')
    .option('--severity <level>', 'Severity (info|warning|critical)', 'info')
    .action(async (options) => {
      const point = createDecisionPoint(
        options.session,
        parseInt(options.round, 10),
        {
          type: options.type,
          trigger: {
            name: 'manual',
            description: 'Manually created decision point',
            severity: options.severity,
          },
          context: {
            sessionId: options.session,
            roundNumber: parseInt(options.round, 10),
            agentName: 'unknown',
          },
          robotMessage: {
            content: options.message,
            suggestedActions: [],
            timestamp: new Date(),
          },
        }
      );
      
      console.log(`✅ Created decision point: ${point.id}`);
      console.log(`   Session: ${point.sessionId}`);
      console.log(`   Use: summon trainer decisions chat ${point.id}`);
    });
  
  // Detect and create decision points from session
  decisions
    .command('detect')
    .description('Run detectors on a session and create decision points')
    .requiredOption('-s, --session <data>', 'Session JSON data')
    .action(async (options) => {
      const session = JSON.parse(options.session);
      const results = runAllDetectors(session);
      
      console.log(`Detected ${results.length} pattern(s):\n`);
      
      for (const result of results) {
        if (result.detected) {
          console.log(`🔍 ${result.type}: ${result.trigger?.name}`);
          console.log(`   ${result.trigger?.description}`);
          console.log(`   ${result.message?.slice(0, 100)}...\n`);
        }
      }
    });
}
