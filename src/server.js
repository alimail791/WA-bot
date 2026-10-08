import { config } from './config.js';
import { connect } from './store.js';
import { createApp } from './app.js';
import { seed } from './seed.js';
import { startCron } from './nudges.js';

await connect();
if (config.store === 'memory' || process.env.SEED_SAMPLE === 'true') {
  const withTests = config.store === 'memory';
  if (await seed({ withTests })) console.log(withTests ? 'Loaded sample questions and tests' : 'Loaded sample questions');
}
if (config.enableCron) startCron();

createApp().listen(config.port, () => {
  console.log(`wa-engine on ${config.baseUrl} · provider=${config.provider} · store=${config.store}`);
  if (config.provider === 'sim') console.log(`Simulator: ${config.baseUrl}/sim`);
  if (config.secret === 'dev-secret-change-me' && config.store === 'mongo') console.warn('⚠️  Set APP_SECRET before going live');
  if (config.adminKey === 'admin-dev-key' && config.store === 'mongo') console.warn('⚠️  Set ADMIN_KEY before going live');
});
