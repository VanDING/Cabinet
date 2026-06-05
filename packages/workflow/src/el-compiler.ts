/* eslint-disable @typescript-eslint/no-explicit-any */
//
// EL Expression Compiler — compiles LiteFlow-style EL to StateGraph nodes + edges.
//
// Supported operators (Phase 3 core subset):
//   THEN(a, b, c)             → sequential chain
//   WHEN(a, b, c)             → parallel execution
//   IF(cond, a, b)            → binary conditional
//   IF(cond, a).ELIF(c2, b2).ELSE(def)  → chained conditional
//   SWITCH(x).TO(a, b, c)    → multi-way switch on variable
//
// Phase 5 additions:
//   FOR(n, a)                 → counted loop
//   WHILE(cond, a)            → conditional loop
//   Sub-flow nesting          → THEN(a, WHEN(b, c))
//

// ── AST Types ────────────────────────────────────────────────────

export type ELNode =
  | { kind: 'agent'; name: string; args?: string }
  | { kind: 'then'; steps: ELNode[] }
  | { kind: 'when'; branches: ELNode[]; maxWaitSeconds?: number }
  | { kind: 'if'; condition: string; trueBranch: ELNode; falseBranch?: ELNode; elifs?: { condition: string; branch: ELNode }[]; elseBranch?: ELNode }
  | { kind: 'switch'; variable: string; targets: string[] }
  | { kind: 'for'; count: number; body: ELNode }
  | { kind: 'while'; condition: string; body: ELNode }
  | { kind: 'subflow'; workflowId: string };

// ── Tokenizer ────────────────────────────────────────────────────

type Token =
  | { type: 'ident'; value: string; pos: number }
  | { type: 'string'; value: string; pos: number }
  | { type: 'number'; value: number; pos: number }
  | { type: 'lparen'; pos: number }
  | { type: 'rparen'; pos: number }
  | { type: 'dot'; pos: number }
  | { type: 'comma'; pos: number }
  | { type: 'eof'; pos: number };

class Tokenizer {
  private pos = 0;
  constructor(private input: string) {}

  next(): Token {
    this.skipWhitespace();
    const start = this.pos;
    if (this.pos >= this.input.length) return { type: 'eof', pos: start };

    const ch = this.input[this.pos];

    if (ch === '(') { this.pos++; return { type: 'lparen', pos: start }; }
    if (ch === ')') { this.pos++; return { type: 'rparen', pos: start }; }
    if (ch === '.') { this.pos++; return { type: 'dot', pos: start }; }
    if (ch === ',') { this.pos++; return { type: 'comma', pos: start }; }

    // Number
    if (/[0-9]/.test(ch!)) {
      let num = '';
      while (this.pos < this.input.length && /[0-9]/.test(this.input[this.pos]!)) {
        num += this.input[this.pos++]!;
      }
      return { type: 'number', value: parseInt(num, 10), pos: start };
    }

    if (ch === '"' || ch === "'") {
      const quote = ch;
      this.pos++;
      let val = '';
      while (this.pos < this.input.length && this.input[this.pos] !== quote) {
        if (this.input[this.pos] === '\\') this.pos++;
        val += this.input[this.pos++];
      }
      this.pos++; // closing quote
      return { type: 'string', value: val, pos: start };
    }

    // Identifier or keyword
    let ident = '';
    while (this.pos < this.input.length && /[a-zA-Z0-9_-]/.test(this.input[this.pos]!)) {
      ident += this.input[this.pos++]!;
    }
    return { type: 'ident', value: ident, pos: start };
  }

  /** Get line:column for a position (for error reporting). */
  getLineCol(pos: number): { line: number; col: number } {
    let line = 1;
    let col = 1;
    for (let i = 0; i < pos && i < this.input.length; i++) {
      if (this.input[i] === '\n') { line++; col = 1; }
      else col++;
    }
    return { line, col };
  }

  peek(): Token {
    const saved = this.pos;
    const t = this.next();
    this.pos = saved;
    return t;
  }

