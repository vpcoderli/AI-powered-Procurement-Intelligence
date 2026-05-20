# Generative Art Static Page Design

## Goal

Create an independent static frontend page using UI/UX Pro Max's "Generative Art Platform" recommendation: Minimalism (Frame) + Gen Z Chaos.

## Route And Isolation

The page lives at `frontend/src/app/generative-art-static/page.tsx` and renders at `/generative-art-static`. It does not modify existing pages, API routes, data models, or shared business flows. Styling is scoped with a CSS module in the same route directory.

## Visual Direction

Use a neutral, spacious canvas as the frame:

- Background: canvas neutral `#FAFAFA`
- Text: near-black `#09090B`
- Frame colors: `#18181B`, `#FFFFFF`, `#E4E4E7`
- Creative accent: `#EC4899`

Layer Gen Z Chaos only as controlled visual energy:

- Offset stickers and rotated labels.
- Marquee strips.
- High-saturation pink, green, yellow, and blue accents.
- Collage-style gallery cards and prompt chips.
- Jitter/float animations that respect `prefers-reduced-motion`.

## Content

The page is a static concept screen for APSi as a generative procurement intelligence workspace. It should show:

- A hero with a big product headline.
- Static prompt chips.
- A generative art preview panel.
- A bento-like gallery of procurement intelligence outputs.
- Static status/workflow modules.

No API calls, authentication, database reads, or crawler actions are included.

## Verification

Verification must include:

- A Vitest test that checks the independent route files exist and remain static.
- `npm test`.
- `npm run lint`.
- `npm run build`.
- A local browser or screenshot check for `/generative-art-static` when practical.
