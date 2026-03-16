const WEB_STOPS = [0, 4, 8, 12, 16, 20, 24, 28, 32, 36]
export const WEB_DEFAULT = 3
const GEN_STOPS = [0, 3, 6, 9, 12, 15]
export const GEN_DEFAULT = 2

export const DEFAULT_PREFERENCES = {
  web_results: WEB_STOPS[WEB_DEFAULT],
  generations: GEN_STOPS[GEN_DEFAULT],
}

export default function GenerationSliders({ webIndex, genIndex, onWebChange, onGenChange, compact }) {
  return (
    <div className={`flex ${compact ? 'gap-4' : 'gap-6'} items-center`}>
      <Slider
        label="Web"
        stops={WEB_STOPS}
        value={webIndex}
        onChange={onWebChange}
        compact={compact}
      />
      <Slider
        label="Generate"
        stops={GEN_STOPS}
        value={genIndex}
        onChange={onGenChange}
        compact={compact}
      />
    </div>
  )
}

function Slider({ label, stops, value, onChange, compact }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className={`${compact ? 'text-[10px]' : 'text-xs'} text-text-muted w-14 text-right`}>{label}</span>
      <span className={`${compact ? 'text-[10px]' : 'text-xs'} text-text-muted/50`}>Less</span>
      <input
        type="range"
        min={0}
        max={stops.length - 1}
        step={1}
        value={value}
        onChange={e => onChange(parseInt(e.target.value))}
        className="w-16 h-1 accent-accent cursor-pointer"
      />
      <span className={`${compact ? 'text-[10px]' : 'text-xs'} text-text-muted/50`}>More</span>
    </div>
  )
}

export function indicesToPreferences(webIndex, genIndex) {
  return {
    web_results: WEB_STOPS[webIndex],
    generations: GEN_STOPS[genIndex],
  }
}

export function preferencesToIndices(prefs) {
  const findIdx = (stops, val, def) => {
    if (val == null) return def
    const idx = stops.indexOf(val)
    return idx >= 0 ? idx : def
  }
  return {
    webIndex: findIdx(WEB_STOPS, prefs?.web_results, WEB_DEFAULT),
    genIndex: findIdx(GEN_STOPS, prefs?.generations, GEN_DEFAULT),
  }
}
