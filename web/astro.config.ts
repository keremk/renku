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
        {
          label: 'Getting Started',
          items: [{ label: 'Welcome', slug: '' }],
        },
      ],
      customCss: ['./src/styles/global.css'],
      components: {
        Header: './src/components/Header.astro',
      },
    }),
  ],
  vite: {
    plugins: [tailwindcss()],
  },
});
