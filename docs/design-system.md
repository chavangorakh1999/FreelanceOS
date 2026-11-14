# Design system — "soft shell"

Light theme, premium-minimal, derived from the approved invoice-detail screen. The app is full-bleed: a flat sidebar and content area with no outer frame. Tokens live in
`apps/web/src/app/globals.css` (`@theme`), so a per-workspace portal brand (PRD §7.15) is a token swap.

| Token | Value | Use |
|---|---|---|
| `shell` | `#f2f2f2` | sidebar |
| `panel` | `#fafafa` | page background |
| `card` | `#ffffff` | cards, 1px `line` border, 16px radius |
| `stat` | `#f0f0f0` | stat cards, board columns, table header, 12px radius |
| `ink` / `ink-2` / `muted` | `#121212` / `#3a3a3a` / `#5f5f5f` | text (all ≥ 4.5:1 on their surfaces) |
| `accent` | `#047857` | primary action, active data, links |
| status tints | success `#e4f3ec`, warn `#fef3e2`, info `#e6eefb`, danger `#fdecea` | badges — always icon/label + colour |

- **Type:** Geist Variable (self-hosted via `@fontsource-variable/geist`). Chosen over Inter, Plus Jakarta Sans and Manrope for crisp 14px UI text; all have the ₹ glyph and tabular figures, which are enabled globally so money columns align. 28px titles, 18px section headings, 14px body.
- **Icons:** [Lucide](https://lucide.dev) (`lucide-react`), 1.75 stroke, decorative icons `aria-hidden`.
- **Shape:** 12px controls, 12px stat cards, 16px cards; borders not shadows, shadow only on the primary button and dialogs.
- **Density:** 40px controls, 44px nav rows (workspace). The client portal will use the same tokens with roomier spacing.
- **Narrow screens:** nav collapses behind a *Menu* button below `lg`; tables scroll horizontally inside their card; boards scroll horizontally.
- **Components** (`apps/web/src/components/ui.tsx`): Button, Card, Field, Input/Select/Textarea, Badge, Dialog (native `<dialog>`), Stat, Table, EmptyState, Spinner, ErrorNote.
- Money is always rendered from integer minor units via `@freelanceos/shared`; never a float.
