export type TokenStyleMode = 'inline' | 'class'

const SIMPLE_COLOR_RE = /^#(?:[\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/i
const COLOR_KEYWORD_RE = /^[a-z][a-z0-9-]*$/i
const CSS_VAR_NAME_RE = /^--[\w-]+$/
const SAFE_CSS_FUNCTION_NAMES = new Set([
  'rgb',
  'rgba',
  'hsl',
  'hsla',
  'hwb',
  'lab',
  'lch',
  'oklab',
  'oklch',
  'color',
  'color-mix',
  'light-dark',
  'var',
  'calc',
  'min',
  'max',
  'clamp',
])
const CSS_FUNCTION_NAME_RE = /([a-z][\w-]*)\s*\(/gi

function fontStyleToCss(style?: number): string {
  if (style == null || !Number.isFinite(style) || style <= 0)
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
const TOKEN_STYLE_CACHE = new Map<string, string>()
const TOKEN_STYLE_BY_CLASS = new Map<string, string>()
const TOKEN_STYLE_RULES: string[] = []
let tokenStyleGeneration = 0
let tokenStyleSheetText = ''
let tokenStyleSheetTextGeneration = -1
type TokenStyleRoot = Document | ShadowRoot
interface TokenStyleRootState {
  element: HTMLStyleElement
  generation: number
}
const TOKEN_STYLE_ROOTS = new WeakMap<TokenStyleRoot, TokenStyleRootState>()

function hasUnsafeCssValueChar(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i)
    if (code <= 31 || code === 127)
      return true
    if (`;"'{}<>\\`.includes(value[i]))
      return true
  }
  return false
}

function isSafeCssColorSyntax(value: string): boolean {
  if (!value || hasUnsafeCssValueChar(value))
    return false
  if (/url\s*\(|\/\*|@/i.test(value))
    return false
  if (!hasBalancedParentheses(value))
    return false
  return hasOnlyAllowedCssFunctions(value)
}

function hasBalancedParentheses(value: string): boolean {
  let depth = 0

  for (let i = 0; i < value.length; i++) {
    const ch = value[i]

    if (ch === '(') {
      depth++
      continue
    }

    if (ch === ')') {
      depth--
      if (depth < 0)
        return false
    }
  }

  return depth === 0
}

function hasOnlyAllowedCssFunctions(value: string): boolean {
  CSS_FUNCTION_NAME_RE.lastIndex = 0

  let match: RegExpExecArray | null
  while ((match = CSS_FUNCTION_NAME_RE.exec(value))) {
    const fn = match[1].toLowerCase()
    if (!SAFE_CSS_FUNCTION_NAMES.has(fn))
      return false
  }

  return true
}

function isSafeTopLevelCssFunction(value: string): boolean {
  const open = value.indexOf('(')
  if (open <= 0 || !value.endsWith(')'))
    return false

  const name = value.slice(0, open).trim().toLowerCase()
  if (!SAFE_CSS_FUNCTION_NAMES.has(name))
    return false

  if (name !== 'var')
    return true

  const body = value.slice(open + 1, -1).trim()
  const commaIndex = body.indexOf(',')
  const varName = (commaIndex === -1 ? body : body.slice(0, commaIndex)).trim()
  return CSS_VAR_NAME_RE.test(varName)
}

function isSafeCssColorForSsr(value: string): boolean {
  return SIMPLE_COLOR_RE.test(value)
    || COLOR_KEYWORD_RE.test(value)
    || isSafeTopLevelCssFunction(value)
}

export function normalizeCssColor(color?: string): string {
  const value = color?.trim()
  if (!value || !isSafeCssColorSyntax(value))
    return ''

  return isSafeCssColorForSsr(value) ? value : ''
}

function tokenStyle(color?: string, fontStyle?: number): string {
  const normalizedColor = normalizeCssColor(color)
  const cacheKey = `${normalizedColor}|${fontStyle ?? 0}`
  const cached = TOKEN_STYLE_CACHE.get(cacheKey)
  if (cached !== undefined)
    return cached

  const colorCss = normalizedColor ? `color: ${normalizedColor};` : ''
  const style = `${colorCss}${fontStyleToCss(fontStyle)}`
  TOKEN_STYLE_CACHE.set(cacheKey, style)
  return style
}

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
}

export function getTokenStyleSignature(color?: string, fontStyle?: number): string {
  return tokenStyle(color, fontStyle)
}

function hashTokenStyle(style: string): string {
  let h1 = 0x811C9DC5
  let h2 = 0x1505

  for (let i = 0; i < style.length; i++) {
    const code = style.charCodeAt(i)
    h1 ^= code
    h1 = Math.imul(h1, 0x01000193)
    h2 = Math.imul(h2, 33) ^ code
  }

  return `${(h1 >>> 0).toString(36)}-${(h2 >>> 0).toString(36)}`
}

