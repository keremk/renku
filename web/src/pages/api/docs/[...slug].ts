import type { APIRoute, GetStaticPaths } from 'astro';
import { getCollection } from 'astro:content';

export const prerender = true;

export const getStaticPaths: GetStaticPaths = async () => {
  const docs = await getCollection('docs');
  return docs.map((doc) => ({
    params: { slug: doc.slug + '.md' },
    props: { doc },
  }));
};

export const GET: APIRoute = async ({ props }) => {
  const { doc } = props as { doc: { data: { title: string; description?: string }; body: string } };

  if (!doc) {
    return new Response('Not found', { status: 404 });
  }

  // Construct markdown with frontmatter
  const frontmatter = [
    '---',
    `title: ${doc.data.title}`,
    doc.data.description ? `description: ${doc.data.description}` : null,
    '---',
    '',
  ]
    .filter(Boolean)
    .join('\n');

  const markdown = frontmatter + doc.body;

  return new Response(markdown, {
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  });
};
