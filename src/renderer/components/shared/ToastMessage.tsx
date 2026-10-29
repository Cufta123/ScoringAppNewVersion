import React from 'react';

interface ToastMessageProps {
  title: string;
  body?: string;
}

/**
 * What a toast shows: the title as a bold first line, the explanation under
 * it. The body keeps its own line breaks (`white-space: pre-line` in App.css)
 * so numbered steps stay on separate lines.
 */
export default function ToastMessage({ title, body = '' }: ToastMessageProps) {
  return (
    <div className="toast-message">
      <strong className="toast-title">{title}</strong>
      {body ? <div className="toast-text">{body}</div> : null}
    </div>
  );
}