  private skipWhitespace(): void {
    while (this.pos < this.input.length && /\s/.test(this.input[this.pos]!)) this.pos++;
  }
}

// ── Parser ───────────────────────────────────────────────────────

class ELParser {
  private tok: Tokenizer;

  constructor(input: string) {
    this.tok = new Tokenizer(input);
  }

  parse(): ELNode {
    const node = this.parseExpression();
    const t = this.tok.next();
    if (t.type !== 'eof') {
      throw new Error(`Unexpected token after expression: ${t.type} '${(t as { value?: string }).value ?? ''}'`);
    }
    return node;
  }

  private parseExpression(): ELNode {
    const t = this.tok.next();
    if (t.type !== 'ident') throw new Error(`Expected identifier, got ${t.type}`);

    const keyword = t.value.toUpperCase();
    switch (keyword) {
      case 'THEN': return this.parseThen();
      case 'WHEN': return this.parseWhen();
      case 'IF':   return this.parseIf();
      case 'SWITCH': return this.parseSwitch();
      case 'FOR':  return this.parseFor();
      case 'WHILE': return this.parseWhile();
      case 'SUBFLOW': return this.parseSubflow();
      default: {
        // Agent reference: agentName or agentName("arg")
        if (this.tok.peek().type === 'lparen') {
          this.tok.next(); // consume (
          const arg = this.tok.next();
          const close = this.tok.next();
          if (close.type !== 'rparen') throw new Error('Expected )');
          return { kind: 'agent', name: t.value, args: arg.type === 'string' ? arg.value : undefined };
        }
        return { kind: 'agent', name: t.value };
      }
    }
  }

  private parseThen(): ELNode {
    const t = this.tok.next();
    if (t.type !== 'lparen') throw new Error('Expected ( after THEN');
    const steps: ELNode[] = [];
    while (this.tok.peek().type !== 'rparen' && this.tok.peek().type !== 'eof') {
      steps.push(this.parseExpression());
      if (this.tok.peek().type === 'comma') this.tok.next();
    }
    this.tok.next(); // consume )
    return { kind: 'then', steps };
  }

  private parseWhen(): ELNode {
    const t = this.tok.next();
    if (t.type !== 'lparen') throw new Error('Expected ( after WHEN');
    const branches: ELNode[] = [];
    while (this.tok.peek().type !== 'rparen' && this.tok.peek().type !== 'eof') {
      branches.push(this.parseExpression());
      if (this.tok.peek().type === 'comma') this.tok.next();
    }
    this.tok.next(); // consume )

    let maxWaitSeconds: number | undefined;
    // .maxWaitSeconds(N)
    if (this.tok.peek().type === 'dot') {
      this.tok.next(); // .
      const method = this.tok.next();
      if (method.type === 'ident' && method.value === 'maxWaitSeconds') {
        const lp = this.tok.next();
        if (lp.type === 'lparen') {
          const num = this.tok.next();
          if (num.type === 'ident') {
            maxWaitSeconds = parseInt(num.value, 10);
          }
          this.tok.next(); // )
        }
      }
    }
    return { kind: 'when', branches, maxWaitSeconds };
  }

