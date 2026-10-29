import React, { useRef } from 'react';
import {
  CheckField,
  OptionSection,
  SelectField,
  TextField,
} from './OptionFields';
import { EXPORT_LANGUAGES, defaultSignatureLabels } from '../../exports/i18n';
import {
  signatureLabelShown,
  type CommonSettings,
} from '../../exports/commonSettings';
import type {
  DocumentStatus,
  ExportLanguage,
  OrientationChoice,
} from '../../exports/types';

const ORIENTATIONS: ReadonlyArray<{ value: OrientationChoice; label: string }> =
  [
    { value: 'auto', label: 'Automatic' },
    { value: 'portrait', label: 'Portrait' },
    { value: 'landscape', label: 'Landscape' },
  ];

const STATUS_LABELS: Record<DocumentStatus, string> = {
  provisional: 'Provisional',
  official: 'Official',
  final: 'Final',
};

interface LogoControl {
  logo: string | null;
  busy: boolean;
  choose: (file: File) => void;
  remove: () => void;
}

interface CommonOptionsFieldsProps {
  settings: CommonSettings;
  onChange: (update: (current: CommonSettings) => CommonSettings) => void;
  /** The title the document would have without a typed one. */
  defaultTitle: string;
  /** The statuses to offer; null when the document has no status. */
  statuses: DocumentStatus[] | null;
  logo: LogoControl;
}

/**
 * The options every document has: language, title, status, page orientation,
 * the event logo and the signature lines.
 */
export default function CommonOptionsFields({
  settings,
  onChange,
  defaultTitle,
  statuses,
  logo,
}: CommonOptionsFieldsProps) {
  const fileInput = useRef<HTMLInputElement>(null);

  // Typing the default label back means "follow the language again".
  const setSignature = (side: 'left' | 'right', value: string) =>
    onChange((current) => {
      const standard = defaultSignatureLabels(current.language)[
        side === 'left' ? 0 : 1
      ];
      return {
        ...current,
        signatures: {
          ...current.signatures,
          [side]: value.trim() === standard ? '' : value,
        },
      };
    });

  return (
    <>
      <OptionSection title="Document">
        <SelectField<ExportLanguage>
          label="Language of the document"
          value={settings.language}
          options={EXPORT_LANGUAGES}
          onChange={(language) => onChange((c) => ({ ...c, language }))}
        />
        <TextField
          label="Title"
          value={settings.title || defaultTitle}
          // Typing the default back means "follow the language again".
          onChange={(value) =>
            onChange((c) => ({
              ...c,
              title: value.trim() === defaultTitle ? '' : value,
            }))
          }
        />
        {statuses && (
          <SelectField<DocumentStatus>
            label="Status"
            value={
              statuses.includes(settings.status) ? settings.status : statuses[0]
            }
            options={statuses.map((value) => ({
              value,
              label: STATUS_LABELS[value],
            }))}
            onChange={(status) => onChange((c) => ({ ...c, status }))}
          />
        )}
        <SelectField<OrientationChoice>
          label="Page orientation"
          value={settings.orientation}
          options={ORIENTATIONS}
          onChange={(orientation) => onChange((c) => ({ ...c, orientation }))}
        />
      </OptionSection>

      <OptionSection title="Logo">
        <div className="export-logo">
          <div className="export-logo-thumb">
            {logo.logo ? (
              <img src={logo.logo} alt="Event logo" />
            ) : (
              <span>No logo</span>
            )}
          </div>
          <div className="export-logo-actions">
            <input
              ref={fileInput}
              type="file"
              accept="image/png,image/jpeg"
              hidden
              aria-label="Logo picture file"
              onChange={(event) => {
                const file = event.target.files?.[0];
                // Choosing the same file again must fire a change again.
                // eslint-disable-next-line no-param-reassign
                event.target.value = '';
                if (file) logo.choose(file);
              }}
            />
            <button
              type="button"
              className="btn-outline"
              disabled={logo.busy}
              onClick={() => fileInput.current?.click()}
            >
              {logo.logo ? 'Replace logo…' : 'Choose logo…'}
            </button>
            {logo.logo && (
              <button
                type="button"
                className="btn-outline"
                disabled={logo.busy}
                onClick={logo.remove}
              >
                Remove logo
              </button>
            )}
          </div>
        </div>
        <p className="export-hint">
          A PNG or JPEG picture, saved with the event and shown in the header of
          every document.
        </p>
      </OptionSection>

      <OptionSection title="Signatures">
        <CheckField
          label="Include signature lines"
          checked={settings.signatures.enabled}
          onChange={(enabled) =>
            onChange((c) => ({
              ...c,
              signatures: { ...c.signatures, enabled },
            }))
          }
        />
        {settings.signatures.enabled && (
          <>
            <TextField
              label="Left line"
              value={signatureLabelShown(settings, 'left')}
              onChange={(value) => setSignature('left', value)}
              maxLength={60}
            />
            <TextField
              label="Right line"
              value={signatureLabelShown(settings, 'right')}
              onChange={(value) => setSignature('right', value)}
              maxLength={60}
            />
          </>
        )}
      </OptionSection>
    </>
  );
}
