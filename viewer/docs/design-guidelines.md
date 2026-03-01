# Viewer App Design Guidelines

This document captures the visual design system, styling conventions, and UI patterns used throughout the Renku Viewer application.

## Color Philosophy

The viewer uses a **warm amber/golden/parchment** palette that evokes an aged manuscript aesthetic. The color system is built on HSL values with intentional warmth in light mode and neutral grays in dark mode, preserving the amber accent as the visual identity across both themes.

**Light mode**: Warm cream/parchment backgrounds (hue ~60, saturation ~50%), golden amber accents (hue ~42), warm brown text (hue ~45).

**Dark mode**: Neutral desaturated grays for backgrounds (no hue/saturation), with the warm amber accent preserved for primary and accent colors. The dark mode foreground text (`hsl(60 51% 91%)`) mirrors the light mode background value, creating an elegant symmetry.

## Elevation & Depth System

Depth is communicated through **background color gradation**, not z-index or shadow alone. The theme defines a 5-level surface hierarchy:

| Level | Token | Light Mode | Dark Mode | Usage |
|-------|-------|-----------|-----------|-------|
| 0 | `--background` | `hsl(60 51% 91%)` warm cream | `hsl(0 0% 20%)` dark gray | App background, outermost surface |
| 1 | `--sidebar-bg` | `hsl(46 52% 88%)` slightly darker | `hsl(0 0% 16%)` deeper dark | Sidebars, panel chrome |
| 2 | `--panel-bg` | Same as background | Same as background | Main content areas, panels |
| 3 | `--card` | `hsl(50 100% 93%)` bright cream | `hsl(0 0% 29%)` lighter gray | Cards, interactive surfaces |
| 4 | `--item-hover-bg` / `--item-active-bg` | Muted hover/active tints | Lighter/amber-tinted states | Hover and active interaction |

**Light mode** achieves depth through warm saturation differences (cream tones from hue 60 to hue 46). **Dark mode** achieves depth by progressively lightening gray values: 16% -> 20% -> 29% -> 32%.

This means: sidebars are darker than the background, cards are lighter (more elevated), and hover states are the lightest of all.

## Color Token Reference

### Semantic Color Tokens

The theme extends the standard Shadcn token set with custom semantic tokens for specific UI regions:

**Standard Shadcn pairs** (background + foreground text):
- `background` / `foreground` -- App-level base
- `card` / `card-foreground` -- Card surfaces
- `popover` / `popover-foreground` -- Popover/dropdown surfaces
- `primary` / `primary-foreground` -- Primary accent (golden amber)
- `secondary` / `secondary-foreground` -- Secondary accent (warm brown)
- `muted` / `muted-foreground` -- Muted/disabled surfaces and text
- `accent` / `accent-foreground` -- Accent highlights (golden)
- `destructive` -- Error/delete actions (orange-red)

**Custom semantic tokens** (Renku-specific):
- `sidebar-bg`, `sidebar-header-bg`, `sidebar-border` -- Sidebar anatomy
- `panel-bg`, `panel-header-bg`, `panel-border` -- Panel anatomy
- `item-hover-bg`, `item-active-bg`, `item-active-border` -- Interactive item states
- `editor-bg`, `editor-fg` -- Code editor
- `dialog-footer-bg` -- Dialog footer surface (semi-transparent)

**Functional tokens:**
- `border` -- General borders
- `input` -- Form input borders
- `ring` -- Focus ring (amber with opacity)

### Interactive State Colors

Item states (used in sidebars, master-detail lists, tab buttons):

| State | Background | Border |
|-------|-----------|--------|
| Default | `bg-transparent` or `bg-background/30` | `border-transparent` |
| Hover | `bg-item-hover-bg` | `border-border/50` |
| Active/Selected | `bg-item-active-bg` | `border-item-active-border` |

### Status Colors

Status indicators use a consistent formula: `border-{color}-500/45 bg-{color}-500/14 text-{color}-700 dark:text-{color}-300`:

| Status | Color |
|--------|-------|
| Success/Complete | `emerald` |
| Error/Failed | `red` |
| Running/In-progress | `blue` |
| Pending/Warning | `amber` |
| Skipped/Neutral | `slate` |

## Typography

### Font Families

```
--font-sans:  Montserrat, sans-serif       (body text, UI)
--font-serif: Geist, Geist Fallback        (not widely used)
--font-mono:  Geist Mono, Geist Mono Fallback  (code editor, monospace)
```

