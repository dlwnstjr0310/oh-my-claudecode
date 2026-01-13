/**
 * Test script for model routing
 */

import {
  routeTask,
  routeWithEscalation,
  adaptPromptForTier,
  quickTierForAgent,
  explainRouting,
  extractAllSignals,
  calculateComplexityScore,
  TIER_MODELS,
} from './dist/features/model-routing/index.js';

console.log('=== Model Routing Test Suite ===\n');

// Test cases with expected tiers
const testCases = [
  // LOW tier - simple searches
  { prompt: 'Find all .ts files in src/', agent: 'explore', expectedTier: 'LOW' },
  { prompt: 'Where is the config file?', agent: 'explore', expectedTier: 'LOW' },
  { prompt: 'List all functions in utils.ts', agent: 'explore', expectedTier: 'LOW' },

  // MEDIUM tier - standard implementation
  { prompt: 'Add a new button component with hover state', agent: 'frontend-engineer', expectedTier: 'MEDIUM' },
  { prompt: 'Update the user list component to show email addresses', agent: 'sisyphus-junior', expectedTier: 'MEDIUM' },

  // HIGH tier - risky refactoring (detected via keywords)
  { prompt: 'Refactor the user service to use the new database schema and add migrations', agent: 'sisyphus-junior', expectedTier: 'HIGH' },

  // LOW tier - short or document-writer tasks
  { prompt: 'Write documentation for the API endpoints', agent: 'document-writer', expectedTier: 'LOW' },
  { prompt: 'Implement the user profile page', agent: 'sisyphus-junior', expectedTier: 'LOW' },

  // HIGH tier - complex tasks
  { prompt: 'Analyze the root cause of the authentication bug affecting production users', agent: 'oracle', expectedTier: 'HIGH' },
  { prompt: 'Design the architecture for a new microservices system with event sourcing', agent: 'oracle', expectedTier: 'HIGH' },
  { prompt: 'Refactor the entire API layer to use dependency injection pattern', agent: 'prometheus', expectedTier: 'HIGH' },
  { prompt: 'Debug the critical security vulnerability in the payment system', agent: 'oracle', expectedTier: 'HIGH' },
];

console.log('--- Test 1: Basic Routing ---\n');

let passed = 0;
let failed = 0;

for (const test of testCases) {
  const decision = routeTask({
    taskPrompt: test.prompt,
    agentType: test.agent,
  });

  const status = decision.tier === test.expectedTier ? '✓' : '✗';
  const color = decision.tier === test.expectedTier ? '\x1b[32m' : '\x1b[31m';

  console.log(`${color}${status}\x1b[0m [${decision.tier}] ${test.agent}: "${test.prompt.substring(0, 50)}..."`);
  console.log(`   Model: ${decision.model}`);
  console.log(`   Confidence: ${(decision.confidence * 100).toFixed(0)}%`);
  console.log(`   Reasons: ${decision.reasons.join(', ')}`);
  console.log('');

  if (decision.tier === test.expectedTier) {
    passed++;
  } else {
    failed++;
    console.log(`   Expected: ${test.expectedTier}, Got: ${decision.tier}`);
  }
}

console.log(`\n--- Results: ${passed}/${testCases.length} passed ---\n`);

console.log('--- Test 2: Agent Quick Tier Lookup ---\n');

const agents = ['oracle', 'prometheus', 'momus', 'explore', 'document-writer', 'frontend-engineer', 'sisyphus-junior'];
for (const agent of agents) {
  const tier = quickTierForAgent(agent);
  console.log(`  ${agent}: ${tier} → ${TIER_MODELS[tier]}`);
}

console.log('\n--- Test 3: Escalation Logic ---\n');

const escalationPrompt = 'Fix this bug';
console.log(`Original prompt: "${escalationPrompt}"`);

for (let failures = 0; failures <= 3; failures++) {
  const decision = routeWithEscalation({
    taskPrompt: escalationPrompt,
    agentType: 'sisyphus-junior',
    previousFailures: failures,
  });
  console.log(`  After ${failures} failures: ${decision.tier} (${decision.model})`);
  if (decision.escalatedFrom) {
    console.log(`    Escalated from: ${decision.escalatedFrom}`);
  }
}

console.log('\n--- Test 4: Prompt Adaptation ---\n');

const samplePrompt = 'Implement user authentication with JWT tokens';

console.log('Original prompt:', samplePrompt);
console.log('\nAdapted for each tier:\n');

for (const tier of ['LOW', 'MEDIUM', 'HIGH']) {
  console.log(`=== ${tier} tier ===`);
  const adapted = adaptPromptForTier(samplePrompt, tier);
  console.log(adapted.substring(0, 300) + (adapted.length > 300 ? '...' : ''));
  console.log('');
}

console.log('--- Test 5: Signal Extraction ---\n');

const complexPrompt = `
  Analyze the production authentication system across multiple services.
  The bug affects user login, session management, and API authorization.
  We need to understand the root cause and design a fix that handles:
  1. Race conditions in token refresh
  2. Session invalidation across microservices
  3. Backwards compatibility with existing clients

  This is critical and urgent - users are being logged out randomly.
`;

console.log('Complex prompt signals:');
const signals = extractAllSignals(complexPrompt, 'oracle');
console.log(JSON.stringify(signals, null, 2));

const score = calculateComplexityScore(signals);
console.log(`\nComplexity score: ${score.toFixed(2)}`);

console.log('\n--- Test 6: Routing Explanation ---\n');

const explanation = explainRouting({
  taskPrompt: complexPrompt,
  agentType: 'oracle',
});
console.log(explanation);

console.log('\n=== All Tests Complete ===');
