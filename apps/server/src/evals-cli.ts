import { runEvals, listDatasets } from '../src/mastra/evals/run.js';

async function main() {
  const args = process.argv.slice(2);
  const cmd = args[0] ?? 'help';

  if (cmd === 'list') {
    console.log('Available datasets:', listDatasets().join(', '));
    process.exit(0);
  }

  if (cmd === 'run') {
    const datasetName = args[1];
    const scorerName = args[2];
    if (!datasetName) {
      console.error('Usage: tsx src/evals-cli.ts run <dataset> [scorer]');
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
    process.exit(summary.failed > 0 ? 1 : 0);
  }

  console.log('Usage:');
  console.log('  tsx src/evals-cli.ts list');
  console.log('  tsx src/evals-cli.ts run <dataset> [scorer]');
}

main().catch(console.error);
