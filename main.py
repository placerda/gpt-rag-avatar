# main.py
import os
import json
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import StreamingResponse, JSONResponse, FileResponse
from fastapi.staticfiles import StaticFiles
import httpx
from dotenv import load_dotenv

load_dotenv()

app = FastAPI()

# Existing configuration for orchestrator, etc.
ORCHESTRATOR_STREAM_URL = os.getenv("STREAMING_ENDPOINT", "http://localhost:7071/api/orcstream")
FUNCTION_KEY = os.getenv("FUNCTION_KEY")
if not FUNCTION_KEY:
    raise Exception("FUNCTION_KEY not found in environment variables.")

# Mount static files from the 'static' directory.
app.mount("/static", StaticFiles(directory="static"), name="static")

# New endpoint: Serve the chat interface.
@app.get("/")
async def serve_index():
    return FileResponse("static/index.html")

# New endpoint: Serve the chat interface.
@app.get("/favicon.ico")
async def serve_index():
    return FileResponse("static/image/favicon.ico")


# ... (rest of your existing endpoints, e.g. /speak, /get-ice-server-token, /get-speech-token)

if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=True)
