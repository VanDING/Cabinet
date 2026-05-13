/**
 * Cost Tracking & Budget Verification
 *
 * Usage: cd tools/verify && npx tsx cost-test.ts
 */
import { CostTracker, BudgetGuard } from '@cabinet/gateway';

async function main(): Promise<void> {
  console.log('=== Cabinet Cost Tracking Verification ===\n');

  // 1. CostTracker
  console.log('1. CostTracker...');
  const tracker = new CostTracker();

  const entry1 = tracker.record('claude-sonnet-4-6', 1000, 500);
  console.log(`   sonnet 1K+500: $${entry1.costUsd.toFixed(4)} (expected ~$0.0105)`);

  const entry2 = tracker.record('claude-opus-4-7', 1_000_000, 1_000_000);
  console.log(`   opus 1M+1M: $${entry2.costUsd.toFixed(2)} (expected ~$90.00)`);

  const entry3 = tracker.record('claude-haiku-4-5', 500_000, 100_000);
  console.log(`   haiku 500K+100K: $${entry3.costUsd.toFixed(4)} (expected ~$0.80)`);

  const total = tracker.getTotalCost();
  console.log(`   total: $${total.toFixed(2)} (3 entries)`);
  console.log(`   CostTracker: ${total > 0 ? 'PASS' : 'FAIL'}`);

  // 2. BudgetGuard
  console.log('\n2. BudgetGuard...');
  const guard = new BudgetGuard(tracker, { daily: 5.0, weekly: 25, monthly: 100 });

  const statuses = guard.checkAll();
  for (const s of statuses) {
    console.log(
      `   ${s.period}: $${s.currentSpend.toFixed(2)} / $${s.limit} (${Math.round(s.percentage * 100)}%) — ${s.level}`
    );
  }

  // Daily should be over budget now (>$5)
  const dailyStatus = statuses.find((s) => s.period === 'daily')!;
  console.log(
    `   daily over budget: ${dailyStatus.level === 'blocked' ? 'PASS' : 'FAIL (expected blocked)'}`
  );

  // L3 calls should still be allowed
  const l3Check = guard.canProceed('L3');
  console.log(`   L3 allowed: ${l3Check.allowed ? 'PASS' : 'FAIL'}`);

  // L2 calls should be blocked
  const l2Check = guard.canProceed('L2');
  console.log(`   L2 blocked: ${!l2Check.allowed ? 'PASS' : 'FAIL'}`);

  // 3. Summary
  const allPass =
    total > 0 &&
    dailyStatus.level === 'blocked' &&
    l3Check.allowed &&
    !l2Check.allowed;

  console.log(`\n=== ${allPass ? 'ALL COST CHECKS PASSED' : 'SOME CHECKS FAILED'} ===`);
  process.exit(allPass ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
