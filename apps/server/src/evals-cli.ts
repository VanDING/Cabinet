import { runEvals, listDatasets } from '../src/mastra/evals/run.js';

async function main() {
  const args = process.argv.slice(2);
  const cmd = args[0] ?? 'help';
  const threshold = parseFloat(
    args.find((a) => a.startsWith('--threshold='))?.split('=')[1] ?? '0.6',
  );

  if (cmd === 'list') {
    console.log('Available datasets:', listDatasets().join(', '));
    process.exit(0);
  }

  if (cmd === 'run') {
    const datasetName = args[1];
    const scorerName = args[2];
    if (!datasetName || datasetName.startsWith('--')) {
      console.error('Usage: tsx src/evals-cli.ts run <dataset> [scorer] [--threshold=0.6]');
      process.exit(1);
    }
    console.log(
      `Running evals on dataset '${datasetName}'${scorerName ? ` with scorer '${scorerName}'` : ''}...`,
    );
    const { results, summary } = await runEvals(datasetName, scorerName);
    console.log(`\nResults (${summary.total} tests):`);
    for (const r of results) {
      const icon = r.passed ? '✓' : '✗';
      console.log(`  ${icon} ${r.name} [${r.scorer}]: ${(r.score * 100).toFixed(0)}%`);
      if (r.reason) console.log(`     ${r.reason}`);
    }
    console.log(
      `\nSummary: ${summary.passed}/${summary.total} passed, avg ${(summary.avgScore * 100).toFixed(0)}%`,
    );

    if (summary.avgScore < threshold) {
      console.error(
        `✗ Gate FAILED: avg ${(summary.avgScore * 100).toFixed(0)}% < threshold ${(threshold * 100).toFixed(0)}%`,
      );
      process.exit(1);
    }
    console.log(`✓ Gate PASSED (threshold ${(threshold * 100).toFixed(0)}%)`);
    process.exit(0);
  }

  if (cmd === 'gate') {
    const datasets = args.filter((a) => !a.startsWith('--'));
    const targets = datasets.length > 0 ? datasets : ['secretary', 'analyst', 'guardrails'];
    let allPassed = true;
    for (const ds of targets) {
      const { results, summary } = await runEvals(ds);
      const icon = summary.avgScore >= threshold ? '✓' : '✗';
      console.log(
        `${icon} ${ds}: ${(summary.avgScore * 100).toFixed(0)}% (${summary.passed}/${summary.total})`,
      );
      if (summary.avgScore < threshold) allPassed = false;
      for (const r of results.filter((x) => !x.passed)) {
        console.log(`     ✗ ${r.name} [${r.scorer}]: ${(r.score * 100).toFixed(0)}%`);
      }
    }
    if (!allPassed) {
      console.error(
        `✗ Gate FAILED — some datasets below threshold ${(threshold * 100).toFixed(0)}%`,
      );
      process.exit(1);
    }
    console.log(`✓ Gate PASSED (threshold ${(threshold * 100).toFixed(0)}%)`);
    process.exit(0);
  }

  console.log('Usage:');
  console.log('  tsx src/evals-cli.ts list');
  console.log('  tsx src/evals-cli.ts run <dataset> [scorer] [--threshold=0.6]');
  console.log('  tsx src/evals-cli.ts gate [dataset...] [--threshold=0.6]');
}

main().catch(console.error);
