import type { Highlighter } from 'shiki'

export interface RenderOptions {
  lang: string
  theme: string
  preClass?: string
  codeClass?: string
  lineClass?: string
  showLineNumbers?: boolean
  startingLineNumber?: number
}

export interface ThemedToken {
  content: string
  color?: string
  fontStyle?: number
}

function escapeHtml(str: string): string {
  return str.replace(/\r/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function fontStyleToCss(style?: number): string {
  if (!style || style === 0)
    return ''
  const parts: string[] = []
  if (style & 1)
    parts.push('font-style: italic;')
  if (style & 2)
    parts.push('font-weight: 600;')
  if (style & 4)
    parts.push('text-decoration: underline; text-underline-offset: 0.15em;')
  return parts.join(' ')
}

export function renderCodeWithTokens(
  highlighter: Highlighter,
  code: string,
  opts: RenderOptions,
): string {
  const { lang, theme, preClass = 'shiki', codeClass = '', lineClass = 'line', showLineNumbers = false, startingLineNumber = 1 } = opts

  let lines: ThemedToken[][]
  const anyHl = highlighter as any
  if (typeof anyHl.codeToThemedTokens === 'function') {
    lines = anyHl.codeToThemedTokens(code, lang, theme)
  }
  else if (typeof anyHl.codeToTokens === 'function') {
    const r = anyHl.codeToTokens(code, { lang, theme })
    lines = r.tokens as ThemedToken[][]
  }
  else {
    throw new TypeError('Highlighter does not support token APIs: codeToThemedTokens/codeToTokens')
  }

  {
    const expected = code.replace(/\r\n/g, '\n').split('\n').length
    if (lines.length < expected) {
      lines = lines.concat(Array.from({ length: expected - lines.length }, () => []))
    }
  }

  let bg: string | undefined
  try {
    const themeObj = (highlighter as any).getTheme?.(theme)
    bg = themeObj?.bg
  }
  catch {
    // ignore
  }

  let lineNumber = startingLineNumber
  const lineHtml = lines.map((line) => {
    const tokensHtml = line.map((t) => {
      const color = t.color ? `color: ${t.color};` : ''
      const style = `${color}${fontStyleToCss(t.fontStyle)}`
      const styleAttr = style ? ` style="${style}"` : ''
      return `<span${styleAttr}>${escapeHtml(t.content)}</span>`
    }).join('')

    const ln = showLineNumbers ? `<span class="line-number" data-line="${lineNumber++}"></span>` : ''
    return `<span class="${lineClass}">${ln}${tokensHtml}</span>`
  }).join('\n')

  const preStyle = bg ? ` style="background-color: ${bg};"` : ''
  const codeCls = codeClass ? ` class="${codeClass}"` : ''
  return `<pre class="${preClass}"${preStyle}><code${codeCls}>${lineHtml}</code></pre>`
}
