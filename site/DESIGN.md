# Torbie website design

## Visual thesis
A quiet window into the real terminal opens into a readable incident record, where the cost of a stall becomes visible in the words and calls that caused it.

## System
Warm stone ramp matches aylith-com: #f8f7f4, #f0eee9, #e1ddd3, #c9c3b3, #90897a, #615b50, #46423a, #332f29, #1c1a16, #131110, #0a0907. Copper oklch(0.66 0.13 50), hover oklch(0.56 0.13 50); darker copper for AA text on light. Cream #f3efe7. Space Grotesk headings, DM Sans body, monospace only for recorded output and code. Self-host Latin font subsets. Display 40–76px; body 16–20px; reading measure 70ch. Four-pixel spacing basis. Max canvas 1200px. Flat surfaces, fine rules, no card grid. Real screenshots retain their own app colours.

## Composition and wireframes
Home (Persuade):
```
[mark Torbie]                  [Features Download]
[The terminal that             [real app capture ]
 explains its stalls.          [                ]
 support + Download]          [                ]
-------------------------------------------------
[Plugins keep loading]        [compatibility proof]
[Why it froze                                  ]
[verbatim stall record, calls aligned underneath]
[Pane returns]                [source evidence  ]
[real link capture]           [Link previews    ]
[Builds and doctor]           [real app capture ]
[Known limits: four full-width readable rows    ]
[Download Torbie]               [footer / theme ]
```
Mobile stacks hero text then the full image within 844px; no sticky header. At 720px desktop height the hero ends at the viewport boundary. No other section enters the first viewport.

Download (Operate):
```
[header]
[Download Torbie]
[OS/architecture selectors] [suggested asset]
[unsigned warning / Tabby stays installed]
[Windows formats grouped by architecture]
[macOS formats grouped by architecture]
[Linux formats grouped by architecture]
[footer / theme]
```
Features (Read):
```
[header]
[Features] [derived count and category count]
[Search] [Category] [Sort]
[Title / description                category →]
[repeated ruled rows, empty state if necessary]
[footer]
```
Feature detail (Read):
```
[header] [All features]
[Feature title / description]
[date / files / additions / deletions]
[Problem] [How it works] [steps / settings / output]
[What this does not claim, fully visible]
[linked commits] [footer]
```
404 (Read):
```
[header] [Page not found] [Home] [Features] [footer]
```

## Motion choices
One optional 180ms ease-out colour response on pointer hover; 100ms press feedback. Theme and keyboard actions remain immediate. No scroll reveals, autoplay or typing. All motion gated by reduced-motion and html data-motion.

## Brief review
Rejected a feature-card grid and headline count strip because either could belong to any developer tool. Replaced them with ruled source-linked prose and a single full-width recorded stall. Removed hero navigation clutter and kept theme controls in the footer to preserve the first viewport budget. Palette and fonts remain exactly the pinned brand.

## Skill decisions
The brief overrides Impeccable reference/init.md’s “require one real answer or approval round” and reference/new-work.md’s “get the user’s answer” and concept-choice checkpoints: the user already specified product truth and delegated composition. No generated comps or screenshots; the brief requires real app captures. craft is a deprecated alias in the installed release. Reviews use critique, audit, polish and Vercel guidelines. The detector’s brand findings will be justified here if they remain.

## Research: avoiding a shared skill aesthetic (12 September 2026)
The owner raised concern that Impeccable makes websites converge. It is used here as a fallible review tool. Its detector passing does not establish originality. The visual brief remains the authority.

