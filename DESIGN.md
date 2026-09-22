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

## 3. Typography Rules (owner decision 2026-09-22: Apple's San Francisco)
- **The product uses Apple's system font, San Francisco (SF Pro).** Font stack for all text:
  `-apple-system, "SF Pro Text", "SF Pro Display", system-ui, Inter, "Helvetica Neue", sans-serif`.
  On iPhone, iPad and Mac this renders the real SF Pro with optical sizing, tracking tables and Dynamic Type; on
  Windows and Android the closest open match, **Inter**, is loaded from Google Fonts (`display=optional`).
- **SF Pro is never self-hosted or embedded**: Apple's license limits it to Apple platforms. Never ship `.woff`
  files of SF Pro in this repo.
- **Mono:** `ui-monospace, "SF Mono", Menlo, "JetBrains Mono", monospace` with tabular numerals for amounts, dates,
  invoice numbers and serials.
- Weights 700/600 for display and headings, 400/500 for body; operational body copy is 14px minimum where space
  permits (13px in dense tables). Tracking and leading are size-specific (see §10).
- Geist is retired for STUDIO. Never introduce Roboto, Arial or serif fonts.

## 4. Component Stylings
- **Sidebar Rail:** fixed black structural layer with a restrained gold contour. Icons stay centered in the rail.
- **Sidebar White Panel:** separate elevated white surface, soft border and rounded lower termination. When an accordion is open, its vertical edge extends so no new option is visually cut by the curve.
- **Navigation Labels:** remain legible inside the navigation surface and never overlap the icon rail.
- **Active Navigation State:** a compact translucent-gold treatment anchored to the label zone, with a slim gold edge.
- **Buttons:** compact, tactile, no neon glow. Hover lifts by 1px only on pointer devices; active state presses down by 1px.
- **Cards:** elevation only where it communicates hierarchy. Use slate-tinted shadows; status and amount cards enter in a short cascade instead of all appearing at once.
- **Modals:** surface fades in while its content rises 8px. Dismissal is quicker than entry.
- **Loaders:** skeletal shimmer matching actual layout dimensions. Never use generic circular spinners for page loading.

## 5. Layout Principles
- Mobile-first below 768px, with no horizontal scrolling.
- Mobile black rail is 76px; expanded navigation surface is 228px. Labels start at least 20px inside the label zone after the rail boundary.
- Touch targets are at least 44px.
- Use explicit grids and zones instead of fragile positional spacing.
- The sidebar may overlay content when expanded, but its physical layers must not overlap semantically.
- Content changes may scroll inside the navigation zone; the dashboard itself must not jump when an accordion opens.

## 6. Motion & Interaction
- **Timing:** 160ms for tactile feedback, 220ms for local surface changes, 320–420ms for drawers and accordions.
- **Easing:** default is a controlled spring curve: `cubic-bezier(.22,1,.36,1)`. Do not use linear movement.
- **Drawer:** the navigation panel emerges from beneath the fixed black rail. Labels follow after 85–115ms in a short cascade.
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
| `--nx-font` | -apple-system, SF Pro Text/Display, system-ui, Inter | all text (SF Pro on Apple; Inter from Google Fonts elsewhere) |
| `--nx-mono` (also `--mono`) | ui-monospace, SF Mono, Menlo, JetBrains Mono | amounts, dates, references, serials |

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

## 9. Iconography (added 2026-09-22, Stitch design system v2)
- Outline icons on a 24px grid, 1.75px stroke, rounded caps and joins (the app ships Tabler Icons: always the outline set, never `ti-*-filled` mixed with outline).
- Sizes: 16px inline, 18px navigation, 20px buttons, 24px app tiles. Monochrome: ink on light, ivory on black; gold only on the active navigation item.
- App tiles: icon inside a 36–40px rounded square filled with Warm Canvas on light or 8% white on black.
- Never emoji, never multicolor illustrations in the operational UI.

