/**
 * Stop Hook Callbacks (#395)
 * 
 * Sends notifications when Claude Code sessions end via:
 * - File system (write session summary to disk)
 * - Telegram bot
 * - Discord webhook
 */

import { SessionMetrics } from './index.js';
import { getSisyphusConfig } from '../../features/auto-update.js';
import { writeFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { homedir } from 'os';

/**
 * Format session summary for notifications
 */
export function formatSessionSummary(metrics: SessionMetrics): string {
  const duration = metrics.duration_ms 
    ? `${Math.floor(metrics.duration_ms / 1000 / 60)}m ${Math.floor((metrics.duration_ms / 1000) % 60)}s`
    : 'unknown';
    
  const modesUsed = metrics.modes_used.length > 0 
    ? metrics.modes_used.join(', ') 
    : 'none';
  
  return `
🦐 **Session Ended**

**Session ID:** \`${metrics.session_id}\`
**Duration:** ${duration}
**Reason:** ${metrics.reason}
**Agents Spawned:** ${metrics.agents_spawned}
**Agents Completed:** ${metrics.agents_completed}
**Modes Used:** ${modesUsed}
**Started At:** ${metrics.started_at || 'unknown'}
**Ended At:** ${metrics.ended_at}
  `.trim();
}

/**
 * Interpolate path placeholders
 * Supports: {session_id}, {date}, {time}
 */
function interpolatePath(path: string, sessionId: string): string {
  const now = new Date();
  const date = now.toISOString().split('T')[0]; // YYYY-MM-DD
  const time = now.toISOString().split('T')[1].split('.')[0].replace(/:/g, '-'); // HH-MM-SS
  
  return path
    .replace(/~/g, homedir())
    .replace(/{session_id}/g, sessionId)
    .replace(/{date}/g, date)
    .replace(/{time}/g, time);
}

/**
 * File system callback
 * Writes session summary to a file
 */
async function writeToFile(
  path: string, 
  content: string, 
  sessionId: string,
  format: 'markdown' | 'json' = 'markdown'
): Promise<void> {
  try {
    const resolvedPath = interpolatePath(path, sessionId);
    const dir = dirname(resolvedPath);
    
    // Ensure directory exists
    mkdirSync(dir, { recursive: true });
    
    // Format content
    let finalContent = content;
    if (format === 'json') {
      // Parse markdown summary back to structured data (simplified)
      finalContent = JSON.stringify({
        session_id: sessionId,
        summary: content,
        timestamp: new Date().toISOString(),
      }, null, 2);
    }
    
    // Write file
    writeFileSync(resolvedPath, finalContent, 'utf-8');
    console.log(`[stop-callback] Session summary written to ${resolvedPath}`);
  } catch (error) {
    console.error('[stop-callback] File write failed:', error);
    // Don't throw - callback failures shouldn't block session end
  }
}

/**
 * Telegram callback
 * Sends message via Telegram Bot API
 */
async function sendTelegram(
  config: { botToken?: string; chatId?: string },
  message: string
): Promise<void> {
  if (!config.botToken || !config.chatId) {
    console.error('[stop-callback] Telegram: missing botToken or chatId');
    return;
  }
  
  try {
    const url = `https://api.telegram.org/bot${config.botToken}/sendMessage`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: config.chatId,
        text: message,
        parse_mode: 'Markdown',
      }),
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Telegram API error: ${response.status} - ${errorText}`);
    }
    
    console.log('[stop-callback] Telegram notification sent');
  } catch (error) {
    console.error('[stop-callback] Telegram send failed:', error);
  }
}

/**
 * Discord callback
 * Sends message via Discord webhook
 */
async function sendDiscord(
  config: { webhookUrl?: string },
  message: string
): Promise<void> {
  if (!config.webhookUrl) {
    console.error('[stop-callback] Discord: missing webhookUrl');
    return;
  }
  
  try {
    const response = await fetch(config.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: message,
      }),
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Discord webhook error: ${response.status} - ${errorText}`);
    }
    
    console.log('[stop-callback] Discord notification sent');
  } catch (error) {
    console.error('[stop-callback] Discord send failed:', error);
  }
}

/**
 * Main callback trigger - called from session-end hook
 * 
 * Executes all enabled callbacks asynchronously (non-blocking).
 * Failures in individual callbacks do not block session end.
 */
export async function triggerStopCallbacks(
  metrics: SessionMetrics,
  input: { session_id: string; cwd: string }
): Promise<void> {
  const config = getSisyphusConfig();
  const callbacks = config.stopHookCallbacks;
  
  if (!callbacks) {
    return; // No callbacks configured
  }
  
  const summary = formatSessionSummary(metrics);
  
  // Execute all enabled callbacks (non-blocking)
  const promises: Promise<void>[] = [];
  
  if (callbacks.file?.enabled && callbacks.file.path) {
    promises.push(
      writeToFile(
        callbacks.file.path, 
        summary, 
        metrics.session_id,
        callbacks.file.format
      )
    );
  }
  
  if (callbacks.telegram?.enabled) {
    promises.push(sendTelegram(callbacks.telegram, summary));
  }
  
  if (callbacks.discord?.enabled) {
    promises.push(sendDiscord(callbacks.discord, summary));
  }
  
  if (promises.length === 0) {
    return; // No callbacks enabled
  }
  
  // Wait for all callbacks (with timeout to prevent hanging)
  try {
    await Promise.race([
      Promise.all(promises),
      new Promise((resolve) => setTimeout(resolve, 5000)), // 5s timeout
    ]);
  } catch (error) {
    console.error('[stop-callback] Callback execution failed:', error);
    // Don't throw - failures shouldn't block session end
  }
}
