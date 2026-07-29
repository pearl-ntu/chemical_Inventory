#!/usr/bin/env node
import http from 'node:http'
import { exec } from 'node:child_process'
import { existsSync, readdirSync, statSync, readFileSync } from 'node:fs'
import { join, resolve, extname, basename } from 'node:path'
import { platform } from 'node:os'

const PORT = Number(process.env.PEARL_AGENT_PORT || 8787)
const TOKEN = process.env.PEARL_AGENT_TOKEN || ''
const ROOT = resolve(process.env.PEARL_AGENT_ROOT || process.cwd())
const MAX_OUTPUT = Number(process.env.PEARL_AGENT_MAX_OUTPUT || 200000)
const MAX_FILES = Number(process.env.PEARL_AGENT_MAX_FILES || 8000)
const ALLOW_WRITES = ['1', 'true', 'yes'].includes((process.env.PEARL_AGENT_ALLOW_WRITES || '').toLowerCase())
const DANGEROUS_RE = /(^|[;&|]\s*)(rm|rmdir|mv|cp|touch|mkdir|chmod|chown|dd|truncate|tee|install|unlink|shred|rsync|scp)\b|(^|[;&|]\s*)(python|python3|perl|ruby|node|bash|sh)\b.*\b(open|write|remove|unlink|rmtree)\b|(^|[^<])>\s*[^&]|>>|<\(|\|\s*tee\b/i

function send(res, code, body) {
  res.writeHead(code, {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'content-type, authorization',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Content-Type': 'application/json; charset=utf-8',
  })
  res.end(JSON.stringify(body))
}

function readJson(req) {
  return new Promise((resolveBody, reject) => {
    let raw = ''
    req.on('data', (chunk) => {
      raw += chunk
      if (raw.length > 2_000_000) req.destroy()
    })
    req.on('end', () => {
      try {
        resolveBody(raw ? JSON.parse(raw) : {})
      } catch (err) {
        reject(err)
      }
    })
  })
}

function authorized(req) {
  if (!TOKEN) return true
  return req.headers.authorization === `Bearer ${TOKEN}`
}

function insideRoot(path) {
  const target = resolve(ROOT, path || '.')
  if (target === ROOT || target.startsWith(ROOT + (platform() === 'win32' ? '\\' : '/'))) return target
  throw new Error('Path is outside PEARL_AGENT_ROOT')
}

function runCommand(command, cwd) {
  return new Promise((resolveRun) => {
    if (!ALLOW_WRITES && DANGEROUS_RE.test(command)) {
      resolveRun({
        code: 126,
        stdout: '',
        stderr: 'Blocked by PEARL read-only mode. Use ls/find/grep/tail/cat/du/pwd/qstat-style commands, or scan a folder. Set PEARL_AGENT_ALLOW_WRITES=1 only if you intentionally want write commands.',
        cwd,
      })
      return
    }
    const shell = platform() === 'win32' ? 'powershell.exe' : '/bin/bash'
    const child = exec(command, { cwd, shell, timeout: 120000, maxBuffer: MAX_OUTPUT }, (error, stdout, stderr) => {
      resolveRun({
        code: typeof error?.code === 'number' ? error.code : 0,
        stdout,
        stderr,
        cwd,
      })
    })
    child.stdin?.end()
  })
}

function walk(dir, rows, count = { n: 0 }) {
  if (count.n >= MAX_FILES) return
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (count.n >= MAX_FILES) return
    if (entry.name.startsWith('.') || ['node_modules', '.git', '__pycache__'].includes(entry.name)) continue
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      walk(path, rows, count)
      continue
    }
    count.n += 1
    const ext = extname(entry.name).toLowerCase()
    if (!['.log', '.out', '.inp', '.gjf', '.com', '.xml'].includes(ext) && !['OUTCAR', 'vasprun.xml'].includes(entry.name)) continue
    const stat = statSync(path)
    const parsed = parseCalculation(path)
    if (parsed) {
      rows.push({
        ...parsed,
        path,
        size_bytes: stat.size,
        size_label: `${stat.size} bytes`,
        last_modified: stat.mtime.toISOString(),
      })
    }
  }
}

