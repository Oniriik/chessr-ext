import { useRef, useCallback, useEffect } from 'react';
import { DndContext, closestCenter, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy, useSortable, arrayMove } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useLayoutStore } from '../stores/layoutStore';
import { renderPinnedComponent } from './ComponentRegistry';
import './floating-widget.css';

function SortableWidgetItem({ id, children }: { id: string; children: React.ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style: React.CSSProperties = {
    transform: CSS.Translate.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
    position: 'relative',
    zIndex: isDragging ? 10 : undefined,
  };

  return (
    <div ref={setNodeRef} style={style}>
      <div
        {...attributes}
        {...listeners}
        style={{ width: 16, height: 3, background: 'rgba(168,85,247,0.4)', borderRadius: 2, margin: '0 auto 2px', cursor: 'grab' }}
      />
      {children}
    </div>
  );
}

export default function FloatingWidget() {
  const pinned = useLayoutStore((s) => s.pinned);
  const editMode = useLayoutStore((s) => s.editMode);
  const setEditMode = useLayoutStore((s) => s.setEditMode);
  const reorderPinned = useLayoutStore((s) => s.reorderPinned);
  const position = useLayoutStore((s) => s.widgetPosition);
  const setPosition = useLayoutStore((s) => s.setWidgetPosition);
  const containerRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const offset = useRef({ x: 0, y: 0 });

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    dragging.current = true;
    offset.current = {
      x: e.clientX - position.x,
      y: e.clientY - position.y,
    };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, [position]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragging.current || !containerRef.current) return;
    const x = Math.max(0, Math.min(window.innerWidth - 180, e.clientX - offset.current.x));
    const y = Math.max(0, Math.min(window.innerHeight - 60, e.clientY - offset.current.y));
    containerRef.current.style.left = `${x}px`;
    containerRef.current.style.top = `${y}px`;
  }, []);

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    if (!dragging.current) return;
    dragging.current = false;
    const x = Math.max(0, Math.min(window.innerWidth - 180, e.clientX - offset.current.x));
    const y = Math.max(0, Math.min(window.innerHeight - 60, e.clientY - offset.current.y));
    setPosition(x, y);
  }, [setPosition]);

  useEffect(() => {
    const onResize = () => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const x = Math.min(rect.left, window.innerWidth - rect.width);
      const y = Math.min(rect.top, window.innerHeight - rect.height);
      if (x !== rect.left || y !== rect.top) {
        setPosition(Math.max(0, x), Math.max(0, y));
      }
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [setPosition]);

  if (pinned.length === 0) return null;

  const renderable = pinned.filter((id) => renderPinnedComponent(id) !== null);
  if (renderable.length === 0) return null;

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      const oldIndex = pinned.indexOf(active.id as string);
      const newIndex = pinned.indexOf(over.id as string);
      reorderPinned(arrayMove(pinned, oldIndex, newIndex));
    }
  };

  const content = editMode ? (
    <DndContext collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={renderable} strategy={verticalListSortingStrategy}>
        {renderable.map((id, i) => (
          <SortableWidgetItem key={id} id={id}>
            {renderPinnedComponent(id)}
          </SortableWidgetItem>
        ))}
      </SortableContext>
    </DndContext>
  ) : (
    renderable.map((id) => (
      <div key={id}>
        {renderPinnedComponent(id)}
      </div>
    ))
  );

  return (
    <div
      ref={containerRef}
      className={`floating-widget ${editMode ? 'floating-widget--edit' : ''}`}
      style={{ left: position.x, top: position.y }}
    >
      <div
        className="floating-widget-drag"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      />
      <button
        className="floating-widget-edit"
        onClick={() => setEditMode(!editMode)}
        title={editMode ? 'Done editing' : 'Edit layout'}
      >
        {editMode ? (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        ) : (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
          </svg>
        )}
      </button>
      {content}
    </div>
  );
}
