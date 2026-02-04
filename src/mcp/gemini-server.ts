/**
 * Gemini MCP Server - In-process MCP server for Google Gemini CLI integration
 *
 * Exposes `ask_gemini` tool via the Claude Agent SDK's createSdkMcpServer helper.
 * Tools will be available as mcp__g__ask_gemini
 *
 * Note: The standalone version (gemini-standalone-server.ts) is used for the
 * external-process .mcp.json registration with proper stdio transport.
 */

import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { spawn } from 'child_process';
import { readFileSync } from 'fs';
import { detectGeminiCli } from './cli-detection.js';
import { resolveSystemPrompt, buildPromptWithSystemContext } from './prompt-injection.js';

// Default model can be overridden via environment variable
const GEMINI_DEFAULT_MODEL = process.env.OMC_GEMINI_DEFAULT_MODEL || 'gemini-3-pro-preview';
const GEMINI_TIMEOUT = parseInt(process.env.OMC_GEMINI_TIMEOUT || '120000', 10);

// Model fallback chain: try each in order if previous fails
const GEMINI_MODEL_FALLBACKS = [
  'gemini-3-pro-preview',
  'gemini-3-flash-preview',
  'gemini-2.5-pro',
  'gemini-2.5-flash',
];

// Gemini is best for design review and implementation tasks (leverages 1M context)
const GEMINI_VALID_ROLES = ['designer', 'executor'] as const;

/**
 * Execute Gemini CLI command and return the response
 */
function executeGemini(prompt: string, model?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const args = ['--yolo'];
    if (model) {
      args.push('--model', model);
    }
    const child = spawn('gemini', args, {
      timeout: GEMINI_TIMEOUT,
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data: Buffer) => {
      stdout += data.toString();
    });

    child.stderr.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    child.on('close', (code) => {
      if (code === 0 || stdout.trim()) {
        resolve(stdout.trim());
      } else {
        reject(new Error(`Gemini exited with code ${code}: ${stderr || 'No output'}`));
      }
    });

    child.on('error', (err) => {
      reject(new Error(`Failed to spawn Gemini CLI: ${err.message}`));
    });

    // Pipe prompt via stdin to avoid OS argument length limits
    child.stdin.write(prompt);
    child.stdin.end();
  });
}

// Define the ask_gemini tool using the SDK tool() helper
const askGeminiTool = tool(
  "ask_gemini",
  "Send a prompt to Google Gemini CLI for design review or implementation validation. Gemini excels at analyzing large codebases with its 1M token context window. Requires agent_role (designer or executor). Requires Gemini CLI (npm install -g @google/gemini-cli).",
  {
    prompt: { type: "string", description: "The prompt to send to Gemini" },
    agent_role: { type: "string", description: `Required. Agent perspective for Gemini: ${GEMINI_VALID_ROLES.join(', ')}. Gemini is optimized for design review and implementation tasks.` },
    model: { type: "string", description: `Gemini model to use (default: ${GEMINI_DEFAULT_MODEL}). Automatic fallback chain: ${GEMINI_MODEL_FALLBACKS.join(' → ')}` },
    files: { type: "array", items: { type: "string" }, description: "File paths for Gemini to analyze (leverages 1M token context window)" },
  } as any,
  async (args: any) => {
    const { prompt, agent_role, model = GEMINI_DEFAULT_MODEL, files } = args as {
      prompt: string;
      agent_role: string;
      model?: string;
      files?: string[];
    };

    // Validate agent_role
    if (!agent_role || !(GEMINI_VALID_ROLES as readonly string[]).includes(agent_role)) {
      return {
        content: [{
          type: 'text' as const,
          text: `Invalid agent_role: "${agent_role}". Gemini requires one of: ${GEMINI_VALID_ROLES.join(', ')}`
        }]
      };
    }

    // Check CLI availability
    const detection = detectGeminiCli();
    if (!detection.available) {
      return {
        content: [{
          type: 'text' as const,
          text: `Gemini CLI is not available: ${detection.error}\n\n${detection.installHint}`
        }]
      };
    }

    // Resolve system prompt from agent role
    const resolvedSystemPrompt = resolveSystemPrompt(undefined, agent_role);

    // Build file context
    let fileContext: string | undefined;
    if (files && files.length > 0) {
      fileContext = files.map(f => {
        try {
          return `--- File: ${f} ---\n${readFileSync(f, 'utf-8')}`;
        } catch (err) {
          return `--- File: ${f} --- (Error reading: ${(err as Error).message})`;
        }
      }).join('\n\n');
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
      }]
    };
  }
);

/**
 * In-process MCP server exposing Gemini CLI integration
 *
 * Tools will be available as mcp__g__ask_gemini
 */
export const geminiMcpServer = createSdkMcpServer({
  name: "g",
  version: "1.0.0",
  tools: [askGeminiTool]
});

/**
 * Tool names for allowedTools configuration
 */
export const geminiToolNames = ['ask_gemini'];