function parseCalculation(path) {
  const name = basename(path)
  const text = readFileSync(path, 'utf8').slice(-300000)
  const lower = text.toLowerCase()
  const software = detectSoftware(name, lower)
  if (!software) return null
  const energy =
    /total energy\s*=\s*(-?\d+(?:\.\d+)?)/i.exec(text)?.[1] ||
    /final.*energy\s*(?:is|=)\s*(-?\d+(?:\.\d+)?)/i.exec(text)?.[1] ||
    /final single point energy\s+(-?\d+(?:\.\d+)?)/i.exec(text)?.[1] ||
    /scf done:\s+e\([^)]+\)\s+=\s+(-?\d+(?:\.\d+)?)/i.exec(text)?.[1] ||
    /free\s+energy\s+totEN\s+=\s+(-?\d+(?:\.\d+)?)/i.exec(text)?.[1] ||
    null
  const method = software === 'GAMESS'
    ? (/CONTRL OPTIONS[\s\S]*?SCFTYP=([A-Z0-9]+)/i.exec(text)?.[1]?.trim() || /SCFTYP=([A-Z0-9]+)/i.exec(text)?.[1]?.trim() || null)
    : (/!\s*([A-Z0-9+\-]+\s+[A-Z0-9+\-*/(),]+)/.exec(text)?.[1]?.trim() ||
      /#\s*([A-Za-z0-9+\-_/(),= ]+)/.exec(text)?.[1]?.trim() ||
      null)
  const warnings = []
  if (lower.includes('error')) warnings.push('error found')
  if (lower.includes('warning')) warnings.push('warning found')
  if (lower.includes('imaginary')) warnings.push('imaginary frequency mention')
  const complete =
    lower.includes('normal termination') ||
    lower.includes('orca terminated normally') ||
    lower.includes('terminated normally') ||
    lower.includes('execution of gamess terminated normally') ||
    lower.includes('total run time') ||
    lower.includes('reached required accuracy')
  const failed = lower.includes('error termination') || lower.includes('aborting the run') || lower.includes('segmentation fault')
  return {
    title: name,
    software,
    method,
    project: path.split(/[\\/]/).slice(-2, -1)[0] || null,
    status: failed ? 'failed' : complete ? 'complete' : 'running',
    output_file: path,
    final_energy: energy,
    warnings,
  }
}

function detectSoftware(name, lower) {
  if (lower.includes('gamess') || lower.includes('firefly') || lower.includes('g a m e s s')) return 'GAMESS'
  if (name === 'OUTCAR' || name === 'vasprun.xml' || lower.includes('vasp')) return 'VASP'
  if (lower.includes('o   r   c   a') || lower.includes('orca terminated')) return 'ORCA'
  if (lower.includes('gaussian') || lower.includes('normal termination of gaussian') || lower.includes('scf done:')) return 'Gaussian'
  return null
}

http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return send(res, 200, { ok: true })
  if (!authorized(req)) return send(res, 401, { error: 'Unauthorized agent token' })
  try {
    const url = new URL(req.url || '/', `http://${req.headers.host}`)
    if (req.method === 'GET' && url.pathname === '/health') {
      return send(res, 200, { ok: true, root: ROOT, port: PORT })
    }
    if (req.method === 'POST' && url.pathname === '/run') {
      const body = await readJson(req)
      const command = String(body.command || '').trim()
      if (!command) throw new Error('No command provided')
      const cwd = insideRoot(String(body.cwd || '.'))
      return send(res, 200, await runCommand(command, cwd))
    }
    if (req.method === 'POST' && url.pathname === '/scan') {
      const body = await readJson(req)
      const root = insideRoot(String(body.root || '.'))
      if (!existsSync(root)) throw new Error('Scan path does not exist')
      const rows = []
      walk(root, rows)
      return send(res, 200, { jobs: rows, count: rows.length, root })
    }
    return send(res, 404, { error: 'Unknown PEARL agent route' })
  } catch (err) {
    return send(res, 400, { error: err instanceof Error ? err.message : 'Agent failed' })
  }
}).listen(PORT, () => {
  console.log(`PEARL HPC agent listening on http://127.0.0.1:${PORT}`)
  console.log(`Root: ${ROOT}`)
  if (!TOKEN) console.log('No PEARL_AGENT_TOKEN set. Use only on trusted localhost/private networks.')
})
