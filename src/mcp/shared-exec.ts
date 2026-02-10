/**
 * Shared MCP execution helpers
 *
 * Pure helper functions used by both codex-core.ts and gemini-core.ts
 * to eliminate duplicated stdout truncation and output file writing logic.
 */

import { existsSync, mkdirSync, writeFileSync, realpathSync } from 'fs';
import { dirname, resolve, relative, isAbsolute, basename, join } from 'path';

export const TRUNCATION_MARKER = '\n\n[OUTPUT TRUNCATED: exceeded 10MB limit]';

/**
 * Creates a streaming stdout collector that accumulates output up to maxBytes.
 * Once the limit is exceeded, further chunks are ignored and a truncation
 * marker is appended exactly once.
 */
export function createStdoutCollector(maxBytes: number): {
  append(chunk: string): void;
  toString(): string;
  readonly isTruncated: boolean;
} {
  let buffer = '';
  let byteCount = 0;
  let truncated = false;

  return {
    append(chunk: string): void {
      if (truncated) return;
      byteCount += chunk.length;
      if (byteCount > maxBytes) {
        const overshoot = byteCount - maxBytes;
        buffer += chunk.slice(0, Math.max(0, chunk.length - overshoot));
        buffer += TRUNCATION_MARKER;
        truncated = true;
      } else {
        buffer += chunk;
      }
    },
    toString(): string {
      return buffer;
    },
    get isTruncated(): boolean {
      return truncated;
    },
  };
}

/**
 * Safely write content to an output file, ensuring the path stays within
 * the base directory boundary (symlink-safe).
 *
 * @returns An MCP-style error response on failure, or null on success.
 */
export async function safeWriteOutputFile(
  outputFile: string,
  content: string,
  baseDirReal: string,
  logPrefix: string = '[mcp]',
): Promise<{ isError: true; content: { type: string; text: string }[] } | null> {
  const outputPath = resolve(baseDirReal, outputFile);
  const relOutput = relative(baseDirReal, outputPath);
  if (relOutput.startsWith('..') || isAbsolute(relOutput)) {
    console.warn(`${logPrefix} output_file '${outputFile}' resolves outside working directory, skipping write.`);
    return null; // silently skip, not a hard error
  }

  try {
    const outputDir = dirname(outputPath);

    if (!existsSync(outputDir)) {
      const relDir = relative(baseDirReal, outputDir);
      if (relDir.startsWith('..') || isAbsolute(relDir)) {
        console.warn(`${logPrefix} output_file directory is outside working directory, skipping write.`);
        return null;
      }
      mkdirSync(outputDir, { recursive: true });
    }

    let outputDirReal: string | undefined;
    try {
      outputDirReal = realpathSync(outputDir);
    } catch {
      console.warn(`${logPrefix} Failed to resolve output directory, skipping write.`);
      return null;
    }

    if (outputDirReal) {
      const relDirReal = relative(baseDirReal, outputDirReal);
      if (relDirReal.startsWith('..') || isAbsolute(relDirReal)) {
        console.warn(`${logPrefix} output_file directory resolves outside working directory, skipping write.`);
        return null;
      }
      const safePath = join(outputDirReal, basename(outputPath));
      writeFileSync(safePath, content, 'utf-8');
    }

    return null; // success
  } catch (err) {
    console.warn(`${logPrefix} Failed to write output file: ${(err as Error).message}`);
    return {
      isError: true,
      content: [{ type: 'text', text: `Failed to write output file '${outputFile}': ${(err as Error).message}` }],
    };
  }
}
