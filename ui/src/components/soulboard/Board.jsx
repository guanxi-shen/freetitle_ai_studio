import BoardItem from './BoardItem'

export default function Board({ items, onItemClick, onLike, onDislike, onNote, onSeen }) {
  if (items.length === 0) return null

  return (
    <div className="columns-2 sm:columns-3 md:columns-4 lg:columns-5 xl:columns-6 gap-2">
      {items.map((item, i) => (
        <BoardItem
          key={item.item_id}
          item={item}
          index={i}
          onClick={() => onItemClick(item)}
          onLike={() => onLike(item.item_id)}
          onDislike={() => onDislike(item.item_id)}
          onNote={() => onNote(item)}
          onSeen={onSeen}
        />
      ))}
    </div>
  )
}
