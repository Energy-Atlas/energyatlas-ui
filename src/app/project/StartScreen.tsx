import { useId, type ReactNode } from 'react'
import styles from './project.module.css'

/**
 * The start screen's layout (decisions 0024, 0028, and 0036), shared by the
 * modeller's Projects screen and the viewer's start page: the menu bar, then
 * a centred heading, a line saying what the screen is for, the main buttons,
 * a notice for the last attempt, and the lists side by side.
 */
export function StartScreen({
  ribbon,
  title,
  intro,
  buttons,
  notice,
  children,
  after,
}: {
  /** The menu bar, with what needs an open project or view unavailable. */
  ribbon: ReactNode
  title: string
  intro: ReactNode
  buttons: ReactNode
  /** Why the last attempt failed, or what is opening. */
  notice?: ReactNode
  /** The lists, as `StartSection`s. */
  children: ReactNode
  /** Dialogs and other content after the page. */
  after?: ReactNode
}) {
  const headingId = useId()
  return (
    <div className={styles.start}>
      {ribbon}
      <main
        className={styles.content}
        aria-labelledby={headingId}
        tabIndex={-1}
      >
        <h1 id={headingId} tabIndex={-1}>
          {title}
        </h1>
        <p>{intro}</p>
        <div className={styles.actions}>{buttons}</div>
        {notice}
        <div className={styles.lists}>{children}</div>
      </main>
      {after}
    </div>
  )
}

/** One list on the start screen, under a mono label heading. */
export function StartSection({
  title,
  children,
}: {
  title: ReactNode
  children: ReactNode
}) {
  const headingId = useId()
  return (
    <section className={styles.section} aria-labelledby={headingId}>
      <h2 id={headingId} className={styles.sectionHeading}>
        {title}
      </h2>
      {children}
    </section>
  )
}
