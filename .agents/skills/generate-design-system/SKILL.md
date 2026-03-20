# Generate Design System

This skill helps you generate and maintain a cohesive design system in this Next.js project.

## When to Use This Skill

Use this skill when the user asks to:
- "create a design system"
- "add a UI component library"
- "setup theming"
- "generate brand colors"
- "create a typography scale"
- "build a component showcase"

## Tech Stack Context

This project uses:
- Next.js App Router (v16.1.6)
- React 19
- Tailwind CSS v4 (using `@theme` and CSS variables instead of `tailwind.config.ts`)
- Shadcn UI
- Lucide React for icons

## Core Rules & Constraints

1. **Tailwind CSS v4 Syntax**: Strictly use Tailwind CSS v4 syntax. Do not try to modify `tailwind.config.ts` or `tailwind.config.js` as they do not exist. Store and modify CSS variables strictly within `app/globals.css` in the `:root` and `.dark` blocks, and map them in the `@theme inline` block.
2. **Shadcn UI**: Use `npx shadcn@latest add <component>` for adding base components to ensure compatibility with React 19.
3. **Icons**: Use `lucide-react` for all icons.
4. **Color Format**: Use standard HSL values for CSS variables in `app/globals.css` (e.g., `--primary: 222.2 47.4% 11.2%;`).

## Workflow for Generating the Design System

When tasked with generating a design system, follow these steps:

### 1. Discovery
- Analyze `app/globals.css` to prevent overwriting existing CSS variables unintentionally.
- If the user hasn't provided brand colors, ask them for a primary brand color or a theme direction (e.g., "ocean blue", "minimalist monochrome", "vibrant startup").

### 2. Tokens Generation
- Define the core design tokens in `app/globals.css` for both light (`:root`) and dark (`.dark`) modes.
- Required tokens include: Background, Foreground, Primary, Secondary, Accent, Muted, Destructive, Card, Popover, Border, Input, Ring, and Radius.
- Ensure the contrast ratios between backgrounds and foregrounds meet accessibility standards (WCAG AA).

### 3. Component Scaffolding
- If the user agrees, install essential core UI components via Shadcn to serve as the foundation of the design system.
- Recommended base components: `button`, `input`, `card`, `dialog`, `badge`, `avatar`, `separator`.
- Run commands sequentially, e.g., `npx shadcn@latest add button input card`

### 4. Typography Scale
- Define a consistent typography scale. While Tailwind handles sizing (`text-sm`, `text-lg`), ensure the base font family is applied correctly in `app/layout.tsx` and mapped to CSS variables in `app/globals.css`.

### 5. Showcase Page
- Automatically generate a visual showcase page at `app/design-system/page.tsx`.
- This page should preview all aspects of the design system in one place:
  - Color palettes (Primary, Secondary, Muted, Destructive, etc.)
  - Typography styles (H1, H2, H3, P, Small, Muted)
  - UI Components (Buttons, Inputs, Cards, Badges)
- Ensure the showcase page has a toggle for testing Light and Dark modes.

## Tone and Style
- Be proactive in suggesting color combinations if the user provides a single hex code.
- Provide clear, visual examples in the showcase page.
- Do not output the entire `globals.css` file to the chat unless specifically requested; prefer using tools to modify it.