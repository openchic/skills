import type { ReactNode } from 'react'

const Layout = (props: { children: ReactNode }) => (
  <html lang="en"><body>{props.children}</body></html>
)

export default Layout