function getTokenClassNameForStyle(style: string): string {
  if (!style)
    return ''

  const cached = TOKEN_CLASS_CACHE.get(style)
  if (cached)
    return cached

  const baseClassName = `smd-token-${hashTokenStyle(style)}`
  let className = baseClassName
  let suffix = 1

  while (true) {
    const existingStyle = TOKEN_STYLE_BY_CLASS.get(className)
    if (!existingStyle) {
      TOKEN_CLASS_CACHE.set(style, className)
      TOKEN_STYLE_BY_CLASS.set(className, style)
      TOKEN_STYLE_RULES.push(`.${className}{${style}}`)
      tokenStyleGeneration++
      return className
    }

    if (existingStyle === style) {
      TOKEN_CLASS_CACHE.set(style, className)
      return className
    }

    className = `${baseClassName}-${suffix++}`
  }
}

export function getTokenClassName(color?: string, fontStyle?: number): string {
  return getTokenClassNameForStyle(tokenStyle(color, fontStyle))
}

export function getTokenInlineStyleAttr(color?: string, fontStyle?: number): string {
  const style = tokenStyle(color, fontStyle)
  if (!style)
    return ''

  return ` style="${escapeAttr(style)}"`
}

export function getTokenClassAttr(color?: string, fontStyle?: number): string {
  const style = tokenStyle(color, fontStyle)
  if (!style)
    return ''

  return ` class="${getTokenClassNameForStyle(style)}"`
}

export function getTokenStyleAttr(
  color?: string,
  fontStyle?: number,
  mode: TokenStyleMode = typeof document === 'undefined' ? 'inline' : 'class',
): string {
  if (mode === 'class')
    return getTokenClassAttr(color, fontStyle)
  return getTokenInlineStyleAttr(color, fontStyle)
}

function isDocumentRoot(node: Node): node is Document {
  return node.nodeType === 9
}

function isShadowRoot(node: Node): node is ShadowRoot {
  return node.nodeType === 11 && 'host' in node
}

function resolveStyleRoot(target?: Node | null): TokenStyleRoot | null {
  if (target === null)
    return null

  if (target !== undefined) {
    if (isDocumentRoot(target) || isShadowRoot(target))
      return target

    const root = typeof target.getRootNode === 'function'
      ? target.getRootNode()
      : null

    if (root && (isDocumentRoot(root) || isShadowRoot(root)))
      return root

    return target.ownerDocument ?? null
  }

  if (typeof document !== 'undefined')
    return document

  return null
}

export function canUseTokenStyleClasses(target?: Node | null): boolean {
  return resolveStyleRoot(target) != null
}

function getRootDocument(root: TokenStyleRoot): Document {
  return isDocumentRoot(root) ? root : root.ownerDocument
}

function appendStyleElement(root: TokenStyleRoot, styleElement: HTMLStyleElement): void {
  if (isDocumentRoot(root)) {
    const parent = root.head ?? root.documentElement
    parent.appendChild(styleElement)
    return
  }

  root.appendChild(styleElement)
}

function isNodeInDocument(root: Document, node: Node): boolean {
  if (typeof node.getRootNode === 'function')
    return node.getRootNode() === root

  const contains = (root as any).contains
  if (typeof contains === 'function')
    return contains.call(root, node)

  return (node as any).ownerDocument === root && (node as any).isConnected === true
}

function isStyleElementMounted(root: TokenStyleRoot, styleElement: HTMLStyleElement): boolean {
  if (styleElement.ownerDocument !== getRootDocument(root))
    return false
  if (isDocumentRoot(root))
    return isNodeInDocument(root, styleElement)
  return styleElement.parentNode === root
}

function getTokenStyleSheetText(): string {
  if (tokenStyleSheetTextGeneration !== tokenStyleGeneration) {
    tokenStyleSheetText = TOKEN_STYLE_RULES.join('\n')
    tokenStyleSheetTextGeneration = tokenStyleGeneration
  }

  return tokenStyleSheetText
}

export function ensureTokenStyleSheet(target?: Node | null): void {
  if (TOKEN_STYLE_RULES.length === 0)
    return

  const root = resolveStyleRoot(target)
  if (!root)
    return

  let state = TOKEN_STYLE_ROOTS.get(root)
  if (!state || !isStyleElementMounted(root, state.element)) {
    const styleElement = getRootDocument(root).createElement('style')
    styleElement.dataset.streamMarkdownTokenStyles = ''
    appendStyleElement(root, styleElement)
    state = {
      element: styleElement,
      generation: -1,
    }
    TOKEN_STYLE_ROOTS.set(root, state)
  }

  const sheetText = getTokenStyleSheetText()
  if (state.generation === tokenStyleGeneration && state.element.textContent === sheetText)
    return

  state.element.textContent = sheetText
  state.generation = tokenStyleGeneration
}
