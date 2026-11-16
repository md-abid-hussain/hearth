import ReactMarkdown, { type Components } from 'react-markdown'

/** Links leave the app: the main process routes new windows to the system browser. */
const components: Components = {
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noreferrer">
      {children}
    </a>
  )
}

/** Renders model-written markdown. Raw HTML in the source is shown as text, never parsed. */
export function Markdown({
  text,
  className
}: {
  text: string
  className?: string
}): React.JSX.Element {
  return (
    <div className={className ? `md ${className}` : 'md'}>
      <ReactMarkdown components={components}>{text}</ReactMarkdown>
    </div>
  )
}
