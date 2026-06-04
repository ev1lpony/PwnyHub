# PwnyHub

PwnyHub is a standalone desktop-style security workflow hub.

Current stack:
- **Electron + React (Vite)** UI
- **FastAPI + SQLite** backend engine
- Current MVP flow: **create project → define scope/ROE → import HAR → normalize traffic → triage actions → create findings**

> Current state: this is still a development workflow. The Electron shell currently loads the Vite dev server. Production packaging and automatic engine startup are future work.

## Dev quickstart

Run the backend and frontend in two separate terminals.

---

## 1) Python engine

### Windows PowerShell

```powershell
cd engine
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
python -m uvicorn pwnyhub_engine.main:app --reload --port 8787
```

If PowerShell blocks activation with an execution policy error, run this in the same terminal and then activate again:

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
.\.venv\Scripts\Activate.ps1
```

### Windows Command Prompt

```cmd
cd engine
python -m venv .venv
.venv\Scripts\activate.bat
pip install -r requirements.txt
python -m uvicorn pwnyhub_engine.main:app --reload --port 8787
```

### macOS / Linux / Git Bash / WSL

```bash
cd engine
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python -m uvicorn pwnyhub_engine.main:app --reload --port 8787
```

Engine health check:

```text
http://127.0.0.1:8787/health
```

Expected response:

```json
{"ok": true}
```

---

## 2) React UI

Open a second terminal from the repo root:

```powershell
cd app
npm install
npm run dev
```

Vite should show the local UI URL, usually:

```text
http://localhost:5173
```

---

## 3) Electron shell

Current Electron support is dev-only. With the Vite dev server already running:

```powershell
cd app
npx electron electron/main.js
```

The Electron window loads:

```text
http://localhost:5173
```

---

## Common issues

### `source` is not recognized

You are in Windows PowerShell. Use:

```powershell
.\.venv\Scripts\Activate.ps1
```

Do not use `source` unless you are in macOS, Linux, Git Bash, or WSL.

### `uvicorn` is not recognized

Use the module form instead:

```powershell
python -m uvicorn pwnyhub_engine.main:app --reload --port 8787
```

### Engine says it is down in the UI

Make sure the backend terminal is still running and that `/health` returns `{"ok": true}` at:

```text
http://127.0.0.1:8787/health
```

### The UI has no actions

Create/select a project, finish scope/ROE setup, import a HAR file, then load actions.

## Product direction

PwnyHub should become a focused bug bounty / web app security workflow hub, not a pile of buttons.

Near-term product loop:

```text
Project setup → Source import → Scope-aware action triage → Useful details → Repeatable findings/workflow
```

UX priorities:
- make first-run setup obvious
- reduce clutter on the main screen
- show what to do next at every stage
- make imports, sources, actions, findings, and modules feel like one workflow
- keep unsafe/active behavior gated behind scope and ROE controls
