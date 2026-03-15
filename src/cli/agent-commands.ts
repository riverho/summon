/**
 * summon agent — True Agent CLI Commands
 * 
 * Usage:
 *   summon agent create --name portfolio --objective "Monitor daily"
 *   summon agent run portfolio --ritual river@watcher
 *   summon agent status portfolio
 *   summon agent list
 */

import { Command } from 'commander';
import { TrueAgentRuntime } from '../agent/runtime.js';
import { getSelfMonitor } from '../agent/self-monitor.js';
import { loadRitual } from '../ritual/loader.js';

export function createAgentCommands(): Command {
  const agent = new Command('agent')
    .description('True agent mode with self-monitoring and auto-steering');

  // Create persistent goal
  agent
    .command('create')
    .description('Create a new true agent goal')
    .requiredOption('-n, --name <name>', 'Goal identifier')
    .requiredOption('-o, --objective <objective>', 'What the agent should do')
    .option('-r, --ritual <ritual>', 'Ritual to use (owner@name)')
    .option('--min-success <rate>', 'Minimum tool success rate (0-1)', '0.7')
    .option('--max-latency <ms>', 'Maximum acceptable latency', '5000')
    .option('--max-interventions <n>', 'Max human steers before pivot', '3')
    .option('--auto-steer', 'Auto-trigger steering on degradation', true)
    .action((options) => {
      const monitor = getSelfMonitor();
      
      monitor.createGoal({
        id: options.name,
        objective: options.objective,
        thresholds: {
          minSuccessRate: parseFloat(options.minSuccess),
          maxLatency: parseInt(options.maxLatency),
          maxInterventions: parseInt(options.maxInterventions)
        }
      });
      
      console.log(`✅ Created agent goal: ${options.name}`);
      console.log(`   Objective: ${options.objective}`);
      console.log(`   Ritual: ${options.ritual || 'none (specify when running)'}`);
      console.log(`   Auto-steer: ${options.autoSteer ? 'enabled' : 'disabled'}`);
      
      if (options.autoSteer) {
        console.log(`\n   Thresholds:`);
        console.log(`     - Min success rate: ${(parseFloat(options.minSuccess) * 100).toFixed(0)}%`);
        console.log(`     - Max latency: ${options.maxLatency}ms`);
        console.log(`     - Max interventions: ${options.maxInterventions}`);
      }
    });

  // Run agent with self-monitoring
  agent
    .command('run')
    .description('Run ritual as true agent with self-monitoring')
    .argument('<goal-name>', 'Goal to execute')
    .requiredOption('-r, --ritual <ritual>', 'Ritual reference (owner@name)')
    .option('-q, --query <query>', 'Initial query', 'Execute objective')
    .option('--no-auto-steer', 'Disable auto-steering')
    .action(async (goalName, options) => {
      console.log(`🤖 Running agent: ${goalName}`);
      console.log(`   Ritual: ${options.ritual}`);
      console.log(`   Query: "${options.query}"`);
      console.log('');
      
      try {
        // Load ritual
        const ritual = await loadRitual(options.ritual);
        
        // Create true agent runtime
        const runtime = new TrueAgentRuntime({
          goalId: goalName,
          objective: ritual.persona.goal || options.objective || 'Execute ritual',
          autoSteer: options.autoSteer
        });
        
        // Execute with self-monitoring
        const result = await runtime.execute(ritual, {
          query: options.query,
          options: {
            streaming: true
          }
        });
        
        console.log('\n📊 Self-Evaluation:');
        console.log(`   Health: ${result.selfEvaluation?.overallHealth}`);
        console.log(`   Confidence: ${(result.selfEvaluation?.confidence || 0 * 100).toFixed(0)}%`);
        
        if (result.autoSteerTriggered) {
          console.log('\n⚡ Auto-Steer Triggered:');
          console.log(`   Action: ${result.recommendedAction}`);
          console.log(`   Reason: ${result.selfEvaluation?.reasoning}`);
        }
        
      } catch (error) {
        console.error('❌ Agent execution failed:', error);
        process.exit(1);
      }
    });

  // Check agent health
  agent
    .command('health')
    .description('Check agent self-evaluation')
    .argument('<goal-name>', 'Goal to check')
    .action(async (goalName) => {
      const monitor = getSelfMonitor();
      const evaluation = monitor.evaluate(goalName);
      
      console.log(`🏥 Agent Health: ${goalName}`);
      console.log('');
      console.log(`   Status: ${evaluation.overallHealth.toUpperCase()}`);
      console.log(`   Confidence: ${(evaluation.confidence * 100).toFixed(0)}%`);
      console.log(`   Recommended: ${evaluation.recommendedAction}`);
      
      if (evaluation.primaryIssue) {
        console.log(`   Issue: ${evaluation.primaryIssue}`);
      }
      
      console.log(`   Reasoning: ${evaluation.reasoning}`);
      
      // Propose action
      if (evaluation.recommendedAction !== 'continue') {
        const steer = await monitor.autoSteer(goalName, evaluation);
        console.log('\n💡 Proposal:');
        console.log(`   ${steer.proposal}`);
        
        if (steer.humanGate) {
          console.log('\n⚠️  Human approval required for action.');
        }
      }
    });

  // List all agent goals
  agent
    .command('list')
    .description('List all agent goals and their health')
    .action(() => {
      const monitor = getSelfMonitor();
      
      // This would need enhancement to list all goals
      console.log('📋 Agent Goals:');
      console.log('   (Run "summon agent health <name>" for each goal)');
      console.log('');
      console.log('   To create a goal:');
      console.log('   summon agent create -n <name> -o "objective"');
    });

  // Proactive check (for cron/heartbeat)
  agent
    .command('check')
    .description('Check if any goals need attention (for cron)')
    .action(async () => {
      // Would iterate through all goals
      console.log('🔍 Checking all agent goals...');
      console.log('   (Implementation: iterate goals, evaluate each)');
    });

  return agent;
}
