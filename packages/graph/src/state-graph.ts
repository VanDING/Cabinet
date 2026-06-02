import type { Annotation } from './annotation.js';
import { validateGraph, type EdgeDef, type ValidationResult } from './validation.js';

export const END = Symbol('END');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type StateSchema = Record<string, Annotation<any>>;
type StateFromSchema<S extends StateSchema> = {
  [K in keyof S]: ReturnType<S[K]['default']>;
};

type NodeFn<S> = (state: S) => Promise<Partial<S>> | Partial<S>;
type RouterFn<S> = (state: S) => string;

interface NodeEntry<S> {
  fn: NodeFn<S>;
  maxRetries: number;
  errorEdge: string | null;
}

interface CompiledEdge {
  type: 'static' | 'conditional';
  to: string | typeof END;
  router?: RouterFn<any>;
  targets?: Record<string, string | typeof END>;
}

export interface CompileResult<S> {
  ok: boolean;
  graph?: CompiledGraph<S>;
  errors?: ValidationResult['errors'];
  warnings?: ValidationResult['warnings'];
}

export interface InvokeConfig {
  maxSteps?: number;
}

export class CompiledGraph<S> {
  private readonly nodes: Map<string, NodeEntry<S>>;
  private readonly outgoingEdges: Map<string, CompiledEdge[]>;
  private readonly schema: StateSchema;
  private readonly entryNode: string;
  private readonly compileWarnings: ValidationResult['warnings'];

  constructor(
    nodes: Map<string, NodeEntry<S>>,
    outgoingEdges: Map<string, CompiledEdge[]>,
    schema: StateSchema,
    entryNode: string,
    warnings: ValidationResult['warnings'],
  ) {
    this.nodes = nodes;
    this.outgoingEdges = outgoingEdges;
    this.schema = schema;
    this.entryNode = entryNode;
    this.compileWarnings = warnings;
  }

  getWarnings() {
    return this.compileWarnings;
  }

  async invoke(input: Partial<S>, config?: InvokeConfig): Promise<S> {
    const maxSteps = config?.maxSteps ?? 100;
    let state = this.applyDefaults(input);
    let currentNode: string | typeof END = this.entryNode;
    let steps = 0;

    while (currentNode !== END && steps < maxSteps) {
      const node = this.nodes.get(currentNode);
      if (!node) break;

      let update: Partial<S>;
      try {
        update = await this.executeWithRetry(node, state);
      } catch (e) {
        if (node.errorEdge) {
          state = this.mergeState(state, {});
          currentNode = node.errorEdge;
          steps++;
          continue;
        }
        throw e;
      }

      state = this.mergeState(state, update);

      const edges: CompiledEdge[] = this.outgoingEdges.get(currentNode) ?? [];
      steps++;

      if (edges.length === 0) break;

      let nextNode: string | typeof END = END;
      for (const edge of edges) {
        if (edge.type === 'conditional' && edge.router && edge.targets) {
          const target = edge.router(state);
          nextNode = edge.targets[target] ?? edge.targets['__default__'] ?? END;
          break;
        }
      }
      if (nextNode === END) {
        const staticEdge: CompiledEdge | undefined = edges.find(
          (e: CompiledEdge) => e.type === 'static',
        );
        nextNode = staticEdge?.to ?? END;
      }

      currentNode = nextNode;
    }

    return state;
  }

  private async executeWithRetry(node: NodeEntry<S>, state: S): Promise<Partial<S>> {
    let lastError: Error | null = null;
    const maxAttempts = node.maxRetries + 1;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        return await node.fn(state);
      } catch (e) {
        lastError = e as Error;
        if (attempt < maxAttempts - 1) {
          // Immediate retry (no delay in server TS env)
        }
      }
    }

    throw lastError ?? new Error('Node execution failed');
  }

  private applyDefaults(input: Partial<S>): S {
    const state = {} as Record<string, unknown>;
    for (const [key, ann] of Object.entries(this.schema)) {
      state[key] = (input as Record<string, unknown>)[key] ?? ann.default();
    }
    return state as S;
  }

  private mergeState(current: S, update: Partial<S>): S {
    const merged = { ...current } as Record<string, unknown>;
    for (const key of Object.keys(update as Record<string, unknown>)) {
      const ann = this.schema[key];
      if (ann) {
        merged[key] = ann.reducer(current[key as keyof S], (update as Record<string, unknown>)[key]);
      }
    }
    return merged as S;
  }
}

export class StateGraph<S extends StateSchema> {
  private schema: S;
  private nodes = new Map<string, NodeEntry<StateFromSchema<S>>>();
  private edges: EdgeDef[] = [];
  private routableEdges = new Map<
    string,
    { router: RouterFn<StateFromSchema<S>>; targets: Record<string, string | typeof END> }
  >();

  constructor(schema: S) {
    this.schema = schema;
  }

  addNode(
    id: string,
    fn: NodeFn<StateFromSchema<S>>,
    opts?: { maxRetries?: number },
  ): this {
    this.nodes.set(id, { fn, maxRetries: opts?.maxRetries ?? 0, errorEdge: null });
    return this;
  }

  addEdge(from: string, to: string | typeof END): this {
    const toStr = to === END ? '__END__' : to;
    this.edges.push({ type: 'static', from, to: toStr });
    return this;
  }

  addConditionalEdges(
    from: string,
    router: RouterFn<StateFromSchema<S>>,
    targets: Record<string, string | typeof END>,
  ): this {
    const normalized: Record<string, string> = {};
    for (const [key, val] of Object.entries(targets)) {
      normalized[key] = val === END ? '__END__' : (val as string);
    }
    this.routableEdges.set(from, { router, targets: normalized });

    for (const [conditionValue, to] of Object.entries(normalized)) {
      this.edges.push({ type: 'conditional', from, to, conditionValue });
    }
    return this;
  }

  addErrorEdge(from: string, to: string): this {
    const node = this.nodes.get(from);
    if (node) {
      node.errorEdge = to;
    }
    return this;
  }

  compile(opts: { entry: string }): CompileResult<StateFromSchema<S>> {
    const nodeIds = new Set(this.nodes.keys());
    for (const edge of this.edges) {
      if (edge.to !== '__END__') nodeIds.add(edge.to);
    }

    const validation = validateGraph(nodeIds, this.edges, opts.entry);
    if (!validation.ok) {
      return { ok: false, errors: validation.errors, warnings: validation.warnings };
    }

    const outgoingEdges = new Map<string, CompiledEdge[]>();
    for (const edge of this.edges) {
      const existing = outgoingEdges.get(edge.from) ?? [];
      const compiledEdge: CompiledEdge = {
        type: edge.type,
        to: edge.to === '__END__' ? END : edge.to,
      };
      if (edge.type === 'conditional' && this.routableEdges.has(edge.from)) {
        const routeInfo = this.routableEdges.get(edge.from)!;
        compiledEdge.router = routeInfo.router;
        compiledEdge.targets = routeInfo.targets;
      }
      existing.push(compiledEdge);
      outgoingEdges.set(edge.from, existing);
    }

    return {
      ok: true,
      graph: new CompiledGraph<StateFromSchema<S>>(
        this.nodes,
        outgoingEdges,
        this.schema as unknown as StateSchema,
        opts.entry,
        validation.warnings,
      ),
      warnings: validation.warnings,
    };
  }
}
