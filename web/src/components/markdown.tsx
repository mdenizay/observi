/**
 * Tiny, safe renderer for GitHub release notes. Builds React elements only (never raw
 * HTML), supports headings, bullet/numbered lists, **bold**, `code`, [text](url) and bare
 * http(s) links, and drops any HTML tags.
 */

const INLINE = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\(https?:\/\/[^)\s]+\)|https?:\/\/[^\s<>)\]]+)/g

function Link({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-foreground decoration-muted-foreground/50 hover:decoration-foreground [overflow-wrap:anywhere] underline underline-offset-2"
    >
      {children}
    </a>
  )
}

function inline(text: string): React.ReactNode[] {
  const out: React.ReactNode[] = []
  let last = 0
  let m: RegExpExecArray | null
  INLINE.lastIndex = 0
  while ((m = INLINE.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index))
    const tok = m[0]
    const key = out.length
    if (tok.startsWith('**')) out.push(<strong key={key} className="font-semibold">{tok.slice(2, -2)}</strong>)
    else if (tok.startsWith('`'))
      out.push(
        <code key={key} className="bg-muted rounded px-1 py-0.5 font-mono text-[12px] [overflow-wrap:anywhere]">
          {tok.slice(1, -1)}
        </code>,
      )
    else if (tok.startsWith('[')) {
      const lm = /^\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)$/.exec(tok)!
      out.push(<Link key={key} href={lm[2]}>{lm[1]}</Link>)
    } else out.push(<Link key={key} href={tok}>{tok}</Link>)
    last = m.index + tok.length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

type Block =
  | { t: 'h'; level: number; text: string }
  | { t: 'ul' | 'ol'; items: string[] }
  | { t: 'p'; lines: string[] }

function parse(src: string): Block[] {
  const clean = src.replace(/<!--[\s\S]*?-->/g, '').replace(/<\/?[a-zA-Z][^>]*>/g, '')
  const blocks: Block[] = []
  for (const raw of clean.split(/\r?\n/)) {
    const line = raw.replace(/\s+$/, '')
    let m: RegExpExecArray | null
    const last = blocks[blocks.length - 1]
    if (!line.trim()) {
      if (last?.t === 'p') blocks.push({ t: 'p', lines: [] }) // paragraph break
      continue
    }
    if ((m = /^\s{0,3}(#{1,6})\s+(.*)$/.exec(line))) blocks.push({ t: 'h', level: Math.min(3, m[1].length), text: m[2] })
    else if ((m = /^\s*[-*+]\s+(.*)$/.exec(line))) {
      if (last?.t === 'ul') last.items.push(m[1])
      else blocks.push({ t: 'ul', items: [m[1]] })
    } else if ((m = /^\s*\d+[.)]\s+(.*)$/.exec(line))) {
      if (last?.t === 'ol') last.items.push(m[1])
      else blocks.push({ t: 'ol', items: [m[1]] })
    } else if ((last?.t === 'ul' || last?.t === 'ol') && /^\s+\S/.test(line)) {
      last.items[last.items.length - 1] += ' ' + line.trim() // wrapped list item
    } else if (last?.t === 'p') last.lines.push(line.trim())
    else blocks.push({ t: 'p', lines: [line.trim()] })
  }
  return blocks.filter((b) => b.t !== 'p' || b.lines.length)
}

export function Markdown({ text, className }: { text: string; className?: string }) {
  const blocks = parse(text)
  return (
    <div className={className ?? 'grid gap-2.5 text-[13px] leading-relaxed [overflow-wrap:anywhere]'}>
      {blocks.map((b, i) => {
        if (b.t === 'h')
          return (
            <div key={i} className={b.level === 1 ? 'pt-1 text-sm font-semibold' : 'pt-1 text-[13px] font-semibold'}>
              {inline(b.text)}
            </div>
          )
        if (b.t === 'ul' || b.t === 'ol') {
          const L = b.t === 'ul' ? 'ul' : 'ol'
          return (
            <L key={i} className={b.t === 'ul' ? 'list-disc space-y-1 pl-5' : 'list-decimal space-y-1 pl-5'}>
              {b.items.map((it, j) => (
                <li key={j} className="marker:text-muted-foreground">
                  {inline(it)}
                </li>
              ))}
            </L>
          )
        }
        const para = b as Extract<Block, { t: 'p' }>
        return (
          <p key={i}>
            {inline(para.lines.join(' '))}
          </p>
        )
      })}
    </div>
  )
}
