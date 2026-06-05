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

const TOKEN_CLASS_CACHE = new Map<string, string>()
const TOKEN_STYLE_RULES: string[] = []
let tokenStyleElement: HTMLStyleElement | null = null
let tokenStyleSheetDirty = false

function tokenStyle(color?: string, fontStyle?: number): string {
  const colorCss = color ? `color: ${color};` : ''
  return `${colorCss}${fontStyleToCss(fontStyle)}`
}

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
}

export function getTokenStyleSignature(color?: string, fontStyle?: number): string {
  return tokenStyle(color, fontStyle)
}

export function getTokenClassName(color?: string, fontStyle?: number): string {
  const style = tokenStyle(color, fontStyle)
  if (!style)
    return ''

  const cached = TOKEN_CLASS_CACHE.get(style)
  if (cached)
    return cached

  const className = `smd-token-${TOKEN_CLASS_CACHE.size}`
  TOKEN_CLASS_CACHE.set(style, className)
  TOKEN_STYLE_RULES.push(`.${className}{${style}}`)
  tokenStyleSheetDirty = true
  return className
}

export function getTokenStyleAttr(color?: string, fontStyle?: number): string {
  const style = tokenStyle(color, fontStyle)
  if (!style)
    return ''

  if (typeof document === 'undefined')
    return ` style="${escapeAttr(style)}"`

  return ` class="${getTokenClassName(color, fontStyle)}"`
}

export function ensureTokenStyleSheet(): void {
  if (typeof document === 'undefined' || TOKEN_STYLE_RULES.length === 0)
    return

  if (!tokenStyleElement || tokenStyleElement.ownerDocument !== document || !tokenStyleElement.isConnected) {
    tokenStyleElement = document.querySelector('style[data-stream-markdown-token-styles]')
    if (!tokenStyleElement) {
      tokenStyleElement = document.createElement('style')
      tokenStyleElement.dataset.streamMarkdownTokenStyles = ''
      document.head.appendChild(tokenStyleElement)
    }
    tokenStyleSheetDirty = true
  }

  if (tokenStyleSheetDirty) {
    tokenStyleElement.textContent = TOKEN_STYLE_RULES.join('\n')
    tokenStyleSheetDirty = false
  }
}
