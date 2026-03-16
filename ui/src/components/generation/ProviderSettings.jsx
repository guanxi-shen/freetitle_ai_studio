function InlineOptions({ value, options, onChange }) {
  return (
    <div className="inline-options">
      {options.map(opt => (
        <div
          key={opt.value}
          className={`inline-option ${value === opt.value ? 'active' : ''}`}
          onClick={() => onChange(opt.value)}
        >
          {opt.label}
        </div>
      ))}
    </div>
  )
}

function ImageSettings({ formState, onFormChange, selectedImageProviders }) {
  const hasNB = selectedImageProviders.includes('nano_banana')

  return (
    <>
      {hasNB && (
        <div className="method-specific-row">
          <div className="method-section">
            <div className="method-section-name nb">Nano Banana</div>
            <div className="form-group">
              <label>Image Size</label>
              <InlineOptions
                value={formState.nanoSize || '2K'}
                options={[
                  { value: '1K', label: '1K' },
                  { value: '2K', label: '2K' },
                  { value: '4K', label: '4K' },
                ]}
                onChange={v => onFormChange({ nanoSize: v })}
              />
            </div>
          </div>
        </div>
      )}
    </>
  )
}

function VeoSettings({ formState, onFormChange }) {
  return (
    <>
      <div className="form-group">
        <label>Resolution</label>
        <InlineOptions
          value={formState.veoSize || '1080p'}
          options={[
            { value: '720p', label: '720p' },
            { value: '1080p', label: '1080p' },
            { value: '4K', label: '4K' },
          ]}
          onChange={v => onFormChange({ veoSize: v })}
        />
      </div>
      <div className="form-group">
        <label>Aspect Ratio</label>
        <InlineOptions
          value={formState.veoRatio || '16:9'}
          options={[
            { value: '16:9', label: '16:9' },
            { value: '9:16', label: '9:16' },
          ]}
          onChange={v => onFormChange({ veoRatio: v })}
        />
      </div>
    </>
  )
}

export default function ProviderSettings({ provider, formState, onFormChange, selectedImageProviders }) {
  if (provider === 'veo') return <VeoSettings formState={formState} onFormChange={onFormChange} />
  return (
    <ImageSettings
      formState={formState}
      onFormChange={onFormChange}
      selectedImageProviders={selectedImageProviders || []}
    />
  )
}
