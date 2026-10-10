import { config } from './config.js';
import { connect } from './store.js';
import { createApp } from './app.js';
import { seed } from './seed.js';
import { startCron } from './nudges.js';
import * as tmSync from './testmandiSync.js';
import { ensureNeetBank } from './bank.js';
import * as yneetBridge from './yneetBridge.js';
import * as ccBridge from './classcoachBridge.js';

await connect();
if (config.store === 'memory' || process.env.SEED_SAMPLE === 'true') {
  const withTests = config.store === 'memory';
  if (await seed({ withTests })) console.log(withTests ? 'Loaded sample questions and tests' : 'Loaded sample questions');
}
try { await ensureNeetBank(); } catch (e) { console.error('[bank] could not load NEET bank', e); }
if (process.env.YNEET_DATABASE_URL) {
  yneetBridge.check()
    .then((r) => console.log(`[yneet] linked to app.yneet.in: ${JSON.stringify(r)}`))
    .catch((e) => console.error(`[yneet] could not reach app.yneet.in database: ${e.message}`));
}
if (ccBridge.enabled()) {
  ccBridge.check()
    .then((r) => console.log(`[classcoach] link to classcoach.in: ${r}`))
    .catch((e) => console.error(`[classcoach] could not reach classcoach.in: ${e.message}`));
}
if (config.enableCron) startCron();
if (tmSync.enabled() && config.store === 'mongo') tmSync.startSync(Number(process.env.TESTMANDI_SYNC_MINUTES || 15));

createApp().listen(config.port, () => {
  console.log(`wa-engine on ${config.baseUrl} · provider=${config.provider} · store=${config.store}`);
  if (config.provider === 'sim') console.log(`Simulator: ${config.baseUrl}/sim`);
  if (config.secret === 'dev-secret-change-me' && config.store === 'mongo') console.warn('⚠️  Set APP_SECRET before going live');
  if (config.adminKey === 'admin-dev-key' && config.store === 'mongo') console.warn('⚠️  Set ADMIN_KEY before going live');
});
