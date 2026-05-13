/**
 * Vector Search & Embedding Verification
 *
 * Usage: cd tools/verify && npx tsx vector-test.ts
 */
import { LongTermMemory } from '@cabinet/memory';
import Database from 'better-sqlite3';

async function main(): Promise<void> {
  console.log('=== Cabinet Vector Search Verification ===\n');

  const db = new Database(':memory:');
  const mem = new LongTermMemory(db);

  // 1. Store entries with embeddings
  console.log('1. Storing entries with embeddings...');
  await mem.store({
    content: 'Apple is a technology company known for iPhones',
    embedding: [0.9, 0.1, 0.0, 0.2],
    metadata: { category: 'tech' },
    timestamp: new Date(),
  });
  await mem.store({
    content: 'Banana is a tropical fruit rich in potassium',
    embedding: [0.1, 0.9, 0.0, 0.1],
    metadata: { category: 'food' },
    timestamp: new Date(),
  });
  await mem.store({
    content: 'Microsoft makes Windows and Office software',
    embedding: [0.85, 0.05, 0.1, 0.0],
    metadata: { category: 'tech' },
    timestamp: new Date(),
  });
  console.log(`   stored 3 entries. total: ${mem.size()}`);
  console.log(`   Storage: ${mem.size() === 3 ? 'PASS' : 'FAIL'}`);

  // 2. Cosine similarity semantic search
  console.log('\n2. Semantic search (cosine similarity)...');
  const results = await mem.semanticSearch([0.9, 0.1, 0.0, 0.2], 3);
  console.log(`   found ${results.length} results (expect >= 2 for tech-related):`);
  for (const r of results) {
    console.log(`   - [${r.score.toFixed(3)}] ${r.content.slice(0, 60)}`);
  }
  const searchPass = results.length >= 2;
  console.log(`   SemanticSearch: ${searchPass ? 'PASS' : 'FAIL'}`);

  // 3. Simple text search (LIKE-based, no embeddings required)
  console.log('\n3. Simple text search...');
  const textResults = await mem.search('Microsoft', 5);
  console.log(`   found ${textResults.length} results for "Microsoft":`);
  for (const r of textResults) {
    console.log(`   - ${r.content.slice(0, 60)}`);
  }
  console.log(`   TextSearch: ${textResults.length === 1 ? 'PASS' : 'FAIL'}`);

  // 4. Delete & size
  console.log('\n4. Delete...');
  const tempId = await mem.store({
    content: 'Temporary entry to delete',
    metadata: {},
    timestamp: new Date(),
  });
  const deleted = await mem.delete(tempId);
  console.log(`   deleted: ${deleted ? 'PASS' : 'FAIL'}`);

  const allPass =
    mem.size() >= 3 && searchPass && textResults.length === 1 && deleted;

  db.close();
  console.log(`\n=== ${allPass ? 'ALL VECTOR CHECKS PASSED' : 'SOME CHECKS FAILED'} ===`);
  process.exit(allPass ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