The body font is Montserrat, set on the `<body>` element.

### The Section Header Pattern

The most distinctive typographic element is the **section header** -- a compact, uppercase label used consistently for all section titles, tab buttons, dialog titles, and sidebar headers:

```
text-[11px] uppercase tracking-[0.12em] font-semibold
```

This pattern appears in: tab buttons, dialog titles (`DialogTitle`), sidebar headers, panel sub-headers, and any label that identifies a UI region.

### Text Size Scale

| Size | Usage |
|------|-------|
| `text-3xl` | Landing page main heading |
| `text-2xl` | Error page heading, plan dialog stat values |
| `text-xl` | Plan dialog section headings |
| `text-lg` | Loading state text |
| `text-sm` | **Primary body text** -- form labels, list items, buttons, descriptions, node labels, property names, empty state titles |
| `text-xs` | Secondary text -- descriptions, badges, timestamps, footer labels, muted text, code snippets, legend items |
| `text-[11px]` | Section headers (uppercase), tab buttons, metadata labels |
| `text-[10px]` | Tiny badges, producer type labels, node subtypes, error details |
| `text-[9px]` | Timeline track labels |

Note: `text-sm` is the dominant text size. The app is information-dense and uses compact text throughout.

### Font Weight Scale

| Weight | Usage |
|--------|-------|
| `font-bold` | CollapsibleSection titles only |
| `font-semibold` | Section headers (11px uppercase), node labels, tab buttons, page headings, dialog titles |
| `font-medium` | Buttons, list item names, property labels, form labels, small badges |
| (no weight) | Body text, descriptions |

## Border Philosophy

Borders are used extensively but **almost never at full opacity**. The dominant pattern is `border-border/40` (40% opacity), creating very soft, barely-there separation lines. This is a core design principle: **borders whisper, they don't shout**.

### Border Opacity Scale

| Opacity | Pattern | Usage |
|---------|---------|-------|
| `/20` | `border-border/20` | Table row separators (barely visible) |
| `/30` | `border-border/30` | Dialog sections, subtle dividers |
| `/40` | `border-border/40` | **Most common** -- tab headers, section dividers, panel internals |
| `/50` | `border-border/50` | Build cards, cancel buttons, hover states |
| `/60` | `border-border/60` | Blueprint nodes, card footers |
| Full | `border-border` | Rarely used alone |

### Semantic Border Tokens

- `border-panel-border` -- Dialog content, detail panel outer border
- `border-sidebar-border` -- Sidebar containers, bottom panel outer border
- `border-item-active-border` -- Selected items in sidebars/lists
- `border-input` -- Form inputs, select triggers
- `border-transparent` -- Unselected items (reserves space to prevent layout shift)
- `border-primary/50` -- Selection highlight accent

### Borders + Shadows Together

The design uses BOTH borders and shadows, with different purposes:
- **Borders**: Structural separation (panel outlines, section dividers, tab headers) -- always softened with opacity
- **Shadows**: Elevation and lift (cards, dialogs, buttons) -- warm-tinted in light mode

## Shadow System

Eight shadow levels defined as CSS variables. Shadows use a warm brown base in light mode (`hsl(30 20% 20%)`) and pure black in dark mode. Dark mode shadows are 5-18x more opaque to remain visible against dark backgrounds.

### Shadow Usage

| Shadow | Where Used |
|--------|-----------|
| `shadow-xs` | Select triggers, switches |
| `shadow-sm` | Base card (Shadcn), outline buttons, inputs, theme toggle thumb |
| `shadow` | Default buttons |
| `shadow-lg` | MediaCards, PropertyRows, CollapsibleSections (highlighted) |
| `shadow-xl` | Hover states with card lift (`-translate-y-1`) |
| `shadow-2xl` | Dialog overlays |

### Card Lift Effect

Interactive cards use a lift animation on hover combining shadow + translate:
```
hover:shadow-xl hover:-translate-y-1 transition-all
```
Selected cards maintain the lifted state: `shadow-xl -translate-y-1`.

## Border Radius

```
--radius:       0.625rem  (10px)  -- base
--radius-sm:    6px               -- small elements
--radius-md:    8px               -- buttons, inputs
--radius-lg:    10px              -- standard cards
--radius-xl:    14px              -- major panels
--radius-panel: 14px (= radius-xl)
```

### Radius Usage

