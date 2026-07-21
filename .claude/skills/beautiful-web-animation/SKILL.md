---
name: beautiful-web-animation
description: Build smooth, beautiful, non-janky web animations and 3D — CSS/Web Animations API, GSAP, and Three.js / React Three Fiber. Use whenever a task involves motion, transitions, scroll effects, hover/entrance animations, parallax, WebGL, or 3D scenes on a website. Enforces GPU-friendly performance, tasteful easing/timing, mandatory cleanup, and prefers-reduced-motion + mobile fallbacks.
---

# Beautiful Web Animation

Motion is a craft. Most agent-made animations look robotic and run janky because they skip four things: they animate the wrong properties, they use default/linear easing, they never clean up, and they ignore reduced-motion + mobile. This skill is the checklist that fixes all four. **Follow it as rules, not suggestions.**

## The Prime Directive: only ever animate `transform` and `opacity`

The browser can animate `transform` and `opacity` on the GPU compositor thread without touching layout or paint. **Everything else risks jank.**

- ✅ Animate: `transform` (translate/scale/rotate/skew), `opacity`, `filter` (sparingly).
- ❌ Never animate in a loop or transition: `width`, `height`, `top`, `left`, `right`, `bottom`, `margin`, `padding`, `box-shadow`, `background-color` on large areas, `border-radius` under load. These trigger layout/paint every frame → stutter.
- Need to move something? `transform: translate3d(x, y, 0)` — **not** `left`/`top`.
- Need to resize? `transform: scale()` — **not** `width`/`height`. (Then correct child distortion with counter-scale if needed.)
- Reveal on scroll? Animate `opacity` + `transform: translateY(20px → 0)`, never `height: 0 → auto`.
- Promote the element with `will-change: transform` **only while it's about to animate**, then remove it. Leaving `will-change` on everything blows GPU memory and makes things worse.

If a design genuinely needs a layout-affecting change (e.g. an accordion opening), use the **FLIP** technique (measure First & Last positions, invert with a transform, then Play by releasing the transform) instead of animating layout directly.

## Taste: timing & easing (this is what separates beautiful from amateur)

Robotic motion is almost always **linear easing** and **wrong durations**. Real motion accelerates and decelerates.

**Durations** (rule of thumb):
- Micro-interactions (hover, button press, toggle): **120–200ms**
- UI transitions (panel, dropdown, card): **200–350ms**
- Entrances / larger moves / page transitions: **350–600ms**
- Anything over ~700ms feels sluggish unless it's a deliberate hero/ambient effect.

**Easing** — never leave it linear or default `ease`:
- **Enter / appear:** ease-**out** — starts fast, settles gently. `cubic-bezier(0.16, 1, 0.3, 1)` (a great "expo-out") or `cubic-bezier(0.22, 1, 0.36, 1)`.
- **Exit / disappear:** ease-**in** — accelerates away. `cubic-bezier(0.4, 0, 1, 1)`.
- **Move between two on-screen states:** ease-in-out. `cubic-bezier(0.65, 0, 0.35, 1)`.
- **Playful / bouncy:** spring or slight overshoot `cubic-bezier(0.34, 1.56, 0.64, 1)` — use sparingly.
- **Springs** (Framer Motion, GSAP, R3F) usually beat bezier curves for anything interactive/draggable — they feel physical. Prefer `type: "spring"` with sensible `stiffness`/`damping` over a fixed duration for interactive elements.

**Polish multipliers:**
- **Stagger** grouped items by 30–80ms each — lists, grids, nav links appearing one after another reads as intentional and expensive.
- Animate **2+ properties together** (opacity + slight translate + slight scale) rather than one — layered motion looks richer.
- Keep distances **small**: a 12–24px translate reads as elegant; 200px reads as a slideshow.
- Respect a shared motion language: pick one easing + duration scale for the whole site and reuse it. Consistency > variety.

## Cleanup: the #1 source of "buggy" animations

Uncleaned animations leak memory, stack on re-trigger, fire after unmount, and fight each other. **Every animation you start, you must be able to stop and dispose.**

- **CSS/WAAPI:** keep the `Animation` object from `element.animate(...)`; call `.cancel()` when tearing down. Remove listeners you added.
- **requestAnimationFrame:** store the id from `requestAnimationFrame` and call `cancelAnimationFrame(id)` on teardown. A rAF loop with no cancel is a leak that runs forever.
- **GSAP:** use `gsap.context(() => {...}, scopeEl)` and call `ctx.revert()` on cleanup. Kill ScrollTriggers (`ScrollTrigger.getAll().forEach(t => t.kill())` or via the context). Never leave orphan timelines.
- **Framer Motion:** it auto-cleans on unmount — but cancel manual `animate()` controls and remove `useMotionValueEvent`/`scroll` subscriptions.
- **Three.js / R3F:** dispose geometries, materials, textures on unmount (`geometry.dispose()`, `material.dispose()`, `texture.dispose()`); stop the render loop; remove resize/pointer listeners; cancel any rAF. In R3F the `<Canvas>` and drei helpers dispose most of this, but **anything you `new`'d yourself, you dispose yourself**.
- **React specifically:** all of the above goes in the `useEffect` cleanup return. If your effect starts motion and returns nothing, that's a bug.
- Guard re-triggers: don't start a new animation on an element that's already animating the same property — kill/cancel the old one first, or the tweens stack and stutter.

