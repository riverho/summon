/**
 * File Operations Skill Module
 * 
 * Self-contained skill for file system operations using Node.js fs module.
 * Registers read_file, write_file, list_directory, create_directory tools.
 */

import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { globalToolRegistry } from '../../../runtime/tools.js';
import { existsSync, readFileSync, statSync, writeFileSync, mkdirSync, readdirSync } from 'fs';
import { resolve, isAbsolute, join, dirname } from 'path';

// ============================================================================
// File Reading Tool
// ============================================================================

const createReadFileTool = (): DynamicStructuredTool => {
  return new DynamicStructuredTool({
    name: 'read_file',
    description: 'Read the contents of a file. Returns the file content and metadata.',
    schema: z.object({
      filepath: z.string().describe('The path of the file to read (can be relative or absolute)'),
    }),
    func: async ({ filepath }) => {
      try {
        // Resolve to absolute path
        const absolutePath = isAbsolute(filepath) ? filepath : resolve(process.cwd(), filepath);
        
        // Check if file exists
        if (!existsSync(absolutePath)) {
          return JSON.stringify({
            success: false,
            error: `File not found: ${absolutePath}`,
          });
        }
        
        // Check if it's a directory
        const stats = statSync(absolutePath);
        if (stats.isDirectory()) {
          return JSON.stringify({
            success: false,
            error: `Path is a directory, not a file: ${absolutePath}`,
          });
        }
        
        // Read the file
        const content = readFileSync(absolutePath, 'utf-8');
        return JSON.stringify({
          success: true,
          filepath: absolutePath,
          size: content.length,
          content,
        });
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        return JSON.stringify({
          success: false,
          error: `Failed to read file: ${errorMsg}`,
        });
      }
    },
  });
};

// ============================================================================
// File Writing Tool
// ============================================================================

const createWriteFileTool = (): DynamicStructuredTool => {
  return new DynamicStructuredTool({
    name: 'write_file',
    description: 'Write content to a file. Checks if parent directory exists before creating folders. Returns success status and file info.',
    schema: z.object({
      filepath: z.string().describe('The path where the file should be written (can be relative or absolute)'),
      content: z.string().describe('The content to write to the file'),
      overwrite: z.boolean().optional().default(false).describe('Whether to overwrite if file exists (default: false)'),
    }),
    func: async ({ filepath, content, overwrite = false }) => {
      try {
        // Resolve to absolute path
        let absolutePath: string;
        if (isAbsolute(filepath)) {
          absolutePath = filepath;
        } else if (filepath.startsWith('./') || filepath.startsWith('../')) {
          absolutePath = resolve(process.cwd(), filepath);
        } else {
          // Use current working directory for relative paths
          absolutePath = resolve(process.cwd(), filepath);
        }

        const directory = dirname(absolutePath);
        
        // Check if file already exists
        if (!overwrite && existsSync(absolutePath)) {
          return JSON.stringify({
            success: false,
            error: `File already exists: ${absolutePath}. Use overwrite=true to replace it.`,
          });
        }
        
        // Check if directory exists
        if (!existsSync(directory)) {
          // Verify parent directory exists before creating
          const parentDir = dirname(directory);
          if (!existsSync(parentDir)) {
            return JSON.stringify({
              success: false,
              error: `Parent directory does not exist: ${parentDir}. Please create it first or use a valid path.`,
            });
          }
          // Only create one level of directory
          mkdirSync(directory, { recursive: true });
        }
        
        // Write the file
        writeFileSync(absolutePath, content, 'utf-8');
        return JSON.stringify({
          success: true,
          filepath: absolutePath,
          size: content.length,
          message: `Successfully wrote ${content.length} bytes to ${absolutePath}`,
        });
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        return JSON.stringify({
          success: false,
          error: `Failed to write file: ${errorMsg}`,
        });
      }
    },
  });
};

// ============================================================================
// Directory Listing Tool
// ============================================================================