  private parseIf(): ELNode {
    const t = this.tok.next();
    if (t.type !== 'lparen') throw new Error('Expected ( after IF');
    // Parse condition as raw text between commas — simple approach
    const condParts: string[] = [];
    let parenDepth = 1;
    while (parenDepth > 0) {
      const tk = this.tok.next();
      if (tk.type === 'eof') throw new Error('Unexpected end in IF condition');
      if (tk.type === 'lparen') parenDepth++;
      if (tk.type === 'rparen') parenDepth--;
      if (parenDepth > 0) {
        if (tk.type === 'ident' || tk.type === 'string') {
          condParts.push((tk as { value?: string }).value ?? '');
        } else if (tk.type === 'comma') {
          break; // condition done, next is true branch
        }
      }
    }
    const condition = condParts.join(' ');

    const trueBranch = this.parseExpression();
    let falseBranch: ELNode | undefined;
    let elifs: { condition: string; branch: ELNode }[] | undefined;
    let elseBranch: ELNode | undefined;

    // Check for .ELIF(...) or .ELSE(...) chain
    while (this.tok.peek().type === 'dot') {
      this.tok.next(); // .
      const method = this.tok.next();
      if (method.type !== 'ident') break;

      const methodUpper = method.value.toUpperCase();
      if (methodUpper === 'ELIF') {
        if (!elifs) elifs = [];
        const lp = this.tok.next();
        if (lp.type !== 'lparen') throw new Error('Expected ( after ELIF');
        const elifCondParts: string[] = [];
        parenDepth = 1;
        while (parenDepth > 0) {
          const tk = this.tok.next();
          if (tk.type === 'eof') throw new Error('Unexpected end in ELIF');
          if (tk.type === 'lparen') parenDepth++;
          if (tk.type === 'rparen') parenDepth--;
          if (parenDepth > 0) {
            if (tk.type === 'ident' || tk.type === 'string') {
              elifCondParts.push((tk as { value?: string }).value ?? '');
            } else if (tk.type === 'comma') break;
          }
        }
        elifs.push({ condition: elifCondParts.join(' '), branch: this.parseExpression() });
      } else if (methodUpper === 'ELSE') {
        const lp = this.tok.next();
        if (lp.type !== 'lparen') throw new Error('Expected ( after ELSE');
        elseBranch = this.parseExpression();
        const rp = this.tok.next();
        if (rp.type !== 'rparen') throw new Error('Expected )');
        break;
      } else {
        break;
      }
    }

    // Consume trailing ) if the IF wasn't fully consumed
    if (this.tok.peek().type === 'rparen') this.tok.next();

    return { kind: 'if', condition, trueBranch, falseBranch, elifs, elseBranch };
  }

  private parseSwitch(): ELNode {
    const t = this.tok.next();
    if (t.type !== 'lparen') throw new Error('Expected ( after SWITCH');
    const variable = this.tok.next();
    if (variable.type !== 'ident') throw new Error('Expected variable name in SWITCH');
    this.tok.next(); // )

    // .TO(a, b, c)
    const dot = this.tok.next();
    if (dot.type !== 'dot') throw new Error('Expected .TO after SWITCH');
    const method = this.tok.next();
    if (method.type !== 'ident' || method.value.toUpperCase() !== 'TO') throw new Error('Expected TO');

    const lp = this.tok.next();
    if (lp.type !== 'lparen') throw new Error('Expected ( after TO');
    const targets: string[] = [];
    while (this.tok.peek().type !== 'rparen' && this.tok.peek().type !== 'eof') {
      const tgt = this.tok.next();
      if (tgt.type === 'ident') targets.push(tgt.value);
      if (this.tok.peek().type === 'comma') this.tok.next();
    }
    this.tok.next(); // )
    return { kind: 'switch', variable: variable.value, targets };
  }

  private parseFor(): ELNode {
    const t = this.tok.next();
    if (t.type !== 'lparen') throw new Error('Expected ( after FOR');
    const countTok = this.tok.next();
    if (countTok.type !== 'number') throw new Error('Expected number as FOR count');
    this.tok.next(); // skip comma
    const body = this.parseExpression();
    this.tok.next(); // )
    return { kind: 'for', count: countTok.value, body };
  }

  private parseWhile(): ELNode {
    const t = this.tok.next();
    if (t.type !== 'lparen') throw new Error('Expected ( after WHILE');
    // Parse condition as raw identifier
    const condTok = this.tok.next();
    if (condTok.type !== 'ident') throw new Error('Expected condition identifier in WHILE');
    this.tok.next(); // skip comma
    const body = this.parseExpression();
    this.tok.next(); // )
    return { kind: 'while', condition: condTok.value, body };
  }

  private parseSubflow(): ELNode {
    const t = this.tok.next();
    if (t.type !== 'lparen') throw new Error('Expected ( after SUBFLOW');
    const idTok = this.tok.next();
    if (idTok.type !== 'string' && idTok.type !== 'ident') throw new Error('Expected workflow ID');
    this.tok.next(); // )
    return { kind: 'subflow', workflowId: idTok.value };
  }
}

