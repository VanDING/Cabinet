import { describe, it, expect } from 'vitest';
import { StateGraph, END } from '../state-graph.js';
import { Annotation } from '../annotation.js';

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

describe('StateGraph', () => {
  it('executes a linear graph', async () => {
    const graph = new StateGraph(TestState)
      .addNode('a', () => ({ value: 'step_a' }))
      .addNode('b', () => ({ value: 'step_b' }))
      .addEdge('a', 'b')
      .addEdge('b', END);

    const result = graph.compile({ entry: 'a' });
    expect(result.ok).toBe(true);

    const state = await result.graph!.invoke({});
    expect(state.value).toBe('step_b');
  });

  it('executes conditional edges based on router function', async () => {
    const graph = new StateGraph(TestState)
      .addNode('start', () => ({ counter: 1 }))
      .addNode('path_a', () => ({ value: 'a' }))
      .addNode('path_b', () => ({ value: 'b' }))
      .addNode('branch', (s) => s)
      .addEdge('start', 'branch')
      .addConditionalEdges('branch', (s) => {
        return s.counter > 0 ? 'path_a' : 'path_b';
      }, {
        'path_a': 'path_a',
        'path_b': 'path_b',
        '__default__': END,
      });

    const result = graph.compile({ entry: 'start' });
    expect(result.ok).toBe(true);

    const state = await result.graph!.invoke({});
    expect(state.value).toBe('a');
  });

  it('ends when conditional router returns unknown key', async () => {
    const graph = new StateGraph(TestState)
      .addNode('start', () => ({ value: 'done' }))
      .addConditionalEdges('start', () => 'unknown_key', {
        '__default__': END,
      });

    const result = graph.compile({ entry: 'start' });
    const state = await result.graph!.invoke({});
    expect(state.value).toBe('done');
  });

  it('applies reducers when merging node output into state', async () => {
    const graph = new StateGraph(TestState)
      .addNode('a', () => ({ counter: 5 }))
      .addNode('b', () => ({ counter: 3 }))
      .addEdge('a', 'b')
      .addEdge('b', END);

    const result = graph.compile({ entry: 'a' });
    const state = await result.graph!.invoke({ counter: 1 });
    expect(state.counter).toBe(9); // 1 + 5 + 3
  });

  it('stops on maxSteps to prevent infinite loops', async () => {
    let calls = 0;
    const graph = new StateGraph(TestState)
      .addNode('loop', () => { calls++; return {}; })
      .addEdge('loop', 'loop');

    const result = graph.compile({ entry: 'loop' });
    await result.graph!.invoke({}, { maxSteps: 5 });
    expect(calls).toBe(5);
  });

  it('retries node on failure up to maxRetries', async () => {
    let attempts = 0;
    const graph = new StateGraph(TestState)
      .addNode('flaky', () => {
        attempts++;
        if (attempts < 2) throw new Error('transient error');
        return { value: 'ok' };
      }, { maxRetries: 3 })
      .addEdge('flaky', END);

    const result = graph.compile({ entry: 'flaky' });
    const state = await result.graph!.invoke({});
    expect(state.value).toBe('ok');
    expect(attempts).toBe(2);
  });

  it('routes to error edge when retries exhausted', async () => {
    const graph = new StateGraph(TestState)
      .addNode('failing', () => { throw new Error('persistent error'); }, { maxRetries: 1 })
      .addNode('errorHandler', () => ({ value: 'recovered' }))
      .addErrorEdge('failing', 'errorHandler')
      .addEdge('errorHandler', END);

    const result = graph.compile({ entry: 'failing' });
    const state = await result.graph!.invoke({});
    expect(state.value).toBe('recovered');
  });

  it('default state values are applied', async () => {
    const graph = new StateGraph(TestState)
      .addNode('nop', () => ({}))
      .addEdge('nop', END);

    const result = graph.compile({ entry: 'nop' });
    const state = await result.graph!.invoke({});
    expect(state.value).toBe('');
    expect(state.counter).toBe(0);
  });
});
