import { memo } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'

/** Links leave the app: the main process routes new windows to the system browser. */
const components: Components = {
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noreferrer">
      {children}
    </a>
  )
}

const remarkPlugins = [remarkGfm]

/**
 * Renders model-written markdown with GitHub tables and lists. Raw HTML is never rendered.
 * Memoized on the text: parsing is the costly part, and the same text re-renders with every
 * state push.
 */
export const Markdown = memo(function Markdown({
  text,
  className
}: {
  text: string
  className?: string
}): React.JSX.Element {
  return (
    <div className={className ? `md ${className}` : 'md'}>
      <ReactMarkdown remarkPlugins={remarkPlugins} components={components}>
        {text}
      </ReactMarkdown>
    </div>
  )
})
