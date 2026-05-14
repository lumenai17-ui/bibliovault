const { Pool } = require('pg');
const p = new Pool({
  connectionString: 'postgresql://postgres.xzluufejwycnxpwafstt:%23%23pexW%2CX%2CX47NfA@aws-1-us-west-2.pooler.supabase.com:5432/postgres'
});

async function run() {
  // 1. Add subscription columns to PG
  const cols = [
    'subscription_status TEXT DEFAULT \'none\'',
    'subscription_id TEXT',
    'subscription_start TIMESTAMPTZ',
    'subscription_end TIMESTAMPTZ',
    'paypal_payer_id TEXT'
  ];
  for (const col of cols) {
    const name = col.split(' ')[0];
    try {
      await p.query('ALTER TABLE users ADD COLUMN ' + col);
      console.log('Added: ' + name);
    } catch(e) {
      console.log('Exists: ' + name);
    }
  }

  // 2. Set admin access for hbouche
  await p.query("UPDATE users SET plan = 'enterprise', subscription_status = 'active' WHERE email = 'hbouche@hotmail.com'");
  console.log('hbouche@hotmail.com -> enterprise');

  // 3. Also add to ADMIN_EMAILS equivalent
  await p.query("UPDATE users SET plan = 'enterprise', subscription_status = 'active' WHERE email = 'hebouche@gmail.com'");
  console.log('hebouche@gmail.com -> enterprise');

  // Verify
  const { rows } = await p.query('SELECT email, plan, subscription_status FROM users ORDER BY email');
  console.log('\nAll users:');
  rows.forEach(r => console.log(`  ${r.email} → plan=${r.plan}, sub=${r.subscription_status}`));

  await p.end();
}

run().catch(e => { console.error(e); p.end(); });
