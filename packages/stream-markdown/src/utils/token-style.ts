const CSS_COLOR_FUNCTION_RE = /^(?:rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch|color)\([\w\s.,%/+~-]+\)$/i
const CSS_VAR_NAME_RE = /^--[\w-]+$/
const CSS_VAR_FALLBACK_RE = /^[\w\s#.,%()+/~-]+$/

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
let colorProbe: HTMLElement | null = null

function hasUnsafeCssValueChar(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i)
    if (code <= 31 || code === 127)
      return true
    if (`;"'{}<>`.includes(value[i]))
      return true
  }
  return false
}

function isSafeCssColorSyntax(value: string): boolean {
  if (!value || hasUnsafeCssValueChar(value))
    return false
  if (/url\s*\(/i.test(value))
    return false
  return true
}

function isSafeCssVar(value: string): boolean {
  if (!value.startsWith('var(') || !value.endsWith(')'))
    return false

  const body = value.slice(4, -1)
  const commaIndex = body.indexOf(',')
  if (commaIndex === -1)
    return CSS_VAR_NAME_RE.test(body.trim())

  const name = body.slice(0, commaIndex).trim()
  const fallback = body.slice(commaIndex + 1).trim()
  return CSS_VAR_NAME_RE.test(name) && CSS_VAR_FALLBACK_RE.test(fallback)
}

function isSafeCssColorForSsr(value: string): boolean {
  return /^#[\da-f]{3,8}$/i.test(value)
    || /^[a-z][a-z0-9-]*$/i.test(value)
    || CSS_COLOR_FUNCTION_RE.test(value)
    || isSafeCssVar(value)
}

function isValidDomColor(value: string): boolean {
  const css = (globalThis as any).CSS
  if (css && typeof css.supports === 'function') {
    try {
      if (css.supports('color', value))
        return true
    }
    catch {
      // Fall through to style-property probing.
    }
  }

  if (typeof document === 'undefined')
    return false

  if (!colorProbe || colorProbe.ownerDocument !== document)
    colorProbe = document.createElement('span')

  colorProbe.style.color = ''
  colorProbe.style.color = value
  return colorProbe.style.color !== ''
}

function normalizeColor(color?: string): string {
  const value = color?.trim()
  if (!value || !isSafeCssColorSyntax(value))
    return ''

  if (typeof document !== 'undefined')
    return isValidDomColor(value) ? value : ''

  return isSafeCssColorForSsr(value) ? value : ''
}

function tokenStyle(color?: string, fontStyle?: number): string {
  const normalizedColor = normalizeColor(color)
  const colorCss = normalizedColor ? `color: ${normalizedColor};` : ''
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
