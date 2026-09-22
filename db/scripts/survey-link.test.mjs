/**
 * apps-script/salary-compass/survey-link.gs — the "Survey link for an email…"
 * menu. Only the lookup is tested: it is the part that decides which row a
 * hand-sent link binds the survey to, and binding it to the wrong one (or to
 * none) is exactly the duplicate-or-lost problem the link exists to avoid.
 *
 * The .gs files are plain scripts sharing one global scope in Apps Script, so
 * they are loaded the same way here.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const GS = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'apps-script', 'salary-compass');

async function load() {
  const ctx = vm.createContext({});
  for (const file of ['survey-reminders.gs', 'survey-link.gs']) {
    vm.runInContext(await readFile(join(GS, file), 'utf8'), ctx, { filename: file });
  }
  return ctx;
}

const EMAIL_HEADER = ['Submission ID', 'Timestamp', 'Email', 'Source', 'Report', 'Newsletter', 'Percentile', 'Token'];
const SUB_HEADER = Array.from({ length: 21 }, (_, i) => `c${i + 1}`);

function sub(id, createdAt, { role = 'Senior PM', district = 'Porto', full = 'No' } = {}) {
  const row = Array(21).fill('');
  row[0] = id; row[1] = createdAt; row[4] = role; row[6] = district; row[20] = full;
  return row;
}

test('the link binds the survey to that person\'s comparison', async () => {
  const ctx = await load();
  const out = ctx.surveyLinkLookup_(
    [EMAIL_HEADER, ['sid-aaaa-0001', '2026-09-01', 'Ana@Example.com ', 'email_gate', true, false, 40, 'tok-1']],
    [SUB_HEADER, sub('sid-aaaa-0001', '2026-09-01T10:00:00Z')],
    'ana@example.com'
  );
  assert.equal(out.ok, true);
  assert.equal(out.submissionId, 'sid-aaaa-0001');
  const url = new URL(out.link);
  assert.equal(url.searchParams.get('survey'), '1');
  assert.equal(url.searchParams.get('sid'), 'sid-aaaa-0001');
  assert.equal(url.searchParams.get('access'), 'tok-1');
  assert.equal(url.searchParams.get('e'), 'ana@example.com');
  assert.equal(out.alreadyCompleted, false);
});

test('with several comparisons, the most recent one wins', async () => {
  const ctx = await load();
  const out = ctx.surveyLinkLookup_(
    [EMAIL_HEADER,
      ['sid-old-00001', '2026-08-01', 'a@b.co', 'email_gate', true, true, 40, 'tok-old'],
      ['sid-new-00001', '2026-09-10', 'a@b.co', 'email_gate', true, true, 55, 'tok-new']],
    [SUB_HEADER, sub('sid-old-00001', '2026-08-01T10:00:00Z'), sub('sid-new-00001', '2026-09-10T10:00:00Z')],
    'a@b.co'
  );
  assert.equal(out.submissionId, 'sid-new-00001');
  assert.equal(out.comparisons, 2);
});

test('a row of the same comparison with a token is preferred over one without', async () => {
  const ctx = await load();
  const out = ctx.surveyLinkLookup_(
    [EMAIL_HEADER,
      ['sid-aaaa-0001', '2026-09-01', 'a@b.co', 'survey_inline', false, false, '', ''],
      ['sid-aaaa-0001', '2026-09-01', 'a@b.co', 'email_gate', true, true, 40, 'tok-1']],
    [SUB_HEADER, sub('sid-aaaa-0001', '2026-09-01T10:00:00Z')],
    'a@b.co'
  );
  assert.equal(new URL(out.link).searchParams.get('access'), 'tok-1');
  assert.equal(out.comparisons, 1);
});

test('no link without a comparison to attach to', async () => {
  const ctx = await load();
  const emails = [EMAIL_HEADER,
    ['', '2026-09-01', 'news@b.co', 'newsletter_popup', false, true, '', 'tok'],
    ['sid-gone-0001', '2026-09-01', 'gone@b.co', 'email_gate', true, true, 40, 'tok']];
  const subs = [SUB_HEADER];

  const newsletter = ctx.surveyLinkLookup_(emails, subs, 'news@b.co');
  assert.equal(newsletter.ok, false);
  assert.match(newsletter.message, /not linked to any comparison/);

  assert.equal(ctx.surveyLinkLookup_(emails, subs, 'gone@b.co').ok, false,
    'an id missing from Submissions would be the silent-loss case');
  assert.match(ctx.surveyLinkLookup_(emails, subs, 'nobody@b.co').message, /No row/);
  assert.match(ctx.surveyLinkLookup_(emails, subs, 'not an email').message, /does not look like/);
});

test('someone who already completed the survey is flagged, not refused', async () => {
  const ctx = await load();
  const out = ctx.surveyLinkLookup_(
    [EMAIL_HEADER, ['sid-aaaa-0001', '2026-09-01', 'a@b.co', 'email_gate', true, true, 40, 'tok']],
    [SUB_HEADER, sub('sid-aaaa-0001', '2026-09-01T10:00:00Z', { full: 'Yes' })],
    'a@b.co'
  );
  assert.equal(out.ok, true);
  assert.equal(out.alreadyCompleted, true);
});