## 10. Fluid interaction (Apple design principles, added 2026-09-22)
Source: WWDC *Designing Fluid Interfaces* and *Principles of Great Design*, translated to CSS/Pointer Events.
- **Response:** feedback on pointer-down (`:active` → `scale(.97)` in 100ms), never only on release. Audit every debounce and artificial delay on the input path.
- **Direct manipulation:** drawers, sheets and swipeable rows track the finger 1:1 (Pointer Events + `setPointerCapture`), respecting the grab offset.
- **Interruptible motion:** any transition can be grabbed and reversed mid-flight; animate from the current on-screen value, never from the target; keep velocity through re-targets. Never lock input during a transition.
- **Springs over durations** for anything the user can touch: critically damped by default (damping 1.0, response 0.3–0.4s); slight bounce (damping 0.8) only after a flick or drag release. Drawer/sheet: damping 0.8, response 0.3.
- **Momentum:** on release, project the resting point (`(v/1000)·d/(1−d)`, d ≈ 0.998) and snap to the nearest target from there; hand the release velocity to the spring.
- **Rubber-band** at boundaries instead of hard stops.
- **Spatial consistency:** enter and exit along the same path; popovers/menus originate from their trigger (`transform-origin`); mirrored easing on reversible transitions.
- **Materials:** translucent top bars and sticky action bars (`rgba(255,254,250,.72)` + `backdrop-filter: blur(20px) saturate(180%)`), content scrolls underneath, scroll-edge fade instead of a 1px divider; never stack two light translucent surfaces. Modal tasks dim with a scrim; parallel panels do not.
- **Typography:** tracking is size-specific (28–32px −0.022em, 20–24px −0.015em, body −0.005em, 11px uppercase +0.06em); leading 1.1 display / 1.2 headings / 1.5 body; layout spacing in rem/em so larger user text never breaks it.
- **Feedback kinds:** status, completion, warning, error. Inline validation, never only on submit. Confirmation dialogs only for destructive, irreversible actions.
- **Accessibility:** `prefers-reduced-motion` → cross-fades, no springs; `prefers-reduced-transparency` → solid bars without blur; `prefers-contrast: more` → solid backgrounds with defined borders.
- Non-gesture transitions keep §6 timings (160/220/320–420ms, `cubic-bezier(.22,1,.36,1)`); animate only `transform` and `opacity`.

