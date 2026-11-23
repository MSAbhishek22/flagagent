# FlagAgent — Design Constitution v1.0 (23 Nov 2026)

## Design research (Blueprint Part V — ≥5 references)
User's supplied reference set: godly.website, minimal.gallery, land-book.com, onepagelove.com, dark.design, darkmodedesign.com, Skiper UI, Vengeance UI, threeui.com, tasteskill.dev, 21st.dev, gsap.com. Patterns only — nothing copied.

Inspected directly on 23 Nov 2026:
- **dark.design** — a dense gallery of dark software sites (Railway, Linear, Warp, Raycast among them). Learning: serious tools read as *instruments* — near-black surfaces, one signal colour, data set in mono, almost no decoration. Taken: the instrument feel, mono data type. Not copied: any site's layout or artwork.
- **minimal.gallery** — restrained, type-led, generous whitespace, small caps category labels. Learning: confidence comes from space and type discipline, not effects. Taken: fixed type scale, small mono section labels, wide margins. Not copied: its gallery grid or content.

Recorded as the user's supplied set (patterns absorbed from the fleet's earlier work with them, not re-inspected today): godly.website + land-book.com (landing structure: one claim per section), 21st.dev + Skiper UI (component polish: hairline borders, soft states), gsap.com (motion should feel physical and short), threeui.com (depth must be explorable, not wallpaper).

## Identity — "The Signal Board"
A feature flag is a switch on a board. FlagAgent is the board room: you file a change ticket in plain words, the board shows exactly which switches move, and nothing moves until a human stamps it.

- **Metaphor:** electrical signal board × change-control ticket. Plans render as tickets; approval is a stamp; guards are red tell-tale lamps.
- **Palette:** slate-black `#0C100E` ground, panel `#141A17`, hairline `#26302A`. Phosphor green `#46D17C` = on / go / applied. Signal amber `#F2B33D` = pending / caution. Alarm red `#E5534B` = guard / stop. Text `#E8EDE9`, muted `#9AA79E`. No gradients except the lamp glow (a shadow, not a fill).
- **Typography:** grotesque system stack for prose; **ui-monospace leads all data** — flag names, diffs, percentages, the plan hash. Fixed scale 12 / 14 / 16 / 20 / 24 / 32 / 40 px. Radii 4 / 8 / 16 / 999 px only.
- **Layout:** wide console, not a centred column. The app is a left rail of four steps (Say it → See the diff → Approve → Receipt) beside the working panel. Landing: hero → problem → solution → the app → outcome → footer.
- **Meaningful spatial feature:** the hero **Signal Board** — a panel in CSS perspective holding three real switches with layered depth (base plate, switch body, lamp at different translateZ). Pointer tilt ≤6° (transform only). The switches are working buttons wired to the mock project: flip one and the watch board below changes. Keyboard operable, `role="switch"`, tilt off under reduced motion / low-motion / coarse pointers.
- **Motion:** transform + opacity only. Switch flip 160 ms, plan rows rise-in with a 50 ms stagger, lamp pulse by opacity. `prefers-reduced-motion` and the Low motion toggle disable tilt, stagger and pulse.

## How this differs from the fleet's recent projects
- **Verity** — dark glass, Georgia serif, evidence constellation, centred column. FlagAgent: no glass, no serif, mono-led, rail layout, switches not stars.
- **GeoRaksha** — radar canvas watch floor, teal-on-dark, map-first. FlagAgent: no map; the board is a table of switches and tickets.
- **Delhi Bus Bheed** — warm paper, ink-green departure board, light theme. FlagAgent is a dark instrument; its "board" is a switch panel, not a timetable.
Shared only where the user's rules demand it: type-scale discipline, radius scale, honest labels, reduced-motion support.
