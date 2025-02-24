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

@app.post("/speak")
async def speak(request: Request):
    """
    Receives a request from the UI with the spoken text and conversation details,
    then forwards it to the orchestrator's streaming API in text-only mode.
    The request includes an x-functions-key header for authentication.
    """
    body = await request.json()
    question = body.get("spokenText")
    conversation_id = body.get("conversation_id", "")
    if not question:
        raise HTTPException(status_code=400, detail="Missing spokenText in request.")
    
    # Build the payload for the orchestrator.
    payload = {
        "conversation_id": conversation_id,
        "question": question,
        "text_only": True,
        "client_principal_id": body.get("client_principal_id", ""),
        "client_principal_name": body.get("client_principal_name", ""),
        "access_token": body.get("access_token", "")
    }
    
    headers = {
        "x-functions-key": FUNCTION_KEY,
        "Content-Type": "application/json"
    }
    
    async def stream_generator():
        async with httpx.AsyncClient(timeout=None) as client:
            async with client.stream("POST", ORCHESTRATOR_STREAM_URL, json=payload, headers=headers) as resp:
                if resp.status_code != 200:
                    yield f"Error: {resp.status_code}"
                    return
                async for line in resp.aiter_lines():
                    if line:
                        yield line

    return StreamingResponse(stream_generator(), media_type="text/event-stream")


@app.get("/get-ice-server-token")
async def get_ice_server_token():
    """
    Retrieves the ICE server token from the Speech service.
    """
    speech_region = os.getenv("AZURE_SPEECH_REGION", "westus2")
    subscription_key = os.getenv("AZURE_SPEECH_API_KEY")
    if not subscription_key:
        raise HTTPException(status_code=400, detail="Missing Azure Speech subscription key.")

    token_url = f"https://{speech_region}.tts.speech.microsoft.com/cognitiveservices/avatar/relay/token/v1"
    async with httpx.AsyncClient() as client:
        headers = {"Ocp-Apim-Subscription-Key": subscription_key}
        response = await client.get(token_url, headers=headers)
        if response.status_code == 200:
            return JSONResponse(content=response.json())
        else:
            raise HTTPException(status_code=response.status_code, detail="Failed to get ICE server token.")

@app.get("/get-speech-region")
async def get_speech_region():
    speech_region = os.getenv("AZURE_SPEECH_REGION", "eastus2")
    return JSONResponse(content={"speech_region": speech_region})

@app.get("/get-supported-languages")
async def get_supported_languages():
    supported_languages = os.getenv("SUPPORTED_LANGUAGES", "en-US,de-DE,zh-CN,nl-NL")
    languages_list = [lang.strip() for lang in supported_languages.split(",")]
    return JSONResponse(content={"supported_languages": languages_list})


@app.get("/get-speech-token")
async def get_speech_token():
    """
    Retrieves the speech token from the Azure Speech service.
    """
    speech_region = os.getenv("AZURE_SPEECH_REGION", "westus2")
    subscription_key = os.getenv("AZURE_SPEECH_API_KEY")
    if not subscription_key:
        raise HTTPException(status_code=400, detail="Missing Azure Speech subscription key.")

    token_url = f"https://{speech_region}.api.cognitive.microsoft.com/sts/v1.0/issueToken"
    async with httpx.AsyncClient() as client:
        headers = {"Ocp-Apim-Subscription-Key": subscription_key}
        response = await client.post(token_url, headers=headers)
        if response.status_code == 200:
            return JSONResponse(content={"token": response.text})
        else:
            raise HTTPException(status_code=response.status_code, detail="Failed to get speech token.")


# Ensure the app listens on the port specified by the environment variable (for Azure App Service)
if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=True)

