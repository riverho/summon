import { execSync } from 'node:child_process';

/**
 * Git Skill Module
 * 
 * Self-contained skill for Git operations using simple git commands.
 * Registers git_search tool with the global registry.
 */

import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { globalToolRegistry } from '../../../runtime/tools.js';

// ============================================================================
// Git Operations
// ============================================================================

interface GitExecResult {
  stdout: string;
  stderr: string;
  code: number;
}

async function execGit(args: string[], cwd?: string): Promise<GitExecResult> {
  try {
    const stdout = execSync('git ' + args.join(' '), {
      cwd: cwd || process.cwd(),
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024, // 10MB
    });
    return { stdout, stderr: '', code: 0 };
  } catch (error: unknown) {
    const err = error as { stdout?: string; stderr?: string; status?: number };
    return {
      stdout: err.stdout || '',
      stderr: err.stderr || String(error),
      code: err.status || 1,
    };
  }
}

// ============================================================================
// Tool: Git Status
// ============================================================================

const createGitStatusTool = (): DynamicStructuredTool => {
  return new DynamicStructuredTool({
    name: 'git_status',
    description: 'Show working tree status (modified, staged, untracked files)',
    schema: z.object({
      repo: z.string().optional().describe('Repository path (default: current directory)'),
    }),
    func: async ({ repo }) => {
      const result = await execGit(['status', '--porcelain'], repo);
      if (result.code !== 0) {
        return JSON.stringify({ error: result.stderr });
      }

      const lines = result.stdout.trim().split('\n').filter(Boolean);
      const files = lines.map(line => ({
        status: line.slice(0, 2).trim(),
        path: line.slice(3).trim(),
      }));

      return JSON.stringify({
        repo: repo || process.cwd(),
        modified: files.filter(f => f.status.includes('M')).length,
        staged: files.filter(f => f.status.includes('A') || f.status.includes('D')).length,
        untracked: files.filter(f => f.status.includes('??')).length,
        files,
        raw: result.stdout,
      });
    },
  });
};

// ============================================================================
// Tool: Git Log
// ============================================================================

const createGitLogTool = (): DynamicStructuredTool => {
  return new DynamicStructuredTool({
    name: 'git_log',
    description: 'Show recent commits with hash, author, date, and message',
    schema: z.object({
      repo: z.string().optional().describe('Repository path'),
      count: z.number().optional().default(10).describe('Number of commits to show'),
    }),
    func: async ({ repo, count = 10 }) => {
      const result = await execGit(['log', '--oneline', '-n', String(count), '--pretty=format:%h|%an|%ad|%s', '--date=short'], repo);
      if (result.code !== 0) {
        return JSON.stringify({ error: result.stderr });
      }

      const commits = result.stdout.trim().split('\n').filter(Boolean).map(line => {
        const [hash, author, date, ...msgParts] = line.split('|');
        return { hash, author, date, message: msgParts.join('|') };
      });

      return JSON.stringify({
        repo: repo || process.cwd(),
        count: commits.length,
        commits,
      });
    },
  });
};

// ============================================================================
// Tool: Git Diff
// ============================================================================

const createGitDiffTool = (): DynamicStructuredTool => {
  return new DynamicStructuredTool({
    name: 'git_diff',
    description: 'Show changes between commits, commit and working tree',
    schema: z.object({
      repo: z.string().optional().describe('Repository path'),
      cached: z.boolean().optional().default(false).describe('Show staged changes only'),
      file: z.string().optional().describe('Show diff for specific file'),
    }),
    func: async ({ repo, cached = false, file }) => {
      const args = ['diff'];
      if (cached) args.push('--cached');
      if (file) args.push(file);
      
      const result = await execGit(args, repo);
      if (result.code !== 0) {
        return JSON.stringify({ error: result.stderr });
      }

      return JSON.stringify({
        repo: repo || process.cwd(),
        cached,
        file,
        diff: result.stdout || '(no changes)',
      });
    },
  });
};

// ============================================================================
// Tool: Git Branch
// ============================================================================

