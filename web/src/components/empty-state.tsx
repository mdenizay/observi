import { cn } from '@/lib/utils'

type Kind = 'monitors' | 'search' | 'users' | 'groups' | 'notifications'

// Pixel glyphs: '#' = ink cell, 'r' = state cell (red), '.' = empty cell.
const glyphs: Record<Kind, string[]> = {
  monitors: [
    '.............',
    '.......#.....',
    '......#.#....',
    '##...#...#...',
    '..#.#.....#.r',
    '...#.......#.',
    '.............',
  ],
  search: [
    '...###.......',
    '..#...#......',
    '..#...#......',
    '..#...#......',
    '...###.#.....',
    '........#....',
    '.........#...',
  ],
  users: [
    '..###...###..',
    '..###...###..',
    '.............',
    '.#####.#####.',
    '.#####.#####.',
    '.............',
    '.............',
  ],
  groups: [
    '.###.........',
    '.##########..',
    '.#........#..',
    '.#........#..',
    '.#........#..',
    '.##########..',
    '.............',
  ],
  notifications: [
    '......#......',
    '....#####....',
    '...#######...',
    '...#######...',
    '..#########..',
    '.............',
    '.....###.....',
  ],
}

function PixelGlyph({ kind }: { kind: Kind }) {
  const rows = glyphs[kind]
  const C = 6
  const G = 2
  const w = rows[0].length * (C + G) - G
  const h = rows.length * (C + G) - G
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden>
      {rows.flatMap((row, y) =>
        [...row].map((ch, x) => (
          <rect
            key={`${x}-${y}`}
            x={x * (C + G)}
            y={y * (C + G)}
            width={C}
            height={C}
            rx={1.5}
            fill={ch === '#' ? 'var(--cell-ink)' : ch === 'r' ? 'var(--down)' : 'var(--cell-empty)'}
          />
        )),
      )}
    </svg>
  )
}

export function EmptyState({
  kind,
  title,
  description,
  action,
  className,
}: {
  kind: Kind
  title: React.ReactNode
  description?: React.ReactNode
  action?: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn('dot-grid flex flex-col items-center gap-4 rounded-xl px-6 py-12 text-center', className)}>
      <PixelGlyph kind={kind} />
      <div className="grid max-w-sm gap-1">
        <p className="text-sm font-medium">{title}</p>
        {description && <p className="text-muted-foreground text-sm">{description}</p>}
      </div>
      {action}
    </div>
  )
}
