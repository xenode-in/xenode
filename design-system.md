# Xenode Mobile App Design System

Based on the web application's `globals.css` and `theme-provider.tsx`, here is the complete design system extracted for the Xenode mobile application. You can directly map these properties into Figma or your preferred UI/UX design tool.

## 1. Theming System
The application supports **5 distinct themes**. Your mobile app should account for these in its design tokens:
*   **Light** (Premium Light Theme with a soft blue tint)
*   **Dark** (High contrast, true dark mode using modern `oklch` color spaces)
*   **Imperial** (A rich, royal blue-based dark theme)
*   **Deep Navy** (A darker, deeper midnight blue theme)
*   **Xenode Green** (A nature-inspired, dark mossy green theme)

---

## 2. Typography (Fonts)
The design system uses three main font categories. You should set up your text styles using these corresponding font families:
*   **Sans Serif (Primary UI Font):** `Suisse` (used via `var(--font-suisse)`)
*   **Monospace (Code/Data):** `Geist Mono` (used via `var(--font-geist-mono)`)
*   **Brand Font (Headings/Logos):** Custom Brand font (used via `var(--font-brand)`)

---

## 3. Core Color Palettes
The system uses two custom-defined core blue scales. You should add these to your foundational color variables:

**Imperial Blue Scale:**
*   `100`: `#000818`
*   `200`: `#001031`
*   `300`: `#001849`
*   `400`: `#002162`
*   `500` (Base/Default): `#00297a`
*   `600`: `#0043c8`
*   `700`: `#1664ff`
*   `800`: `#6498ff`
*   `900`: `#b1cbff`

**Deep Navy Scale:**
*   `100`: `#000613`
*   `200`: `#000d27`
*   `300`: `#00133a`
*   `400`: `#001a4e`
*   `500` (Base/Default): `#00205f`
*   `600`: `#003cb4`
*   `700`: `#075aff`
*   `800`: `#5a91ff`
*   `900`: `#acc8ff`

---

## 4. Semantic Theme Tokens (Mapping)
Here are the specific semantic colors for each theme to use for components (Buttons, Backgrounds, Cards, etc.).

### A. Light Theme (Default)
*   **Background:** `#f0f4ff` (Very bright pale blue)
*   **Foreground (Text):** `#001031` (Deep Imperial Blue text)
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

### C. Imperial Theme
*   **Background:** `#000818`
*   **Foreground:** `#b1cbff`
*   **Primary (Buttons):** `#1664ff`
*   **Primary Foreground:** `#ffffff`
*   **Card / Popover:** `#001031`
*   **Secondary / Muted Surface:** `#001849`
*   **Border / Input:** `#002162`
*   **Ring:** `#1664ff`

### D. Deep Navy Theme
*   **Background:** `#000613`
*   **Foreground:** `#acc8ff`
*   **Primary (Buttons):** `#075aff`
*   **Primary Foreground:** `#ffffff`
*   **Card / Popover:** `#000d27`
*   **Secondary / Muted Surface:** `#00133a`
*   **Border / Input:** `#001a4e`
*   **Ring:** `#075aff`

### E. Xenode Green Theme
*   **Background:** `#0f1a12` (Deep Forest Black/Green)
*   **Foreground:** `#e8e4d9` (Warm Off-White/Bone)
*   **Primary:** `#7cb686` (Soft Sage Green)
*   **Primary Foreground:** `#0f1a12`
*   **Card / Popover:** `#1a2e1d` (Translucent white mix over green)
*   **Ring / Focus:** `#7cb686`

---

## 5. UI Shapes & Border Radius
The project uses a highly specific corner-rounding scale based on a root value of `0.625rem` (10px). In Figma, set up your radius variables as follows:
*   **Base (`radius` / `lg`):** `10px`
*   **Small (`sm`):** `6px`
*   **Medium (`md`):** `8px`
*   **Extra Large (`xl`):** `14px`
*   **2XL:** `18px`
*   **3XL:** `22px`
*   **4XL:** `26px`

---

## 6. Component Architecture & System
*   **Base Framework:** The project relies heavily on **Shadcn UI**. For mobile UX, you should mirror Shadcn's standard component layouts (e.g., standard padding for buttons, input heights, typical card paddings, and bottom sheets).
*   **Video Player:** The app uses **Plyr** for video. The primary play button and progress bar colors are mapped to the theme's `--primary` color (`--plyr-color-main: var(--primary)`).

---

## 7. Custom Effects & Animations
If you are designing micro-interactions or empty states, include these custom effects defined in the CSS:
*   **Glow Rotate Animation:** An animation (`animate-glow-rotate`) that takes 4 seconds to linearly complete a 360-degree rotation.
*   **Conic Gradient Backgrounds:** A specific gradient is used for glowing effects: `conic-gradient(from 0deg, transparent 0deg 60deg, rgba(232, 228, 217, 0.4) 90deg 120deg, transparent 150deg 360deg)`.

---

## Design Setup Advice for Figma:
1. Create 5 variable modes in Figma (Light, Dark, Imperial, Deep Navy, Xenode Green).
2. Input the Semantic Theme Tokens (Background, Primary, Muted, Border, etc.) linking to the raw Hex codes.
3. Map Shadcn UI mobile kits directly to these variables so your components instantly adapt to the 5 themes exactly as the web codebase does.
