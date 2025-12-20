import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  site: 'https://renku.dev',
  integrations: [
    starlight({
      title: 'Renku',
      logo: {
        src: './src/assets/logo.svg',
      },
      social: [
        {
          icon: 'github',
          label: 'GitHub',
          href: '#github',
        },
        {
          icon: 'discord',
          label: 'Discord',
          href: '#discord',
        },
      ],
      sidebar: [
        { label: 'Welcome', slug: 'docs' },
        { label: 'Introduction', slug: 'docs/introduction' },
        { label: 'Quick Start', slug: 'docs/quick-start' },
        { label: 'Usage Guide', slug: 'docs/usage-guide' },
        { label: 'CLI Reference', slug: 'docs/cli-reference' },
        {
          label: 'Blueprint Authoring',
          slug: 'docs/blueprint-authoring',
          badge: { text: 'Advanced', variant: 'tip' },
        },
      ],
      customCss: ['./src/styles/global.css'],
      components: {
        PageTitle: './src/components/starlight/PageTitle.astro',
        ThemeSelect: './src/components/starlight/ThemeSelect.astro',
      },
    }),
  ],
  vite: {
    plugins: [tailwindcss()],
  },
});
