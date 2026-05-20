# Generative Art Static Page Design

## Goal

Create an independent static frontend page using the actual UI/UX Pro Max "Generative Art Platform" demo as the visual reference:

https://ui-ux-pro-max-skill.nextlevelbuilder.io/demo/generative-art-platform

## Route And Isolation

The page lives at `frontend/src/app/generative-art-static/page.tsx` and renders at `/generative-art-static`. It does not modify existing pages, API routes, data models, or shared business flows. Styling is scoped with a CSS module in the same route directory.

## Visual Direction

Use the demo's dark generative platform language as the frame:

- Background: near-black `#0A0A0A`
- Cards: elevated charcoal `#1A1A1A`
- Text: white with muted gray secondary copy
- Accents: magenta `#FF00FF`, cyan `#00FFFF`, lime `#00FF00`, yellow `#FFFF00`
- Typography: Syne-like geometric headings and Manrope-like product body copy

Translate the demo's structure into APSi procurement content:

- Fixed glass-style top navigation.
- Hero with a generation command module adapted to procurement intelligence.
- Static visual previews for search, saved bids, crawler runs, alerts, and source health.
- Bento-style gallery cards for core workflows.
- Tool cards and numbered flow steps for the APSi operating model.
- Motion and hover states that respect `prefers-reduced-motion`.

## Content

The page is a static concept screen for APSi as a generative procurement intelligence workspace. It should show:

- A hero with a big product headline.
- A static "generate intelligence" command panel.
- A bento-like gallery of procurement intelligence workflows.
- Static tool cards for state crawlers, saved bids, alerts, and source quality.
- Numbered UE flow steps for discover, qualify, save, and monitor.

No API calls, authentication, database reads, or crawler actions are included.

## Verification

Verification must include:

- A Vitest test that checks the independent route files exist and remain static.
- `npm test`.
- `npm run lint`.
- `npm run build`.
- A local browser or screenshot check for `/generative-art-static` when practical.
