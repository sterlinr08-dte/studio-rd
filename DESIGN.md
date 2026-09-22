# Design System: STUDIO RD

## 1. Visual Theme & Atmosphere
STUDIO RD is a professional operations platform with **Daily App Balanced** density (6/10), controlled asymmetry (6/10) and calm, physical motion (6/10). It should feel precise, dependable and quietly premium: black structural navigation, a warm-white operational surface and measured gold accents. Motion supports orientation and feedback; it must never delay a task.

## 2. Color Palette & Roles
- **Studio Black** (#0A0A0A) — navigation, login and premium structural surfaces.
- **Studio Charcoal** (#171717) — secondary dark surfaces and depth.
- **Warm Canvas** (#F7F5EF) — page background.
- **Pure Surface** (#FFFEFA / #FFFFFF) — topbar, modal and primary card fill.
- **Charcoal Ink** (#111111) — primary text and headings.
- **Muted Graphite** (#686862) — secondary labels, metadata and helper text.
- **Studio Gold** (#C9A227) — the single brand accent for primary actions, selected states and focus.
- **Light Gold** (#E3C45C) and **Dark Gold** (#806515) — hover/highlight and accessible text on light surfaces.
- Success, warning and error retain their semantic green, amber and red. Gold never replaces status meaning.

## 3. Typography Rules
- **Display / Headings:** Geist Sans or Satoshi, controlled scale, tight tracking and hierarchy through weight.
- **Body / UI Labels:** Geist Sans or Satoshi; operational body copy is 14px minimum where space permits.
- **Mono:** JetBrains Mono for amounts, dates, technical metadata and cycle references.
- Dashboard UI remains sans-serif. Do not introduce Inter or serif fonts.

## 4. Component Stylings
- **Sidebar Dock:** a floating black navigation object, inset 12px from the viewport, with a 28px contour, restrained gold spine and soft depth shadow. It collapses to a 78px icon dock and expands to 248px.
- **Navigation Icons:** each icon lives in a compact dark tile. The active icon becomes a solid gold tile with black glyph; labels stay white and never overlap the icon zone.
- **Active Navigation State:** a translucent-gold row, slim illuminated gold edge and one active icon. No full-surface glow.
- **Mobile Drawer:** the same dock becomes a floating sheet with 10px outer breathing room, rounded corners and a blurred backdrop; it never covers the full screen width.
- **Buttons:** compact, tactile, no neon glow. Hover lifts by 1px only on pointer devices; active state presses down by 1px.
- **Cards:** elevation only where it communicates hierarchy. Use slate-tinted shadows; status and amount cards enter in a short cascade instead of all appearing at once.
- **Modals:** surface fades in while its content rises 8px. Dismissal is quicker than entry.
- **Loaders:** skeletal shimmer matching actual layout dimensions. Never use generic circular spinners for page loading.

## 5. Layout Principles
- Mobile-first below 768px, with no horizontal scrolling.
- Desktop dock is 78px collapsed and 248px expanded. Mobile uses a floating sheet up to 292px wide with 10px viewport margins. Touch targets remain at least 44px.
- Touch targets are at least 44px.
- Use explicit grids and zones instead of fragile positional spacing.
- The sidebar may overlay content when expanded, but its physical layers must not overlap semantically.
- Content changes may scroll inside the navigation zone; the dashboard itself must not jump when an accordion opens.

## 6. Motion & Interaction
- **Timing:** 160ms for tactile feedback, 220ms for local surface changes, 320–420ms for drawers and accordions.
- **Easing:** default is a controlled spring curve: `cubic-bezier(.22,1,.36,1)`. Do not use linear movement.
- **Drawer:** the floating dock enters with a controlled 360ms spring curve; its contents remain stable and labels never animate separately from their action row.
- **Views:** the first 8–12 visible operational surfaces enter with 22ms stagger: opacity from 0 to 1 and translateY from 8px to 0. Re-enter only on a real navigation change.
- **Accordions:** options reveal downward with real measured height; the rail’s lower contour continues vertically while open. The navigation zone may auto-scroll just enough to reveal the first new option.
- **Buttons and cards:** pointer hover uses translateY(-1px); active press uses translateY(1px). Never use scale for primary taps on iOS.
- **Active navigation glyph:** use an extremely subtle opacity breath (2.8–3.2s) to confirm the current module; no glow, bounce or color flashing.
- **Performance:** animate only `transform` and `opacity`. Do not animate `top`, `left`, `width` or `height`; accordion height is a controlled exception required to reveal its content.
- **Accessibility:** `prefers-reduced-motion: reduce` removes nonessential animation and smooth scrolling while preserving visibility and state changes.

## 7. Anti-Patterns (Banned)
- No low-contrast text over the black rail.
- No active pill behind icons.
- No neon outer glows, oversaturated accent surfaces or purple/blue neon treatments.
- No pure black.
- No oversized floating cards without a hierarchy purpose.
- No duplicated actions or decorative filler copy.
- No generic three-column equal-card layouts for new areas.
- No horizontal overflow on mobile.
- No absolute-positioned text layers that can collide with navigation.
- No decorative gradients on large text.
- No emoji in the operational UI.
- No mount animations that repeatedly replay during routine data updates.


## 7b. Single Graphic Line — implementation contract (POS, 2026-09-22)
The owner decided that this file is the **only** graphic line of the product. It is materialized in code as
CSS custom properties injected by `parches-pos-stitch-visual.js` (layer `#nxLineaUnicaCSS`), scoped to
`#v-pos`, `#v-multiempresa`, POS modals (`.modal.nxPrForm`, `.nxPf`) and `body.org-tienda`. Seguros views are
outside that scope on purpose (FOUC rollback history on iPhone).

| Token | Value | Role |
|---|---|---|
| `--nx-bg` | #F8FAFC | page canvas |
| `--nx-surface` | #FFFFFF | cards, modals, top bar |
| `--nx-ink` / `--nx-steel` / `--nx-mute` | #0F172A / #64748B / #94A3B8 | text hierarchy |
| `--nx-line` / `--nx-line-2` | rgba(148,163,184,.12 / .18) | separators / card borders |
| `--studio-gold` / `--studio-gold-dark` / `--studio-gold-soft` | #C9A227 / #806515 / rgba(201,162,39,.13) | the single brand accent |
| `--nx-r` / `--nx-r-md` / `--nx-r-sm` | 16px / 12px / 10px | surfaces / bars / buttons & inputs |
| `--nx-font` | Geist, Segoe UI, system-ui | all text (Google Fonts, `display=optional`, loaded when the POS opens) |
| `--nx-mono` (also `--mono`) | JetBrains Mono, ui-monospace | amounts, dates, references, serials |

Rules the layers enforce: the base Stitch layer defines geometry, density and motion; `studio-brand-theme.css`
loads last and remaps legacy purple/indigo/blue brand treatments to STUDIO black, white and gold. `.bc1`, `.bxl`,
quick-sale actions and focus rings use gold with black text; white cards keep 16px radius; buttons lift 1px on
pointer hover and press 1px. New STUDIO code must use the brand tokens instead of new blue or purple literals.

## 8. Multiempresa POS Profile
- **Atmosphere:** an operational workspace for daily sales: balanced density (6/10), structured asymmetry (5/10), and restrained motion (5/10). The Multiempresa hub is the administrative launcher; the POS shell is the focused work area.
- **POS canvas:** Warm Canvas (#F7F5EF) behind Pure Surface (#FFFEFA / #FFFFFF). **Studio Gold** (#C9A227) is the only brand accent for quick-sale actions, focus states and selection.
- **Navigation:** the POS side rail is a calm black structural plane. Its active item uses a translucent gold inset and slim gold edge, never a neon glow or oversized pill.
- **Dashboard:** operational KPIs use tabular numbers and compact 16px-radius surfaces. App shortcuts form an adaptive grid, not a fixed three-column feature row.
- **Multiempresa cards:** each business/module card is a 112px minimum touch surface with icon, title, role-specific description and directional affordance. On mobile it becomes a single column.
- **Motion:** cards and KPIs enter at 24ms intervals; hover lifts 1–2px only on pointer devices. Buttons press down 1px on activation. All movement uses transform and opacity, and respects reduced-motion settings.
- **Never:** blend business identity colors into large backgrounds, duplicate navigation actions, animate sales amounts continuously, or use cosmetic motion that delays a sale, payment or inventory action.
