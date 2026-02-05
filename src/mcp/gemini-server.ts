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
import {
  GEMINI_DEFAULT_MODEL,
  GEMINI_MODEL_FALLBACKS,
  GEMINI_VALID_ROLES,
  handleAskGemini
} from './gemini-core.js';

// Define the ask_gemini tool using the SDK tool() helper
const askGeminiTool = tool(
  "ask_gemini",
  "Send a prompt to Google Gemini CLI for design review or implementation validation. Gemini excels at analyzing large codebases with its 1M token context window. Requires agent_role to specify the perspective (designer, writer, or vision). Requires Gemini CLI (npm install -g @google/gemini-cli).",
  {
    agent_role: { type: "string", description: `Required. Agent perspective for Gemini: ${GEMINI_VALID_ROLES.join(', ')}. Gemini is optimized for design review and implementation tasks.` },
    files: { type: "array", items: { type: "string" }, description: "File paths for Gemini to analyze (leverages 1M token context window)" },
    prompt: { type: "string", description: "The prompt to send to Gemini" },
    model: { type: "string", description: `Gemini model to use (default: ${GEMINI_DEFAULT_MODEL}). Automatic fallback chain: ${GEMINI_MODEL_FALLBACKS.join(' → ')}` },
  } as any,
  async (args: any) => {
    const { prompt, agent_role, model, files } = args as {
      prompt: string;
      agent_role: string;
      model?: string;
      files?: string[];
    };

    return handleAskGemini({ prompt, agent_role, model, files });
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
