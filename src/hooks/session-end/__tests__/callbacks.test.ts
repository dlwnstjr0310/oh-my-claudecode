import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { triggerStopCallbacks, formatSessionSummary } from '../callbacks.js';
import type { SessionMetrics } from '../index.js';
import { existsSync, readFileSync, rmSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// Mock config
vi.mock('../../../features/auto-update.js', () => ({
  getSisyphusConfig: vi.fn(() => ({
    silentAutoUpdate: false,
  })),
}));

describe('stop-callback', () => {
  describe('formatSessionSummary', () => {
    it('formats session summary correctly', () => {
      const metrics: SessionMetrics = {
        session_id: 'test-123',
        ended_at: '2026-02-04T12:00:00Z',
        reason: 'clear',
        duration_ms: 90000, // 1m 30s
        agents_spawned: 2,
        agents_completed: 2,
        modes_used: ['ultrawork', 'swarm'],
        started_at: '2026-02-04T11:58:30Z',
      };
      
      const summary = formatSessionSummary(metrics);
      
      expect(summary).toContain('test-123');
      expect(summary).toContain('1m 30s');
      expect(summary).toContain('ultrawork, swarm');
      expect(summary).toContain('Agents Spawned:** 2');
      expect(summary).toContain('Agents Completed:** 2');
    });
    
    it('handles missing duration gracefully', () => {
      const metrics: SessionMetrics = {
        session_id: 'test-456',
        ended_at: '2026-02-04T12:00:00Z',
        reason: 'logout',
        agents_spawned: 0,
        agents_completed: 0,
        modes_used: [],
      };
      
      const summary = formatSessionSummary(metrics);
      
      expect(summary).toContain('unknown');
      expect(summary).toContain('none'); // no modes
    });
  });
  
  describe('triggerStopCallbacks', () => {
    const testDir = join(tmpdir(), 'omc-test-callbacks');
    
    beforeEach(() => {
      // Clean up test directory
      if (existsSync(testDir)) {
        rmSync(testDir, { recursive: true, force: true });
      }
      mkdirSync(testDir, { recursive: true });
    });
    
    afterEach(() => {
      // Clean up after tests
      if (existsSync(testDir)) {
        rmSync(testDir, { recursive: true, force: true });
      }
      vi.restoreAllMocks();
    });
    
    it('does nothing when no callbacks configured', async () => {
      const { getSisyphusConfig } = await import('../../../features/auto-update.js');
      vi.mocked(getSisyphusConfig).mockReturnValue({
        silentAutoUpdate: false,
      });
      
      const metrics: SessionMetrics = {
        session_id: 'test',
        ended_at: '2026-02-04T12:00:00Z',
        reason: 'clear',
        agents_spawned: 0,
        agents_completed: 0,
        modes_used: [],
      };
      
      // Should not throw
      await expect(
        triggerStopCallbacks(metrics, { session_id: 'test', cwd: testDir })
      ).resolves.toBeUndefined();
    });
    
    it('writes file when file callback enabled', async () => {
      const { getSisyphusConfig } = await import('../../../features/auto-update.js');
      const testFile = join(testDir, 'test-{session_id}.md');
      
      vi.mocked(getSisyphusConfig).mockReturnValue({
        silentAutoUpdate: false,
        stopHookCallbacks: {
          file: {
            enabled: true,
            path: testFile,
            format: 'markdown',
          },
        },
      });
      
      const metrics: SessionMetrics = {
        session_id: 'session-abc',
        ended_at: '2026-02-04T12:00:00Z',
        reason: 'clear',
        agents_spawned: 1,
        agents_completed: 1,
        modes_used: ['ultrawork'],
      };
      
      await triggerStopCallbacks(metrics, { session_id: 'session-abc', cwd: testDir });
      
      // Check file was created
      const expectedPath = join(testDir, 'test-session-abc.md');
      expect(existsSync(expectedPath)).toBe(true);
      
      const content = readFileSync(expectedPath, 'utf-8');
      expect(content).toContain('session-abc');
      expect(content).toContain('ultrawork');
    });
    
    it('handles file write errors gracefully', async () => {
      const { getSisyphusConfig } = await import('../../../features/auto-update.js');
      
      vi.mocked(getSisyphusConfig).mockReturnValue({
        silentAutoUpdate: false,
        stopHookCallbacks: {
          file: {
            enabled: true,
            path: '/invalid/path/cannot/write/{session_id}.md',
            format: 'markdown',
          },
        },
      });
      
      const metrics: SessionMetrics = {
        session_id: 'test',
        ended_at: '2026-02-04T12:00:00Z',
        reason: 'clear',
        agents_spawned: 0,
        agents_completed: 0,
        modes_used: [],
      };
      
      // Should not throw even if write fails
      await expect(
        triggerStopCallbacks(metrics, { session_id: 'test', cwd: testDir })
      ).resolves.toBeUndefined();
    });
    
    it('skips callbacks when enabled=false', async () => {
      const { getSisyphusConfig } = await import('../../../features/auto-update.js');
      const testFile = join(testDir, 'should-not-exist.md');
      
      vi.mocked(getSisyphusConfig).mockReturnValue({
        silentAutoUpdate: false,
        stopHookCallbacks: {
          file: {
            enabled: false,
            path: testFile,
          },
        },
      });
      
      const metrics: SessionMetrics = {
        session_id: 'test',
        ended_at: '2026-02-04T12:00:00Z',
        reason: 'clear',
        agents_spawned: 0,
        agents_completed: 0,
        modes_used: [],
      };
      
      await triggerStopCallbacks(metrics, { session_id: 'test', cwd: testDir });
      
      // File should not be created
      expect(existsSync(testFile)).toBe(false);
    });
    
    it('interpolates {date} and {time} placeholders', async () => {
      const { getSisyphusConfig } = await import('../../../features/auto-update.js');
      const testFile = join(testDir, '{date}-{time}.md');
      
      vi.mocked(getSisyphusConfig).mockReturnValue({
        silentAutoUpdate: false,
        stopHookCallbacks: {
          file: {
            enabled: true,
            path: testFile,
          },
        },
      });
      
      const metrics: SessionMetrics = {
        session_id: 'test',
        ended_at: '2026-02-04T12:00:00Z',
        reason: 'clear',
        agents_spawned: 0,
        agents_completed: 0,
        modes_used: [],
      };
      
      await triggerStopCallbacks(metrics, { session_id: 'test', cwd: testDir });
      
      // Check that a file with date/time pattern was created
      const files = require('fs').readdirSync(testDir);
      expect(files.length).toBeGreaterThan(0);
      expect(files[0]).toMatch(/^\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}\.md$/);
    });
  });
});
