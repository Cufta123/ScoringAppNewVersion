/** @jest-environment node */
import ExcelJS from 'exceljs';
import {
  DEFAULT_RESULTS_OPTIONS,
  buildResultsModel,
  type ResultsInput,
  type ResultsOptions,
} from '../renderer/exports/resultsModel';
import {
  buildResultsDocument,
  resolveResultsOrientation,
} from '../renderer/exports/resultsDocument';
import {
  buildResultsCsv,
  buildResultsMarkdown,
  buildResultsText,
} from '../renderer/exports/resultsText';
import buildResultsWorkbook from '../renderer/exports/resultsExcel';
import {
  DEFAULT_STARTING_LIST_OPTIONS,
  buildStartingListDocument,
  buildStartingListModel,
  buildStartingListWorkbook,
} from '../renderer/exports/startingList';
import {
  buildHeatsDocument,
  buildHeatsModel,
  buildHeatsWorkbook,
  latestRoundKey,
  listHeatRounds,
  type HeatForExport,
} from '../renderer/exports/heats';
import {
  defaultSignatureLabels,
  penaltyDescription,
} from '../renderer/exports/i18n';
import type {
  CommonDocumentOptions,
  DocumentContext,
} from '../renderer/exports/types';
import type { LeaderboardEntry } from '../renderer/types';
import { PENALTY_DESCRIPTIONS } from '../renderer/constants/penaltyLabels';

const common = (
  patch: Partial<CommonDocumentOptions> = {},
): CommonDocumentOptions => ({
  language: 'en',
  title: '',
  status: 'provisional',
  signatures: { enabled: false, labels: ['', ''] },
  ...patch,
});

const context = (patch: Partial<DocumentContext> = {}): DocumentContext => ({
  event: {
    name: 'Kup Kvarnera 2026',
    venue: 'Rijeka',
    startDate: '2026-06-01',
    endDate: '2026-06-03',
    boatClass: 'IOM',
    logo: null,
  },
  generatedAt: new Date(2026, 5, 2, 14, 5, 30),
  flags: {},
  target: 'screen',
  ...patch,
});

/** A boat with one cell per race: [text, status, points]. */
const entry = (
  boat_id: number,
  cells: Array<[string, string, string]>,
  extra: Partial<LeaderboardEntry> = {},
): LeaderboardEntry =>
  ({
    boat_id,
    name: `Sailor${boat_id}`,
    surname: 'Test',
    country: 'CRO',
    boat_number: 100 + boat_id,
    boat_type: 'IOM',
    place: boat_id,
    races: cells.map(([text]) => text),
    race_points: cells.map(([, , points]) => points),
    race_statuses: cells.map(([, status]) => status),
    race_ids: cells.map((_, i) => String(i + 1)),
    computed_total: 10 + boat_id,
    ...extra,
  }) as LeaderboardEntry;

const qualifyingInput = (rows: LeaderboardEntry[]): ResultsInput => ({
  finalSeriesStarted: false,
  leaderboard: [],
  eventLeaderboard: rows,
  discardProfiles: { qualifying: 'standard', final: 'standard' },
  clubs: {},
});

const finalInput = (): ResultsInput => ({
  finalSeriesStarted: true,
  eventLeaderboard: [
    entry(1, [
      ['1', 'FINISHED', '1'],
      ['(5)', 'DNF', '5'],
    ]),
    entry(2, [
      ['2', 'FINISHED', '2'],
      ['3', 'FINISHED', '3'],
    ]),
  ],
  leaderboard: [
    entry(1, [['1', 'FINISHED', '1']], {
      placement_group: 'Gold',
      overall_rank: 1,
      total_points_combined: 3,
      computed_total: 1,
    }),
    entry(2, [['4', 'ZFP', '4.4']], {
      placement_group: 'Silver',
      overall_rank: 2,
      total_points_combined: 9,
      computed_total: 4.4,
    }),
  ],
  discardProfiles: { qualifying: 'standard', final: 'standard' },
  clubs: { 1: 'JK Galeb' },
});

const model = (input: ResultsInput, options: Partial<ResultsOptions> = {}) =>
  buildResultsModel(input, { ...DEFAULT_RESULTS_OPTIONS, ...options });

