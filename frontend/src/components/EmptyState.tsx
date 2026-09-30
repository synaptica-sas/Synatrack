import type { ReactNode } from "react";

export function EmptyState({
  icon = "📋",
  title,
  description,
  action,
}: {
  icon?: string;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <div className="empty-state__icon" aria-hidden="true">{icon}</div>
      <p className="empty-state__title">{title}</p>
      {description && <p className="empty-state__text">{description}</p>}
      {action && <div className="empty-state__action">{action}</div>}
    </div>
  );
}
