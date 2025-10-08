// Lightweight CSV helpers with basic quote handling

export function toCsv(headers: string[], rows: Array<Record<string, any>>): string {
  const esc = (v: any) => {
    const s = v == null ? '' : String(v)
    if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"'
    return s
  }
  const head = headers.join(',')
  const body = rows.map(r => headers.map(h => esc(r[h])).join(',')).join('\n')
  return head + (body ? '\n' + body : '') + '\n'
}

export function parseCsv(text: string): { headers: string[]; rows: string[][] } {
  const out: string[][] = []
  let row: string[] = []
  let cur = ''
  let inQuotes = false
  let i = 0
  const pushCell = () => { row.push(cur); cur = '' }
  const pushRow = () => { out.push(row); row = [] }
  while (i < text.length) {
    const ch = text[i]
    if (inQuotes) {
      if (ch === '"') {
        const next = text[i + 1]
        if (next === '"') { cur += '"'; i += 2; continue }
        inQuotes = false; i++; continue
      }
      cur += ch; i++; continue
    } else {
      if (ch === '"') { inQuotes = true; i++; continue }
      if (ch === ',') { pushCell(); i++; continue }
      if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i++
        pushCell(); pushRow(); i++; continue
      }
      cur += ch; i++; continue
    }
  }
  pushCell(); if (row.length > 1 || (row.length === 1 && row[0] !== '')) pushRow()
  const headers = out.shift() || []
  return { headers, rows: out }
}

