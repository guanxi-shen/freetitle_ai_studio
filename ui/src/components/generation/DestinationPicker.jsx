import { useEffect, useRef } from 'react'

export default function DestinationPicker({ scenes, onSelect, onClose }) {
  const ref = useRef(null)

  useEffect(() => {
    function handleClick(e) {
      if (ref.current && !ref.current.contains(e.target)) onClose()
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [onClose])

  return (
    <div className="destination-picker" ref={ref}>
      <button
        className="destination-item"
        onClick={() => onSelect({ type: 'supplementary' })}
      >
        Supplementary
      </button>
      <div className="destination-divider" />
      {(scenes || []).map((scene, si) => (
        <div key={scene.id} className="destination-scene">
          <div className="destination-scene-label">Scene {si + 1}</div>
          {(scene.shots || []).map((shot, shi) => (
            <button
              key={shot.id}
              className="destination-item destination-shot"
              onClick={() => onSelect({ type: 'shot', sceneId: scene.id, shotId: shot.id })}
            >
              Shot {shi + 1}
            </button>
          ))}
        </div>
      ))}
    </div>
  )
}
