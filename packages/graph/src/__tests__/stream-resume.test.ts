import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { StateGraph, END } from '../state-graph.js';
import { Annotation } from '../annotation.js';
import { CheckpointStore } from '../checkpoint-store.js';

const TestState = {
  value: Annotation<string>({
    reducer: (_a, b) => b,
    default: () => '',
  }),
  counter: Annotation<number>({
    reducer: (a, b) => a + b,
    default: () => 0,
  }),
};

function createCheckpointStore(): CheckpointStore {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  const store = new CheckpointStore(db);
  store.ensureTable();
  return store;
}

describe('CompiledGraph stream', () => {
  it('emits node:start and node:end events', async () => {
    const graph = new StateGraph(TestState)
      .addNode('a', () => ({ value: 'step_a' }))
      .addNode('b', () => ({ value: 'step_b' }))
      .addEdge('a', 'b')
      .addEdge('b', END);

    const compiled = graph.compile({ entry: 'a' }).graph!;
    const events: { type: string; nodeId?: string }[] = [];

    for await (const event of compiled.stream({})) {
      events.push(event);
    }

    expect(events).toHaveLength(4); // start_a, end_a, start_b, end_b
    expect(events[0]).toMatchObject({ type: 'node:start', nodeId: 'a' });
    expect(events[1]).toMatchObject({ type: 'node:end', nodeId: 'a' });
    expect(events[2]).toMatchObject({ type: 'node:start', nodeId: 'b' });
    expect(events[3]).toMatchObject({ type: 'node:end', nodeId: 'b' });
  });

  it('emits error event then routes to error edge', async () => {
    const graph = new StateGraph(TestState)
      .addNode('failing', () => { throw new Error('boom'); }, { maxRetries: 1 })
      .addNode('recovery', () => ({ value: 'recovered' }))
      .addErrorEdge('failing', 'recovery')
      .addEdge('recovery', END);

    const compiled = graph.compile({ entry: 'failing' }).graph!;
    const events: { type: string; nodeId?: string }[] = [];

    for await (const event of compiled.stream({})) {
      events.push(event);
    }

    const errorEvent = events.find((e) => e.type === 'error');
    expect(errorEvent).toBeDefined();
    expect(errorEvent!.nodeId).toBe('failing');

    // Should have recovered via error edge
    const recoveryEnd = events.find((e) => e.type === 'node:end' && e.nodeId === 'recovery');
    expect(recoveryEnd).toBeDefined();
  });

  it('saves checkpoints when CheckpointStore is provided', async () => {
    const store = createCheckpointStore();
    const graph = new StateGraph(TestState)
      .addNode('a', () => ({ value: 'done' }))
      .addEdge('a', END);

    const compiled = graph.compile({ entry: 'a' }).graph!;
    await compiled.invoke({}, { checkpointStore: store, runId: 'ckpt-test' });

    const list = store.listRun('ckpt-test');
    expect(list).toHaveLength(1);
  });
});

describe('CompiledGraph resume', () => {
  it('resumes from a checkpoint and continues execution', async () => {
    const store = createCheckpointStore();
    const graph = new StateGraph(TestState)
      .addNode('step1', () => ({ value: 'first' }))
      .addNode('step2', () => ({ value: 'second', counter: 5 }))
      .addNode('step3', () => ({ value: 'third' }))
      .addEdge('step1', 'step2')
      .addEdge('step2', 'step3')
      .addEdge('step3', END);

    const compiled = graph.compile({ entry: 'step1' }).graph!;

    // Do a full invocation with checkpointing to save state
    await compiled.invoke({}, { checkpointStore: store, runId: 'resume-test' });

    // Load the checkpoint after step1
    const list = store.listRun('resume-test');
    const ckptAfterStep1 = list.find((r) => r.nodeId === 'step1');
    expect(ckptAfterStep1).toBeDefined();

    // Resume from step1's checkpoint — should execute step2 and step3
    const state = await compiled.resume(ckptAfterStep1!.id, {}, { checkpointStore: store });
    expect(state.value).toBe('third');
    expect(state.counter).toBe(5);
  });

  it('resume with override merges additional state', async () => {
    const store = createCheckpointStore();
    const graph = new StateGraph(TestState)
      .addNode('n1', () => ({ value: 'original', counter: 10 }))
      .addEdge('n1', END);

    const compiled = graph.compile({ entry: 'n1' }).graph!;
    await compiled.invoke({}, { checkpointStore: store, runId: 'override-test' });

    // Resume with override — counter addition via reducer
    const state = await compiled.resume('ckpt_override-test_0', { counter: 7 }, { checkpointStore: store });
    // The original counter was already 10 from the first run, override adds 7 via reducer
    // But note: resume loads the checkpoint state (counter=10), then merges override (counter=7) via reducer (a+b=17)
    // Then there are no more nodes to execute, so the merged state is returned
    expect(state.counter).toBe(17);
  });

  it('throws when CheckpointStore is not provided', async () => {
    const graph = new StateGraph(TestState)
      .addNode('n1', () => ({}))
      .addEdge('n1', END);

    const compiled = graph.compile({ entry: 'n1' }).graph!;
    await expect(compiled.resume('any-id')).rejects.toThrow('CheckpointStore');
  });

  it('time travel: list history and resume from earlier checkpoint', async () => {
    const store = createCheckpointStore();
    const graph = new StateGraph(TestState)
      .addNode('a', () => ({ value: 'first', counter: 1 }))
      .addNode('b', () => ({ value: 'second', counter: 2 }))
      .addNode('c', () => ({ value: 'third', counter: 3 }))
      .addEdge('a', 'b')
      .addEdge('b', 'c')
      .addEdge('c', END);

    const compiled = graph.compile({ entry: 'a' }).graph!;

    // Full run
    await compiled.invoke({}, { checkpointStore: store, runId: 'time-travel' });

    // Check history
    const history = compiled.getRunHistory('time-travel', store);
    expect(history.length).toBe(3); // a, b, c

    // Time travel: resume from checkpoint after node 'a', override state
    const afterA = history.find((r) => r.nodeId === 'a');
    const state = await compiled.resume(afterA!.id, { value: 'overridden' }, { checkpointStore: store });
    // Should have executed b and c with the overridden state
    expect(state.value).toBe('third');
    // counter: first run saved 1 at node 'a', resume from there executes b(+2) and c(+3) = 6
    expect(state.counter).toBe(6);
  });

  it('throws when checkpoint not found', async () => {
    const store = createCheckpointStore();
    const graph = new StateGraph(TestState)
      .addNode('n1', () => ({}))
      .addEdge('n1', END);

    const compiled = graph.compile({ entry: 'n1' }).graph!;
    await expect(compiled.resume('nonexistent', {}, { checkpointStore: store })).rejects.toThrow('not found');
  });
});
