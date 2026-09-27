import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';

// Parse .env manually without external dependencies
let env = {};
try {
  const envPath = path.resolve('.env');
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, 'utf8').split('\n');
    lines.forEach(line => {
      const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
      if (match) {
        let val = match[2] || '';
        val = val.trim().replace(/^['"]|['"]$/g, '');
        env[match[1]] = val;
      }
    });
  }
} catch (_) { }

const supabaseUrl = env.VITE_SUPABASE_URL || process.env.VITE_SUPABASE_URL;
// Prefer service role key for administrative maintenance, or fall back to configured env key
const supabaseKey = env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("❌ Error: Missing VITE_SUPABASE_URL or VITE_SUPABASE_PUBLISHABLE_KEY in .env.");
  console.error("Please ensure your .env file is configured before executing administrative scripts.");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function clearDatabase() {
  console.log("🧹 Starting Supabase session and rounds reset...\n");

  const steps = [
    { name: 'attempts', fn: () => supabase.from('attempts').delete().neq('id', '00000000-0000-0000-0000-000000000000') },
    { name: 'miner_round_progress', fn: () => supabase.from('miner_round_progress').delete().neq('round_id', '00000000-0000-0000-0000-000000000000') },
    { name: 'blocks', fn: () => supabase.from('blocks').delete().neq('id', '00000000-0000-0000-0000-000000000000') },
    { name: 'unlink round winners', fn: () => supabase.from('rounds').update({ winner_miner_id: null }).neq('id', '00000000-0000-0000-0000-000000000000') },
    { name: 'round_questions', fn: () => supabase.from('round_questions').delete().neq('id', '00000000-0000-0000-0000-000000000000') },
    { name: 'rounds', fn: () => supabase.from('rounds').delete().neq('id', '00000000-0000-0000-0000-000000000000') },
    { name: 'miners', fn: () => supabase.from('miners').delete().neq('id', '00000000-0000-0000-0000-000000000000') }
  ];

  for (const step of steps) {
    try {
      const { error } = await step.fn();
      if (error) {
        console.warn(`⚠️  Warning on [${step.name}]:`, error.message);
      } else {
        console.log(`✅ Cleared / Reset [${step.name}]`);
      }
    } catch (err) {
      console.warn(`❌ Error on [${step.name}]:`, err.message);
    }
  }

  console.log("\n✨ Database reset complete! Ready for fresh tests.");
}

clearDatabase();
