# Xenode Mobile App Design System

Based on the web application's `globals.css` and `theme-provider.tsx`, here is the design system extracted for the Xenode mobile application. You can directly map these properties into Figma or your preferred UI/UX design tool.

## 1. Theming System
The application supports Light and Dark color modes, with System as the user-facing option that follows the device preference:
*   **Light** (Premium light theme with a soft blue tint)
*   **Dark** (High contrast, true dark mode using modern `oklch` color spaces)
*   **System** (Resolves automatically to Light or Dark)

---

## 2. Typography (Fonts)
The design system uses three main font categories. You should set up your text styles using these corresponding font families:
*   **Sans Serif (Primary UI Font):** `Suisse` (used via `var(--font-suisse)`)
*   **Monospace (Code/Data):** `Geist Mono` (used via `var(--font-geist-mono)`)
*   **Brand Font (Headings/Logos):** Custom Brand font (used via `var(--font-brand)`)

---

## 3. Semantic Theme Tokens (Mapping)
Here are the specific semantic colors for each theme to use for components (Buttons, Backgrounds, Cards, etc.).

### A. Light Theme (Default)
*   **Background:** `#f0f4ff` (Very bright pale blue)
*   **Foreground (Text):** `#001031` (Deep brand blue text)
*   **Primary (Buttons/Active):** `#00297a`
*   **Primary Foreground (Button Text):** `#ffffff`
*   **Card / Popover Surface:** `#ffffff`
*   **Secondary / Muted Surface:** `#e0eaff`
*   **Secondary / Muted Text:** `#00297a` (Secondary) / `#5e7ba8` (Muted)
*   **Border / Input:** `#ccdfff`
*   **Ring (Focus state):** `#0043c8`
*   **Sidebar Background:** `#ffffff`
*   **Sidebar Active/Primary:** `#00297a`

### B. Dark Theme
*(Note: Designed using `oklch` for smooth luminance. In Figma, you can use an OKLCH to HEX plugin, or approximate these deep grays/whites).*
*   **Background:** `oklch(0.145 0 0)` (Near Black)
*   **Foreground:** `oklch(0.985 0 0)` (Near White)
*   **Primary:** `oklch(0.922 0 0)` (Bright White/Gray)
*   **Primary Foreground:** `oklch(0.205 0 0)` (Dark Gray)
*   **Card / Popover:** `oklch(0.205 0 0)` (Dark Gray)
*   **Border / Input:** `oklch(1 0 0 / 10%)` (White with 10% opacity)

---

## 4. UI Shapes & Border Radius
The project uses a highly specific corner-rounding scale based on a root value of `0.625rem` (10px). In Figma, set up your radius variables as follows:
*   **Base (`radius` / `lg`):** `10px`
*   **Small (`sm`):** `6px`
*   **Medium (`md`):** `8px`
*   **Extra Large (`xl`):** `14px`
*   **2XL:** `18px`
*   **3XL:** `22px`
*   **4XL:** `26px`

---

## 5. Component Architecture & System
*   **Base Framework:** The project relies heavily on **Shadcn UI**. For mobile UX, you should mirror Shadcn's standard component layouts (e.g., standard padding for buttons, input heights, typical card paddings, and bottom sheets).
*   **Video Player:** The app uses **Plyr** for video. The primary play button and progress bar colors are mapped to the theme's `--primary` color (`--plyr-color-main: var(--primary)`).

---

## 6. Custom Effects & Animations
If you are designing micro-interactions or empty states, include these custom effects defined in the CSS:
*   **Glow Rotate Animation:** An animation (`animate-glow-rotate`) that takes 4 seconds to linearly complete a 360-degree rotation.
*   **Conic Gradient Backgrounds:** A specific gradient is used for glowing effects: `conic-gradient(from 0deg, transparent 0deg 60deg, rgba(232, 228, 217, 0.4) 90deg 120deg, transparent 150deg 360deg)`.

---

## Design Setup Advice for Figma
1. Create Light and Dark variable modes in Figma.
2. Input the Semantic Theme Tokens (Background, Primary, Muted, Border, etc.) linking to the raw color values.
3. Map Shadcn UI mobile kits directly to these variables so your components adapt to the web codebase themes.
