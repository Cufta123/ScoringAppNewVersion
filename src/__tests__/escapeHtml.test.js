import escapeHtml from '../renderer/utils/escapeHtml';

describe('escapeHtml', () => {
  it('escapes all HTML-significant characters', () => {
    expect(escapeHtml(`<b>&"'`)).toBe('&lt;b&gt;&amp;&quot;&#39;');
  });

  it('escapes a realistic name that would otherwise break the markup', () => {
    expect(escapeHtml('Tom & Jerry <Sailing> "Club"')).toBe(
      'Tom &amp; Jerry &lt;Sailing&gt; &quot;Club&quot;',
    );
  });

  it('coerces null/undefined/number to a safe string', () => {
    expect(escapeHtml(null)).toBe('');
    expect(escapeHtml(undefined)).toBe('');
    expect(escapeHtml(12345)).toBe('12345');
  });

  it('leaves ordinary text untouched', () => {
    expect(escapeHtml('Ana Horvat')).toBe('Ana Horvat');
  });
});
