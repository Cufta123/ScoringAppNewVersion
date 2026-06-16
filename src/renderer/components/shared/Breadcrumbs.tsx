import React from 'react';

export interface BreadcrumbItem {
  label: string;
  onClick?: () => void;
}

interface BreadcrumbsProps {
  items: BreadcrumbItem[];
}

function Breadcrumbs({ items }: BreadcrumbsProps) {
  if (!Array.isArray(items) || items.length === 0) return null;

  return (
    <nav className="breadcrumbs" aria-label="Breadcrumb">
      {items.map((item, index) => {
        const isLast = index === items.length - 1;
        return (
          <span key={`crumb-${item.label}`} className="breadcrumbs-item">
            {item.onClick && !isLast ? (
              <button
                type="button"
                className="breadcrumbs-link"
                onClick={item.onClick}
              >
                {item.label}
              </button>
            ) : (
              <span aria-current={isLast ? 'page' : undefined}>
                {item.label}
              </span>
            )}
            {!isLast && <span className="breadcrumbs-separator">/</span>}
          </span>
        );
      })}
    </nav>
  );
}

export default Breadcrumbs;
