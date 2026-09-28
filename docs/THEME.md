# Theme and design tokens

The app's theme is a set of **design tokens**: named values that screens, frames and components use instead of fixed colours and sizes. Change a token once, and everything that uses it follows, in light and dark mode. It works the way UI libraries (Chakra UI, Panda, Tailwind, shadcn) define a theme.

Edit it in the sidebar's **Theme** tab. The model is `src/model/theme.js`.

The default theme is Nexa's look, based on **IBM Carbon**:
- the Carbon palettes (primary: Blue 60 `#0f62fe`, the Carbon grays);
- Carbon's White theme (light) and Gray 100 theme (dark);
- IBM Plex Sans / Mono fonts, which the Nexa UI plugin provides;
- Carbon's type scale and motion;
- a small 4px corner radius.

## 1. Tokens

| Category | Path | Example |
| --- | --- | --- |
| Palettes | `colors.<palette>.<50 … 950>` | `colors.blue.600` = `#0f62fe` (Carbon Blue 60) |
| Base colours | `colors.white`, `colors.black`, `colors.transparent`, `colors.current` | |
| Fonts | `fonts.heading` / `body` / `mono` | |
| Font sizes (px) | `fontSizes.2xs` … `7xl` | `fontSizes.lg` = 18 |
| Font weights | `fontWeights.thin` … `black` | `fontWeights.semibold` = 600 |
| Line heights | `lineHeights.none` … `taller` | |
| Letter spacings | `letterSpacings.tighter` … `widest` | |
| Spacing (px) | `spacing.0` … `40` (4 px steps) | `spacing.4` = 16 |
| Corner radii (px) | `radii.none` … `4xl`, `full` | `radii.md` = 6 |
| Shadows | `shadows.xs` … `2xl`, `inner` | |
| Durations | `durations.fastest` … `slowest` | |
| Layers | `zIndex.hide` … `tooltip` | |

The default palettes are gray, red, orange, yellow, green, teal, blue, cyan, purple and pink.

**A palette comes from one colour.** Its 500 is the colour you pick; 50 … 400 get lighter and 600 … 950 darker, in the same hue. The default palettes keep their hand-made shades until you change their 500.

## 2. Semantic tokens: light and dark

A semantic token names what a colour is **for**. It has a light and a dark value, each a colour or a reference such as `{colors.gray.50}`.

| Token | Light | Dark |
| --- | --- | --- |
| `colors.bg` | white | black |
| `colors.bg.subtle` / `.muted` / `.emphasized` | gray 50 / 100 / 200 | gray 950 / 900 / 800 |
| `colors.bg.panel`, `.inverted` | | |
| `colors.bg.error` / `.warning` / `.success` / `.info` | red / orange / green / blue 50 | … 950 |
| `colors.fg`, `.muted`, `.subtle`, `.inverted` | black, gray 600, gray 400… | gray 50, gray 400… |
| `colors.fg.error` / `.warning` / `.success` / `.info` | | |
| `colors.border`, `.muted`, `.subtle`, `.emphasized`, `.inverted`, `.error`… | gray 200… | gray 800… |

Add your own in Theme → Semantic, e.g. `brand.accent` → `colors.brand.accent`.

**Every palette has its own semantic tokens**, Chakra's `colorPalette`. A component can then take a palette name and use its roles:

| Role | Used for | Light / dark |
| --- | --- | --- |
| `colors.<p>.solid` | a filled button | 600 / 600 |
| `colors.<p>.contrast` | text on solid | white (black on yellow) |
| `colors.<p>.fg` | coloured text | 700 / 300 |
| `colors.<p>.subtle` | a soft background | 100 / 900 |
| `colors.<p>.muted` | a stronger soft background | 200 / 800 |
| `colors.<p>.emphasized` | hover of subtle | 300 / 700 |
| `colors.<p>.focusRing` | the focus outline | 500 |
| `colors.<p>.border` | an outline | 500 / 400 |

Gray has its own roles: solid is gray 900 in light and white in dark.

**The primary palette**: `colors.primary.*` are the tokens of the palette chosen in Theme → Mode → Primary palette. The default is blue.

## 3. Using a token

- **In a field**: a colour field — and a size field whose component declares `tokens` (a frame's gap: spacing, radius: radii) — has a **◆** button. Pick a token and the field holds `{token:colors.primary.solid}`, shown as a chip with its value. × puts its plain value back.
- **Anywhere in a prop**: `{token:<path>}`. A whole token keeps its type (`{token:fontSizes.lg}` is the number 18); inside a text it is its value (`"gap {token:spacing.2}px"`).
- **In CSS** (a component's CSS, a Lit view): `var(--nexa-colors-bg-subtle)`. The dots of the path become dashes.

**On the page**:

- Every token is a CSS variable on `:root`; `html[data-nexa-mode="dark"]` holds the dark values.
- A frame's token fill, stroke, radius or gap is written as a CSS variable, so it follows the mode without a redraw.
- A component prop bound to a token is resolved in the mode in use, and drawn again when the mode changes.
- The screen's background is `colors.bg`.

**In the editor** the canvas shows the theme too. Theme → Mode → "The canvas shows" previews light or dark; the preview is not saved.

## 4. Light, dark, system

- Theme → Mode → **The page opens in**: Light, Dark or **the viewer's system setting** (it follows the OS, live).
- `{$colorMode}` is the mode in use (`"light"` / `"dark"`).
- **Set Variable** `$colorMode` (App) to `light`, `dark` or `system` switches the page in place. The choice is kept for that browser. The Events tab has **Dark mode**, **Light mode**, **Set colour mode** and **On colour mode change** chips.

## 5. For component plugins (SDK)

Everything comes from the SDK:

```js
import { defineComponent, NexaElement, html, css, theme } from "../../nexa-sdk/nexa-component-sdk.js";

theme.token("colors.primary.solid");   // "#0f62fe" (in the current mode)
theme.cssVar("colors.bg.subtle");      // "var(--nexa-colors-bg-subtle)"
theme.mode();                          // "light" | "dark"
theme.list("fontSizes");               // [{ path, category, light, dark, semantic }]
const off = theme.onChange(({ theme, mode }) => { … });
```

- In a view, `this.token(path)` and `this.tokenVar(path)` do the same. A view is redrawn when the theme or the mode changes.
- A prop the user set to `{token:…}` arrives in `this.p` already resolved.
- A `color` prop gets the ◆ picker by itself. Give any other prop one with `tokens: "fontSizes"` (or several: `"spacing,radii"`); `tokens: ""` turns it off.
- In the view's CSS prefer the variables (`background: var(--nexa-colors-primary-solid)`): they follow the mode with no redraw.

## 6. The data

`project.theme` holds only what the app changed, one category at a time (each replaces the default's):

```js
{ defaultMode: "light" | "dark" | "system", primary: "blue",
  palettes: { blue: { "50": "#eff6ff", …, "950": "#172554" }, … },
  semantic: { "bg.subtle": { light: "{colors.gray.50}", dark: "{colors.gray.950}" }, … },
  fonts: {…}, fontSizes: {…}, fontWeights: {…}, lineHeights: {…}, letterSpacings: {…},
  spacing: {…}, radii: {…}, shadows: {…}, durations: {…}, zIndex: {…} }
```

`null` means the defaults; Theme → Reset brings them back. Tests: `test/model-theme.test.js`, `test/runtime-theme-browser.test.js`.
