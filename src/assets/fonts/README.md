# Vendored fonts

Geist Mono, the label, code, and identifier face of [decision 0020](../../../docs/decisions/0020-energyatlas-family-ui-alignment.md), is vendored here rather than installed from npm, so no package is added.

| File | Content |
| --- | --- |
| `geist-mono-latin.woff2` | Geist Mono, variable weight 100 to 900, Latin subset |
| `geist-mono-latin-ext.woff2` | Geist Mono, variable weight 100 to 900, Latin Extended subset |
| `OFL-GeistMono.txt` | SIL Open Font License 1.1, which allows bundling the font with the application |

- **Source:** copied on 2026-10-20 from `docs/assets/fonts/` of the EnergyAtlas dev-skills repository (commit `266e00b`, 2026-10-11), which took them from the BEMGen documentation site. The upstream Geist release is not recorded there.
- **Declared** with `@font-face` in `src/index.css`; Vite bundles the files, so the browser contacts no font host.
- **Replacing** them with `@fontsource-variable/geist-mono` pinned exactly would restore npm version and licence tracking (decision 0010's preference); it is a package decision for the user.