| Radius | Where Used |
|--------|-----------|
| `rounded-[var(--radius-panel)]` | All major panels (sidebar, detail, bottom panel) |
| `rounded-xl` | Cards, collapsible sections, property rows, media cards, config editors |
| `rounded-lg` | Build card items, inner content areas |
| `rounded-md` | Buttons, inputs, small UI elements |
| `rounded-full` | Badges, count pills, graph node circles, toggle thumb |

## Gradient Usage

Gradients are used sparingly and purposefully:

| Pattern | Purpose |
|---------|---------|
| `bg-linear-to-b from-muted/80 to-muted/40` | Vertical fade on status cards |
| `bg-linear-to-br from-emerald-500/20 to-emerald-600/10` | Success icon glow |
| `bg-linear-to-br from-red-500/20 to-red-600/10` | Error icon glow |
| `bg-linear-to-t from-muted/80 to-transparent` | Bottom fade overlay on hover |
| `bg-linear-to-r from-orange-400 to-yellow-500` | Timeline slider progress fill |
| `bg-linear-to-br from-muted/70 via-muted/50 to-muted/30` | Audio card background depth |

## Layout Patterns

### App Shell

The app uses a full-viewport layout with a vertically-split resizable workspace:

```
Root (h-screen w-screen bg-background text-foreground p-4 flex flex-col)
  Container (flex-1 min-h-0 flex flex-col)
    TOP SECTION (flex, percentage-based height)
      Builds Sidebar (w-64 shrink-0)     [conditional]
      Detail Panel   (flex-1 min-w-0)
    RESIZE HANDLE (h-2, cursor-row-resize)
    BOTTOM SECTION (flex, percentage-based height, 30-70% range)
      Bottom Tabbed Panel
```

The resize handle uses mouse drag with `usePanelResizer` hook. Default split: 70% top / 30% bottom.

### Panel Anatomy

All major panels share a consistent structure:

```
Container:
  rounded-[var(--radius-panel)]
  border border-{sidebar-border|panel-border}
  bg-sidebar-bg
  overflow-hidden
  flex flex-col h-full

Header (h-[45px]):
  flex items-center justify-between
  px-4
  border-b border-border/40
  bg-sidebar-header-bg
  shrink-0

Content:
  flex-1 overflow-y-auto p-4
```

Key rules:
- All panel containers are `overflow-hidden` with `rounded-[var(--radius-panel)]`
- Headers are fixed at `h-[45px]` with `shrink-0`
- Header text uses the 11px uppercase tracking pattern
- Internal dividers use `border-border/40`

### Master-Detail Layout

Used in Models and Outputs panels:

```
<div className='flex-1 min-h-0 flex gap-4'>
  <aside className='w-72 shrink-0 bg-muted/40 rounded-xl border border-border/40'>
    {/* Selectable list */}
  </aside>
  <section className='min-w-0 flex-1 bg-muted/40 rounded-xl border border-border/40'>
    {/* Detail content */}
  </section>
</div>
```

- Master list: fixed `w-72` (288px), with its own header and scrollable item list
- Detail section: flexible width, with header and scrollable content
- Both use `bg-muted/40` background with `border-border/40` border
- Internal headers: `px-4 py-3 border-b border-border/40 bg-panel-header-bg`

### Spacing Conventions

| Context | Spacing |
|---------|---------|
| App root padding | `p-4` (16px) |
| Panel content | `p-4` (16px) |
| Panel headers | `px-4` + fixed height |
| Sidebar list | `p-2` (8px) |
| Dialog content | `px-6 py-6` (24px) |
| Dialog header | `px-6 py-4` |
| Dialog footer | `px-6 py-4` |
| Card internal | `px-4 py-3` (footer), `p-4` (content) |
| CollapsibleSection trigger | `px-4 py-3.5` |
| CollapsibleSection content | `px-4 pb-4` |
| Between top-level sections | `space-y-8` |
| Between media sections | `space-y-6` |
| Between form groups | `space-y-4` |
| Between buttons in headers | `gap-2` |
| Grid items | `gap-5` |
| Between list items (sidebar) | `gap-1` |

## Component Patterns

### Dialogs

All dialogs follow a consistent structure:

```tsx
<DialogContent className="sm:max-w-md p-0 gap-0 overflow-hidden">
  <DialogHeader>
    <DialogTitle>SECTION TITLE</DialogTitle>
  </DialogHeader>
  <div className="px-6 py-6">
    {/* Content */}
  </div>
  <DialogFooter>
    <Button variant="outline">Cancel</Button>
    <Button>Primary Action</Button>
  </DialogFooter>
</DialogContent>
```

