/**
 * @jest-environment node
 */
import { isSameAppPage, isWebLink } from '../main/util';

describe('isSameAppPage', () => {
  const app = 'file:///C:/app/resources/app.asar/dist/renderer/index.html';

  it('allows a reload and the hash routes of the app page', () => {
    expect(isSameAppPage(app, app)).toBe(true);
    expect(isSameAppPage(`${app}#/event/Cup`, `${app}#/`)).toBe(true);
  });

  it('refuses a dropped file or any other page', () => {
    expect(isSameAppPage('file:///C:/Users/me/sailors.csv', app)).toBe(false);
    expect(isSameAppPage('https://example.com/', app)).toBe(false);
  });

  it('refuses everything while the current page is unknown', () => {
    expect(isSameAppPage(app, '')).toBe(false);
  });
});

describe('isWebLink', () => {
  it('accepts http and https links only', () => {
    expect(isWebLink('https://example.com/rules.pdf')).toBe(true);
    expect(isWebLink('http://example.com')).toBe(true);
    expect(isWebLink('file:///C:/Windows/System32/calc.exe')).toBe(false);
    expect(isWebLink('ms-settings:privacy')).toBe(false);
    expect(isWebLink('not a url')).toBe(false);
  });
});
