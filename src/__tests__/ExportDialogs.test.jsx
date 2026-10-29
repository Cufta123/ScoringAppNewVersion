/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import React from 'react';
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import ResultsExportDialog from '../renderer/components/export/ResultsExportDialog';
import StartingListExportDialog from '../renderer/components/export/StartingListExportDialog';
import HeatsExportDialog from '../renderer/components/export/HeatsExportDialog';
import { eventDB, exportDB } from '../renderer/api/db';
import {
  reportError,
  reportInfo,
  reportWarning,
} from '../renderer/utils/userFeedback';
import { prepareLogo } from '../renderer/exports/logo';

jest.mock('../renderer/api/db', () => ({
  eventDB: {
    readBoatsByEvent: jest.fn(),
    readEventExportLogo: jest.fn(),
    saveEventExportLogo: jest.fn(),
  },
  exportDB: {
    exportDocumentPdf: jest.fn(),
    exportDocumentFile: jest.fn(),
    printDocument: jest.fn(),
  },
}));
jest.mock('../renderer/utils/userFeedback', () => ({
  reportError: jest.fn(),
  reportInfo: jest.fn(),
  reportWarning: jest.fn(),
}));
jest.mock('../renderer/exports/flags', () => ({
  __esModule: true,
  default: () => ({}),
}));
jest.mock('../renderer/exports/logo', () => ({
  ...jest.requireActual('../renderer/exports/logo'),
  prepareLogo: jest.fn(),
}));

const event = {
  event_id: 7,
  event_name: 'Kup Kvarnera',
  event_location: 'Rijeka',
  start_date: '2026-06-01',
  end_date: '2026-06-03',
};

const row = (boat_id, group, extra = {}) => ({
  boat_id,
  name: `Sailor${boat_id}`,
  surname: 'Test',
  country: 'CRO',
  boat_number: 100 + boat_id,
  boat_type: 'IOM',
  place: boat_id,
  races: ['2', '(DNF)'],
  race_points: ['2', '9'],
  race_statuses: ['FINISHED', 'DNF'],
  race_ids: ['1', '2'],
  computed_total: 2,
  total_points_combined: 2,
  overall_rank: boat_id,
  placement_group: group,
  ...extra,
});

const resultsProps = {
  open: true,
  onClose: jest.fn(),
  event,
  finalSeriesStarted: false,
  leaderboard: [],
  eventLeaderboard: [row(1, undefined), row(2, undefined)],
  discardProfiles: { qualifying: 'standard', final: 'standard' },
};

/** Render the results dialog and wait until the boats' clubs have loaded. */
const renderResults = async (props) => {
  const view = render(<ResultsExportDialog {...props} />);
  await screen.findByLabelText('Club');
  return view;
};
const idle = (name) =>
  waitFor(() => expect(screen.getByRole('button', { name })).toBeEnabled());

const preview = () =>
  screen.getByTitle('Document preview').getAttribute('srcdoc');
const waitForPreview = (text) =>
  waitFor(() => expect(preview()).toContain(text), { timeout: 3000 });

