/**
 * Codex MCP Core - Shared business logic for Codex CLI integration
 *
 * This module contains all the business logic for the Codex MCP integration.
 * It is imported by both the in-process SDK server (codex-server.ts) and the
 * standalone stdio server to eliminate code duplication.
 *
 * This module is SDK-agnostic and contains no dependencies on @anthropic-ai/claude-agent-sdk.
 */

import { spawn } from 'child_process';
import { readFileSync, statSync } from 'fs';
import { resolve } from 'path';
import { detectCodexCli } from './cli-detection.js';
import { resolveSystemPrompt, buildPromptWithSystemContext } from './prompt-injection.js';

// Default model can be overridden via environment variable
export const CODEX_DEFAULT_MODEL = process.env.OMC_CODEX_DEFAULT_MODEL || 'gpt-5.2';
export const CODEX_TIMEOUT = Math.min(Math.max(5000, parseInt(process.env.OMC_CODEX_TIMEOUT || '3600000', 10) || 3600000), 3600000);

// Codex is best for analytical/planning tasks
export const CODEX_VALID_ROLES = ['architect', 'planner', 'critic', 'analyst', 'code-reviewer', 'security-reviewer', 'tdd-guide'] as const;

export const MAX_CONTEXT_FILES = 20;
export const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB per file

/**
 * Parse Codex JSONL output to extract the final text response
 */
export function parseCodexOutput(output: string): string {
  const lines = output.trim().split('\n').filter(l => l.trim());
  const messages: string[] = [];

  for (const line of lines) {
    try {
      const event = JSON.parse(line);
      // Look for message events with text content
      if (event.type === 'message' && event.content) {
        if (typeof event.content === 'string') {
          messages.push(event.content);
        } else if (Array.isArray(event.content)) {
          for (const part of event.content) {
            if (part.type === 'text' && part.text) {
              messages.push(part.text);
            }
          }
        }
      }
      // Also handle output_text events
      if (event.type === 'output_text' && event.text) {
        messages.push(event.text);
      }
    } catch {
      // Skip non-JSON lines (progress indicators, etc.)
    }
  }

  return messages.join('\n') || output; // Fallback to raw output
}

/**
 * Execute Codex CLI command and return the response
 */
export function executeCodex(prompt: string, model: string): Promise<string> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const args = ['exec', '-m', model, '--json', '--full-auto'];
    const child = spawn('codex', args, {
      stdio: ['pipe', 'pipe', 'pipe']
    });

    // Manual timeout handling to ensure proper cleanup
    const timeoutHandle = setTimeout(() => {
      if (!settled) {
        settled = true;
        child.kill('SIGTERM');
        reject(new Error(`Codex timed out after ${CODEX_TIMEOUT}ms`));
      }
    }, CODEX_TIMEOUT);

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data: Buffer) => {
      stdout += data.toString();
    });

    child.stderr.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    child.on('close', (code) => {
      if (!settled) {
        settled = true;
        clearTimeout(timeoutHandle);
        if (code === 0 || stdout.trim()) {
          resolve(parseCodexOutput(stdout));
        } else {
          reject(new Error(`Codex exited with code ${code}: ${stderr || 'No output'}`));
        }
      }
    });

    child.on('error', (err) => {
      if (!settled) {
        settled = true;
        clearTimeout(timeoutHandle);
        child.kill('SIGTERM');
        reject(new Error(`Failed to spawn Codex CLI: ${err.message}`));
      }
    });

    // Pipe prompt via stdin with error handling
    child.stdin.on('error', (err) => {
      if (!settled) {
        settled = true;
        clearTimeout(timeoutHandle);
        child.kill('SIGTERM');
        reject(new Error(`Stdin write error: ${err.message}`));
      }
    });
    child.stdin.write(prompt);
    child.stdin.end();
  });
}

/**
 * Validate and read a file for context inclusion
 */
export function validateAndReadFile(filePath: string): string {
  if (typeof filePath !== 'string') {
    return `--- File: ${filePath} --- (Invalid path type)`;
  }
  try {
    const resolved = resolve(filePath);

    // Security: ensure file is within working directory (worktree boundary)
    const cwd = process.cwd();
    if (!resolved.startsWith(cwd + '/') && resolved !== cwd) {
      return `[BLOCKED] File '${filePath}' is outside the working directory. Only files within the project are allowed.`;
    }

    const stats = statSync(resolved);
    if (!stats.isFile()) {
      return `--- File: ${filePath} --- (Not a regular file)`;
    }
    if (stats.size > MAX_FILE_SIZE) {
      return `--- File: ${filePath} --- (File too large: ${(stats.size / 1024 / 1024).toFixed(1)}MB, max 5MB)`;
    }
    return `--- File: ${filePath} ---\n${readFileSync(resolved, 'utf-8')}`;
  } catch {
    return `--- File: ${filePath} --- (Error reading file)`;
  }
}

/**
 * Handle ask_codex tool invocation with all business logic
 *
 * This function contains ALL the tool handler logic and can be used by both
 * the SDK server and the standalone stdio server.
 */
export async function handleAskCodex(args: {
  prompt: string;
  agent_role: string;
  model?: string;
  context_files?: string[];
}): Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: boolean }> {
  const { prompt, agent_role, model = CODEX_DEFAULT_MODEL, context_files } = args;

  // Validate agent_role
  if (!agent_role || !(CODEX_VALID_ROLES as readonly string[]).includes(agent_role)) {
    return {
      content: [{
        type: 'text' as const,
        text: `Invalid agent_role: "${agent_role}". Codex requires one of: ${CODEX_VALID_ROLES.join(', ')}`
      }],
      isError: true
    };
  }

  // Check CLI availability
  const detection = detectCodexCli();
  if (!detection.available) {
    return {
      content: [{
        type: 'text' as const,
        text: `Codex CLI is not available: ${detection.error}\n\n${detection.installHint}`
      }],
      isError: true
    };
  }

  // Resolve system prompt from agent role
  const resolvedSystemPrompt = resolveSystemPrompt(undefined, agent_role);

  // Build file context
  let fileContext: string | undefined;
  if (context_files && context_files.length > 0) {
    if (context_files.length > MAX_CONTEXT_FILES) {
      return {
        content: [{
          type: 'text' as const,
          text: `Too many context files (max ${MAX_CONTEXT_FILES}, got ${context_files.length})`
        }],
        isError: true
      };
    }
    fileContext = context_files.map(f => validateAndReadFile(f)).join('\n\n');
  }

  // Combine: system prompt > file context > user prompt
  const fullPrompt = buildPromptWithSystemContext(prompt, fileContext, resolvedSystemPrompt);

  try {
    const response = await executeCodex(fullPrompt, model);
    return {
      content: [{
        type: 'text' as const,
        text: response
      }]
    };
  } catch (err) {
    return {
      content: [{
        type: 'text' as const,
        text: `Codex CLI error: ${(err as Error).message}`
      }],
      isError: true
    };
  }
}
