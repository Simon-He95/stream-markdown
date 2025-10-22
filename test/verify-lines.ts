export interface VerifyResult {
  ok: boolean
  totalLines: number
  emptyLines: number
  totalDomLines: number
  emptyDomLines: number
}

/**
 * Verify that DOM .line elements structurally match the newline-split of code.
 * - Normalizes CRLF to LF
 * - Counts total and empty lines on both sides
 */
export function verifyCodeLinesStructure(
  container: HTMLElement | null | undefined,
  code: string,
  opts: { lineSelector?: string } = {},
): VerifyResult {
  const lineSelector = opts.lineSelector ?? 'code .line'
  const norm = code.replace(/\r\n/g, '\n')
  const codeLines = norm.split('\n')
  const emptyLines = codeLines.filter(s => s === '').length

  if (!container) {
    return {
      ok: false,
      totalLines: codeLines.length,
      emptyLines,
      totalDomLines: 0,
      emptyDomLines: 0,
    }
  }

  const lines = Array.from(container.querySelectorAll<HTMLElement>(lineSelector))
  const emptyDomLines = lines.filter(l => (l.textContent ?? '') === '').length

  const ok = lines.length === codeLines.length && emptyDomLines === emptyLines
  return {
    ok,
    totalLines: codeLines.length,
    emptyLines,
    totalDomLines: lines.length,
    emptyDomLines,
  }
}