// ── Compiler: EL → StateGraph Nodes + Edges ──────────────────────

export interface CompileResult {
  nodes: { id: string; type: string; agentId?: string; title?: string; condition?: string }[];
  edges: { from: string; to: string; condition?: string; branch?: string }[];
  entryNodeId: string;
}

let nodeCounter = 0;
function newNodeId(prefix: string): string {
  return `${prefix}_${++nodeCounter}`;
}

function resetNodeCounter(): void {
  nodeCounter = 0;
}

function compileNode(ast: ELNode): CompileResult {
  switch (ast.kind) {
    case 'agent': {
      const id = newNodeId(ast.name);
      return {
        nodes: [{ id, type: 'agent', agentId: ast.name, title: ast.args }],
        edges: [],
        entryNodeId: id,
      };
    }
    case 'then': {
      if (ast.steps.length === 0) {
        const id = newNodeId('pass');
        return { nodes: [{ id, type: 'pass' }], edges: [], entryNodeId: id };
      }
      const compiled = ast.steps.map((s) => compileNode(s));
      const nodes = compiled.flatMap((c) => c.nodes);
      // Collect internal edges from all sub-expressions
      const edges: CompileResult['edges'] = compiled.flatMap((c) => c.edges);
      for (let i = 0; i < compiled.length - 1; i++) {
        const prev = compiled[i]!;
        const next = compiled[i + 1]!;
        const prevNodes = prev.nodes;
        if (prevNodes.length > 0) {
          edges.push({ from: prevNodes[prevNodes.length - 1]!.id, to: next.entryNodeId });
        }
      }
      return { nodes, edges, entryNodeId: compiled[0]!.entryNodeId };
    }
    case 'when': {
      const compiled = ast.branches.map((b) => compileNode(b));
      const nodes = compiled.flatMap((c) => c.nodes);
      const edges: CompileResult['edges'] = [];
      const parallelId = newNodeId('parallel');
      const mergeId = newNodeId('merge');
      nodes.unshift({ id: parallelId, type: 'parallel' });
      for (const c of compiled) {
        edges.push({ from: parallelId, to: c.entryNodeId });
      }
      // Connect each branch end to merge
      for (const c of compiled) {
        const lastNode = c.nodes[c.nodes.length - 1];
        if (lastNode) edges.push({ from: lastNode.id, to: mergeId });
      }
      nodes.push({ id: mergeId, type: 'merge' });
      return { nodes, edges, entryNodeId: parallelId };
    }
    case 'if': {
      const ifId = newNodeId('ifElse');
      const trueCompiled = compileNode(ast.trueBranch);
      const falseCompiled = ast.falseBranch ? compileNode(ast.falseBranch) : null;
      const nodes: CompileResult['nodes'] = [];
      const edges: CompileResult['edges'] = [];
      nodes.push({ id: ifId, type: 'ifElse', condition: ast.condition });

      // True branch
      nodes.push(...trueCompiled.nodes);
      edges.push({ from: ifId, to: trueCompiled.entryNodeId, condition: 'true' });

      // ELIF chain: each ELIF is an additional ifElse + branch
      let prevIfId = ifId;
      if (ast.elifs) {
        for (const elif of ast.elifs) {
          const elifId = newNodeId('ifElse');
          const elifCompiled = compileNode(elif.branch);
          nodes.push({ id: elifId, type: 'ifElse', condition: elif.condition });
          nodes.push(...elifCompiled.nodes);
          edges.push({ from: prevIfId, to: elifId, condition: 'false' });
          edges.push({ from: elifId, to: elifCompiled.entryNodeId, condition: 'true' });
          prevIfId = elifId;
        }
      }

      // ELSE branch
      if (ast.elseBranch) {
        const elseCompiled = compileNode(ast.elseBranch);
        nodes.push(...elseCompiled.nodes);
        edges.push({ from: prevIfId, to: elseCompiled.entryNodeId, condition: 'false' });
      } else if (falseCompiled) {
        nodes.push(...falseCompiled.nodes);
        edges.push({ from: prevIfId, to: falseCompiled.entryNodeId, condition: 'false' });
      }

      return { nodes, edges, entryNodeId: ifId };
    }
    case 'switch': {
      const switchId = newNodeId('ifElse');
      const nodes: CompileResult['nodes'] = [{ id: switchId, type: 'ifElse' }];
      const edges: CompileResult['edges'] = [];
      let prevId = switchId;

      for (let i = 0; i < ast.targets.length; i++) {
        const targetName = ast.targets[i]!;
        const targetNode: CompileResult = compileNode({ kind: 'agent', name: targetName });
        nodes.push(...targetNode.nodes);
        // First branch: match condition; rest: false chain
        edges.push({
          from: prevId,
          to: targetNode.entryNodeId,
          condition: i === 0 ? undefined : 'false',
        });
        if (i === 0) {
          edges.push({ from: switchId, to: targetNode.entryNodeId, condition: 'true' });
        }
        prevId = switchId;
      }
      return { nodes, edges, entryNodeId: switchId };
    }
    case 'for': {
      const bodyCompiled = compileNode(ast.body);
      const loopId = newNodeId('loop');
      const nodes: CompileResult['nodes'] = [
        { id: loopId, type: 'loop' },
        ...bodyCompiled.nodes,
      ];
      const edges: CompileResult['edges'] = [
        { from: loopId, to: bodyCompiled.entryNodeId },
      ];
      // Loop back from last body node to loop (the engine handles this via loop config)
      const lastBodyNode = bodyCompiled.nodes[bodyCompiled.nodes.length - 1];
      if (lastBodyNode) {
        edges.push({ from: lastBodyNode.id, to: loopId });
      }
      // Set loop config on the loop node (will be used by engine)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
      (nodes[0] as any).loopType = 'count';
      /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
      (nodes[0] as any).loopCount = ast.count;
      /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
      (nodes[0] as any).loopMaxIterations = ast.count * 2;
      return { nodes, edges, entryNodeId: loopId };
    }
    case 'while': {
      const bodyCompiled = compileNode(ast.body);
      const loopId = newNodeId('loop');
      const nodes: CompileResult['nodes'] = [
        { id: loopId, type: 'loop' },
        ...bodyCompiled.nodes,
      ];
      const edges: CompileResult['edges'] = [
        { from: loopId, to: bodyCompiled.entryNodeId },
      ];
      const lastBodyNode = bodyCompiled.nodes[bodyCompiled.nodes.length - 1];
      if (lastBodyNode) {
        edges.push({ from: lastBodyNode.id, to: loopId });
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
      (nodes[0] as any).loopType = 'count';
      /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
      (nodes[0] as any).loopCondition = ast.condition;
      /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
      (nodes[0] as any).loopMaxIterations = 1000;
      return { nodes, edges, entryNodeId: loopId };
    }
    case 'subflow': {
      const id = newNodeId('subflow');
      return {
        nodes: [{ id, type: 'workflow', workflowId: ast.workflowId } as any],
        edges: [],
        entryNodeId: id,
      };
    }
  }
}

// ── Public API ───────────────────────────────────────────────────

/** Parse an EL expression string into an AST. Errors include line:column position. */
export function parseEL(input: string): ELNode {
  try {
    const parser = new ELParser(input);
    return parser.parse();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Try to extract position info from the tokenizer
    const posMatch = msg.match(/at position (\d+)/);
    if (posMatch) {
      const pos = parseInt(posMatch[1]!, 10);
      const tokenizer = new /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
      (Tokenizer as any)(input) as Tokenizer;
      const lc = tokenizer.getLineCol(pos);
      throw new Error(`${msg} (line ${lc.line}, col ${lc.col})`);
    }
    throw err;
  }
}

/** Compile an EL expression string into StateGraph-compatible nodes + edges. */
export function compileEL(input: string): CompileResult {
  resetNodeCounter();
  const ast = parseEL(input);
  return compileNode(ast);
}
