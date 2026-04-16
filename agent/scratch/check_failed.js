// List TODAY's FAILED jobs
const { loadConfig } = require('../../agent/dist/config');
const cfg = loadConfig();

async function main() {
  // Get all candidates with larger window
  const res = await fetch(
    `${cfg.serverUrl}api/agent/cleanup/candidates?before=${encodeURIComponent(new Date(Date.now() + 86400000).toISOString())}&limit=500&excludeChannels=`,
    { headers: { Authorization: `Bearer ${cfg.agentToken}` } }
  );
  const data = await res.json();
  
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  
  const chRes = await fetch(`${cfg.serverUrl}api/agent/channels`, {
    headers: { Authorization: `Bearer ${cfg.agentToken}` }
  });
  const { channels } = await chRes.json();
  const chMap = new Map(channels.map(c => [c.id, c.name]));
  
  const todayFailed = (data.candidates || []).filter(j => 
    j.status === 'FAILED' && new Date(j.createdAt) >= todayStart
  );
  
  // Also count all FAILED (not just today)
  const allFailed = (data.candidates || []).filter(j => j.status === 'FAILED');
  
  console.log(`Total in DB: ${data.candidates?.length || 0}`);
  console.log(`All FAILED: ${allFailed.length}`);
  console.log(`Today FAILED: ${todayFailed.length}`);
  
  console.log('\n=== ALL FAILED JOBS ===');
  for (const job of allFailed) {
    const isToday = new Date(job.createdAt) >= todayStart;
    console.log(`${isToday ? '📅TODAY' : '      '} Job #${job.id} | ${chMap.get(job.channelId) || 'ch-'+job.channelId} | created: ${job.createdAt}`);
  }
  
  // Also count by status
  const statusCount = {};
  for (const j of data.candidates || []) {
    statusCount[j.status] = (statusCount[j.status] || 0) + 1;
  }
  console.log('\n=== Status summary ===');
  console.log(JSON.stringify(statusCount, null, 2));
}

main().catch(console.error);
