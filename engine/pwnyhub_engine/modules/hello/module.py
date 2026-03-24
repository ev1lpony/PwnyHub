def run(ctx: dict, config: dict):
    return {"ok": True, "echo": config.get("message", "hi")}