Rules:
- Always `p-0 gap-0 overflow-hidden` on `DialogContent` (padding handled internally)
- `DialogHeader` has `bg-panel-header-bg` with `border-b border-border/40`
- `DialogFooter` has `bg-dialog-footer-bg` with `border-t border-border/40`
- `DialogTitle` uses the 11px uppercase tracking pattern
- Cancel button: `variant="outline"` or `variant="ghost"`
- Primary action: default variant (amber/primary)
- Destructive action: `variant="destructive"`

Dialog sizes:
- Small: `sm:max-w-[400px]` (create/delete builds)
- Medium: `sm:max-w-md` or `sm:max-w-[500px]` (plan, config editors)
- Large: `max-w-2xl` (file upload, producer details)
- Extra-wide: `sm:max-w-[620px]` (timeline editor)
- Viewport-based: `w-[46vw]` to `w-[72vw]` (code editors)

### Cards

**MediaCard** (the primary card):
```
rounded-xl border bg-card overflow-hidden flex flex-col transition-all shadow-lg
```
- Default border: `border-border`
- Selected: `border-primary ring-2 ring-primary/40 shadow-xl -translate-y-1`
- Pinned: `border-amber-500 ring-2 ring-amber-500/40 shadow-xl -translate-y-1`
- Clickable hover: `hover:border-primary/70 hover:shadow-xl hover:-translate-y-1`
- Footer: `border-t border-border/60 bg-muted/50 px-4 py-3`

**PropertyRow** (2-column grid card):
```
grid grid-cols-2 gap-4 p-4 rounded-xl border max-w-2xl shadow-lg transition-all
```
- Default: `bg-card border-border`
- Selected: `border-primary bg-primary/10 ring-2 ring-primary/40`

**BuildCard** (sidebar items):
```
p-3 rounded-lg border transition-colors
```
- Default: `bg-transparent border-transparent`
- Selected: `bg-item-active-bg border-item-active-border`
- Hover: `hover:bg-item-hover-bg hover:border-border/50`

### Selection Styling

A reusable selection system with 5 color variants (from `panel-utils.ts`):

| Variant | Border | Background | Ring |
|---------|--------|-----------|------|
| primary | `border-primary/50` | `bg-primary/5` | `ring-primary/30` |
| purple | `border-purple-400` | `bg-purple-500/10` | `ring-purple-400/30` |
| blue | `border-blue-400` | `bg-blue-500/10` | `ring-blue-400/30` |
| green | `border-green-400` | `bg-green-500/10` | `ring-green-400/30` |
| amber | `border-amber-400` | `bg-amber-500/10` | `ring-amber-400/30` |

Unselected default: `border-border/40 bg-muted/30`

The pattern uses very low opacity fills (5-10%) with subtle ring highlights.

### Buttons

Standard Shadcn button variants:
- `default`: `bg-primary text-primary-foreground shadow hover:bg-primary/90`
- `destructive`: `bg-destructive text-destructive-foreground shadow-sm`
- `outline`: `border-input bg-background shadow-sm hover:bg-accent`
- `ghost`: Transparent, `hover:bg-accent`
- `link`: `text-primary underline-offset-4 hover:underline`

Sizes: `default` (h-9), `sm` (h-8), `lg` (h-10), `icon` (h-9 w-9)

Icon-only actions in headers use: `size="icon" variant="ghost" className="h-6 w-6"`

Status/plan dialogs use raw `<button>` elements with custom styling including `active:scale-[0.98]` press feedback.

### Tabs

Custom tab implementation (not Shadcn Tabs):
```
Container: flex items-center h-[45px] border-b border-border/40 bg-sidebar-header-bg shrink-0
Tab (active):   text-foreground bg-item-active-bg + 2px bg-primary bottom indicator
Tab (inactive): text-muted-foreground hover:text-foreground hover:bg-item-hover-bg
Tab label:      text-[11px] uppercase tracking-[0.12em] font-semibold
```

The active tab has a 2px primary-colored bottom bar indicator.

### CollapsibleSections

