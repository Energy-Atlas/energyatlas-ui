import {
  AllCommunityModule,
  ModuleRegistry,
  themeQuartz,
} from 'ag-grid-community'

// AG Grid Community only (decision 0007). Registered once for the app.
ModuleRegistry.registerModules([AllCommunityModule])

/**
 * Quartz with its parameters mapped to workbench tokens, so every appearance
 * follows the app. A data sheet in the EnergyAtlas family (decision 0020):
 * mono label headers, row and column rules, no zebra stripes, an accent tint
 * on hover, and square corners. Numeric parameters do not take CSS variables,
 * so the header size repeats --font-size-label (0.6875rem, 11px) and the body
 * size --font-size-base (0.8125rem, 13px); the uppercase header text is a
 * class override in table.module.css.
 */
export const workbenchGridTheme = themeQuartz.withParams({
  backgroundColor: 'var(--color-surface)',
  foregroundColor: 'var(--color-text)',
  borderColor: 'var(--color-border)',
  headerBackgroundColor: 'var(--color-surface-raised)',
  headerTextColor: 'var(--color-text-muted)',
  headerFontFamily: 'var(--font-mono)',
  headerFontSize: 11,
  headerFontWeight: 600,
  headerColumnBorder: true,
  oddRowBackgroundColor: 'var(--color-surface)',
  rowHoverColor: 'color-mix(in srgb, var(--color-accent) 8%, transparent)',
  selectedRowBackgroundColor: 'var(--color-selected-bg)',
  accentColor: 'var(--color-accent)',
  fontFamily: 'var(--font-sans)',
  fontSize: 13,
  rowHeight: 30,
  headerHeight: 32,
  rowBorder: true,
  columnBorder: true,
  borderRadius: 0,
  wrapperBorderRadius: 0,
  checkboxBorderRadius: 0,
  inputBorder: { color: 'var(--color-border-interactive)' },
})

/**
 * Column defaults shared by the workbench grids. Mono uppercase header labels
 * (decision 0020) are wider than Geist, so long headers wrap onto a second
 * line instead of being cut off at the app's column widths.
 */
export const workbenchColumnDefaults = {
  wrapHeaderText: true,
  autoHeaderHeight: true,
} as const
