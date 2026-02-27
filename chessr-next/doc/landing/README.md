# Landing Page Documentation

Technical documentation for the Chessr landing page — the public-facing marketing site hosted on Vercel.

## Tech Stack

- **Next.js 15** - App Router, server-side rendering
- **TypeScript** - Type safety
- **Tailwind CSS 4** - Styling
- **Framer Motion** - Animations
- **Radix UI** - Accessible UI primitives
- **@supabase/supabase-js** - Password reset flow
- **@vercel/analytics** - Traffic analytics

## Hosting

- **Platform:** Vercel
- **Domain:** chessr.io
- **Deploy:** Automatic on push to main branch
- **Not on VPS** — fully managed by Vercel

## Pages

| Route | Purpose |
|-------|---------|
| `/` | Homepage with hero, features, pricing, FAQ |
| `/privacy` | Privacy policy |
| `/tos` | Terms of service |
| `/refund` | Refund policy |
| `/reset-password` | Password reset flow (Supabase Auth) |
| `/email-confirmed` | Email confirmation success page |
| `/version` | Version API route |

## Homepage Sections

### Navigation
- Fixed top navbar (desktop + mobile hamburger menu)
- Links: Features, Pricing, FAQ, Roadmap
- CTA buttons: Discord invite, Download extension

### Hero
- Main value proposition
- Download extension CTA

### Features
- Feature grid showcasing key capabilities

### Pricing
- Plan comparison table (Free, Premium, Lifetime)
- Pricing details and feature breakdown

### FAQ
- Collapsible accordion (Radix UI)
- Common questions and answers

### Footer
- Sticky bottom navigation
- Legal links (Privacy, ToS, Refund)

## SEO

- `robots.ts` — Dynamic robots.txt generation
- `sitemap.ts` — Dynamic sitemap generation
- Metadata configured in `layout.tsx`

## Project Structure

```
landing/
├── app/
│   ├── layout.tsx              # Root layout + metadata
│   ├── page.tsx                # Homepage (hero + nav)
│   ├── privacy/page.tsx        # Privacy policy
│   ├── tos/page.tsx            # Terms of service
│   ├── refund/page.tsx         # Refund policy
│   ├── reset-password/page.tsx # Password reset
│   ├── email-confirmed/page.tsx
│   ├── version/route.ts       # Version API
│   ├── robots.ts              # SEO robots.txt
│   └── sitemap.ts             # SEO sitemap
├── components/
│   ├── hero.tsx               # Hero section
│   ├── features.tsx           # Features grid
│   ├── pricing-section.tsx    # Pricing plans
│   ├── faq-section.tsx        # FAQ accordion
│   ├── sticky-footer.tsx      # Bottom navigation
│   └── ui/                    # Radix UI components
├── public/                    # Static assets
├── Dockerfile                 # For VPS (unused, Vercel deploys)
├── package.json
├── next.config.ts
└── tailwind.config.ts
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes | Supabase anonymous key |
