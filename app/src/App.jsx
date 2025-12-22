import React, { useEffect, useState } from 'react'

const ENGINE = 'http://127.0.0.1:8787'

export default function App() {
  const [health, setHealth] = useState(null)
  const [projects, setProjects] = useState([])
  const [activeProjectId, setActiveProjectId] = useState(null)
  const [summary, setSummary] = useState(null)

  useEffect(() => {
    fetch(`${ENGINE}/health`).then(r => r.json()).then(setHealth).catch(() => setHealth({ok:false}))
    fetch(`${ENGINE}/projects`).then(r => r.json()).then(setProjects).catch(() => setProjects([]))
  }, [])

  async function createDemoProject() {
    const payload = { name: 'Demo', scope_allow: ['www.amazon.com'], scope_deny: [], qps: 3 }
    const res = await fetch(`${ENGINE}/projects`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload) })
    const p = await res.json()
    setProjects(prev => [...prev, p])
    setActiveProjectId(p.id)
  }

  async function importHar(file) {
    if (!activeProjectId) return
    const fd = new FormData()
    fd.append('har', file)
    const res = await fetch(`${ENGINE}/import/har?project_id=${activeProjectId}&include_assets=false`, { method:'POST', body: fd })
    await res.json()
    const s = await fetch(`${ENGINE}/summary?project_id=${activeProjectId}`).then(r => r.json())
    setSummary(s)
  }

  return (
    <div style={{fontFamily:'system-ui', padding: 18, maxWidth: 1100}}>
      <h1 style={{margin:0}}>PwnyHub</h1>
      <p style={{marginTop:6, opacity:0.8}}>Standalone hub (Electron UI) + engine (FastAPI). MVP: HAR import → normalize → summarize.</p>

      <div style={{display:'flex', gap:12, alignItems:'center'}}>
        <div><b>Engine:</b> {health ? (health.ok ? 'OK' : 'Down') : '...'}</div>
        <button onClick={createDemoProject}>Create demo project</button>
        <select value={activeProjectId ?? ''} onChange={e=>setActiveProjectId(e.target.value ? Number(e.target.value) : null)}>
          <option value=''>Select project…</option>
          {projects.map(p => <option key={p.id} value={p.id}>{p.name} (id {p.id})</option>)}
        </select>
        <input type="file" accept=".har" onChange={e => e.target.files?.[0] && importHar(e.target.files[0])} />
      </div>

      {summary && (
        <div style={{marginTop:18}}>
          <h2>Import summary</h2>
          <div><b>Entries stored:</b> {summary.entries}</div>
          <h3>Top hosts</h3>
          <ul>
            {summary.hosts.map(([h,c]) => <li key={h}><code>{h}</code> — {c}</li>)}
          </ul>
          <h3>Top MIME types</h3>
          <ul>
            {summary.mimes.map(([m,c]) => <li key={m}><code>{m || '(none)'}</code> — {c}</li>)}
          </ul>
        </div>
      )}
    </div>
  )
}
