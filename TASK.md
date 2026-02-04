# Task: Implement Stop Hook Callbacks (#395)

Implement configurable stop hook callbacks (file/telegram/discord) for v4.0.0-beta.

**Plan:** `.omc/plans/issue-395-stop-callbacks.md`

**Priority:**
1. Phase 1: Config schema + callback handlers + hook integration
2. Phase 4.1: Tests
3. Phase 2: CLI command
4. Build and verify

**Requirements:**
- Base: v4.0.0-beta
- All code in TypeScript
- Error handling (callbacks mustn't block session end)
- Tests for all callback types

Start with Phase 1.1 (config types).
