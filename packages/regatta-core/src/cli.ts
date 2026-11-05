#!/usr/bin/env node
/**
 * regatta-core on the command line: one event file in, its results out.
 *
 *   regatta-core event.json           results as JSON (schema/results.schema.json)
 *   regatta-core --text event.json    the same as tables, for reading
 *   regatta-core - < event.json       read the event from stdin
 *
 * Exit codes: 0 results, 1 a decision was refused (the results are the event
 * before it), 2 the file is not an event file (JSON or schema errors).
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import Ajv, { type ErrorObject, type ValidateFunction } from 'ajv';
import {
  FORMAT_VERSION,
  readEventFile,
  results,
  type EventFile,
  type Results,
  type RaceScore,
} from './results';
import type { NextStep } from './event/nextStep';

const USAGE = `Usage: regatta-core [--text] <event.json | ->

  --text   print tables instead of JSON
  -h       this help

Exit codes: 0 ok, 1 a decision was refused, 2 not a valid event file.`;

type Schema = {
  definitions: Record<string, { anyOf?: Record<string, unknown>[] }>;
} & Record<string, unknown>;

function loadSchema(): Schema {
  // dist/cli.js and src/cli.ts both sit one level below the package root.
  const path = join(__dirname, '..', 'schema', 'event.schema.json');
  return JSON.parse(readFileSync(path, 'utf8'));
}

const describe = (errors: ErrorObject[] | null | undefined) =>
  (errors ?? []).map(
    (e) =>
      `  ${e.instancePath || '/'} ${e.message ?? ''}${
        e.keyword === 'additionalProperties'
          ? `: ${(e.params as { additionalProperty: string }).additionalProperty}`
          : ''
      }${
        e.keyword === 'enum' || e.keyword === 'const'
          ? ` (${JSON.stringify(
              (e.params as { allowedValues?: unknown; allowedValue?: unknown })
                .allowedValues ??
                (e.params as { allowedValue?: unknown }).allowedValue,
            )})`
          : ''
      }`,
  );

/**
 * Schema errors in words. A decision that matches no kind of decision gets
 * the errors of the kind its `type` names, not one per kind.
 */
export function validateEventFile(data: unknown): string[] {
  const schema = loadSchema();
  const ajv = new Ajv({ allErrors: true, strict: false });
  const validate = ajv.compile(schema);
  if (validate(data)) return [];

  const { decisions } = data as { decisions?: unknown };
  if (!Array.isArray(decisions)) return describe(validate.errors);

  const byType = new Map<string, ValidateFunction>();
  (schema.definitions.Decision.anyOf ?? []).forEach((branch) => {
    const type = (branch.properties as { type: { const: string } }).type.const;
    byType.set(
      type,
      ajv.compile({ ...branch, definitions: schema.definitions }),
    );
  });
  const problems: string[] = [];
  decisions.forEach((decision, index) => {
    const type = (decision as { type?: unknown })?.type;
    const check = typeof type === 'string' ? byType.get(type) : undefined;
    if (!check) {
      problems.push(
        `decision ${index}: "type" must be one of ${[...byType.keys()].join(', ')}`,
      );
    } else if (!check(decision)) {
      problems.push(
        `decision ${index} (${type}):`,
        ...describe(check.errors).map((line) => `  ${line}`),
      );
    }
  });
  // Errors outside the decisions (an unknown top-level field, …).
  const outside = (validate.errors ?? []).filter(
    (e) => !e.instancePath.startsWith('/decisions/'),
  );
  return [...describe(outside), ...problems];
}

const races = (n: number) => `${n} race${n === 1 ? '' : 's'}`;
const pad = (text: string | number, width: number) =>
  String(text).padEnd(width);
const padLeft = (text: string | number, width: number) =>
  String(text).padStart(width);

function scoreText(score: RaceScore): string {
  const text = score.code ? `${score.points} ${score.code}` : `${score.points}`;
  return score.excluded ? `(${text})` : text;
}

function stepText(step: NextStep): string {
  switch (step.kind) {
    case 'enterBoats':
      return 'enter the boats';
    case 'createHeats':
      return 'create the heats';
    case 'score':
      return `score ${step.heat} race ${step.race}`;
    case 'createRound':
      return `create round ${step.round} or start the Final Series`;
    default:
      return '';
  }
}