## Accessibility & responsiveness (non-negotiable, cheap to do)

- **Always** honour reduced motion. Users who set it get disoriented/nauseous by big motion.
  ```css
  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after {
      animation-duration: 0.01ms !important;
      animation-iteration-count: 1 !important;
      transition-duration: 0.01ms !important;
      scroll-behavior: auto !important;
    }
  }
  ```
  In JS: `const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;` — if true, skip/shorten the animation and jump to the end state. GSAP: `gsap.matchMedia()`. Framer: `useReducedMotion()`.
- **Mobile:** heavy scroll-jacking, parallax, and WebGL tank low-end phones. Reduce particle counts, lower `dpr` (cap at `[1, 2]` in R3F), disable expensive post-processing on small screens, and never block scrolling.
- Ensure the **end state is the correct, functional layout** even if JS fails — animate *from* a visible baseline (progressive enhancement), so a broken script never leaves content invisible (`opacity: 0` stuck).
- Keep interactive targets clickable during/after motion; never trap focus in an animating element.

## Scroll animations

- Prefer the native **`ScrollTimeline` / `animation-timeline: view()`** or **IntersectionObserver** for reveal-on-scroll — cheap and jank-free — before reaching for a library.
- For sequenced scroll storytelling, use **GSAP ScrollTrigger**. Set `scrub` for scroll-linked, use `once: true` for one-shot reveals, and **always** register + later kill triggers.
- Never run layout reads/writes inside a raw scroll handler — that's guaranteed jank. Batch reads then writes, or let the library/observer handle it.
- Avoid full scroll-jacking (hijacking the scrollbar) unless the user explicitly wants it — it frustrates users and breaks accessibility.

## Three.js / React Three Fiber

- **R3F if the app is React**, vanilla Three.js otherwise. Don't mix imperative Three into React's render.
- Animate inside `useFrame((state, delta) => ...)`; **multiply motion by `delta`** so speed is frame-rate independent (never assume 60fps).
- Never `new` geometries/materials inside the render/`useFrame` loop — create once, reuse. Instance repeated meshes with `<Instances>` / `InstancedMesh`.
- Cap pixel ratio: `<Canvas dpr={[1, 2]}>`. Use `frameloop="demand"` for static scenes that only move on interaction — huge battery/CPU win.
- Lazy-load the 3D bundle (it's big); show a lightweight fallback; `<Suspense>` around loaders. Compress textures (KTX2/basis) and models (draco/meshopt glTF).
- Lights and shadows are expensive — bake where possible, limit real-time shadow casters, keep shadow map sizes modest.
- Dispose everything you created on unmount (see Cleanup). Test on an actual mid-range phone, not just the desktop.

## Library selection (quick guide)

| Need | Reach for |
|------|-----------|
| Simple hover/entrance/toggle, one-off | Plain CSS transition / `@keyframes` |
| Programmatic, promise-based, no deps | Web Animations API (`element.animate`) |
| Complex timelines, scroll storytelling, sequencing | GSAP (+ ScrollTrigger) |
| React declarative UI motion, layout animations, gestures | Framer Motion |
| Real 3D / WebGL | Three.js (vanilla) or React Three Fiber (React) |

Don't add a heavyweight library for something CSS does in 5 lines. Don't hand-roll a timeline engine when GSAP exists.

## Pre-ship checklist (run through this before declaring an animation done)

1. Does it animate **only** `transform`/`opacity` (or use FLIP)? No `top`/`left`/`width`/`height` transitions?
2. Is easing intentional (ease-out for enter, ease-in for exit) — **not** linear/default?
3. Duration in the right band for its role (micro vs transition vs entrance)?
4. Is there **cleanup** for every animation, rAF loop, listener, ScrollTrigger, and Three.js resource?
5. Does `prefers-reduced-motion` short-circuit it to a static end state?
6. Does it hold up on a mid-range phone (or degrade gracefully)?
7. Is the functional end state correct even if the script never runs?
8. Did you actually **watch it run in a browser** — golden path and re-trigger — before claiming success? Type-checks don't verify motion feels right.

If you can't test it in a browser, say so explicitly rather than claiming it looks good.
