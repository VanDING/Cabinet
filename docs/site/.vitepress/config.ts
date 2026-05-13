import { defineConfig } from 'vitepress';

export default defineConfig({
  title: 'Cabinet',
  description: 'AI Collaboration Framework for Super Individuals',
  themeConfig: {
    nav: [
      { text: 'Home', link: '/' },
      { text: 'Guide', link: '/guide/' },
      { text: 'API', link: '/api/' },
    ],
    sidebar: {
      '/guide/': [
        { text: 'Getting Started', link: '/guide/' },
        { text: 'Architecture', link: '/guide/architecture' },
        { text: 'Development', link: '/guide/development' },
        { text: 'Deployment', link: '/guide/deployment' },
      ],
      '/api/': [
        { text: 'Overview', link: '/api/' },
        { text: 'Secretary API', link: '/api/secretary' },
        { text: 'Decisions API', link: '/api/decisions' },
        { text: 'Workflows API', link: '/api/workflows' },
      ],
    },
    socialLinks: [
      { icon: 'github', link: 'https://github.com/cabinet/cabinet' },
    ],
  },
});
