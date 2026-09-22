/**
 * Fires the Salary Compass scheduled email jobs.
 *
 * It exists because Cloudflare Pages has no Cron Triggers — they are a Workers
 * feature — and the jobs live in a Pages Function. So this Worker does nothing
 * but call `/api/compass/cron` on a schedule with the shared secret. All the
 * logic, and all the database access, stays in the Pages Function.
 *
 * Replaces the two Apps Script time-driven triggers:
 *   result-emails.gs     every 5 minutes
 *   survey-reminders.gs  hourly
 *
 * Which schedule fired is read from `event.cron`, so adding a job means adding
 * a line here and a line in wrangler.jsonc, and nothing else.
 */

/** Cron expression → job kind. Must match the crons in wrangler.jsonc exactly. */
const JOBS = {
  '*/5 * * * *': 'result',
  '13 * * * *': 'reminder_1',
  '43 * * * *': 'reminder_2'
};

const TARGET = 'https://www.impostor.pm/api/compass/cron';

export default {
  async scheduled(event, env, ctx) {
    const kind = JOBS[event.cron];
    if (!kind) {
      // A schedule was added to wrangler.jsonc without a matching entry above.
      // Logged rather than thrown: a silent no-op is how a job quietly stops
      // running for months.
      console.error(`No job mapped to cron "${event.cron}" — nothing was run.`);
      return;
    }

    if (!env.CRON_SECRET) {
      console.error('CRON_SECRET is not set; the endpoint would reject this.');
      return;
    }

    ctx.waitUntil(run(kind, env));
  },

  /**
   * A plain GET returns what this Worker would do, so "is the scheduler alive
   * and pointing at the right place?" is answerable without waiting for a
   * schedule to come round. It runs nothing and needs no secret, because it
   * reveals nothing that is not in this file.
   */
  async fetch() {
    return Response.json({
      service: 'compass-cron',
      target: TARGET,
      jobs: JOBS,
      note: 'Scheduled only. This endpoint does not trigger anything.'
    });
  }
};

async function run(kind, env) {
  const started = Date.now();
  try {
    const res = await fetch(`${TARGET}?kind=${encodeURIComponent(kind)}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.CRON_SECRET}` }
    });

    const body = await res.text();
    if (!res.ok) {
      console.error(`${kind}: HTTP ${res.status} ${body.slice(0, 300)}`);
      return;
    }

    // Logged on success too. "The job ran and had nothing to do" and "the job
    // never ran" look identical in an empty log, and only one of them is fine.
    console.log(`${kind}: ${body.slice(0, 300)} (${Date.now() - started}ms)`);
  } catch (err) {
    console.error(`${kind}: ${err.message}`);
  }
}
