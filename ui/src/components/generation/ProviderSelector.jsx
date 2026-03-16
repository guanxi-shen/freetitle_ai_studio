const PROVIDERS = [
  { value: 'nano_banana', label: 'Nano Banana' },
]

export default function ProviderSelector({ selected, onChange }) {
  function toggle(value) {
    const isActive = selected.includes(value)
    // Prevent deselecting the last provider
    if (isActive && selected.length <= 1) return
    const next = isActive
      ? selected.filter(v => v !== value)
      : [...selected, value]
    onChange(next)
  }

  return (
    <div className="inline-options multi-select">
      {PROVIDERS.map(p => (
        <div
          key={p.value}
          className={`inline-option ${selected.includes(p.value) ? 'active' : ''}`}
          onClick={() => toggle(p.value)}
        >
          {p.label}
        </div>
      ))}
    </div>
  )
}
