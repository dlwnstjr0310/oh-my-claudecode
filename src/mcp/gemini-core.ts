/**
 * Gemini Core Business Logic - Shared between SDK and Standalone MCP servers
 *
 * This module contains all the business logic for Gemini CLI integration:
 * - Constants and configuration
 * - CLI execution with timeout handling
 * - File validation and reading
 * - Complete tool handler logic with role validation, fallback chain, etc.
 *
 * This module is SDK-agnostic and can be imported by both:
 * - gemini-server.ts (in-process SDK MCP server)
 * - gemini-standalone-server.ts (stdio-based external process server)
 */

import { spawn } from 'child_process';
import { readFileSync, statSync } from 'fs';
import { resolve } from 'path';
import { detectGeminiCli } from './cli-detection.js';
import { resolveSystemPrompt, buildPromptWithSystemContext } from './prompt-injection.js';

// Default model can be overridden via environment variable
export const GEMINI_DEFAULT_MODEL = process.env.OMC_GEMINI_DEFAULT_MODEL || 'gemini-3-pro-preview';
export const GEMINI_TIMEOUT = Math.min(Math.max(5000, parseInt(process.env.OMC_GEMINI_TIMEOUT || '3600000', 10) || 3600000), 3600000);

// Model fallback chain: try each in order if previous fails
export const GEMINI_MODEL_FALLBACKS = [
  'gemini-3-pro-preview',
  'gemini-3-flash-preview',
  'gemini-2.5-pro',
  'gemini-2.5-flash',
];

// Gemini is best for design review and implementation tasks (leverages 1M context)
export const GEMINI_VALID_ROLES = ['designer', 'writer', 'vision'] as const;

export const MAX_CONTEXT_FILES = 20;
export const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB per file

/**
 * Execute Gemini CLI command and return the response
 */
export function executeGemini(prompt: string, model?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const args = ['--yolo'];
    if (model) {
      args.push('--model', model);
    }
    const child = spawn('gemini', args, {
      stdio: ['pipe', 'pipe', 'pipe']
    });

    const timeoutHandle = setTimeout(() => {
      if (!settled) {
        settled = true;
        child.kill('SIGTERM');
        reject(new Error(`Gemini timed out after ${GEMINI_TIMEOUT}ms`));
      }
    }, GEMINI_TIMEOUT);

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
          resolve(stdout.trim());
        } else {
          reject(new Error(`Gemini exited with code ${code}: ${stderr || 'No output'}`));
        }
      }
    });

    child.on('error', (err) => {
      if (!settled) {
        settled = true;
        clearTimeout(timeoutHandle);
        child.kill('SIGTERM');
        reject(new Error(`Failed to spawn Gemini CLI: ${err.message}`));
      }
    });

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
 * Handle ask_gemini tool request - contains ALL business logic
 *
 * This function is called by both the SDK server and standalone server.
 * It performs:
 * - Agent role validation
 * - CLI detection
 * - System prompt resolution
 * - File context building
 * - Full prompt assembly
 * - Fallback chain execution
 * - Error handling
 *
 * @returns MCP-compatible response with content array
 */
export async function handleAskGemini(args: {
  prompt: string;
  agent_role: string;
  model?: string;
  files?: string[];
}): Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: boolean }> {
  const { prompt, agent_role, model = GEMINI_DEFAULT_MODEL, files } = args;

  // Validate agent_role
  if (!agent_role || !(GEMINI_VALID_ROLES as readonly string[]).includes(agent_role)) {
    return {
      content: [{
        type: 'text' as const,
        text: `Invalid agent_role: "${agent_role}". Gemini requires one of: ${GEMINI_VALID_ROLES.join(', ')}`
      }],
      isError: true
    };
  }

  // Check CLI availability
  const detection = detectGeminiCli();
  if (!detection.available) {
    return {
      content: [{
        type: 'text' as const,
        text: `Gemini CLI is not available: ${detection.error}\n\n${detection.installHint}`
      }],
      isError: true
    };
  }

  // Resolve system prompt from agent role
  const resolvedSystemPrompt = resolveSystemPrompt(undefined, agent_role);

  // Build file context
  let fileContext: string | undefined;
  if (files && files.length > 0) {
    if (files.length > MAX_CONTEXT_FILES) {
      return {
        content: [{
          type: 'text' as const,
          text: `Too many context files (max ${MAX_CONTEXT_FILES}, got ${files.length})`
        }],
        isError: true
      };
    }
    fileContext = files.map(f => validateAndReadFile(f)).join('\n\n');
  }

  // Combine: system prompt > file context > user prompt
  const fullPrompt = buildPromptWithSystemContext(prompt, fileContext, resolvedSystemPrompt);

  // Build fallback chain: start from the requested model
  const requestedModel = model;
  const fallbackIndex = GEMINI_MODEL_FALLBACKS.indexOf(requestedModel);
  const modelsToTry = fallbackIndex >= 0
    ? GEMINI_MODEL_FALLBACKS.slice(fallbackIndex)
    : [requestedModel, ...GEMINI_MODEL_FALLBACKS];

  const errors: string[] = [];
  for (const tryModel of modelsToTry) {
    try {
      const response = await executeGemini(fullPrompt, tryModel);
      const usedFallback = tryModel !== requestedModel;
      const prefix = usedFallback ? `[Fallback: used ${tryModel} instead of ${requestedModel}]\n\n` : '';
      return {
        content: [{
          type: 'text' as const,
          text: `${prefix}${response}`
        }]
      };
    } catch (err) {
      errors.push(`${tryModel}: ${(err as Error).message}`);
    }
  }

  return {
    content: [{
      type: 'text' as const,
      text: `Gemini CLI error: all models failed.\n${errors.join('\n')}`
    }],
    isError: true
  };
}
