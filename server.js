#!/usr/bin/env node
// Mothership Live Data Server — serves cron run data to the dashboard

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PORT = 7474;
const CRON_RUNS_DIR = path.join(os.homedir(), '.openclaw/cron/runs');
const CRON_JOBS_FILE = path.join(os.homedir(), '.openclaw/cron/jobs.json');

function readJsonl(file) {
  try {
    const lines = fs.readFileSync(file, 'utf8').trim().split('\n');
    return lines.map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  } catch { return []; }
}

function getRecentRuns(limit = 20) {
  const runs = [];
  try {
    const files = fs.readdirSync(CRON_RUNS_DIR);
    for (const file of files) {
      if (!file.endsWith('.jsonl')) continue;
      const entries = readJsonl(path.join(CRON_RUNS_DIR, file));
      for (const e of entries) {
        if (e.action === 'finished') runs.push(e);
      }
    }
  } catch {}
  return runs.sort((a, b) => b.ts - a.ts).slice(0, limit);
}

function getJobs() {
  try {
    const d = JSON.parse(fs.readFileSync(CRON_JOBS_FILE, 'utf8'));
    return d.jobs || [];
  } catch { return []; }
}

function getAgentStatus() {
  const agents = ['main', 'powerhour', 'newsbot'];
  const agentLabels = { main: 'Zero', powerhour: 'PowerHour', newsbot: 'NewsBot' };
  const agentIcons = { main: '⚡', powerhour: '🔥', newsbot: '📰' };
  const result = {};

  const jobs = getJobs();
  const jobsByAgent = {};
  for (const job of jobs) {
    const aid = job.agentId || 'main';
    if (!jobsByAgent[aid]) jobsByAgent[aid] = [];
    jobsByAgent[aid].push(job);
  }

  for (const agent of agents) {
    const agentJobs = jobsByAgent[agent] || [];
    const now = Date.now();
    
    // Find most recent run across all jobs for this agent
    let lastRunMs = 0;
    let lastJobName = '';
    let nextRunMs = Infinity;
    let nextJobName = '';

    for (const job of agentJobs) {
      const lr = job.state?.lastRunAtMs || 0;
      const nr = job.state?.nextRunAtMs || 0;
      if (lr > lastRunMs) { lastRunMs = lr; lastJobName = job.name; }
      if (nr > now && nr < nextRunMs) { nextRunMs = nr; nextJobName = job.name; }
    }

    // Also check session files for main agent activity
    const sessionsDir = path.join(os.homedir(), `.openclaw/agents/${agent}/sessions`);
    let lastSessionMs = 0;
    try {
      const files = fs.readdirSync(sessionsDir).filter(f => f.endsWith('.jsonl'));
      for (const f of files) {
        const mtime = fs.statSync(path.join(sessionsDir, f)).mtimeMs;
        if (mtime > lastSessionMs) lastSessionMs = mtime;
      }
    } catch {}

    const lastActiveMs = Math.max(lastRunMs, lastSessionMs);
    const secsAgo = (now - lastActiveMs) / 1000;
    
    // Active if ran in last 5 minutes
    const isActive = secsAgo < 300;

    result[agent] = {
      id: agent,
      label: agentLabels[agent],
      icon: agentIcons[agent],
      status: isActive ? 'active' : 'idle',
      lastActiveMs,
      lastActiveAgo: Math.floor(secsAgo),
      lastJobName,
      nextRunMs: nextRunMs === Infinity ? null : nextRunMs,
      nextJobName,
    };
  }
  return result;
}

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');

  if (req.url === '/api/runs') {
    const runs = getRecentRuns(20);
    res.end(JSON.stringify(runs));
  } else if (req.url === '/api/jobs') {
    const jobs = getJobs();
    res.end(JSON.stringify(jobs));
  } else if (req.url === '/api/agents') {
    res.end(JSON.stringify(getAgentStatus()));
  } else if (req.url === '/api/status') {
    const runs = getRecentRuns(5);
    const jobs = getJobs();
    const agents = getAgentStatus();
    res.end(JSON.stringify({ runs, jobs, agents, ts: Date.now() }));
  } else {
    res.statusCode = 404;
    res.end('{}');
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Mothership data server running at http://127.0.0.1:${PORT}`);
});
