# Season Preview Color Policy

Version 1.0 · 2026–27 Hanson Hoops season preview package

## Authority and scope

All agents creating or modifying graphics for this package must read this file before editing. This policy applies to all 30 team sections, chart containers, controls, marks, inspection panels, tables and exports. The user's explicit direction overrides this policy. Changes to a team's identity palette must be documented here and in the shared registry; agents must not independently choose replacement palettes.

The Washington cherry-pink and Sacramento purple treatments are the reference philosophy: team identity appears across large background surfaces, not merely as a line color. Knicks, Sixers and Nuggets extend the same roles. Consistency means consistent color roles and structure, not identical hues or identical opacity.

## Core rule

Use the dominant or most distinctive team color as the identity hue for the full graphic/container background and primary design elements. Use lighter and darker derivatives of that hue for readable surfaces, controls, text and marks. A team's secondary color supplies contrast where useful. Never apply one team's palette to another through shared component defaults.

The section containing a graphic and the graphic itself must read as belonging to the same team. Long article text may remain on a neutral reading surface, with the surrounding graphic region, section accents and controls carrying the identity. Do not invent a different header/background layout for one team solely to make its color visible.

## Shared roles

| Token | Role | Requirement |
|---|---|---|
| `--team-identity` | Canonical identity hue | One shared value per team |
| `--team-secondary` | Secondary brand cue | Supporting emphasis, never a generic replacement identity |
| `--team-surface` | Whole graphic and containing region | Recognizable identity tint, default 12% identity mixed with white |
| `--team-surface-strong` | Selected controls, callouts, highlights | Stronger tint, default 24% identity mixed with white |
| `--team-ink` | Primary marks, headings, links, borders | Dark readable identity derivative; may differ from raw identity |
| `--team-text` | Body text | Neutral dark text on light surfaces |
| `--team-muted` | Notes, ticks, secondary text | Readable neutral; do not use faint brand color for small text |
| `--team-plot` | Plot surface | White by default across all teams; keep any approved tint treatment consistent |
| `--team-comparison` | Comparison/rank series | Contrasting neutral, supported by line style or marker shape |
| `--team-negative` | Explicit negative/warning meaning | Semantic red, with signed labels or other non-color cues |
| `--team-border` | Container/control boundary | Darker identity tint with sufficient functional contrast |
| `--team-focus` | Keyboard focus | High-contrast visible ring; may use a neutral outline |

Tint percentages are defaults, not fixed requirements. Adjust per team or chart when needed, while preserving hue and role. A very pale tint that makes all containers look white fails the visual identity goal. Do not achieve readability by silently reverting to Washington pink.

## Five reference treatments

| Team | Identity/background family | Primary ink | Secondary cue |
|---|---|---|---|
| WAS | Cherry pink/red | Navy | Navy |
| SAC | Kings purple | Dark purple | Silver/gray |
| NYK | Knicks orange | Dark burnt orange | Knicks blue |
| PHI | Sixers blue | Dark blue | Sixers red |
| DEN | Nuggets gold | Dark gold/brown | Nuggets navy |

These are project design choices, not a claim about official brand specifications. WAS is an intentional cherry-tint treatment chosen by the user; do not normalize it to the red or navy schemes used by other teams. NYK/PHI/DEN are the initial extensions of that philosophy. The other 25 entries in `team-palettes.json` are initial project assignments: implement them consistently and revise centrally if the user prefers another recognizable team color.

## Data color semantics

For a single focal series or player, use readable team ink. For Brunson, preserve orange emphasis against neutral comparisons. For multi-panel Maxey charts, keep the same color meaning across panels. For Jokić on/off or other multiple-series charts, preserve series identities across views and supplement color with labels or dash patterns.

Do not overwrite categorical, continuous or diverging encodings with one color. Brand the container and controls first; data semantics retain priority inside the plot. Sequential scales may derive from the identity hue if readable. Diverging scales must clearly distinguish both sides of their midpoint. Do not recolor negative points merely because red is outside the team palette.

Gold, orange and pale pink often lack contrast as thin lines on white. Use the darker ink token, retaining the identity hue on large surfaces. Primary marks need not use the exact raw hex. Labels, line style and marker shape must distinguish rank from actual value, on from off, or selected player from peers. Never make color the only carrier of meaning.

## Implementation contract

Use one shared palette registry and role layer. Scope tokens with `data-team-theme="NYK"` (or the equivalent established team root), and have all nested chart components inherit them. Use explicit `.team-graphic-region` and `.team-graphic` hooks rather than broad selectors that restyle prose or unrelated controls.

Read CSS variables from the correct chart root when JavaScript supplies SVG or canvas colors. Inline SVG styles, canvas redraws, tooltips, legends and export routines must use the same theme roles. A CSS container override alone is insufficient when the renderer hard-codes colors. Preserve separately scoped state for all chart instances.

The accompanying CSS establishes theme tokens and reusable surface/control classes. It is an integration layer, not proof that existing components already consume every token. Adapt current component selectors and renderer hooks deliberately. Do not use blanket SVG `fill`/`stroke` overrides or `!important` to force adoption.

Use solid precomputed surface colors. If translucency is needed, measure the composited result against the actual page background. Existing team/header tokens and this registry must agree on palette intent; consolidate rather than maintaining two competing sources.

## Agent workflow

1. Read this policy, the registry and current WAS/SAC implementation.
2. Inventory every graphic, containing section, control, tooltip, table and export for the target team.
3. Reuse the shared role mapping and attach a scoped team theme.
4. Replace inherited hard-coded colors with appropriate theme roles; preserve analytical encodings.
5. Compare the target beside WAS/SAC and the other reference teams at the same size. Team identity must be evident before reading the title.
6. Verify actual rendered contrast, labels, interactions and exports. Report any unresolved gap.

Add a reference to `ColorPolicy.md` in the repository's existing `AGENTS.md` so future agents load it. Preserve unrelated instructions. If the repository has no AGENTS.md, create a minimal one directing agents to this policy without inventing new approval requirements.

## Acceptance criteria

- The dominant hue occupies the same roles across teams and is visible on the whole graphic region.
- Every chart belonging to a team uses that team's registry, including expanded inspection/table states.
- No accidental Washington pink remains in SAC, NYK, PHI or DEN controls/backgrounds.
- Standard text reaches 4.5:1 contrast; large text reaches 3:1. Essential graphic marks, control boundaries and focus indicators reach 3:1 against adjacent surfaces where applicable.
- Identity is supported by team names and other cues; color is never the sole data distinction.
- Desktop and approximately 390px mobile layouts remain readable without horizontal page overflow.
- Hover, touch, keyboard, view toggles, resizing and card reopening preserve themes and state.
- SVG/canvas exports and screenshots preserve the intended background and readable labels.
- No data, domains, ranks, methodology, editorial copy or ranking order changes solely for theming.

## Delivery status

This package supplies the policy, 30-team registry, shared CSS and five visual design specimens. The specimens contain no NBA statistics. Current NYK/PHI/DEN chart source was not available in this session, so repository integration and browser checks on the real charts remain production-agent work. Do not describe these specimens as screenshots of implemented charts.
