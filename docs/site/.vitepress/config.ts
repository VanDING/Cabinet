import { defineConfig } from 'vitepress';

export default defineConfig({
  title: 'Cabinet',
  description: 'AI Collaboration Framework for Super Individuals',
  themeConfig: {
    nav: [
      { text: 'Home', link: '/' },
      { text: 'Guide', link: '/guide/' },
      { text: 'Concepts', link: '/concepts/' },
      { text: 'API', link: '/api/' },
    ],
    sidebar: {
      '/guide/': [
        { text: 'Getting Started', link: '/guide/' },
        { text: 'Architecture', link: '/guide/architecture' },
        { text: 'Development', link: '/guide/development' },
        { text: 'Deployment', link: '/guide/deployment' },
        { text: 'Contributing', link: '/guide/contributing' },
      ],
      '/concepts/': [
        { text: 'Overview', link: '/concepts/' },
        { text: 'Agent System', link: '/concepts/agents' },
        { text: 'Decision L0-L3', link: '/concepts/decisions' },
        { text: 'Memory Layers', link: '/concepts/memory-layers' },
        { text: 'Knowledge Graph', link: '/concepts/knowledge-graph' },
      ],
      '/api/': [
        { text: 'Overview', link: '/api/' },
        { text: 'Secretary API', link: '/api/secretary' },
        { text: 'Decisions API', link: '/api/decisions' },
        { text: 'Memory API', link: '/api/memory' },
        { text: 'Memory API', link: '/api/memory' },
        { text: 'Gateway API', link: '/api/gateway' },
      ],
    },
    socialLinks: [{ icon: 'github', link: 'https://github.com/VanDING/Cabinet' }],
  },
});
