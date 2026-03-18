# Web Cookie Consent + PostHog QA Checklist

Use this after `pnpm deploy:web` to verify GDPR banner behavior and analytics coverage on `https://gorenku.com`.

## Setup

- Open an Incognito window.
- Open DevTools:
  - Console
  - Application (Storage)
  - Network (filter: `posthog`)
- Test pages:
  - `https://gorenku.com/`
  - `https://gorenku.com/install/`
  - `https://gorenku.com/blog/`
  - `https://gorenku.com/docs/`

## 1) First-Visit Banner

- On first load of `/`, banner is visible at the bottom.
- Banner has only two actions: `Reject` and `Accept`.
- Styling is readable and consistent in both light and dark themes.

## 2) Reject Flow

- Click `Reject`.
- In Console run:

```js
localStorage.getItem('renku_cookie_consent_v1');
```

- Expected value: `"rejected"`.
- Refresh page: banner stays hidden.
- Footer `Cookie settings` reopens banner.
- After reject, confirm no persistent PostHog identity storage appears (`ph_*` keys/cookies should not be set for accepted tracking).

## 3) Accept Flow

- Reset and retest:

```js
localStorage.removeItem('renku_cookie_consent_v1');
location.reload();
```

- Click `Accept`.
- In Console run:

```js
localStorage.getItem('renku_cookie_consent_v1');
```

- Expected value: `"accepted"`.
- Refresh page: banner stays hidden.
- Network tab (filter `posthog`) shows analytics requests.
- PostHog Live Events should show `cookie_consent_accepted`.

## 4) Cookie Settings Change Path

- Click `Cookie settings` in site footer and in docs footer.
- Switch choice from accepted to rejected and back.
- Validate localStorage key updates each time.

## 5) Docs + Blog Coverage

- Go to `/docs/` and a docs detail page.
- Scroll to at least 50% and 90%.
- Expected events in PostHog: `content_scroll_depth` with docs context.
- On docs pages, click `Copy Page`.
- Expected event: `docs_copy_page_clicked`.
- Go to `/blog/`, click a blog post from list.
- Expected event: `blog_post_opened_from_list`.
- On blog post, scroll and confirm `content_scroll_depth` events.

## 6) Install Funnel Coverage

- From homepage, click install CTA(s) and go to `/install/`.
- Confirm existing CTA/install events continue to appear.
- Confirm pageviews for `/` and `/install/` appear so bounce vs continue can be analyzed.

## 7) Country-Level Signal

- In PostHog, open recent `$pageview` events.
- Verify country property is present (for example `$geoip_country_name`).
- If missing, check PostHog project geo/IP settings.

## Pass Criteria

- Consent choice persists in localStorage and banner does not reappear unnecessarily.
- Accept/Reject both function correctly.
- Cookie settings link allows changing choice.
- Docs/blog/install events are visible in PostHog.
- Country-level pageview property is present.
