const express = require('express');
const path = require('path');
const fs = require('fs');
const os = require('os');
const https = require('https');
const yaml = require('js-yaml');
const { Pool } = require('pg');
const { createClient } = require('redis');
const { MongoClient } = require('mongodb');

const PORT = process.env.PORT || 4600;
const TIMEOUT = 5000;

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://mts:mts_password@localhost:5435/mts_dev';
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6381';
const MONGODB_URL = process.env.MONGODB_URL || 'mongodb://localhost:27018';
const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:8000/health';
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000';
const GRAFANA_URL = process.env.GRAFANA_URL || 'http://localhost:3001';
const PROMETHEUS_URL = process.env.PROMETHEUS_URL || 'http://localhost:9090/-/healthy';
const ALERTMANAGER_URL = process.env.ALERTMANAGER_URL || 'http://localhost:9093/-/healthy';
const KUBE_CONTEXT = process.env.KUBE_CONTEXT || 'kind-mts-dev';
const KUBE_NAMESPACE = process.env.KUBE_NAMESPACE || 'mts';

const app = express();
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  next();
});
app.use(express.static(path.join(__dirname, '..', 'dashboard')));

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms)),
  ]);
}

async function checkHttp(url) {
  const start = Date.now();
  try {
    const res = await withTimeout(fetch(url), TIMEOUT);
    return { status: res.ok ? 'up' : 'down', http_status: res.status, latency_ms: Date.now() - start };
  } catch (e) {
    return { status: 'down', error: e.message };
  }
}

// ── PostgreSQL ────────────────────────────────────────────────────────────
const pgPool = new Pool({ connectionString: DATABASE_URL, connectionTimeoutMillis: TIMEOUT });

app.get('/api/postgres/status', async (req, res) => {
  const start = Date.now();
  try {
    const client = await withTimeout(pgPool.connect(), TIMEOUT);
    try {
      const version = await client.query('SELECT version()');
      const size = await client.query('SELECT pg_size_pretty(pg_database_size(current_database())) AS size');
      const tables = await client.query(`
        SELECT relname AS table_name, n_live_tup AS row_estimate
        FROM pg_stat_user_tables ORDER BY n_live_tup DESC LIMIT 50
      `);
      res.json({
        status: 'up',
        latency_ms: Date.now() - start,
        version: version.rows[0].version,
        size: size.rows[0].size,
        tables: tables.rows,
      });
    } finally {
      client.release();
    }
  } catch (e) {
    res.status(503).json({ status: 'down', error: e.message });
  }
});

// ── Redis ─────────────────────────────────────────────────────────────────
app.get('/api/redis/status', async (req, res) => {
  const start = Date.now();
  const client = createClient({ url: REDIS_URL, socket: { connectTimeout: TIMEOUT } });
  client.on('error', () => {});
  try {
    await withTimeout(client.connect(), TIMEOUT);
    const pong = await client.ping();
    const dbsize = await client.dbSize();
    const infoRaw = await client.info('memory');
    const usedMemory = (infoRaw.match(/used_memory_human:(\S+)/) || [])[1] || 'unknown';
    await client.quit();
    res.json({ status: 'up', latency_ms: Date.now() - start, pong, dbsize, used_memory: usedMemory });
  } catch (e) {
    try { await client.quit(); } catch (_) {}
    res.status(503).json({ status: 'down', error: e.message });
  }
});

// ── MongoDB ───────────────────────────────────────────────────────────────
app.get('/api/mongodb/status', async (req, res) => {
  const start = Date.now();
  const client = new MongoClient(MONGODB_URL, { serverSelectionTimeoutMS: TIMEOUT });
  try {
    await client.connect();
    const admin = client.db().admin();
    await admin.ping();
    const { databases } = await admin.listDatabases();
    await client.close();
    res.json({
      status: 'up',
      latency_ms: Date.now() - start,
      databases: databases.map(d => ({ name: d.name, size_bytes: d.sizeOnDisk })),
    });
  } catch (e) {
    try { await client.close(); } catch (_) {}
    res.status(503).json({ status: 'down', error: e.message });
  }
});

// ── Application services ─────────────────────────────────────────────────
app.get('/api/services/status', async (req, res) => {
  const [backend, frontend] = await Promise.all([checkHttp(BACKEND_URL), checkHttp(FRONTEND_URL)]);
  res.json({ backend, frontend });
});

// ── Monitoring stack (prod compose only) ─────────────────────────────────
app.get('/api/monitoring/status', async (req, res) => {
  const [grafana, prometheus, alertmanager] = await Promise.all([
    checkHttp(GRAFANA_URL + '/api/health'),
    checkHttp(PROMETHEUS_URL),
    checkHttp(ALERTMANAGER_URL),
  ]);
  res.json({ grafana, prometheus, alertmanager });
});