## 11. Stitch (source of visual truth for new screens)
- Stitch project **STUDIO RD · POS (negro, blanco y oro)**: `projects/3084779069905725803`.
- Design system asset `assets/11862383679991154944` (v2) generated from this file: Material-style color roles (primary #755B00 on light surfaces, primary-container #C9A227, surface #FBF9F3, outline #7F7663), Geist typography scale, spacing scale. New screens are generated with this asset; approved screens are translated to `studio-brand-theme.css`, never copied as generated HTML.
- The previous NEXUS PRO project *POS Dominicana* (`projects/1133794898386011572`) is not used for STUDIO.

## 12. Reference screens (spec for implementation, 2026-09-22) — read this before touching the POS UI
Mockup: Claude artifact "STUDIO Línea gráfica" (6 boards). The text below is the source of truth for anyone who
cannot open it. Every screen uses §2 colors, §3 SF Pro, §9 outline icons and §10 fluid motion.

### 12.1 Shell (desktop 1440)
- Sidebar 240px, Studio Black `#0A0A0A`, right edge 1px `rgba(201,162,39,.22)`. Top: STUDIO wordmark (ivory
  `logo-studio.png`) + "PUNTO DE VENTA" 10.5px, tracking .14em, 50% ivory. Then "Buscar todo · Ctrl K" button
  (rgba white .05 fill, .10 border, 9px radius). Sections labelled 10px uppercase at 38% ivory: Principal
  (Inicio, Avisos, Vender, Factura, Prefactura, Reparaciones), Inventario (Inventario, Kardex, Compras,
  Cotizaciones), Personas y CRM (Entidades, CRM, Clientes), Finanzas (Caja, Cuotas, Apartados, Historial),
  Sistema (Ajustes). Items 13px, 7px 10px padding, 8px radius, 66% ivory; active item: `rgba(201,162,39,.16)`
  fill, `inset 2px 0 0 #C9A227`, text Light Gold `#E3C45C`, weight 600. Footer: gold avatar circle (initial in
  black), name + role, "Cerrar sesión" outlined button.
- Workspace: Warm Canvas `#F7F5EF`, padding 26px 28px. Page header: greeting 28px/700/-.022em + 13px graphite
  sub-line; right side: secondary white button "Abrir caja" + primary gold button "Vender".
- Cards: white, 12px radius, 1px `rgba(128,101,21,.14)`, shadow `0 1px 2px rgba(10,10,10,.04)`.

### 12.2 Inicio
- 8 KPI cards in 4 columns: 16px icon + 12px graphite label, value 24px mono 600, 12px sub-line (green ▲ for
  positive trend, amber for "Revisar productos"). Ventas de hoy, Caja, Utilidad, Equipos pendientes, Garantías,
  Inventario crítico, Compras pendientes, Clientes esperando.
- Below, grid 1.35fr / 1fr: "Ventas de hoy" table (Factura mono · Cliente · Artículo · Pago chip · Total mono
  right; header 11px uppercase; rows 13px; "Fiado" chip amber, other payments neutral `#F0EDE4`) and "Accesos
  rápidos" (10 white tiles in 5 columns: 36px Warm-Canvas square with 18px outline icon + 13px label).

### 12.3 Vender
- Grid: fluid left column + 380px cart. Left: white card with "No. factura" (read-only mono input on Warm Canvas)
  and "Cliente" (40px selector button with chevron); 44px search field (gold border + 3px gold ring when focused,
  "/" shortcut chip); category chips as pills (selected = black fill, ivory text; never gold); product grid 4
  columns (72px Warm-Canvas image area with box icon, name 13px 600, price mono 14px, stock 11px graphite, low
  stock amber 600).
- Cart: title + "N artículos"; lines with name, "ITBIS incluido", −/+ 26px stepper, mono total; footer on Warm
  Canvas: Subtotal, ITBIS 18%, Total 24px mono; 48px gold "Cobrar RD$ …" full width; two white buttons
  "Prefactura" / "Cotizar".

### 12.4 Factura — LIST MODE (owner request)
Replace the document-shaped invoice with a dense list. Same actions and the same functions as today
(`nxFacAdd`, `nxFacPrecio`, `nxFacQtyStep`, `nxFacDesc`, `nxFacDescTipo`, `nxPosDel`, `nxFacFacturar`,
`nxPrefGuardar`, `nxFacCancelar`, `nxCotGuardarDesdeCart`, `facBarraSync`); zero new business logic.
- Header strip (one white card, one row): "Factura" 15px/700 + company line 11.5px (STUDIO · RNC); "Nº" with the
  history lupa button + read-only mono number; "Comprobante" selector (NCF type); "Fecha" date input; "Almacén"
  selector; "Cliente" selector filling the rest (name · cédula · status such as "Cliente frecuente · sin deuda").
  All controls 36px, 9px radius.
- One 44px search/scan field: lupa, placeholder "Buscar artículo por nombre, código o serial, o escanéalo…",
  scanner hint, "F2" chip.
- Items list (white card): header row 10.5px uppercase graphite on `#F0EDE4`; columns
  `34px | 1fr | 104px | 112px | 100px | 110px | 32px` = # (mono, muted) · Descripción (13.5px 600 + chips: code
  neutral, IMEI `n/n` gold-soft, "Garantía 12 meses" green) · Precio (34px editable mono input, right aligned) ·
  Cant. (28px −/+ buttons + 36px mono input) · Desc. (58px input + "%"/"RD$" toggle) · Importe (mono 600, right)
  · quitar (28px outlined "−" button). Rows 9px 12px padding, 1px `rgba(128,101,21,.09)` dividers. Footer line:
  "4 artículos · 6 unidades" + "F2 Buscar · F10 Limpiar".
- Bottom grid 1fr / 340px: left card "Otras acciones" (Guardar cotización, Prefacturas, Historial, Limpiar
  carrito as 34px outlined buttons; "Agregar nota o condiciones" ghost button); right card totals: Subtotal,
  Descuento (red, negative), ITBIS (18 %), Total 26px mono with top rule; then 44px row `44px | 1fr` = print icon
  button + gold "Cobrar"; "Cancelar factura" ghost below.