describe('export dialogs', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    window.localStorage.clear();
    eventDB.readBoatsByEvent.mockResolvedValue([
      {
        boat_id: 1,
        club_name: 'JK Galeb',
        name: 'Ana',
        surname: 'A',
        sail_number: 5,
        boat_country: 'CRO',
        model: 'IOM',
        category_name: 'SENIOR',
      },
      {
        boat_id: 2,
        club_name: null,
        name: 'Bo',
        surname: 'B',
        sail_number: 6,
        boat_country: 'GBR',
        model: 'IOM',
        category_name: 'VETERAN',
      },
    ]);
    eventDB.readEventExportLogo.mockResolvedValue(null);
    eventDB.saveEventExportLogo.mockResolvedValue({ success: true });
    exportDB.exportDocumentPdf.mockResolvedValue({
      status: 'saved',
      filePath: '/x/results.pdf',
    });
    exportDB.exportDocumentFile.mockResolvedValue({
      status: 'saved',
      filePath: '/x/results.csv',
    });
    exportDB.printDocument.mockResolvedValue({ status: 'printed' });
  });

  describe('results', () => {
    it('opens as a named dialog with options and a live preview of the document', async () => {
      await renderResults({ ...resultsProps });
      expect(
        screen.getByRole('dialog', { name: 'Export results' }),
      ).toBeInTheDocument();
      await waitForPreview('Kup Kvarnera');
      expect(preview()).toContain('Qualifying Series Results');
      expect(preview()).toContain('Sailor1 Test');
      // Sandboxed preview: scripts never run in it.
      expect(
        screen.getByTitle('Document preview').getAttribute('sandbox'),
      ).not.toMatch(/allow-scripts/);
      for (const name of [
        'Save as PDF',
        'Save as Excel',
        'Save as HTML',
        'Save as CSV',
        'Save as Text',
        'Save as Markdown',
      ]) {
        expect(screen.getByRole('button', { name })).toBeEnabled();
      }
      expect(screen.getByRole('button', { name: /Print/ })).toBeEnabled();
    });

    it('changing options changes the preview', async () => {
      await renderResults({ ...resultsProps });
      await waitForPreview('Qualifying Series Results');
      expect(preview()).toContain('class="legend"');

      fireEvent.click(screen.getByLabelText('Legend of the codes used'));
      await waitFor(() => expect(preview()).not.toContain('class="legend"'), {
        timeout: 3000,
      });

      fireEvent.change(screen.getByLabelText('Language of the document'), {
        target: { value: 'hr' },
      });
      await waitForPreview('Rezultati kvalifikacijske serije');
      expect(screen.getByLabelText('Title')).toHaveValue(
        'Rezultati kvalifikacijske serije',
      );

      fireEvent.change(screen.getByLabelText('Title'), {
        target: { value: 'My <b>title</b>' },
      });
      await waitForPreview('My &lt;b&gt;title&lt;/b&gt;');

      fireEvent.change(screen.getByLabelText('Status'), {
        target: { value: 'official' },
      });
      await waitForPreview('badge-official');
    });

    it('offers series and fleets once the final series has started', async () => {
      const props = {
        ...resultsProps,
        finalSeriesStarted: true,
        leaderboard: [row(1, 'Gold'), row(2, 'Silver')],
      };
      await renderResults(props);
      await waitForPreview('Overall Results');
      fireEvent.click(screen.getByLabelText('Silver fleet'));
      await waitFor(() => expect(preview()).not.toContain('Silver Fleet'), {
        timeout: 3000,
      });
      expect(preview()).toContain('Gold Fleet');
      fireEvent.change(screen.getByLabelText('Series'), {
        target: { value: 'qualifying' },
      });
      await waitForPreview('Qualifying Series Results');
    });

    it('offers the Club column only when some boat has a club', async () => {
      await renderResults({ ...resultsProps });
      const club = await screen.findByLabelText('Club');
      fireEvent.click(club);
      await waitForPreview('JK Galeb');
    });

    it('each format button hands the right document to the main process', async () => {
      await renderResults({ ...resultsProps });
      await waitForPreview('Kup Kvarnera');

      fireEvent.click(screen.getByRole('button', { name: 'Save as PDF' }));
      await waitFor(() =>
        expect(exportDB.exportDocumentPdf).toHaveBeenCalledTimes(1),
      );
      const pdf = exportDB.exportDocumentPdf.mock.calls[0][0];
      expect(pdf.html).toContain('Sailor1 Test');
      expect(pdf.html).not.toContain('counter(page)'); // Electron adds the page numbers
      expect(pdf.defaultFileName).toBe(
        'Kup_Kvarnera_qualifying_results_Q2.pdf',
      );
      expect(pdf.footer).toMatchObject({
        left: 'Kup Kvarnera',
        page: 'Page',
        of: 'of',
      });
      expect(typeof pdf.landscape).toBe('boolean');
      await waitFor(() => expect(reportInfo).toHaveBeenCalledTimes(1));
      expect(reportInfo.mock.calls[0][0]).toContain('/x/results.pdf');

      await idle('Save as PDF');
      fireEvent.click(screen.getByRole('button', { name: 'Save as Excel' }));
      await waitFor(() =>
        expect(exportDB.exportDocumentFile).toHaveBeenCalledTimes(1),
      );
      const xlsx = exportDB.exportDocumentFile.mock.calls[0][0];
      expect(xlsx.extension).toBe('xlsx');
      expect(xlsx.data).toBeInstanceOf(Uint8Array);
      expect([...xlsx.data.slice(0, 2)]).toEqual([80, 75]); // a zip: "PK"

      await idle('Save as PDF');
      fireEvent.click(screen.getByRole('button', { name: 'Save as CSV' }));
      await waitFor(() =>
        expect(exportDB.exportDocumentFile).toHaveBeenCalledTimes(2),
      );
      const csv = exportDB.exportDocumentFile.mock.calls[1][0];
      expect(csv.extension).toBe('csv');
      expect(csv.data.startsWith('\uFEFFRank,Name,Country')).toBe(true);

      await idle('Save as PDF');
      fireEvent.click(screen.getByRole('button', { name: 'Save as HTML' }));
      await waitFor(() =>
        expect(exportDB.exportDocumentFile).toHaveBeenCalledTimes(3),
      );
      expect(exportDB.exportDocumentFile.mock.calls[2][0]).toMatchObject({
        extension: 'html',
      });
      expect(exportDB.exportDocumentFile.mock.calls[2][0].data).toContain(
        'counter(page)',
      );

      await idle('Save as PDF');
      fireEvent.click(screen.getByRole('button', { name: 'Save as Text' }));
      await waitFor(() =>
        expect(exportDB.exportDocumentFile).toHaveBeenCalledTimes(4),
      );
      await idle('Save as PDF');
      fireEvent.click(screen.getByRole('button', { name: 'Save as Markdown' }));
      await waitFor(() =>
        expect(exportDB.exportDocumentFile).toHaveBeenCalledTimes(5),
      );
      expect(exportDB.exportDocumentFile.mock.calls[3][0].extension).toBe(
        'txt',
      );
      expect(exportDB.exportDocumentFile.mock.calls[4][0].extension).toBe('md');
    });

    it('Print opens the print dialog with the same document', async () => {
      await renderResults({ ...resultsProps });
      await waitForPreview('Kup Kvarnera');
      fireEvent.click(screen.getByRole('button', { name: /Print/ }));
      await waitFor(() =>
        expect(exportDB.printDocument).toHaveBeenCalledTimes(1),
      );
      expect(exportDB.printDocument.mock.calls[0][0].html).toContain(
        'Sailor1 Test',
      );
    });

    it('while one export runs every button waits and a second click does nothing', async () => {
      let finish;
      exportDB.exportDocumentPdf.mockReturnValue(
        new Promise((resolve) => {
          finish = resolve;
        }),
      );
      await renderResults({ ...resultsProps });
      await waitForPreview('Kup Kvarnera');
      const pdfButton = screen.getByRole('button', { name: 'Save as PDF' });
      fireEvent.click(pdfButton);
      fireEvent.click(pdfButton);
      await waitFor(() => expect(pdfButton).toBeDisabled());
      expect(
        screen.getByRole('button', { name: 'Save as Excel' }),
      ).toBeDisabled();
      expect(screen.getByRole('button', { name: /Print/ })).toBeDisabled();
      expect(screen.getByText(/Working/)).toBeInTheDocument();
      expect(exportDB.exportDocumentPdf).toHaveBeenCalledTimes(1);

      finish({ status: 'saved', filePath: '/x/a.pdf' });
      await waitFor(() => expect(pdfButton).toBeEnabled());
      expect(screen.queryByText(/Working/)).not.toBeInTheDocument();
    });

    it('a cancelled save dialog says nothing; a failure is reported plainly', async () => {
      await renderResults({ ...resultsProps });
      await waitForPreview('Kup Kvarnera');

      exportDB.exportDocumentPdf.mockResolvedValueOnce({ status: 'canceled' });
      fireEvent.click(screen.getByRole('button', { name: 'Save as PDF' }));
      await waitFor(() =>
        expect(
          screen.getByRole('button', { name: 'Save as PDF' }),
        ).toBeEnabled(),
      );
      expect(reportInfo).not.toHaveBeenCalled();
      expect(reportError).not.toHaveBeenCalled();

      exportDB.exportDocumentPdf.mockRejectedValueOnce(
        new Error('The disk is full.'),
      );
      fireEvent.click(screen.getByRole('button', { name: 'Save as PDF' }));
      await waitFor(() => expect(reportError).toHaveBeenCalledTimes(1));
      expect(reportError.mock.calls[0][0]).toBe(
        'Could not export the results as PDF.',
      );
    });

    it('closes with the Close button and with Escape', async () => {
      const onClose = jest.fn();
      await renderResults({ ...resultsProps, onClose });
      fireEvent.click(screen.getByRole('button', { name: 'Close' }));
      expect(onClose).toHaveBeenCalledTimes(1);
      fireEvent.keyDown(document, { key: 'Escape' });
      expect(onClose).toHaveBeenCalledTimes(2);
    });

    it('says unsaved edits are not in the documents', async () => {
      await renderResults({ ...resultsProps, hasUnsavedEdits: true });
      expect(
        screen.getByText(/Unsaved edits are not included/),
      ).toBeInTheDocument();
    });

    it('remembers the options per event and document type', async () => {
      const { unmount } = await renderResults({ ...resultsProps });
      fireEvent.change(screen.getByLabelText('Language of the document'), {
        target: { value: 'hr' },
      });
      fireEvent.click(screen.getByLabelText('Include signature lines'));
      unmount();

      const second = await renderResults({ ...resultsProps });
      expect(screen.getByLabelText('Language of the document')).toHaveValue(
        'hr',
      );
      expect(screen.getByLabelText('Include signature lines')).toBeChecked();
      await waitForPreview('Voditelj regate');

      // Another event starts from the defaults.
      second.unmount();
      await renderResults({
        ...resultsProps,
        event: { ...event, event_id: 8 },
      });
      expect(screen.getByLabelText('Language of the document')).toHaveValue(
        'en',
      );
    });

    it('works when localStorage is blocked or holds garbage', async () => {
      window.localStorage.setItem('iom.export.7.results', '{not json');
      await renderResults({ ...resultsProps });
      expect(screen.getByLabelText('Language of the document')).toHaveValue(
        'en',
      );
      const getItem = jest
        .spyOn(Storage.prototype, 'getItem')
        .mockImplementation(() => {
          throw new Error('blocked');
        });
      const setItem = jest
        .spyOn(Storage.prototype, 'setItem')
        .mockImplementation(() => {
          throw new Error('blocked');
        });
      fireEvent.change(screen.getByLabelText('Language of the document'), {
        target: { value: 'hr' },
      });
      await waitForPreview('Rezultati');
      getItem.mockRestore();
      setItem.mockRestore();
    });
  });

  describe('logo', () => {
    const choose = (file) => {
      const input = screen.getByLabelText('Logo picture file');
      fireEvent.change(input, { target: { files: [file] } });
    };

    it('shows the stored logo and puts it in the document', async () => {
      eventDB.readEventExportLogo.mockResolvedValue(
        'data:image/png;base64,AAAA',
      );
      await renderResults({ ...resultsProps });
      expect(await screen.findByAltText('Event logo')).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: 'Replace logo…' }),
      ).toBeInTheDocument();
      await waitForPreview(
        '<img class="doc-logo" src="data:image/png;base64,AAAA"',
      );
    });

    it('saves a chosen picture with the event, replaced or removed later', async () => {
      prepareLogo.mockResolvedValue('data:image/png;base64,BBBB');
      await renderResults({ ...resultsProps });
      choose(new File(['x'], 'logo.png', { type: 'image/png' }));
      await waitFor(() =>
        expect(eventDB.saveEventExportLogo).toHaveBeenCalledWith(
          7,
          'data:image/png;base64,BBBB',
        ),
      );
      await waitForPreview('data:image/png;base64,BBBB');

      fireEvent.click(
        await screen.findByRole('button', { name: 'Remove logo' }),
      );
      await waitFor(() =>
        expect(eventDB.saveEventExportLogo).toHaveBeenCalledWith(7, null),
      );
      await waitFor(() => expect(preview()).not.toContain('doc-logo" src'), {
        timeout: 3000,
      });
    });

    it('a refused file leaves the logo alone and says why', async () => {
      const { LogoRefusal } = jest.requireActual('../renderer/exports/logo');
      prepareLogo.mockRejectedValue(
        new LogoRefusal('That picture is larger than 5 MB.'),
      );
      await renderResults({ ...resultsProps });
      choose(new File(['x'], 'big.png', { type: 'image/png' }));
      await waitFor(() =>
        expect(reportWarning).toHaveBeenCalledWith(
          'That picture is larger than 5 MB.',
          'Logo not changed',
        ),
      );
      expect(eventDB.saveEventExportLogo).not.toHaveBeenCalled();
    });
  });

  describe('starting list', () => {
    it('previews the entries as saved and exports PDF and Excel', async () => {
      render(
        <StartingListExportDialog open onClose={jest.fn()} event={event} />,
      );
      expect(
        screen.getByRole('dialog', { name: 'Export starting list' }),
      ).toBeInTheDocument();
      await waitForPreview('Ana A');
      expect(preview()).toContain('Total entries: 2');
      // Only PDF, Excel and HTML for this document.
      expect(
        screen.queryByRole('button', { name: 'Save as CSV' }),
      ).not.toBeInTheDocument();
      expect(screen.queryByLabelText('Status')).toBeInTheDocument();

      fireEvent.click(
        screen.getByLabelText('Group by country, with entry counts'),
      );
      await waitForPreview('1 entry');
      fireEvent.change(screen.getByLabelText('Sort by'), {
        target: { value: 'surname' },
      });

      fireEvent.click(screen.getByRole('button', { name: 'Save as PDF' }));
      await waitFor(() =>
        expect(exportDB.exportDocumentPdf).toHaveBeenCalled(),
      );
      expect(exportDB.exportDocumentPdf.mock.calls[0][0].defaultFileName).toBe(
        'Kup_Kvarnera_starting_list.pdf',
      );
      await idle('Save as PDF');
      fireEvent.click(screen.getByRole('button', { name: 'Save as Excel' }));
      await waitFor(() =>
        expect(exportDB.exportDocumentFile).toHaveBeenCalled(),
      );
    });
  });

  describe('heats', () => {
    const boat = (sail) => ({
      name: `S${sail}`,
      surname: 'X',
      country: 'CRO',
      sail_number: sail,
      model: 'IOM',
      category_name: 'SENIOR',
    });
    const heats = [
      {
        heat_id: 1,
        heat_name: 'Heat A1',
        heat_type: 'Qualifying',
        raceNumber: 1,
        boats: [boat(1), boat(2)],
      },
      {
        heat_id: 2,
        heat_name: 'Heat A2',
        heat_type: 'Qualifying',
        raceNumber: 0,
        boats: [boat(3)],
      },
    ];

    it('defaults to the latest round and lists the rounds', async () => {
      render(
        <HeatsExportDialog
          open
          onClose={jest.fn()}
          event={event}
          heats={heats}
        />,
      );
      expect(
        screen.getByRole('dialog', { name: 'Export heats' }),
      ).toBeInTheDocument();
      const round = screen.getByLabelText('Round');
      expect(round).toHaveValue('2');
      expect(
        within(round)
          .getAllByRole('option')
          .map((o) => o.textContent),
      ).toEqual(['Round 1 (1 heat)', 'Round 2 (1 heat)']);
      await waitForPreview('Heat A2');
      expect(preview()).not.toContain('Heat A1');
      expect(screen.queryByLabelText('Status')).not.toBeInTheDocument();

      fireEvent.change(round, { target: { value: '1' } });
      await waitForPreview('Heat A1');
    });

    it('scoring sheets switch on blank Place/Notes columns and one heat per page', async () => {
      render(
        <HeatsExportDialog
          open
          onClose={jest.fn()}
          event={event}
          heats={heats}
        />,
      );
      await waitForPreview('Heat A2');
      expect(preview()).not.toContain('>Place<');
      fireEvent.click(
        screen.getByLabelText('Scoring sheets (blank Place/Notes columns)'),
      );
      await waitForPreview('>Place<');
      expect(preview()).toContain('Race to be sailed: Q2');
      expect(screen.getByLabelText('One heat per page')).toBeDisabled();
      expect(screen.getByLabelText('One heat per page')).toBeChecked();

      fireEvent.click(screen.getByRole('button', { name: 'Save as PDF' }));
      await waitFor(() =>
        expect(exportDB.exportDocumentPdf).toHaveBeenCalled(),
      );
      expect(exportDB.exportDocumentPdf.mock.calls[0][0].defaultFileName).toBe(
        'Kup_Kvarnera_scoring_sheets_round_2.pdf',
      );
      await waitFor(() =>
        expect(reportInfo.mock.calls[0][0]).toContain('scoring sheets'),
      );
    });

    it('with no heats it says so and still opens', async () => {
      render(
        <HeatsExportDialog open onClose={jest.fn()} event={event} heats={[]} />,
      );
      expect(
        screen.getByText('There are no heats to export yet.'),
      ).toBeInTheDocument();
    });
  });
});