// ── Kubernetes (kind cluster) ─────────────────────────────────────────────
function readKubeconfig() {
  const kcPath = process.env.KUBECONFIG || path.join(os.homedir(), '.kube', 'config');
  return yaml.load(fs.readFileSync(kcPath, 'utf8'));
}

// When running inside a container, 127.0.0.1/localhost in the kubeconfig
// resolves to the container itself, not the host running kind. Remap to
// host.docker.internal and skip TLS verification (kind's cert isn't issued
// for that hostname) so kubectl-equivalent calls can still reach the API server.
const K8S_DOCKER_HOST_REMAP = process.env.K8S_DOCKER_HOST_REMAP === 'true';

function buildClient(contextName, kc) {
  const ctx = (kc.contexts || []).find(c => c.name === contextName)?.context;
  if (!ctx) throw new Error(`context "${contextName}" not found in kubeconfig`);
  const cluster = (kc.clusters || []).find(c => c.name === ctx.cluster)?.cluster;
  const user = (kc.users || []).find(u => u.name === ctx.user)?.user || {};

  const agentOpts = { rejectUnauthorized: false };
  let server = cluster.server;
  if (K8S_DOCKER_HOST_REMAP) {
    const remapped = server.replace('https://127.0.0.1', 'https://host.docker.internal')
                            .replace('https://localhost', 'https://host.docker.internal');
    if (remapped !== server) server = remapped;
  } else if (cluster['certificate-authority-data']) {
    agentOpts.ca = Buffer.from(cluster['certificate-authority-data'], 'base64');
  }
  const headers = { 'Content-Type': 'application/json' };
  if (user.token) {
    headers['Authorization'] = `Bearer ${user.token}`;
  } else if (user['client-certificate-data']) {
    agentOpts.cert = Buffer.from(user['client-certificate-data'], 'base64');
    agentOpts.key = Buffer.from(user['client-key-data'], 'base64');
  } else {
    throw new Error('unsupported auth method in kubeconfig for this context');
  }
  return { server, agentOpts, headers, namespace: ctx.namespace };
}

function fetchK8s(contextName, urlPath) {
  return new Promise((resolve, reject) => {
    let client;
    try {
      client = buildClient(contextName, readKubeconfig());
    } catch (e) {
      return reject(e);
    }
    const req = https.request(client.server + urlPath, {
      method: 'GET', headers: client.headers, agent: new https.Agent(client.agentOpts),
    }, r => {
      let data = '';
      r.on('data', c => (data += c));
      r.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (e) { reject(new Error('bad JSON from API server')); }
      });
    });
    req.setTimeout(TIMEOUT, () => { req.destroy(); reject(new Error('timeout')); });
    req.on('error', reject);
    req.end();
  });
}

app.get('/api/k8s/summary', async (req, res) => {
  try {
    const [nodesData, podsData, depsData, svcData] = await Promise.all([
      fetchK8s(KUBE_CONTEXT, '/api/v1/nodes'),
      fetchK8s(KUBE_CONTEXT, `/api/v1/namespaces/${KUBE_NAMESPACE}/pods`),
      fetchK8s(KUBE_CONTEXT, `/apis/apps/v1/namespaces/${KUBE_NAMESPACE}/deployments`),
      fetchK8s(KUBE_CONTEXT, `/api/v1/namespaces/${KUBE_NAMESPACE}/services`),
    ]);

    const nodes = (nodesData.items || []).map(n => ({
      name: n.metadata.name,
      status: (n.status.conditions || []).find(c => c.type === 'Ready')?.status === 'True' ? 'Ready' : 'NotReady',
      role: n.metadata.labels['node-role.kubernetes.io/control-plane'] !== undefined ? 'control-plane' : 'worker',
      version: n.status.nodeInfo.kubeletVersion,
    }));

    const pods = (podsData.items || []).map(p => {
      const cs = p.status.containerStatuses || [];
      return {
        name: p.metadata.name,
        status: p.status.phase,
        ready: `${cs.filter(c => c.ready).length}/${cs.length}`,
        restarts: cs.reduce((s, c) => s + (c.restartCount || 0), 0),
        node: p.spec.nodeName,
      };
    });

    const deployments = (depsData.items || []).map(d => ({
      name: d.metadata.name,
      desired: d.spec.replicas || 0,
      ready: d.status.readyReplicas || 0,
      available: d.status.availableReplicas || 0,
    }));

    const services = (svcData.items || []).map(s => ({
      name: s.metadata.name,
      type: s.spec.type,
      cluster_ip: s.spec.clusterIP,
      ports: (s.spec.ports || []).map(p => `${p.port}/${p.protocol}`).join(', '),
    }));

    res.json({ status: 'up', context: KUBE_CONTEXT, namespace: KUBE_NAMESPACE, nodes, pods, deployments, services });
  } catch (e) {
    res.status(503).json({ status: 'down', error: e.message, context: KUBE_CONTEXT });
  }
});

app.listen(PORT, () => {
  console.log(`MTS Ops Dashboard listening on http://localhost:${PORT}`);
});