- Sticky action bar (existing `.nxFacBar`, restyled): translucent `rgba(255,254,250,.72)` +
  `backdrop-filter: blur(20px) saturate(180%)`, top hairline gold .12; [×] cancel, [save] draft, "Total RD$ …"
  20px mono, gold "Cobrar RD$ …" (min 200px). Same buttons and functions as `facBarraSync()`.
- Mobile: the same list stacks (each row becomes two lines: name+chips / price·qty·amount), header strip wraps to
  two rows, sticky bar stays.

### 12.5 Inicio móvil (390)
- Top bar `rgba(10,10,10,.92)` + blur 20px, safe-area padding, bottom hairline gold .22: 38px translucent
  buttons (menu, search, alerts with gold dot) and the wordmark. No bottom tab bar.
- Greeting 22px/700/-.015em + 12.5px sub-line; 48px gold "Vender" full width; 4 KPI cards in 2 columns (value
  20px mono); 8 access tiles in 4 columns (38px Warm-Canvas square + 11.5px label); "Ventas de hoy" card with
  "Ver todas" link and 3 rows (client / item / mono amount).

### 12.6 Menú móvil (drawer)
- 300px black panel from the left, gold edge, close button top-right, sections as in 12.1 (14px items), user
  footer; visible grab handle on its right edge. Page behind: dimmed `rgba(10,10,10,.42)` and scaled to .96.
- Behaviour (§10): opens/closes 1:1 with the finger (Pointer Events, grab offset), spring on release (damping
  .8, response .3) with velocity handoff and momentum projection, rubber-band past the edge, interruptible
  mid-flight, `prefers-reduced-motion` → cross-fade.

### 12.7 Tokens board (for the CSS layer)
- Palette roles as §2; chips selected = black; focus ring = gold; state badges green/amber/red light fills;
  buttons flat (no gradients), `:active` scale(.97) 100ms, pointer hover -1px; cards 12px; motion values as §10.

### 12.8 Implementation plan (next delivery, branch, unpublished)
1. `studio-brand-theme.css`: remove gold gradients (flat `#C9A227` + black text), reduce `!important`, apply §3
   font stack, chips black, focus ring, translucent bars, `prefers-reduced-motion/transparency/contrast`.
2. Icons: every `ti-*` in POS markup in outline; app tiles per 12.2; never `-filled`.
3. New `parches-pos-motion.js` (presentational only): pointer-down feedback, 22ms stagger on real tab changes,
   draggable mobile drawer with spring + velocity, no animation replay on data refresh.
4. Factura list mode per 12.4 inside `renderFactura`/`pintarFactura` markup and CSS, keeping every function.
5. QA in Chromium 390/1280 and on the owner's iPhone; bitácora; no publish without "publícalo".

## 13. Sidebar Dock — approved implementation (2026-09-22)

The owner requested a substantially different sidebar and explicitly authorized publication. This section is an additive
refinement of §12.1 and §12.6; color, typography, icon and motion rules from §2, §3, §9 and §10 remain unchanged.

- **Desktop:** the black navigation surface becomes a floating 240px dock inset 12px from the viewport, with a 24px
  contour and a restrained 1px gold spine. It collapses to a 76px icon dock using the existing toggle.
- **Items:** 40px outline-icon tiles, 50px minimum rows and 15px corners. The active row uses a translucent gold fill,
  a 2px inset gold edge and a flat gold icon tile with a black glyph. No gold gradients.
- **Brand and profile:** 46px flat-gold brand tile at the top; user profile remains in a dark translucent surface at the
  bottom. Labels disappear only in desktop compact mode.
- **Mobile:** the same navigation becomes a floating drawer up to 300px wide, with 10px viewport breathing room,
  24px corners, dimmed/blurred backdrop and the existing open/close logic.
- **POS:** the internal POS sidebar follows the same geometry and state treatment.
- **Implementation:** `studio-sidebar-dock.css`, loaded after `studio-brand-theme.css`; presentation only, scoped to
  `html.nx-studio`, no new business logic, no new priority overrides and reduced-motion/transparency supported.

