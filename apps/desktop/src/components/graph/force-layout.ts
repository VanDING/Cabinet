interface LayoutNode {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  frequency: number;
}

interface LayoutEdge {
  from: string;
  to: string;
  strength: number;
}

export function computeForceLayout(
  nodes: { id: string; frequency: number }[],
  edges: { from: string; to: string; strength: number }[],
  options?: { width?: number; height?: number },
): Map<string, { x: number; y: number }> {
  const width = options?.width ?? 800;
  const height = options?.height ?? 600;
  const cx = width / 2;
  const cy = height / 2;

  const layoutNodes: LayoutNode[] = nodes.map((n) => ({
    id: n.id,
    x: cx + (Math.random() - 0.5) * 200,
    y: cy + (Math.random() - 0.5) * 200,
    vx: 0,
    vy: 0,
    frequency: n.frequency,
  }));

  const nodeMap = new Map(layoutNodes.map((n) => [n.id, n]));
  const layoutEdges: LayoutEdge[] = edges.filter((e) => nodeMap.has(e.from) && nodeMap.has(e.to));

  // Force simulation parameters
  const repulsion = 5000;
  const springLength = 120;
  const springStrength = 0.08;
  const centering = 0.005;
  const damping = 0.85;
  const iterations = 150;

  for (let iter = 0; iter < iterations; iter++) {
    // Repulsive force: all node pairs (Coulomb-like)
    for (let i = 0; i < layoutNodes.length; i++) {
      for (let j = i + 1; j < layoutNodes.length; j++) {
        const a = layoutNodes[i]!;
        const b = layoutNodes[j]!;
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const distSq = dx * dx + dy * dy;
        const dist = Math.max(1, Math.sqrt(distSq));
        const force = repulsion / distSq;
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        a.vx += fx;
        a.vy += fy;
        b.vx -= fx;
        b.vy -= fy;
      }
    }

    // Attractive force: edges (spring/Hooke)
    for (const e of layoutEdges) {
      const a = nodeMap.get(e.from);
      const b = nodeMap.get(e.to);
      if (!a || !b) continue;
      const dx2 = b.x - a.x;
      const dy2 = b.y - a.y;
      const dist2 = Math.max(1, Math.sqrt(dx2 * dx2 + dy2 * dy2));
      const restLen = springLength / (0.5 + e.strength);
      const displacement = dist2 - restLen;
      const force2 = springStrength * displacement;
      const fx2 = (dx2 / dist2) * force2;
      const fy2 = (dy2 / dist2) * force2;
      a.vx += fx2;
      a.vy += fy2;
      b.vx -= fx2;
      b.vy -= fy2;
    }

    // Centering force
    for (const n of layoutNodes) {
      n.vx += (cx - n.x) * centering;
      n.vy += (cy - n.y) * centering;
    }

    // Apply velocity with damping
    for (const n of layoutNodes) {
      n.vx *= damping;
      n.vy *= damping;
      n.x += n.vx;
      n.y += n.vy;
    }
  }

  return new Map(layoutNodes.map((n) => [n.id, { x: n.x, y: n.y }]));
}
