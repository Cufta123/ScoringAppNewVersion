// Escapes a value for safe interpolation into generated HTML export documents.
// Sailor/club/event names are free text and can contain &, <, >, " or ', which
// would otherwise corrupt the markup (or inject content) in the HTML exports.
const HTML_ESCAPES = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export default function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => HTML_ESCAPES[char]);
}
