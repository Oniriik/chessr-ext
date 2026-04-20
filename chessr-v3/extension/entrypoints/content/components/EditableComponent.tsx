import { forwardRef } from 'react';
import { useLayoutStore } from '../stores/layoutStore';
import './editable-component.css';

interface Props {
  id: string;
  children: React.ReactNode;
  dragHandleProps?: Record<string, any>;
  isDragging?: boolean;
}

const EditableComponent = forwardRef<HTMLDivElement, Props>(
  ({ id, children, dragHandleProps, isDragging }, ref) => {
    const editMode = useLayoutStore((s) => s.editMode);
    const pinned = useLayoutStore((s) => s.pinned);
    const togglePin = useLayoutStore((s) => s.togglePin);
    const isPinned = pinned.includes(id);

    if (!editMode) {
      return <div ref={ref}>{children}</div>;
    }

    return (
      <div
        ref={ref}
        className={`editable editable--edit ${isPinned ? 'editable--pinned' : ''} ${isDragging ? 'editable--dragging' : ''}`}
      >
        {dragHandleProps && <div className="editable-grip" title="Drag to reorder" {...dragHandleProps} />}
        <div className="editable-actions">
          <button
            className={`editable-btn ${isPinned ? 'editable-btn--pin-active' : ''}`}
            title={isPinned ? 'Unpin from page' : 'Pin to page'}
            onClick={() => togglePin(id)}
          >
            📌
          </button>
        </div>
        {children}
      </div>
    );
  }
);

EditableComponent.displayName = 'EditableComponent';
export default EditableComponent;
