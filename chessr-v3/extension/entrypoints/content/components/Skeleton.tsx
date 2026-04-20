import './skeleton.css';

export default function Skeleton() {
  return (
    <div className="skeleton-panel">
      <div className="skeleton-header">
        <div className="skeleton-bone skeleton-avatar" />
        <div className="skeleton-bone skeleton-title" />
        <div className="skeleton-bone skeleton-badge" />
      </div>
      <div className="skeleton-body">
        <div className="skeleton-bone skeleton-line-full" />
        <div className="skeleton-bone skeleton-line-short" />
        <div className="skeleton-bone skeleton-block" />
        <div className="skeleton-bone skeleton-line-medium" />
        <div className="skeleton-bone skeleton-line-full" />
      </div>
    </div>
  );
}