Wraps Shadcn's `Collapsible` with consistent styling:
```
Container: rounded-xl bg-muted/40
Highlighted: bg-primary/15 shadow-lg
Trigger: px-4 py-3.5 hover:bg-muted/60
Content: px-4 pb-4
Count badge: text-xs font-medium text-primary-foreground bg-primary px-2.5 py-0.5 rounded-full
```

### MediaGrid

Responsive grid layout for media cards:
```
grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5
```

### Forms

**Inputs**: `h-9 border-input bg-transparent shadow-sm`, focus: `ring-1 ring-ring`
**Compact inputs** (in dialogs): `h-8 text-xs`
**Form sections**: Icon + label header (`text-sm font-medium`), then content with `space-y-3`
**Form rows**: `space-y-1.5` with `text-xs text-muted-foreground` label above input
**Grid layout**: `grid grid-cols-2 gap-4` for side-by-side fields

### Badges

| Type | Style |
|------|-------|
| Count (sidebar) | `text-[10px] text-muted-foreground bg-muted/50 px-2 py-0.5 rounded-full` |
| Count (section) | `text-xs text-primary-foreground bg-primary px-2.5 py-0.5 rounded-full` |
| Type label | `text-xs text-muted-foreground bg-muted/50 px-1.5 py-0.5 rounded` |
| Status | `rounded-full border px-2 py-0.5 text-[10px] font-medium` + status color formula |
| Edited | `bg-amber-500/20 text-amber-600 dark:text-amber-400` |

## States

### Empty States

Centered layout with circular icon container:
```
Container: flex flex-col items-center justify-center h-full text-center px-8
Icon circle: w-16 h-16 rounded-full bg-muted/50 flex items-center justify-center mb-4
Icon: size-8 text-muted-foreground
Title: text-sm font-medium text-foreground mb-1
Description: text-xs text-muted-foreground max-w-[280px]
```

Editable empty states use a dashed border placeholder:
```
border-2 border-dashed rounded-xl bg-muted/30 text-muted-foreground
hover:border-primary hover:bg-primary/10 hover:text-foreground hover:shadow-lg hover:-translate-y-1
```

### Loading States

Inline spinner: `Loader2` icon with `animate-spin`:
```tsx
<Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
```

Overlay loading:
```
absolute inset-0 bg-background/90 backdrop-blur-sm flex items-center justify-center z-10
```

### Error States

Inline error box:
```
bg-destructive/10 border border-destructive/30 rounded-lg p-3 text-sm text-destructive
```

Failed items list:
```
bg-red-500/5 border border-red-500/20 rounded-lg p-3
```

## Icons

All icons from **lucide-react**. Sizing conventions:

| Context | Size |
|---------|------|
| Card preview inline | `size-3` |
| Card footer, form labels | `size-4` |
| Button icon, inline actions | `w-4 h-4` |
| Dialog section headers | `size-4` or `size-5` |
| Empty state hero | `size-8` |
| Tab chevrons | `size-5` |

## Transitions

| Pattern | Where Used |
|---------|-----------|
| `transition-colors` | Buttons, tabs, list items, badges |
| `transition-all` | Cards (shadow + translate + border combined) |
| `transition-all duration-200` | Graph nodes |
| `transition-opacity` | Hover overlays on media cards |
| `active:scale-[0.98]` | Primary action buttons (press feedback) |

## Dark Mode

Managed via React context (`ThemeProvider`). The `.dark` class is added to `<html>`. Priority: localStorage > system preference > light default. Custom CSS variant: `@custom-variant dark (&:is(.dark *))`.

Key dark mode behaviors:
- Backgrounds become neutral grays (no warmth)
- Primary/accent amber colors are preserved (slightly richer saturation)
- Borders become much subtler (lower contrast against dark backgrounds)
- Shadows become dramatically more opaque (5-18x stronger)
- Foreground text uses the light mode's background color (cream/parchment)
- The theme toggle is a pill-shaped slider with Sun/Moon icons

## CSS Architecture

- **Tailwind CSS v4** via `@tailwindcss/vite` plugin -- no `tailwind.config.js`
- All configuration is done via CSS in `theme.css` using `@theme inline`
- CSS custom properties in `:root` (light) and `.dark` (dark) blocks
- `@theme inline` bridges CSS variables to Tailwind's color/spacing/font/shadow/radius systems
- Base layer sets `border-border` on all elements and `bg-background text-foreground` on body
- `cn()` utility (clsx + tailwind-merge) for conditional class composition
- No component-scoped CSS -- everything uses Tailwind utility classes