/** Results as tables, for a person reading a terminal. */
export function textReport(r: Results): string {
  const label = new Map(
    r.boats.map((b) => [
      b.id,
      `${b.nat} ${b.sail}${b.name ? ` ${b.name}` : ''}`,
    ]),
  );
  const width = Math.max(8, ...[...label.values()].map((l) => l.length));
  const lines: string[] = [];
  if (r.name) lines.push(r.name, '');
  if (r.refused) {
    lines.push(
      `REFUSED decision ${r.refused.at} (${r.refused.decision.type}): ${r.refused.reason}`,
      'Results below are the event before it.',
      '',
    );
  }
  lines.push(`Next: ${stepText(r.nextStep)}`, '');

  const table = (
    title: string,
    rows: {
      place: number;
      boat: string;
      total: number;
      scores: RaceScore[];
      circular?: boolean;
    }[],
  ) => {
    lines.push(title);
    rows.forEach((row) => {
      lines.push(
        `${padLeft(row.place, 3)}${row.circular ? '*' : ' '} ${pad(label.get(row.boat) ?? row.boat, width)} ${padLeft(row.total, 6)}   ${row.scores.map(scoreText).join('  ')}`,
      );
    });
    lines.push('');
  };

  table(
    `Qualifying (${races(r.qualifying.completedRaces)})`,
    r.qualifying.standings,
  );
  r.final.forEach((fleet) =>
    table(`Final, ${fleet.fleet} (${races(fleet.races)})`, fleet.standings),
  );
  if (r.final.length > 0) {
    lines.push('Overall');
    r.overall.forEach((o) => {
      lines.push(
        `${padLeft(o.place, 3)}${o.circular ? '*' : ' '} ${pad(label.get(o.boat) ?? o.boat, width)} ${pad(o.fleet ?? '', 7)} ${padLeft(o.qualifying, 6)} + ${padLeft(o.final, 6)} = ${padLeft(o.total, 6)}`,
      );
    });
    lines.push('');
  }
  const circular = [
    ...r.qualifying.standings,
    ...r.final.flatMap((f) => f.standings),
    ...r.overall,
  ].some((s) => s.circular);
  if (circular) {
    lines.push(
      '* tie-break went in a circle (SHRS 5.7); placed by plain RRS A8',
      '',
    );
  }
  lines.push('(n) excluded score');
  return `${lines.join('\n')}\n`;
}

export function main(
  argv: string[],
  stdin: () => string,
): {
  code: number;
  out: string;
  err: string;
} {
  const args = argv.filter((a) => a !== '--text');
  const text = argv.includes('--text');
  if (args.includes('-h') || args.includes('--help')) {
    return { code: 0, out: `${USAGE}\n`, err: '' };
  }
  if (args.length !== 1) return { code: 2, out: '', err: `${USAGE}\n` };

  let raw: string;
  try {
    raw = args[0] === '-' ? stdin() : readFileSync(args[0], 'utf8');
  } catch (error) {
    return {
      code: 2,
      out: '',
      err: `Cannot read ${args[0]}: ${(error as Error).message}\n`,
    };
  }
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch (error) {
    return { code: 2, out: '', err: `Not JSON: ${(error as Error).message}\n` };
  }
  // A newer format first: its schema errors would only confuse.
  const version = (data as { formatVersion?: unknown } | null)?.formatVersion;
  if (typeof version === 'number' && version !== FORMAT_VERSION) {
    try {
      readEventFile({ formatVersion: version });
    } catch (error) {
      return { code: 2, out: '', err: `${(error as Error).message}\n` };
    }
  }
  const problems = validateEventFile(data);
  if (problems.length > 0) {
    return {
      code: 2,
      out: '',
      err: `Not a valid event file (schema/event.schema.json):\n${problems.join('\n')}\n`,
    };
  }
  const r = results(data as EventFile);
  return {
    code: r.refused ? 1 : 0,
    out: text ? textReport(r) : `${JSON.stringify(r, null, 2)}\n`,
    err: r.refused
      ? `Decision ${r.refused.at} refused: ${r.refused.reason}\n`
      : '',
  };
}

if (require.main === module) {
  const { code, out, err } = main(process.argv.slice(2), () =>
    readFileSync(0, 'utf8'),
  );
  process.stdout.write(out);
  process.stderr.write(err);
  process.exitCode = code;
}