const createGitBranchTool = (): DynamicStructuredTool => {
  return new DynamicStructuredTool({
    name: 'git_branch',
    description: 'List, create, or delete branches',
    schema: z.object({
      repo: z.string().optional().describe('Repository path'),
      create: z.string().optional().describe('Create a new branch'),
      delete: z.string().optional().describe('Delete a branch'),
      list: z.boolean().optional().default(true).describe('List all branches'),
    }),
    func: async ({ repo, create, delete: deleteBranch, list = true }) => {
      if (create) {
        const result = await execGit(['checkout', '-b', create], repo);
        return JSON.stringify({
          action: 'create',
          branch: create,
          success: result.code === 0,
          output: result.stderr || result.stdout,
        });
      }

      if (deleteBranch) {
        const result = await execGit(['branch', '-D', deleteBranch], repo);
        return JSON.stringify({
          action: 'delete',
          branch: deleteBranch,
          success: result.code === 0,
          output: result.stderr || result.stdout,
        });
      }

      if (list) {
        const result = await execGit(['branch', '-a', '--format=%(refname:short)'], repo);
        const branches = result.stdout.trim().split('\n').filter(Boolean);
        const currentResult = await execGit(['rev-parse', '--abbrev-ref', 'HEAD'], repo);
        const current = currentResult.stdout.trim();

        return JSON.stringify({
          repo: repo || process.cwd(),
          current,
          branches,
          count: branches.length,
        });
      }

      return JSON.stringify({ error: 'No action specified' });
    },
  });
};

// ============================================================================
// Tool: Git Search (Simple repo search)
// ============================================================================

const createGitSearchTool = (): DynamicStructuredTool => {
  return new DynamicStructuredTool({
    name: 'git_search',
    description: 'Search for commits, files, or patterns in git history',
    schema: z.object({
      repo: z.string().optional().describe('Repository path'),
      query: z.string().describe('Search pattern'),
      type: z.enum(['commit', 'file', 'grep']).optional().default('commit').describe('Search type'),
      count: z.number().optional().default(20).describe('Max results'),
    }),
    func: async ({ repo, query, type = 'commit', count = 20 }) => {
      let args: string[];

      if (type === 'commit') {
        args = ['log', '--oneline', '--grep', query, '-n', String(count)];
      } else if (type === 'file') {
        args = ['ls-files', query];
      } else {
        args = ['grep', '--oneline', '-n', query];
      }

      const result = await execGit(args, repo);
      if (result.code !== 0) {
        return JSON.stringify({ error: result.stderr });
      }

      const results = result.stdout.trim().split('\n').filter(Boolean);

      return JSON.stringify({
        repo: repo || process.cwd(),
        query,
        type,
        count: results.length,
        results,
      });
    },
  });
};

// ============================================================================
// Skill Definition
// ============================================================================

export const gitSkill = {
  id: 'git',
  name: 'Git Operations',
  capabilities: [
    'Check repository status (modified, staged, untracked files)',
    'View commit history',
    'Show diffs between commits or working tree',
    'Manage branches (list, create, delete)',
    'Search git history for commits or patterns',
  ],
  requiredTools: ['git_status', 'git_log', 'git_diff', 'git_branch', 'git_search'],
  triggerKeywords: [
    'git', 'commit', 'branch', 'status', 'diff', 'log',
    'checkout', 'merge', 'rebase', 'push', 'pull',
    'staged', 'modified', 'untracked',
  ],
  promptFragment: `You can help with Git operations:
- Check status: modified files, staged changes, untracked files
- View commit history with author, date, and messages
- Show diffs between commits or working tree
- List, create, and delete branches
- Search commit history for patterns

Always show clear, concise output. Use tables for multiple commits.`,
};

// ============================================================================
// Tool Registration (called on module load)
// ============================================================================

globalToolRegistry.register({
  name: 'git_status',
  tool: createGitStatusTool(),
  description: 'Show working tree status (modified, staged, untracked files)',
});

globalToolRegistry.register({
  name: 'git_log',
  tool: createGitLogTool(),
  description: 'Show recent commits with hash, author, date, and message',
});

globalToolRegistry.register({
  name: 'git_diff',
  tool: createGitDiffTool(),
  description: 'Show changes between commits, commit and working tree',
});

globalToolRegistry.register({
  name: 'git_branch',
  tool: createGitBranchTool(),
  description: 'List, create, or delete branches',
});

globalToolRegistry.register({
  name: 'git_search',
  tool: createGitSearchTool(),
  description: 'Search commits, files, or patterns in git history',
});

