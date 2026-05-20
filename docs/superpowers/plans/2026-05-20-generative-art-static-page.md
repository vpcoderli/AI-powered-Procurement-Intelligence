# Generative Art Static Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a standalone static `/generative-art-static` page using the UI/UX Pro Max Generative Art Platform style.

**Architecture:** Add a new Next.js app route under its own directory. Keep all visual styling in a colocated CSS module and avoid touching existing product pages, shared layout, API routes, or business data flows.

**Tech Stack:** Next.js App Router, React, TypeScript, CSS Modules, Vitest, existing lucide-react icons.

---

## File Structure

- Create `frontend/src/app/generative-art-static/page.test.ts`
  - Static route contract test: page and CSS module exist, page text identifies the concept, and page does not import app APIs.
- Create `frontend/src/app/generative-art-static/page.tsx`
  - Static React page for the route.
- Create `frontend/src/app/generative-art-static/page.module.css`
  - Scoped visual system for Minimalism + Gen Z Chaos.

## Tasks

### Task 1: Route Contract Test

- [ ] Write `page.test.ts` that reads `page.tsx` and `page.module.css`.
- [ ] Assert the page includes `Generative Bid Lab`, `Minimalism + Gen Z Chaos`, and no `/api/` or `@/lib/api` references.
- [ ] Run `cd frontend && npm test -- src/app/generative-art-static/page.test.ts`.
- [ ] Expected: fail because the route files do not exist yet.

### Task 2: Static Page Implementation

- [ ] Create `page.tsx` with static arrays for prompt chips, gallery cards, and signal modules.
- [ ] Create `page.module.css` with scoped layout, responsive rules, stickers, marquee, bento cards, and reduced-motion handling.
- [ ] Run `cd frontend && npm test -- src/app/generative-art-static/page.test.ts`.
- [ ] Commit with `feat: add generative art static page`.

### Task 3: Full Verification

- [ ] Run `cd frontend && npm test`.
- [ ] Run `cd frontend && npm run lint`.
- [ ] Run `cd frontend && npm run build`.
- [ ] Open `/generative-art-static` locally and capture visual evidence if possible.