describe('results HTML document', () => {
  const rows = [
    entry(1, [
      ['1', 'FINISHED', '1'],
      ['(DNF)', 'DNF', '9'],
    ]),
    entry(2, [
      ['ZFP', 'ZFP', '5.2'],
      ['3', 'FINISHED', '3'],
    ]),
  ];

  it('has the header fields: event, venue, dates, class, title, status, as-of', () => {
    const { html } = buildResultsDocument(
      model(qualifyingInput(rows)),
      common(),
      context(),
      'auto',
    );
    expect(html).toContain('Kup Kvarnera 2026');
    expect(html).toContain('Rijeka');
    expect(html).toContain('01.06.2026 – 03.06.2026');
    expect(html).toContain('Class IOM');
    expect(html).toContain('Qualifying Series Results');
    expect(html).toContain('>Provisional<');
    expect(html).toContain('Results as of 02.06.2026 14:05');
  });

  it('escapes user text everywhere (a <script> name never becomes markup)', () => {
    const evil = entry(1, [['1', 'FINISHED', '1']], {
      name: '<script>alert(1)</script>',
      surname: '"><img src=x>',
      country: '<b>',
    });
    const built = buildResultsDocument(
      model(qualifyingInput([evil])),
      common({ title: '<script>title</script>' }),
      context({
        event: {
          ...context().event,
          name: '<script>event</script>',
          venue: 'A & B <i>',
        },
      }),
      'auto',
    );
    expect(built.html).not.toMatch(/<script/i);
    expect(built.html).not.toContain('<img src=x>');
    expect(built.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(built.html).toContain('A &amp; B &lt;i&gt;');
  });

  it('an event name cannot break out of the page footer CSS either', () => {
    const { html } = buildResultsDocument(
      model(qualifyingInput([])),
      common(),
      context({
        event: { ...context().event, name: '</style><script>x</script>' },
      }),
      'auto',
    );
    expect(html).not.toMatch(/<script/i);
    expect((html.match(/<\/style>/g) ?? []).length).toBe(1);
  });

  it('is self-contained: no external fonts, scripts or links', () => {
    const { html } = buildResultsDocument(
      model(qualifyingInput(rows)),
      common(),
      context(),
      'auto',
    );
    expect(html).not.toMatch(/<script|<link|@import|https?:\/\//i);
    expect(html).toContain('thead { display: table-header-group; }');
    expect(html).toContain('break-inside: avoid');
    expect(html).toMatch(/@page \{ size: A4 (landscape|portrait)/);
  });

  it('page numbers: CSS margin boxes on screen/print, none for the PDF (Electron adds its own)', () => {
    const screen = buildResultsDocument(
      model(qualifyingInput(rows)),
      common(),
      context(),
      'auto',
    );
    const pdf = buildResultsDocument(
      model(qualifyingInput(rows)),
      common(),
      context({ target: 'pdf' }),
      'auto',
    );
    expect(screen.html).toContain('counter(page)');
    expect(pdf.html).not.toContain('counter(page)');
    expect(pdf.footer).toEqual({
      left: 'Kup Kvarnera 2026',
      center: 'Generated by IOM Regatta Manager',
      page: 'Page',
      of: 'of',
    });
  });

  it('switches every word with the language', () => {
    const en = buildResultsDocument(
      model(qualifyingInput(rows)),
      common(),
      context(),
      'auto',
    ).html;
    const hr = buildResultsDocument(
      model(qualifyingInput(rows)),
      common({
        language: 'hr',
        signatures: { enabled: true, labels: ['', ''] },
      }),
      context(),
      'auto',
    ).html;
    expect(en).toContain('Qualifying Series Results');
    expect(en).toContain('Did not finish');
    expect(hr).toContain('Rezultati kvalifikacijske serije');
    expect(hr).toContain('Nije završio');
    expect(hr).toContain('>Privremeno<');
    expect(hr).toContain('Rezultati na dan');
    expect(hr).toContain('Voditelj regate');
    expect(hr).toContain('Predsjednik žirija');
    expect(hr).toContain('lang="hr"');
    // The codes themselves are never translated.
    expect(hr).toContain('>DNF<');
    expect(hr).not.toContain('Qualifying Series Results');
  });

  it('prints Croatian diacritics as they are', () => {
    const built = buildResultsDocument(
      model(
        qualifyingInput([
          entry(1, [['1', 'FINISHED', '1']], {
            name: 'Đuro',
            surname: 'Šarić-Žuvić',
          }),
        ]),
      ),
      common(),
      context(),
      'auto',
    );
    expect(built.html).toContain('Đuro Šarić-Žuvić');
  });

  it('the legend lists only the codes present, and only when switched on', () => {
    const withLegend = buildResultsDocument(
      model(qualifyingInput(rows)),
      common(),
      context(),
      'auto',
    ).html;
    expect(withLegend).toContain('class="code penalty">DNF<');
    expect(withLegend).toContain('class="code penalty">ZFP<');
    expect(withLegend).not.toContain('>OCS<');
    expect(withLegend).not.toContain('>DSQ<');
    expect(withLegend).toContain('Did not finish');

    const without = buildResultsDocument(
      model(qualifyingInput(rows), { legend: false }),
      common(),
      context(),
      'auto',
    ).html;
    expect(without).not.toContain('class="legend"');
  });

  it('shows penalty points next to the code only when asked', () => {
    const on = buildResultsModel(
      qualifyingInput(rows),
      DEFAULT_RESULTS_OPTIONS,
    );
    const off = model(qualifyingInput(rows), { showPenaltyPoints: false });
    const texts = (m: ReturnType<typeof model>) =>
      m.sections[0].rows.flatMap((row) => row.cells.map((cell) => cell.text));
    expect(texts(on)).toContain('ZFP 5.2');
    expect(texts(off)).toContain('ZFP');
    expect(texts(off)).not.toContain('ZFP 5.2');
  });

  it('keeps discards in brackets, or leaves the brackets off', () => {
    const rowsWithDiscard = [
      entry(1, [
        ['(7)', 'FINISHED', '7'],
        ['2', 'FINISHED', '2'],
      ]),
    ];
    const bracketed = model(qualifyingInput(rowsWithDiscard));
    const plain = model(qualifyingInput(rowsWithDiscard), {
      showDiscards: false,
    });
    expect(bracketed.sections[0].rows[0].cells[0].text).toBe('(7)');
    expect(plain.sections[0].rows[0].cells[0].text).toBe('7');
    expect(plain.sections[0].rows[0].cells[0].discarded).toBe(true);
    // The "(n) discarded score" legend line needs the brackets.
    const html = (m: typeof bracketed) =>
      buildResultsDocument(m, common(), context(), 'auto').html;
    expect(html(bracketed)).toContain('discarded score');
    expect(html(plain)).not.toContain('discarded score');
  });

  it('respects the column options', () => {
    const bare = model(qualifyingInput(rows), {
      columns: {
        country: false,
        club: false,
        total: false,
        net: true,
        races: false,
      },
    });
    const { html } = buildResultsDocument(bare, common(), context(), 'auto');
    expect(html).not.toContain('>Country<');
    expect(html).not.toContain('>Total<');
    expect(html).not.toContain('>Q1<');
    expect(html).toContain('>Net<');
  });

  it('shows the Club column only when asked and at least one boat has a club', () => {
    const input = { ...qualifyingInput(rows), clubs: { 1: 'JK Galeb' } };
    const asked = model(input, {
      columns: { ...DEFAULT_RESULTS_OPTIONS.columns, club: true },
    });
    expect(asked.showClub).toBe(true);
    expect(
      buildResultsDocument(asked, common(), context(), 'auto').html,
    ).toContain('JK Galeb');
    const noClubs = model(qualifyingInput(rows), {
      columns: { ...DEFAULT_RESULTS_OPTIONS.columns, club: true },
    });
    expect(noClubs.showClub).toBe(false);
  });

  it('the Type column appears only when the boats are not all one model', () => {
    expect(model(qualifyingInput(rows)).showType).toBe(false);
    const mixed = [
      rows[0],
      entry(2, [['2', 'FINISHED', '2']], { boat_type: 'Marblehead' }),
    ];
    expect(model(qualifyingInput(mixed)).showType).toBe(true);
  });

  it('draws flags once per country and falls back to the code alone', () => {
    const svg = 'data:image/svg+xml,%3csvg%3e';
    const built = buildResultsDocument(
      model(
        qualifyingInput([
          rows[0],
          entry(2, [['2', 'FINISHED', '2']], { country: 'ZZZ' }),
        ]),
      ),
      common(),
      context({ flags: { CRO: svg } }),
      'auto',
    ).html;
    expect(built).toContain(
      '.flag-CRO{background-image:url("data:image/svg+xml,%3csvg%3e")}',
    );
    expect(built).toContain('class="flag flag-CRO"');
    expect(built).not.toContain('flag-ZZZ');
    expect(built).toContain('>ZZZ<');
  });

  it('missing country and long names render sensibly', () => {
    const built = buildResultsDocument(
      model(
        qualifyingInput([
          entry(1, [['1', 'FINISHED', '1']], {
            country: '',
            surname: 'X'.repeat(200),
          }),
        ]),
      ),
      common(),
      context(),
      'auto',
    ).html;
    expect(built).toContain('<span class="missing">–</span>');
    expect(built).toContain('table-layout: fixed');
    // Names wrap; nothing in a printed document is cut with an ellipsis.
    expect(built).not.toContain('text-overflow');
    expect(built).toContain('overflow-wrap: anywhere');
  });

  it('says so when there is nothing to show', () => {
    const empty = buildResultsDocument(
      model(qualifyingInput([])),
      common(),
      context(),
      'auto',
    ).html;
    expect(empty).toContain('No results to show.');
    const noRaces = buildResultsDocument(
      model(qualifyingInput([entry(1, [])])),
      common(),
      context(),
      'auto',
    ).html;
    expect(noRaces).toContain('Sailor1 Test');
  });

  it('chooses landscape for many races and honours an explicit orientation', () => {
    const wide = model(
      qualifyingInput([
        entry(
          1,
          Array.from(
            { length: 12 },
            (_, i) =>
              [String(i + 1), 'FINISHED', String(i + 1)] as [
                string,
                string,
                string,
              ],
          ),
        ),
      ]),
    );
    const narrow = model(qualifyingInput(rows));
    expect(resolveResultsOrientation('auto', wide)).toBe('landscape');
    expect(resolveResultsOrientation('auto', narrow)).toBe('portrait');
    expect(resolveResultsOrientation('portrait', wide)).toBe('portrait');
  });

  it('prints signature lines with editable labels', () => {
    const { html } = buildResultsDocument(
      model(qualifyingInput(rows)),
      common({ signatures: { enabled: true, labels: ['Chief Umpire', ''] } }),
      context(),
      'auto',
    );
    expect(html).toContain('Chief Umpire');
    expect(html).toContain(defaultSignatureLabels('en')[1]);
    expect(
      buildResultsDocument(
        model(qualifyingInput(rows)),
        common(),
        context(),
        'auto',
      ).html,
    ).not.toContain('class="signatures"');
  });

  it('the status badge differs per status', () => {
    const badge = (status: CommonDocumentOptions['status']) =>
      buildResultsDocument(
        model(qualifyingInput(rows)),
        common({ status }),
        context(),
        'auto',
      ).html;
    expect(badge('provisional')).toContain('badge-provisional');
    expect(badge('official')).toContain('badge-official');
    expect(badge('final')).toContain('badge-final');
    expect(badge(null)).not.toContain('class="badge');
  });

  it('shows the logo when there is one and nothing when there is not', () => {
    const logo = 'data:image/png;base64,iVBORw0KGgo=';
    const withLogo = buildResultsDocument(
      model(qualifyingInput(rows)),
      common(),
      context({ event: { ...context().event, logo } }),
      'auto',
    ).html;
    expect(withLogo).toContain(`<img class="doc-logo" src="${logo}"`);
    // Anything that is not a PNG/JPEG data URL is never put into the page.
    const hostile = buildResultsDocument(
      model(qualifyingInput(rows)),
      common(),
      context({
        event: { ...context().event, logo: `${'javascript'}:alert(1)` },
      }),
      'auto',
    ).html;
    expect(hostile).not.toContain('doc-logo" src');
    expect(
      buildResultsDocument(
        model(qualifyingInput(rows)),
        common(),
        context(),
        'auto',
      ).html,
    ).not.toContain('<img class="doc-logo"');
  });

  it('copes with 80 boats and 16 races', () => {
    const many = Array.from({ length: 80 }, (_, i) =>
      entry(
        i + 1,
        Array.from(
          { length: 16 },
          (_x, r) =>
            [
              String(((i + r) % 80) + 1),
              'FINISHED',
              String(((i + r) % 80) + 1),
            ] as [string, string, string],
        ),
      ),
    );
    const built = buildResultsDocument(
      model(qualifyingInput(many)),
      common(),
      context(),
      'auto',
    );
    expect(built.orientation).toBe('landscape');
    expect((built.html.match(/<tr>/g) ?? []).length).toBeGreaterThanOrEqual(80);
  });
});

describe('results: series, fleets and the race summary', () => {
  it('the final view groups by fleet with overall rank and combined net', () => {
    const m = model(finalInput());
    expect(m.sections.map((s) => s.fleet)).toEqual(['Gold', 'Silver']);
    expect(m.raceHeaders).toEqual(['Q1', 'Q2', 'F1']);
    expect(m.sections[1].rows[0]).toMatchObject({
      rank: 2,
      net: 9,
      total: 9.4,
    });
  });

  it('can show the qualifying series, or the final series, on its own', () => {
    const q = model(finalInput(), { series: 'qualifying' });
    expect(q.sections).toHaveLength(1);
    expect(q.raceHeaders).toEqual(['Q1', 'Q2']);
    const f = model(finalInput(), { series: 'final' });
    expect(f.raceHeaders).toEqual(['F1']);
    expect(f.rankInFleet).toBe(true);
    expect(f.sections[0].rows[0].net).toBe(1);
  });

  it('without a final series there is only the qualifying view, whatever was asked', () => {
    const m = model(qualifyingInput([entry(1, [['1', 'FINISHED', '1']])]), {
      series: 'both',
    });
    expect(m.series).toBe('qualifying');
  });

  it('fleets can be left out', () => {
    const m = model(finalInput(), { fleets: ['Silver'] });
    expect(m.sections.map((s) => s.fleet)).toEqual(['Silver']);
  });

  it('puts the race count and discards from the standings in the summary, never a guess', () => {
    const ten = Array.from(
      { length: 10 },
      (_, i) =>
        [String(i + 1), 'FINISHED', String(i + 1)] as [string, string, string],
    );
    const { html } = buildResultsDocument(
      model(qualifyingInput([entry(1, ten)])),
      common(),
      context(),
      'auto',
    );
    expect(html).toContain('10 races sailed, 2 discards');
    const one = buildResultsDocument(
      model(qualifyingInput([entry(1, [['1', 'FINISHED', '1']])])),
      common(),
      context(),
      'auto',
    ).html;
    expect(one).toContain('1 race sailed, no discards');
    const hr = buildResultsDocument(
      model(qualifyingInput([entry(1, ten)])),
      common({ language: 'hr' }),
      context(),
      'auto',
    ).html;
    expect(hr).toContain('Odjedreno 10 utrka, 2 odbačena rezultata');
    const off = buildResultsDocument(
      model(qualifyingInput([entry(1, ten)]), { raceSummary: false }),
      common(),
      context(),
      'auto',
    ).html;
    expect(off).not.toContain('races sailed');
    const none = buildResultsDocument(
      model(qualifyingInput([entry(1, [])])),
      common(),
      context(),
      'auto',
    ).html;
    expect(none).not.toContain('sailed');
  });

  it('Start each fleet on a new page marks the second fleet only', () => {
    const { html } = buildResultsDocument(
      model(finalInput(), { fleetPerPage: true }),
      common(),
      context(),
      'auto',
    );
    expect((html.match(/<section class="fleet new-page">/g) ?? []).length).toBe(
      1,
    );
  });
});

describe('results text formats', () => {
  const m = model(finalInput());
  const options = common({ signatures: { enabled: true, labels: ['', ''] } });

  it('TXT and Markdown carry the header block and the legend as text', () => {
    const txt = buildResultsText(m, options, context());
    const md = buildResultsMarkdown(m, options, context());
    [txt, md].forEach((text) => {
      expect(text).toContain('Kup Kvarnera 2026');
      expect(text).toContain('Rijeka | 01.06.2026 – 03.06.2026 | Class IOM');
      expect(text).toContain('Overall Results');
      expect(text.toUpperCase()).toContain('PROVISIONAL');
      expect(text).toContain('Results as of 02.06.2026 14:05');
      expect(text).toContain('Gold Fleet');
      expect(text).toContain('Did not finish');
      expect(text).toContain('20% penalty');
      expect(text).toContain('Race Officer');
    });
    expect(md).toContain('| Rank | Name |');
    expect(md).toContain('### Gold Fleet');
  });

  it('Markdown escapes a pipe in a name', () => {
    const piped = model(
      qualifyingInput([entry(1, [['1', 'FINISHED', '1']], { name: 'A|B' })]),
    );
    expect(buildResultsMarkdown(piped, common(), context())).toContain('A\\|B');
  });

  it('Croatian text uses Croatian words', () => {
    const hr = buildResultsText(m, common({ language: 'hr' }), context());
    expect(hr).toContain('Ukupni rezultati');
    expect(hr).toContain('Rezultati na dan');
    expect(hr).toContain('Gold flota');
  });

  it('CSV is a clean table: one header row, fleet as a column, no decoration', () => {
    const csv = buildResultsCsv(m, 'en');
    const lines = csv.trim().split('\n');
    expect(lines).toHaveLength(3); // header + 2 boats
    expect(lines[0]).toBe('Rank,Name,Country,Sail #,Fleet,Total,Net,Q1,Q2,F1');
    expect(lines[1].startsWith('1,Sailor1 Test,CRO,101,Gold,')).toBe(true);
    expect(lines[2]).toContain(',Silver,');
    expect(csv).not.toMatch(/===|---|Results as of|Provisional/i);
    // every line has the same number of cells
    const widths = new Set(lines.map((line) => line.split(',').length));
    expect(widths.size).toBe(1);
  });

  it('CSV of a qualifying-only sheet has no Fleet column, and leaves missing values empty', () => {
    const csv = buildResultsCsv(
      model(
        qualifyingInput([
          entry(1, [['1', 'FINISHED', '1']], {
            country: '',
            computed_total: null,
          }),
        ]),
      ),
      'en',
    );
    const [header, row] = csv.trim().split('\n');
    expect(header).toBe('Rank,Name,Country,Sail #,Total,Net,Q1');
    expect(row).toBe('1,Sailor1 Test,,101,1,,1');
  });

  it('CSV neutralises formula injection and quotes commas', () => {
    const csv = buildResultsCsv(
      model(
        qualifyingInput([
          entry(1, [['1', 'FINISHED', '1']], {
            name: '=HYPERLINK("x")',
            surname: 'A, B',
          }),
        ]),
      ),
      'en',
    );
    expect(csv).toContain(`"'=HYPERLINK(""x"") A, B"`);
  });
});

describe('results Excel workbook', () => {
  const read = async (bytes: Uint8Array) => {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(bytes as unknown as ArrayBuffer);
    return workbook;
  };
  const png =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

  it('has the title block, a styled header, fleet bands and numeric results', async () => {
    const bytes = await buildResultsWorkbook(
      model(finalInput()),
      common({ signatures: { enabled: true, labels: ['', ''] } }),
      context({ event: { ...context().event, logo: png } }),
      'auto',
    );
    const sheet = (await read(bytes)).worksheets[0];
    const values: string[] = [];
    sheet.eachRow((row) =>
      row.eachCell((cell) => values.push(String(cell.value))),
    );
    expect(values).toContain('Kup Kvarnera 2026');
    expect(values).toContain('Overall Results');
    expect(values).toContain('PROVISIONAL');
    expect(
      values.some((v) => v.startsWith('Results as of 02.06.2026 14:05')),
    ).toBe(true);
    expect(values).toContain('Gold Fleet');
    expect(values).toContain('Silver Fleet');
    expect(values).toContain('Race Officer');
    expect(values).toContain('Qualifying');
    // The header row is bold white on navy, frozen, repeated when printed.
    const header = sheet.getRow(
      [...Array(40).keys()]
        .map((i) => i + 1)
        .find((r) => sheet.getRow(r).getCell(1).value === 'Rank') as number,
    );
    expect(header.getCell(1).font?.bold).toBe(true);
    expect(header.getCell(1).fill).toMatchObject({
      fgColor: { argb: 'FF14233F' },
    });
    expect(sheet.views[0]).toMatchObject({ state: 'frozen', xSplit: 2 });
    expect(sheet.pageSetup).toMatchObject({
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      paperSize: 9,
    });
    expect(sheet.pageSetup.printTitlesRow).toMatch(/^\d+:\d+$/);
    expect(sheet.headerFooter.oddFooter).toContain('&P');
    // The logo is in the workbook.
    expect(sheet.getImages()).toHaveLength(1);
    // Fleet colour of the Gold band follows FLEET_COLORS.
    const goldRow = sheet.getRow(
      [...Array(40).keys()]
        .map((i) => i + 1)
        .find(
          (r) => sheet.getRow(r).getCell(1).value === 'Gold Fleet',
        ) as number,
    );
    expect(goldRow.getCell(1).fill).toMatchObject({
      fgColor: { argb: 'FF8A6800' },
    });
  });

  it('keeps places as numbers and codes as text, discards in brackets', async () => {
    const bytes = await buildResultsWorkbook(
      model(
        qualifyingInput([
          entry(1, [
            ['1', 'FINISHED', '1'],
            ['(DNF)', 'DNF', '9'],
          ]),
        ]),
      ),
      common(),
      context(),
      'auto',
    );
    const sheet = (await read(bytes)).worksheets[0];
    let q1: unknown;
    let q2: unknown;
    sheet.eachRow((row) => {
      if (row.getCell(1).value === 1) {
        const last = row.cellCount;
        q1 = row.getCell(last - 1).value;
        q2 = row.getCell(last).value;
      }
    });
    expect(q1).toBe(1);
    expect(q2).toBe('(DNF 9)');
  });

  it('works without a logo and with no boats', async () => {
    const bytes = await buildResultsWorkbook(
      model(qualifyingInput([])),
      common(),
      context(),
      'auto',
    );
    const sheet = (await read(bytes)).worksheets[0];
    expect(sheet.getImages()).toHaveLength(0);
  });
});

describe('starting list', () => {
  const boats = [
    {
      name: 'Ana',
      surname: 'Žuvić',
      boat_country: 'CRO',
      club_name: 'JK Galeb',
      sail_number: 12,
      model: 'IOM',
      category_name: 'SENIOR',
    },
    {
      name: 'Bob',
      surname: 'Adams',
      boat_country: 'GBR',
      club_name: '',
      sail_number: 7,
      model: 'IOM',
      category_name: 'VETERAN',
    },
    {
      name: 'Cem',
      surname: 'Čorić',
      boat_country: 'CRO',
      club_name: 'JK Opatija',
      sail_number: 3,
      model: 'IOM',
      category_name: 'JUNIOR',
    },
  ];

  it('sorts by sail number, country or surname', () => {
    const order = (sort: 'sail' | 'country' | 'surname') =>
      buildStartingListModel(boats, {
        ...DEFAULT_STARTING_LIST_OPTIONS,
        sort,
      }).sections[0].rows.map((r) => r.surname);
    expect(order('sail')).toEqual(['Čorić', 'Adams', 'Žuvić']);
    expect(order('country')).toEqual(['Čorić', 'Žuvić', 'Adams']);
    expect(order('surname')).toEqual(['Adams', 'Čorić', 'Žuvić']);
  });

  it('groups by country with entry counts and a total line', () => {
    const grouped = buildStartingListModel(boats, {
      ...DEFAULT_STARTING_LIST_OPTIONS,
      groupByCountry: true,
    });
    expect(grouped.sections.map((s) => [s.country, s.rows.length])).toEqual([
      ['CRO', 2],
      ['GBR', 1],
    ]);
    const { html } = buildStartingListDocument(
      grouped,
      common(),
      context(),
      'auto',
    );
    expect(html).toContain('2 entries');
    expect(html).toContain('1 entry');
    expect(html).toContain('Total entries: 3 · 2 nations');
    expect(html).toContain('Starting List');
    expect(html).toContain('>Provisional<');
    const hr = buildStartingListDocument(
      grouped,
      common({ language: 'hr' }),
      context(),
      'auto',
    ).html;
    expect(hr).toContain('Startna lista');
    expect(hr).toContain('2 prijave');
    expect(hr).toContain('Ukupno prijava: 3');
  });

  it('respects the column options and the total line option', () => {
    const lean = buildStartingListModel(boats, {
      ...DEFAULT_STARTING_LIST_OPTIONS,
      columns: { club: false, subgroup: false, boatModel: false },
      totalEntries: false,
    });
    const { html } = buildStartingListDocument(
      lean,
      common(),
      context(),
      'auto',
    );
    expect(html).not.toContain('>Club<');
    expect(html).not.toContain('>Subgroup<');
    expect(html).not.toContain('>Boat model<');
    expect(html).not.toContain('Total entries');
  });

  it('escapes names, leaves missing values as a dash, and survives no entries', () => {
    const evil = buildStartingListModel(
      [
        {
          name: '<script>x</script>',
          surname: '',
          boat_country: '',
          sail_number: null,
        },
      ],
      DEFAULT_STARTING_LIST_OPTIONS,
    );
    const { html } = buildStartingListDocument(
      evil,
      common(),
      context(),
      'auto',
    );
    expect(html).not.toMatch(/<script/i);
    expect(html).toContain('<span class="missing">–</span>');
    const empty = buildStartingListDocument(
      buildStartingListModel([], DEFAULT_STARTING_LIST_OPTIONS),
      common(),
      context(),
      'auto',
    ).html;
    expect(empty).toContain('No entries to show.');
  });

  it('writes a workbook with a country band per group', async () => {
    const grouped = buildStartingListModel(boats, {
      ...DEFAULT_STARTING_LIST_OPTIONS,
      groupByCountry: true,
    });
    const bytes = await buildStartingListWorkbook(
      grouped,
      common(),
      context(),
      'auto',
    );
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(bytes as unknown as ArrayBuffer);
    const values: unknown[] = [];
    workbook.worksheets[0].eachRow((row) =>
      row.eachCell((cell) => values.push(cell.value)),
    );
    expect(values).toContain('CRO  —  2 entries');
    expect(values).toContain('Ana Žuvić');
    expect(values).toContain(12); // sail numbers stay numeric
  });
});

describe('heat lists and scoring sheets', () => {
  const boat = (sail: number, country = 'CRO') => ({
    name: `S${sail}`,
    surname: 'X',
    country,
    sail_number: sail,
    model: 'IOM',
    category_name: 'SENIOR',
  });
  const heats: HeatForExport[] = [
    {
      heat_id: 1,
      heat_name: 'Heat A1',
      heat_type: 'Qualifying',
      raceNumber: 1,
      boats: [boat(5), boat(2)],
    },
    {
      heat_id: 2,
      heat_name: 'Heat A2',
      heat_type: 'Qualifying',
      raceNumber: 1,
      boats: [boat(7)],
    },
    {
      heat_id: 3,
      heat_name: 'Heat B2',
      heat_type: 'Qualifying',
      raceNumber: 0,
      boats: [boat(9, 'ITA')],
    },
    {
      heat_id: 4,
      heat_name: 'Final Silver',
      heat_type: 'Final',
      raceNumber: 1,
      boats: [boat(11)],
    },
    {
      heat_id: 5,
      heat_name: 'Final Gold',
      heat_type: 'Final',
      raceNumber: 1,
      boats: [boat(10)],
    },
  ];

  it('lists the rounds, the Final Series last, and defaults to the latest', () => {
    expect(listHeatRounds(heats).map((r) => [r.key, r.heatCount])).toEqual([
      ['1', 1],
      ['2', 2],
      ['final', 2],
    ]);
    expect(latestRoundKey(heats)).toBe('final');
    expect(latestRoundKey(heats.slice(0, 3))).toBe('2');
    expect(latestRoundKey([])).toBe('');
  });

  it('builds the chosen round only, boats by sail number, final fleets in fleet order', () => {
    const round = buildHeatsModel(heats, {
      round: '2',
      onePerPage: false,
      scoringSheets: false,
    });
    expect(round.heats.map((h) => h.name)).toEqual(['Heat A2', 'Heat B2']);
    expect(round.heats[0].race).toBe('Q2');
    const final = buildHeatsModel(heats, {
      round: 'final',
      onePerPage: false,
      scoringSheets: false,
    });
    expect(final.heats.map((h) => h.name)).toEqual([
      'Final Gold',
      'Final Silver',
    ]);
    expect(final.heats[0].race).toBe('F2');
    const first = buildHeatsModel(heats, {
      round: '1',
      onePerPage: false,
      scoringSheets: false,
    });
    expect(first.heats[0].rows.map((r) => r.sail)).toEqual(['2', '5']);
  });

  it('heat list HTML: no Place/Notes, all heats flow, title names the round; HR switches words', () => {
    const m = buildHeatsModel(heats, {
      round: '2',
      onePerPage: false,
      scoringSheets: false,
    });
    const { html } = buildHeatsDocument(
      m,
      common({ status: 'official' }),
      context(),
      'auto',
    );
    expect(html).toContain('Heat Lists – Round 2');
    expect(html).toContain('Heat A2');
    expect(html).not.toContain('>Place<');
    expect(html).not.toContain('<section class="heat new-page">');
    expect(html).not.toContain('class="badge'); // heats carry no status
    const hr = buildHeatsDocument(
      m,
      common({ language: 'hr' }),
      context(),
      'auto',
    ).html;
    expect(hr).toContain('Popisi heatova – Kolo 2');
  });

  it('one heat per page puts every heat but the first on a new page', () => {
    const m = buildHeatsModel(heats, {
      round: '2',
      onePerPage: true,
      scoringSheets: false,
    });
    const { html } = buildHeatsDocument(m, common(), context(), 'auto');
    expect((html.match(/<section class="heat new-page">/g) ?? []).length).toBe(
      1,
    );
  });

  it('scoring sheets: one heat per page, blank Place and Notes columns, race to sail, scorer line', () => {
    const m = buildHeatsModel(heats, {
      round: '2',
      onePerPage: false,
      scoringSheets: true,
    });
    const { html } = buildHeatsDocument(m, common(), context(), 'auto');
    expect(html).toContain('Scoring sheet – Round 2');
    expect(html).toContain('>Place<');
    expect(html).toContain('>Notes<');
    expect(html).toContain('Race to be sailed: Q2');
    expect(html).toContain('class="scorer"');
    // Both lines of the scorer block are labelled; none is blank.
    expect(html).toContain(
      '<span>Scorer</span><span class="short">Time</span>',
    );
    expect(html).not.toContain('<span class="short"></span>');
    expect(html).toContain(
      '<td class="c-place"></td><td class="c-notes"></td>',
    );
    expect((html.match(/<section class="heat new-page">/g) ?? []).length).toBe(
      1,
    );
    expect(html).toContain('table class="list sheet"');
  });

  it('writes workbooks for both modes', async () => {
    for (const scoringSheets of [false, true]) {
      const m = buildHeatsModel(heats, {
        round: '2',
        onePerPage: false,
        scoringSheets,
      });
      // eslint-disable-next-line no-await-in-loop
      const bytes = await buildHeatsWorkbook(m, common(), context(), 'auto');
      const workbook = new ExcelJS.Workbook();
      // eslint-disable-next-line no-await-in-loop
      await workbook.xlsx.load(bytes as unknown as ArrayBuffer);
      const values: unknown[] = [];
      workbook.worksheets[0].eachRow((row) =>
        row.eachCell((cell) => values.push(cell.value)),
      );
      expect(values.some((v) => String(v).startsWith('Heat A2'))).toBe(true);
      expect(values.includes('Place')).toBe(scoringSheets);
    }
  });

  it('an empty event or an unknown round renders a note, not a crash', () => {
    const m = buildHeatsModel([], {
      round: '',
      onePerPage: false,
      scoringSheets: false,
    });
    expect(buildHeatsDocument(m, common(), context(), 'auto').html).toContain(
      'No boats in this heat.',
    );
  });
});

describe('penalty descriptions in both languages', () => {
  const CODES = Object.keys(PENALTY_DESCRIPTIONS).filter(
    (c) => c !== 'FINISHED',
  );

  it('every code the app uses is described in English and Croatian', () => {
    CODES.forEach((code) => {
      expect(penaltyDescription(code, 'en')).toBe(PENALTY_DESCRIPTIONS[code]);
      expect(penaltyDescription(code, 'hr')).toBeTruthy();
    });
  });

  it('the Croatian wording of the codes the owner named', () => {
    expect(penaltyDescription('DNF', 'hr')).toBe('Nije završio');
    expect(penaltyDescription('DNS', 'hr')).toBe('Nije startao');
    expect(penaltyDescription('DNC', 'hr')).toBe('Nije došao na start');
    expect(penaltyDescription('OCS', 'hr')).toBe(
      'Na kursu na startu / rani start',
    );
    expect(penaltyDescription('DSQ', 'hr')).toBe('Diskvalificiran');
    expect(penaltyDescription('DNE', 'hr')).toBe(
      'Diskvalifikacija koja se ne odbacuje',
    );
    expect(penaltyDescription('RET', 'hr')).toBe('Odustao');
    expect(penaltyDescription('UFD', 'hr')).toContain('30.3');
    expect(penaltyDescription('BFD', 'hr')).toContain('30.4');
    expect(penaltyDescription('ZFP', 'hr')).toContain(
      'Kazna 20% (pravilo 30.2)',
    );
    expect(penaltyDescription('RDG1', 'hr')).toContain(
      'Dodijeljena zadovoljština',
    );
  });

  it('an unknown code has no description (never a guess)', () => {
    expect(penaltyDescription('XYZ', 'en')).toBeNull();
    expect(penaltyDescription('XYZ', 'hr')).toBeNull();
  });
});

describe('continued bands on the next page', () => {
  const finalWithTwoFleets = () => finalInput();

  it('a fleet table repeats its band, marked (continued), in the repeating header', () => {
    const { html } = buildResultsDocument(
      model(finalWithTwoFleets()),
      common(),
      context(),
      'auto',
    );
    // One real band and one hidden-then-repeated row per fleet.
    expect((html.match(/<div class="band"/g) ?? []).length).toBe(2);
    expect((html.match(/<tr class="cont-row">/g) ?? []).length).toBe(2);
    expect(html).toContain(
      'Gold Fleet <span class="cont-text">(continued)</span>',
    );
    expect(html).toContain(
      'Silver Fleet <span class="cont-text">(continued)</span>',
    );
    // The continuation row sits inside <thead>, so it repeats like the header.
    expect(html).toMatch(/<thead><tr class="cont-row">/);
    expect(html).toContain(
      'table.has-band { margin-top: calc(-1 * var(--band-h)); }',
    );
    expect(html).toContain('<table class="results has-band">');
  });

  it('says (nastavak) in Croatian', () => {
    const { html } = buildResultsDocument(
      model(finalInput()),
      common({ language: 'hr' }),
      context(),
      'auto',
    );
    expect(html).toContain(
      'Gold flota <span class="cont-text">(nastavak)</span>',
    );
  });

  it('a sheet without fleets has no band at all', () => {
    const { html } = buildResultsDocument(
      model(qualifyingInput([entry(1, [['1', 'FINISHED', '1']])])),
      common(),
      context(),
      'auto',
    );
    expect(html).not.toContain('<div class="band"');
    expect(html).not.toContain('cont-row');
  });

  it('the band row spans every column of the table', () => {
    const m = model(finalInput());
    const { html } = buildResultsDocument(m, common(), context(), 'auto');
    // rank, name, country, sail, total, net + Q1 Q2 F1
    expect(html).toContain('<th class="cont-band" colspan="9"');
  });

  it('starting list: one band per country, repeated as (continued), and no Country column', () => {
    const boats = [
      { name: 'Ana', surname: 'A', boat_country: 'CRO', sail_number: 1 },
      { name: 'Bo', surname: 'B', boat_country: 'GBR', sail_number: 2 },
    ];
    const grouped = buildStartingListModel(boats, {
      ...DEFAULT_STARTING_LIST_OPTIONS,
      groupByCountry: true,
    });
    const { html } = buildStartingListDocument(
      grouped,
      common(),
      context(),
      'auto',
    );
    expect((html.match(/<div class="band"/g) ?? []).length).toBe(2);
    expect(html).toContain('CRO <span class="cont-text">(continued)</span>');
    expect(html).toContain('GBR <span class="cont-text">(continued)</span>');
    expect(html).not.toContain('>Country<');
    expect(html).not.toContain('class="c-country"');
    // The flat list keeps the Country column and has no bands.
    const flat = buildStartingListDocument(
      buildStartingListModel(boats, DEFAULT_STARTING_LIST_OPTIONS),
      common(),
      context(),
      'auto',
    ).html;
    expect(flat).toContain('>Country<');
    expect(flat).not.toContain('<div class="band"');
    const hr = buildStartingListDocument(
      grouped,
      common({ language: 'hr' }),
      context(),
      'auto',
    ).html;
    expect(hr).toContain('(nastavak)');
  });

  it('the grouped starting list workbook has no Country column either', async () => {
    const grouped = buildStartingListModel(
      [{ name: 'Ana', surname: 'A', boat_country: 'CRO', sail_number: 1 }],
      { ...DEFAULT_STARTING_LIST_OPTIONS, groupByCountry: true },
    );
    const bytes = await buildStartingListWorkbook(
      grouped,
      common(),
      context(),
      'auto',
    );
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(bytes as unknown as ArrayBuffer);
    const values: unknown[] = [];
    workbook.worksheets[0].eachRow((row) =>
      row.eachCell((cell) => values.push(cell.value)),
    );
    expect(values).toContain('Sail #');
    expect(values).not.toContain('Country');
  });
});

describe('names are never truncated in printed documents', () => {
  const longName = 'Wolfeschlegelsteinhausenberger-Kovačević';
  it('starting list and heat lists give names room and wrap, without ellipsis', () => {
    const boats = [
      {
        name: 'Tomislav',
        surname: longName,
        boat_country: 'CRO',
        club_name: 'JK Galeb',
        sail_number: 5,
        model: 'IOM',
      },
    ];
    const list = buildStartingListDocument(
      buildStartingListModel(boats, DEFAULT_STARTING_LIST_OPTIONS),
      common(),
      context(),
      'auto',
    ).html;
    expect(list).not.toContain('text-overflow');
    expect(list).toContain(`Tomislav ${longName}`);
    const widths = [...list.matchAll(/<col style="width:([\d.]+)mm">/g)].map(
      (m) => Number(m[1]),
    );
    // The widths fill the printable width of the page (190 mm portrait)...
    expect(widths.reduce((a, b) => a + b, 0)).toBeCloseTo(190, 0);
    // ...and the Sailor column is the widest column of the list.
    const sailorColumn = 3; // No., Country, Sail #, Sailor
    expect(widths[sailorColumn]).toBe(Math.max(...widths));
  });
});
