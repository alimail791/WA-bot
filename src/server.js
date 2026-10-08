import { config } from './config.js';
import { connect } from './store.js';
import { createApp } from './app.js';
import { seed } from './seed.js';
import { startCron } from './nudges.js';
import * as tmSync from './testmandiSync.js';
import { ensureNeetBank } from './bank.js';

await connect();
if (config.store === 'memory' || process.env.SEED_SAMPLE === 'true') {
  const withTests = config.store === 'memory';
  if (await seed({ withTests })) console.log(withTests ? 'Loaded sample questions and tests' : 'Loaded sample questions');
}
try { await ensureNeetBank(); } catch (e) { console.error('[bank] could not load NEET bank', e); }
if (config.enableCron) startCron();
if (tmSync.enabled() && config.store === 'mongo') tmSync.startSync(Number(process.env.TESTMANDI_SYNC_MINUTES || 15));

createApp().listen(config.port, () => {
  console.log(`wa-engine on ${config.baseUrl} · provider=${config.provider} · store=${config.store}`);
  if (config.provider === 'sim') console.log(`Simulator: ${config.baseUrl}/sim`);
  if (config.secret === 'dev-secret-change-me' && config.store === 'mongo') console.warn('⚠️  Set APP_SECRET before going live');
  if (config.adminKey === 'admin-dev-key' && config.store === 'mongo') console.warn('⚠️  Set ADMIN_KEY before going live');
});
