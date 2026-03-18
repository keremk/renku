import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  site: 'https://gorenku.com',
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
        { label: 'Quick Start', slug: 'docs/app-quick-start' },
        { label: 'Usage Guide', slug: 'docs/app-usage-guide' },
        { label: 'Using Skills', slug: 'docs/app-using-skills' },
        {
          label: 'CLI (Advanced)',
          items: [
            { label: 'Introduction', slug: 'docs/introduction' },
            { label: 'CLI Quick Start', slug: 'docs/quick-start' },
            { label: 'Usage Guide', slug: 'docs/usage-guide' },
            { label: 'CLI Reference', slug: 'docs/cli-reference' },
            {
              label: 'Blueprint Authoring',
              slug: 'docs/blueprint-authoring',
            },
            { label: 'Asset Producers', slug: 'docs/asset-producers' },
          ],
        },
      ],
      customCss: ['./src/styles/global.css'],
      components: {
        Head: './src/components/starlight/Head.astro',
        Footer: './src/components/starlight/Footer.astro',
        PageTitle: './src/components/starlight/PageTitle.astro',
        ThemeSelect: './src/components/starlight/ThemeSelect.astro',
      },
    }),
  ],
  vite: {
    plugins: [tailwindcss()],
  },
});
