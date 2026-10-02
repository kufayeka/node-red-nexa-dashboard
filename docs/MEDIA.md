# Images and carousels

Three pieces work together:

1. The **Assets** tab holds the app's images.
2. The **Image** component shows one of them.
3. A **Carousel** frame shows slides one after the other. A slide can be a Populate's copies of a template.

## 1. Assets

The **Assets** tab (sidebar) accepts png, jpg, svg, webp, gif and avif, up to 10 MB each. Import them with **Import…** or by dropping files on the tab.

- **Names** can have folders: `icons/motor-on`, `products/kopi`.
  - When you search for `icons/` and then import, the file goes into that folder.
- **In a prop**, write `{asset:icons/motor-on}`.
  - A variable that holds the plain name works too, for example `{param1.image}` with `"products/kopi"`.
- **Actions per image:**
  - rename: references in every screen and template follow;
  - delete: it warns when the image is still used;
  - copy `{asset:name}`.
- **Drag an image onto the canvas** to get an Image component showing it. It is sized to the image, between 64 and 320 px on the longer side.
- **The tab warns about big files** (more than 1 MB or more than 3000 px), because a smaller file loads faster on a page.

On the server (`src/server/assets.js`):

- Files live in `<userDir>/nexa-assets/`, next to `assets.json`, which holds each name and its file.
- A file is named after its content, so its URL never changes meaning and pages cache it forever. A new upload under the same name gets a new file.
- The type is read from the file's bytes, not from what the browser claims.
- An SVG is cleaned when it is imported: scripts, event handlers, `javascript:` links and `foreignObject` are removed. It is also served with a CSP that runs nothing.
- The admin API needs `nexa.read` to list and `nexa.write` to import, rename or delete.
- Deployed pages load the files from `/nexa/_assets/<file>` on the screen worker.

## 2. Image (Media)

| Group | Props |
|---|---|
| Image | **Image** (an asset, a URL, or bound ⛓), **alt text**, **fallback** (shown if the image fails to load) |
| Layout | **Fit**: contain / cover / stretch / original / scale down; **position** |
| States | **State map**: rows of value → image; **Value**: bind it to a tag or a variable, and the matching row's image is shown |
| Style | **Tint** (paints the image's shape one colour, e.g. an SVG icon in any colour), background, corner radius, opacity, grayscale, brightness, blur |
| Loading | **When visible** (lazy) or at once; a skeleton or a colour while it loads; fade in |

Events: **Clicked**, **Loaded** and **Failed to load** (`msg.payload.src`, `msg.payload.url`).

A typical HMI motor symbol uses one SVG, a state map and a tint:

```
Image:  src {asset:icons/motor}
        state map: 0 → icons/motor-off · 1 → icons/motor-on · 2 → icons/motor-fault
        value: {M101.State}     tint: {M101.Colour}
```

For a plugin developer:

- A prop can be of type `asset`. It gets the same picker, with thumbnails, search, Import… and a URL field.
- `assetUrl(value)` (SDK) returns what to show: an asset's URL, or the value itself when it is a URL.
- `onAssetsChange(fn)` calls `fn` when the list changes.

## 3. Carousel (a frame layout)

Frame → Auto layout → **Carousel**, or the palette's **Carousel** chip.

The slides are the frame's children, or the copies a Populate puts in it:

```
[Populate: Slide template → product] → [Layout: Carousel #ab12]
```

| Setting | |
|---|---|
| Transition | **Slide**: scrolls with snapping, and swipes natively on touch screens and trackpads. **Fade**: one slide at a time. |
| Direction | across / down |
| Slides in view | 1, 2, or a fraction such as 1.2 (the next slide peeks in). The gap sits between slides. |
| Arrows, Dots | shown only when there is more than one page |
| Loop | after the last slide comes the first |
| Swipe / drag | a mouse drag too, not only touch |
| Autoplay every | ms, 0 = off. It pauses while the pointer is over it, while it is touched, and while the tab is hidden, and wraps to the first slide. |
| Current slide → variable | a declared variable holding the slide shown (0, 1, …). It is two-way: set it with Set Variable to go to a slide. |

- **Keys**: ← → (↑ ↓ for a vertical carousel) move between slides.
- **Events** → Layouts: "Carousel … → on Slide Change" fires with `msg.index`, plus `msg.item` for a populated slide.
- **A template slide takes the slide's size.** It is not scaled: its constraints place its content, so an image with left & right, top & bottom constraints fills the slide.
- **A carousel draws every slide.** "Virtualize" is ignored in a carousel.

Tests: `test/mock-assets.js`, `test/media-browser.test.js`, `test/runtime-carousel-browser.test.js`.
