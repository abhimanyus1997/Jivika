/* XML helpers: escaping, a safe parser, and the generic jivika.xml export. */

/** Escapes text and attribute values, and drops characters XML 1.0 does not allow. */
export const escapeXml = (s: string) =>
  // oxlint-disable-next-line no-control-regex -- strips characters XML 1.0 forbids
  s.replace(/[^\x09\x0A\x0D\x20-\uD7FF\uE000-\uFFFD\u{10000}-\u{10FFFF}]/gu, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')

/**
 * Parses XML with the browser's DOMParser. Documents with a DOCTYPE or entity declarations are rejected
 * before parsing, so no external or expanding entities are ever resolved.
 */
export function parseXmlSafe(text: string): Document {
  if (/<!DOCTYPE/i.test(text) || /<!ENTITY/i.test(text)) throw new Error('XML files with a DOCTYPE or entity declarations are not accepted.')
  if (typeof DOMParser === 'undefined') throw new Error('XML parsing is not available here.')
  const doc = new DOMParser().parseFromString(text, 'application/xml')
  if (doc.getElementsByTagName('parsererror').length) throw new Error('The file is not well-formed XML.')
  return doc
}

/** Child elements by local name (namespace prefixes ignored). */
export const kids = (el: Element | null | undefined, name?: string): Element[] =>
  el ? Array.from(el.children).filter((c) => !name || c.localName === name) : []
export const kid = (el: Element | null | undefined, name: string) => kids(el, name)[0] ?? null
/** Text of the element at a path of local names, trimmed; '' when missing. */
export const textAt = (el: Element | null | undefined, ...path: string[]): string => {
  let cur: Element | null | undefined = el
  for (const p of path) cur = kid(cur, p)
  return cur?.textContent?.trim() ?? ''
}

/* ---------- Generic export ---------- */

const NAME = /^[A-Za-z_][A-Za-z0-9_.-]*$/

/**
 * Element vocabulary (also in README.txt):
 *  - An object property becomes an element named after the key; keys that are not valid XML names use <field name="...">.
 *  - type="array" elements hold one <item> per entry; type="object" elements hold their properties.
 *  - type="number" | "boolean" | "null" mark non-string values. Strings have no type attribute.
 */
function node(name: string, v: unknown, depth: number): string {
  const ind = '  '.repeat(depth)
  const valid = NAME.test(name) && !/^xml/i.test(name)
  const open = valid ? name : 'field'
  const attr = valid ? '' : ` name="${escapeXml(name)}"`
  if (v === null || v === undefined) return `${ind}<${open}${attr} type="null"/>`
  if (Array.isArray(v)) {
    if (!v.length) return `${ind}<${open}${attr} type="array"/>`
    return `${ind}<${open}${attr} type="array">\n${v.map((x) => node('item', x, depth + 1)).join('\n')}\n${ind}</${open}>`
  }
  if (typeof v === 'object') {
    const entries = Object.entries(v as Record<string, unknown>)
    if (!entries.length) return `${ind}<${open}${attr} type="object"/>`
    return `${ind}<${open}${attr} type="object">\n${entries.map(([k, x]) => node(k, x, depth + 1)).join('\n')}\n${ind}</${open}>`
  }
  const type = typeof v === 'number' ? ' type="number"' : typeof v === 'boolean' ? ' type="boolean"' : ''
  return `${ind}<${open}${attr}${type}>${escapeXml(String(v))}</${open}>`
}

export function toGenericXml(file: { version: number; exportedAt: string; data: Record<string, unknown> }): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!-- Jivika data export. Each stored item is a child of <data>. Arrays: type="array" with <item> children. Objects: type="object".',
    '     Keys that are not valid XML names appear as <field name="key">. See README.txt in the bundle. -->',
    `<jivika version="${file.version}" exportedAt="${escapeXml(file.exportedAt)}">`,
    node('data', file.data, 1),
    '</jivika>',
    '',
  ].join('\n')
}