const createListDirectoryTool = (): DynamicStructuredTool => {
  return new DynamicStructuredTool({
    name: 'list_directory',
    description: 'List the contents of a directory. Returns files and subdirectories with their metadata.',
    schema: z.object({
      dirpath: z.string().optional().default('.').describe('The directory path to list (can be relative or absolute, defaults to current directory)'),
    }),
    func: async ({ dirpath = '.' }) => {
      try {
        // Resolve to absolute path
        const absolutePath = isAbsolute(dirpath) ? dirpath : resolve(process.cwd(), dirpath);
        
        // Check if directory exists
        if (!existsSync(absolutePath)) {
          return JSON.stringify({
            success: false,
            error: `Directory not found: ${absolutePath}`,
          });
        }
        
        // Check if it's actually a directory
        const stats = statSync(absolutePath);
        if (!stats.isDirectory()) {
          return JSON.stringify({
            success: false,
            error: `Path is not a directory: ${absolutePath}`,
          });
        }
        
        // Read directory contents
        const entries = readdirSync(absolutePath);
        
        // Get details for each entry
        const items = entries.map(name => {
          const itemPath = join(absolutePath, name);
          const itemStats = statSync(itemPath);
          return {
            name,
            type: itemStats.isDirectory() ? 'directory' : 'file',
            size: itemStats.isFile() ? itemStats.size : undefined,
            modified: itemStats.mtime.toISOString(),
          };
        });
        
        return JSON.stringify({
          success: true,
          directory: absolutePath,
          count: items.length,
          items,
        });
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        return JSON.stringify({
          success: false,
          error: `Failed to list directory: ${errorMsg}`,
        });
      }
    },
  });
};

// ============================================================================
// Directory Creation Tool
// ============================================================================

const createCreateDirectoryTool = (): DynamicStructuredTool => {
  return new DynamicStructuredTool({
    name: 'create_directory',
    description: 'Create a new directory. Can optionally create parent directories recursively. Returns success status.',
    schema: z.object({
      dirpath: z.string().describe('The directory path to create (can be relative or absolute)'),
      recursive: z.boolean().optional().default(false).describe('Create parent directories if needed (default: false)'),
    }),
    func: async ({ dirpath, recursive = false }) => {
      try {
        // Resolve to absolute path
        const absolutePath = isAbsolute(dirpath) ? dirpath : resolve(process.cwd(), dirpath);
        
        // Check if directory already exists
        if (existsSync(absolutePath)) {
          return JSON.stringify({
            success: false,
            error: `Directory already exists: ${absolutePath}`,
          });
        }
        
        // If not recursive, check parent exists
        if (!recursive) {
          const parentDir = dirname(absolutePath);
          if (!existsSync(parentDir)) {
            return JSON.stringify({
              success: false,
              error: `Parent directory does not exist: ${parentDir}. Use recursive=true to create parent directories.`,
            });
          }
        }
        
        // Create the directory
        mkdirSync(absolutePath, { recursive });
        
        return JSON.stringify({
          success: true,
          path: absolutePath,
          message: `Successfully created directory: ${absolutePath}`,
        });
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        return JSON.stringify({
          success: false,
          error: `Failed to create directory: ${errorMsg}`,
        });
      }
    },
  });
};

// ============================================================================
// Skill Definition
// ============================================================================

export const fileSkill = {
  id: 'file',
  name: 'File Operations',
  capabilities: [
    'Read file contents with metadata',
    'Write content to files with safety checks',
    'List directory contents with file/directory metadata',
    'Create new directories with optional recursive creation',
  ],
  requiredTools: ['read_file', 'write_file', 'list_directory', 'create_directory'],
  triggerKeywords: [
    'read', 'file', 'write', 'save', 'list', 'directory', 'folder',
    'create', 'mkdir', 'ls', 'cat', 'edit', 'view', 'open',
    'contents', 'path', 'exists', 'size', 'modified',
  ],
  promptFragment: `You can perform file system operations:
- Read files: get contents, size, and modification dates
- Write files: create or overwrite files with content
- List directories: see files and folders with metadata
- Create directories: make new folders, optionally with parent directories

Paths can be relative (to current working directory) or absolute.
Safety checks prevent accidental overwrites and validate paths.`,
};

// ============================================================================
// Tool Registration
// ============================================================================

globalToolRegistry.register({
  name: 'read_file',
  tool: createReadFileTool(),
  description: 'Read the contents of a file. Returns the file content and metadata.',
});

globalToolRegistry.register({
  name: 'write_file',
  tool: createWriteFileTool(),
  description: 'Write content to a file. Checks if parent directory exists before creating folders.',
});

globalToolRegistry.register({
  name: 'list_directory',
  tool: createListDirectoryTool(),
  description: 'List the contents of a directory. Returns files and subdirectories with their metadata.',
});

globalToolRegistry.register({
  name: 'create_directory',
  tool: createCreateDirectoryTool(),
  description: 'Create a new directory. Can optionally create parent directories recursively.',
});
