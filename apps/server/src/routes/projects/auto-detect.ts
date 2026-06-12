import { readdirSync, readFileSync } from 'node:fs';
import { join, basename } from 'node:path';

interface DetectedProjectInfo {
  projectType: string;
  summary: string;
  techStack: string[];
  fileCount: number;
}

const PROJECT_TYPE_SIGNATURES: Record<string, { type: string; label: string }> = {
  'package.json': { type: 'node', label: 'Node.js' },
  'tsconfig.json': { type: 'typescript', label: 'TypeScript' },
  'Cargo.toml': { type: 'rust', label: 'Rust' },
  'go.mod': { type: 'go', label: 'Go' },
  'requirements.txt': { type: 'python', label: 'Python' },
  'pyproject.toml': { type: 'python', label: 'Python' },
  'setup.py': { type: 'python', label: 'Python' },
  Pipfile: { type: 'python', label: 'Python' },
  Gemfile: { type: 'ruby', label: 'Ruby' },
  'pom.xml': { type: 'java', label: 'Java (Maven)' },
  'build.gradle': { type: 'java', label: 'Java (Gradle)' },
  'composer.json': { type: 'php', label: 'PHP' },
  'CMakeLists.txt': { type: 'cpp', label: 'C/C++ (CMake)' },
  Makefile: { type: 'make', label: 'Make-based' },
  Dockerfile: { type: 'docker', label: 'Docker' },
  'docker-compose.yml': { type: 'docker', label: 'Docker Compose' },
  '.git': { type: 'git', label: 'Git repository' },
  'pnpm-workspace.yaml': { type: 'monorepo', label: 'pnpm Monorepo' },
  'lerna.json': { type: 'monorepo', label: 'Lerna Monorepo' },
  'nx.json': { type: 'monorepo', label: 'Nx Monorepo' },
  'turbo.json': { type: 'monorepo', label: 'Turborepo' },
  'next.config.js': { type: 'nextjs', label: 'Next.js' },
  'next.config.ts': { type: 'nextjs', label: 'Next.js' },
  'vite.config.ts': { type: 'vite', label: 'Vite' },
  'vite.config.js': { type: 'vite', label: 'Vite' },
  'astro.config.mjs': { type: 'astro', label: 'Astro' },
  'svelte.config.js': { type: 'svelte', label: 'Svelte' },
  'tailwind.config.js': { type: 'tailwind', label: 'Tailwind CSS' },
  'tailwind.config.ts': { type: 'tailwind', label: 'Tailwind CSS' },
  '.eslintrc.js': { type: 'eslint', label: 'ESLint' },
  '.eslintrc.json': { type: 'eslint', label: 'ESLint' },
  'eslint.config.js': { type: 'eslint', label: 'ESLint' },
  'prettier.config.js': { type: 'prettier', label: 'Prettier' },
  '.prettierrc': { type: 'prettier', label: 'Prettier' },
  '.env': { type: 'env', label: 'Environment config' },
  '.env.example': { type: 'env', label: 'Environment config' },
  'README.md': { type: 'docs', label: 'Documented' },
  'CHANGELOG.md': { type: 'docs', label: 'Changelog' },
  '.github': { type: 'ci', label: 'GitHub Actions' },
  '.gitlab-ci.yml': { type: 'ci', label: 'GitLab CI' },
};

export function detectProjectInfo(rootPath: string): DetectedProjectInfo | null {
  const topEntries = readdirSync(rootPath, { withFileTypes: true });
  const topFiles = new Set(topEntries.filter((e) => e.isFile()).map((e) => e.name));
  const topDirs = new Set(topEntries.filter((e) => e.isDirectory()).map((e) => e.name));

  // Detect project type from signature files
  const techStack: string[] = [];
  const detectedTypes: string[] = [];

  for (const [sigFile, info] of Object.entries(PROJECT_TYPE_SIGNATURES)) {
    if (topFiles.has(sigFile) || topDirs.has(sigFile)) {
      if (!detectedTypes.includes(info.type)) {
        detectedTypes.push(info.type);
        techStack.push(info.label);
      }
    }
  }

  // Try to read package.json for more details
  let projectName = basename(rootPath);
  let projectDescription = '';
  if (topFiles.has('package.json')) {
    try {
      const pkg = JSON.parse(readFileSync(join(rootPath, 'package.json'), 'utf-8'));
      if (pkg.name) projectName = pkg.name;
      if (pkg.description) projectDescription = pkg.description;
    } catch {
      /* ignore malformed JSON */
    }
  }

  // Try Cargo.toml
  if (topFiles.has('Cargo.toml')) {
    try {
      const cargo = readFileSync(join(rootPath, 'Cargo.toml'), 'utf-8');
      const nameMatch = cargo.match(/^name\s*=\s*"(.+)"$/m);
      if (nameMatch) projectName = nameMatch[1]!;
      const descMatch = cargo.match(/^description\s*=\s*"(.+)"$/m);
      if (descMatch) projectDescription = descMatch[1]!;
    } catch {
      /* ignore */
    }
  }

  // Count files (shallow, max depth 2 for performance)
  let fileCount = 0;
  function countFiles(dir: string, depth: number): void {
    if (depth > 1) return;
    try {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'target')
          continue;
        if (entry.isFile()) fileCount++;
        else if (entry.isDirectory()) countFiles(join(dir, entry.name), depth + 1);
      }
    } catch {
      /* skip unreadable */
    }
  }
  countFiles(rootPath, 0);

  // Build project type string
  const projectType = detectedTypes.length > 0 ? detectedTypes.join('/') : 'unknown';

  // Build summary
  const summaryParts: string[] = [];
  if (projectDescription) {
    summaryParts.push(projectDescription);
  } else {
    const techDesc =
      techStack.length > 0 ? `A ${techStack.slice(0, 3).join('/')} project` : 'A project';
    summaryParts.push(`${techDesc} located at ${rootPath}.`);
  }
  summaryParts.push(`${fileCount} files detected.`);

  return {
    projectType,
    summary: summaryParts.join(' '),
    techStack: techStack.slice(0, 5), // Cap at 5
    fileCount,
  };
}
