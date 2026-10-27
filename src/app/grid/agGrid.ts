import {
  AllCommunityModule,
  ModuleRegistry,
  themeQuartz,
} from 'ag-grid-community'

// AG Grid Community only (decision 0007). Registered once for the app.
ModuleRegistry.registerModules([AllCommunityModule])

/**
 * Quartz with its parameters mapped to workbench tokens, so every appearance
 * follows the app. A data sheet in the EnergyAtlas family (decision 0021):
 * label-style headers, row and column rules, no zebra stripes unless the
 * reader turns them on (decision 0027), an accent tint on hover, and square
 * corners. Numeric parameters do not take CSS variables, so the header size
 * repeats --label-size (--font-size-small, 0.75rem, 12px) and the body size
 * --font-size-base (0.8125rem, 13px); the header case and tracking come from
 * the shared header component's class in dataTable.module.css.
 */
export const workbenchGridTheme = themeQuartz.withParams({
  backgroundColor: 'var(--color-surface)',
  foregroundColor: 'var(--color-text)',
  borderColor: 'var(--color-border)',
  headerBackgroundColor: 'var(--color-surface-raised)',
  headerTextColor: 'var(--color-text-muted)',
  headerFontFamily: 'var(--label-font)',
  headerFontSize: 12,
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
  // The shared data table's cell padding (0.5rem).
  cellHorizontalPadding: 8,
  rowBorder: true,
  columnBorder: true,
  borderRadius: 0,
  wrapperBorderRadius: 0,
  checkboxBorderRadius: 0,
  inputBorder: { color: 'var(--color-border-interactive)' },
})

/**
 * The workbench grid with alternate rows shaded, at the same strength as the
 * shared data table's shading.
 */
export const shadedGridTheme = workbenchGridTheme.withParams({
  oddRowBackgroundColor:
    'color-mix(in srgb, var(--color-text) 7%, var(--color-surface))',
})

/**
 * Column defaults shared by the workbench grids. Long header labels wrap onto
 * a second line instead of being cut off at the app's column widths, whatever
 * the label style (decision 0021).
 */
export const workbenchColumnDefaults = {
  wrapHeaderText: true,
  autoHeaderHeight: true,
} as const
