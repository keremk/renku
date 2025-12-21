# First-Time Setup Steps

Before you can deploy, you need to complete these one-time setup steps:

1. Authenticate with Cloudflare

cd web
pnpm wrangler login
This opens a browser for OAuth login.

2. Create the Cloudflare Pages Project

cd web
pnpm wrangler pages project create renku-web --production-branch main

3. Deploy

pnpm deploy:web

4. Configure Custom Domain (in Cloudflare Dashboard)

After first deployment:
1. Go to Workers & Pages → renku-web → Custom domains
2. Click Set up a custom domain
3. Add gorenku.com
4. Cloudflare will auto-configure DNS since your domain is already on Cloudflare

# Steps to Add Custom Domain

1. Go to https://dash.cloudflare.com
2. Click Workers & Pages in the left sidebar
3. Click on your renku-web project
4. Click the Custom domains tab
5. Click Set up a custom domain
6. Enter gorenku.com
7. Click Continue → Activate domain

Cloudflare will automatically configure the DNS record since the domain is already on their platform. It typically takes just a few seconds to a couple of minutes to propagate.

Optional: Add www subdomain

If you also want www.gorenku.com to work:
1. Add another custom domain: www.gorenku.com
2. Or set up a redirect rule in Cloudflare to redirect www → apex

Verify it's working

After activation, visit:
- https://gorenku.com

You should see your Astro site with HTTPS automatically configured.