[Interrogating Design Homogenization in Web Vibe Coding](https://arxiv.org/abs/2603.13036) is a risk analysis and mitigation framework, not an empirical comparison of Impeccable outputs. It argues for reflective intervention and contextual anchoring. [Impeccable’s source](https://github.com/pbakaus/impeccable) combines shared rules with product-specific direction; those rules can still encourage convergence if treated as the creative objective. An [open proposed fix](https://github.com/pbakaus/impeccable/pull/809) documents false positives on deliberately chosen brand tokens.

Design test: remove the logo and ask whether the page still identifies Torbie through the recorded stall, per-call attribution, plugin compatibility evidence and honest limits. Conventional navigation and accessible forms may be shared. Distinctiveness must come from how the evidence is presented. Avoid importing another terminal’s illustrations, card rhythm or palette.

## Capture limitation
Real hero light/dark captures are 1920×1140 and use public demo content. Additional preview/settings capture calls timed out with the window hidden, so those sections use source-linked prose. No substitute app mockup is drawn.

## Toolchain
The checking compiler is stable native TypeScript 7 through @typescript/native. Svelte-check requires the JavaScript TypeScript 6 peer package to load; it runs with --tsgo. Biome’s Svelte embedded-script unused-variable/import checks are disabled because template usages are invisible to that analysis; svelte-check covers them. Descending-specificity warnings across disjoint component selectors are disabled; responsive cascade is reviewed in-browser.

## Video research applied
Read the English captions of [Design trends that kill sales](https://www.youtube.com/watch?v=lpqTva43Bxo) and [The UX Psychology Behind Apps People Can’t Stop Using](https://www.youtube.com/watch?v=2TlIg3VokY8). The former evaluates whether a key visual is relevant to its claim, independently of how abstract it is. That exposed a weakness in the first Torbie hero: generic git output did not substantiate the stall headline. Request a new real capture with the recorded diagnostic sample legible. The second supports useful defaults and showing value before a conversion request. Detect platform and architecture where available, retain visible choice, and make all evidence freely readable. No account wall, artificial countdown or invented progress.

Visual references inspected in a headless browser: [Ghostty](https://ghostty.org/) concentrates on one terminal; [Zed](https://zed.dev/) uses an editorial frame; [Warp](https://www.warp.dev/terminal) uses a dominant colour field and demonstration. Borrow the discipline of choosing what leads, while Torbie’s evidence supplies the content and the pinned brand supplies the tokens. Mobbin was offered by the owner; the available browser reached a login gate, so no member screens are claimed as reviewed.

## Review notes
| Before | After | Why |
| --- | --- | --- |
| Generic terminal output beside a diagnostic headline | Requested a real app capture showing the recorded stall | The visual should substantiate the headline |
| Broad side-by-side install statement | Windows-specific statement and Linux deb/rpm replacement warning | Packaging source contradicts the brief’s generalization |
| Empty caveat block where source has none | Explicit statement that the source records no separate caveat | Avoid an empty designed section |
| Decorative motion candidates | Pointer feedback only, immediate keyboard/theme changes | Reading and downloading need no animation |

## Detector gate
`npx impeccable detect site/src` reports one `overused-font` finding at `src/app.css:2` for Space Grotesk. Retained deliberately: the owner pins this font and the org brand requires it. Originality is assessed through composition and the specificity of evidence; replacing the mandated typeface to satisfy the detector would violate the brief.

## Remaining capture gap
The second bounded capture attempt checked visibility before any resize; the launcher still reported a visible window. It was hidden immediately and stopped by its exact PID. Packaged Torbie/Tabby process counts remained six. Existing real captures are retained. A diagnostic-focused hero capture remains desirable but was not obtained under the required hidden-window constraint. No claim is made that the hero capture demonstrates the diagnostic feature itself; the recorded output below it provides that evidence.

## Review workflow exceptions
The user’s brief and later request to treat Impeccable cautiously govern the review. Impeccable reference/critique.md asks to “present the browser”; all inspection stays headless because the user forbids showing or focusing windows. Its “ask the user what to improve next” and Mobbin’s “implement after approval” checkpoints are superseded by the existing instruction to choose, build, fix and ship without plan approval. Findings are fixed within the authorized scope. Vercel’s Title Case suggestion is superseded by the pinned sentence-case voice.

## Final review evidence
Independent visual review looked at every route through 552 captures (69 routes, four widths, both themes). No blocking layout, overflow, overlap or asset defects. The missing release separator and singular “file” label were corrected. The actual-app evidence gap remains declared above. Independent browser review reports 552 axe checks with zero violations and no overflow or broken media. Search/filter/sort URL state, Back/reload, theme persistence and live OS preference, keyboard skip link, reduced motion and five platform/architecture cases passed. All 164 external HEAD links resolved during review; all 23 downloadable release assets independently returned 200 after redirects.

Mobile Lighthouse accessibility is 100 on home, download, index and a detail page; performance is 95, 98, 97 and 99 respectively. Local artifacts are in the gitignored `.review/` directory. These are measurements of the local static build; served-output verification is separate. Questions skipped: scope and authority to fix and ship were already supplied.

## Visual redesign — owner correction
The owner rejected the text-heavy first version and requested Emil Kowalski's design engineering guidance, richer real screenshots, optional explanations, and a living contextual companion. This direction supersedes the earlier composition, motion restrictions, and no-card-grid decision above. The original pinned palette and type remain; the hierarchy is now demonstration first.

| Before | After | Why |
| --- | --- | --- |
| Prose sections describing each feature | Four selectable, large real-app scenes | Visitors can see the behavior before reading details |
| Generic git output as the only capture | Workspace, GitHub preview, recorded diagnostic replay, build inventory; both themes | Show distinct capabilities using the actual application |
| Permanent paragraphs throughout the catalogue | Native disclosure controls in the index and feature pages | Keep technical detail accessible without making it the default view |
| No guided exploration | Small copper cat companion with pointer following, contextual help, and a park control | Make exploration approachable without covering the work |
| One color transition | Restrained press feedback and an interruptible guide-panel transition | Apply Emil's purpose, timing, and motion principles |

The companion follows fine mouse input, pauses under the pointer and while its explanation panel is open, and parks on keyboard Escape. Touch and reduced-motion users get a stationary control. Parking persists locally. It is a deterministic field guide with authored explanations, not a networked chatbot. Essential download/security warnings remain visible beside the downloads. Every hover-enhanced affordance also works with click, keyboard, and touch.

Mobbin is now connected and was queried successfully. Visually inspected [Cursor's hero](https://mobbin.com/sites/sections/a7f2c059-5d26-466d-9337-33ab8583c3d4) and [Retool's product demonstration](https://mobbin.com/sites/sections/dcbd55be-58cb-4e0e-9b70-cb4d184fa30a). The useful pattern is a dominant product demonstration with optional explanation; their color and composition are not used as a template. The owner-provided screenshot identifies `emilkowalski/skill`; the installed `emil-design-eng` guidance was read and applied.

### Real capture provenance
A temporary Electron bootstrap in the Windows temp directory intercepts BrowserWindow creation to enable offscreen rendering and disables show, showInactive, and focus before the app loads. It uses a separate profile and a dynamically selected free CDP port. Each capture refuses to proceed unless the window is invisible and its webContents are offscreen. No application source or existing user profile is changed.

The workspace runs public repository commands. The preview fetches public commit 1e144ffc through Torbie's GitHub integration; the integration's field settings omit the author. The diagnostic scene displays the previously recorded stall through a labelled replay script, not a newly induced stall. The build inventory uses the actual table view with path columns outside the viewport. Captures are 2162×1352, compressed to WebP; eight images are committed under docs/media. No app UI is fabricated. The small plugin, timeline, and resume illustrations are website-native explanatory diagrams, not screenshots.

### Redesign verification
The four scene controls, click-to-reveal explanations, native discovery disclosures, companion context, parking persistence, Escape focus restoration, and reduced-motion stationary behavior were exercised in a browser. Home passed axe at 390, 768, 1440 and 1920 pixels in both themes. All 69 routes were additionally checked with feature disclosures expanded: 138 light/mobile and dark/desktop checks, zero axe violations and zero overflow. The intentional 404 document's self-referencing skip link is an expected 404, not a product navigation failure. All eight framed scene exports were visually inspected. Site lint, Svelte/native TypeScript checking, four catalog/release tests, prerendering and internal asset/link checks pass. The source-owned homepage link also survives the actual umbrella collector's parser and serializer.

The owner subsequently relayed a no-Electron-launch instruction while the product session investigates hidden launches and protocol registration. All new captures preceded that instruction; capture processes are stopped and the temporary launcher is disabled. No future launch is authorized by this document. Protocol readback after the handoff points both tabby and torbie schemes at the installed Torbie.exe; this website session did not modify the registry. DNS, repository naming, Pages custom domains and the `/torbie` base are unchanged. The private URL proposal lives in `.review/web-presence-proposal.md`.

### Companion and selector refinement — 12 September 2026

| Before | After | Why |
| --- | --- | --- |
| Uniform ginger face, no idle motion | Irregular dark/copper tortoiseshell patches, tabby forehead stripes, amber eyes, a double blink and occasional ear flick | Match Torbie's namesake and make the guide feel attentive; reduced motion disables idle animation |
| Download placeholder remained selectable | Empty OS/architecture option disables once its value is known or selected | Prevent clearing a confirmed choice into a non-choice |
| Font plus sat below the label center | Centered geometric strokes rotate into a close mark | Stable optical alignment independent of font metrics |
| Native category and sort controls | Authored listbox menus with keyboard navigation and category count badges | Consistent appearance; counts reflect the current search, including zero-result categories |

Menus open immediately without keyboard animation. Sort choices have no per-choice counts because sorting does not change the result set. Existing result totals remain visible. The user explicitly requested idle animation for the companion; it is limited to its small control and gated by both the site motion setting and prefers-reduced-motion.
