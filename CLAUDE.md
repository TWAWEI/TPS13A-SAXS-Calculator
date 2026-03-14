## Design Context

### Users
Beamline scientists at NSRRC operating the TPS 13A BioSAXS beamline. They use this tool during active experiments to quickly calculate SAXS parameters, estimate protein properties, and verify experimental settings. Speed and accuracy are critical — they need reliable answers without second-guessing the tool.

### Brand Personality
**Modern, Helpful, Smart** — A friendly yet technically competent scientific tool. It should feel like a capable assistant that understands the domain, not a cold instrument panel or a toy.

### Aesthetic Direction
- **Theme:** Dark mode (scientific instrument aesthetic with deep navy backgrounds)
- **Primary accent:** Indigo (#6366f1) — modern, trustworthy, distinct from typical lab software
- **Secondary accents:** Emerald (#10b981) for success/positive, Amber (#f59e0b) for warnings, Red (#ef4444) for errors
- **Typography:** Inter for UI text, JetBrains Mono for scientific values and sequences
- **Icons:** Emoji-based system (no image assets) — scientific themed (🔬🧬🧪⚗️📊)
- **Visual effects:** Subtle glassmorphism on cards, smooth transitions (150-400ms), gentle hover lifts
- **Anti-references:** Avoid looking like a generic dashboard template, overly playful consumer apps, or cluttered legacy lab software

### Design Principles

1. **Clarity over decoration** — Every visual element must serve comprehension. Scientific data should be immediately readable with clear hierarchy: labels, values (monospace), and units.

2. **Trust through precision** — Use consistent spacing (8px base), aligned grids, and predictable patterns. Sloppy layout undermines confidence in calculations.

3. **Speed of use** — Optimize for fast input-to-result workflows. Minimize clicks, keep related fields visible together, use smart defaults. Scientists are working under time pressure at the beamline.

4. **Accessible by default** — WCAG AA compliance. High contrast text on dark backgrounds, proper form labels, semantic HTML. The dark theme should enhance readability in various lighting conditions.

5. **Progressive disclosure** — Show essential results prominently, keep advanced details available but not overwhelming. Use section organization and collapsible areas to manage complexity.
