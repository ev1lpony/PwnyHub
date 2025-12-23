MODULE = {
  "id": "hello",
  "name": "Hello Module",
  "kind": "passive",
  "targets": ["project"],
  "description": "Sanity test module",
  "params_schema": {}
}

def run(ctx):
  return {
    "summary": {"msg": "hi", "project_id": ctx["project_id"]},
    "findings": [
      {
        "severity": "info",
        "title": "Hello finding",
        "description": "Module system is working",
        "evidence": {"ctx_keys": list(ctx.keys())},
        "tags": ["hello"],
        "action_keys": []
      }
    ]
  }
