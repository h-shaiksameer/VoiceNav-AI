from __future__ import annotations

import asyncio
import io
import logging
import os
import shutil
import subprocess
import tempfile
import threading
import time
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

import soundfile as sf
import torch
import torchaudio
from fastapi import FastAPI, File, HTTPException, UploadFile
from dotenv import load_dotenv
from transformers import pipeline

load_dotenv(Path(__file__).resolve().parents[2] / ".env")
logging.basicConfig(level=os.getenv("META_MMS_LOG_LEVEL", "INFO"))
logger = logging.getLogger("meta-mms")

MODEL_ID = os.getenv("META_MMS_MODEL_ID", "facebook/mms-1b-all").strip()
MODEL_PATH = os.getenv("META_MMS_MODEL_PATH", "").strip()
DEVICE = os.getenv("META_MMS_DEVICE", "cpu").strip().lower()
LANGUAGE = os.getenv("META_MMS_LANGUAGE", "eng").strip()
MAX_AUDIO_BYTES = int(os.getenv("META_MMS_MAX_AUDIO_BYTES", str(15 * 1024 * 1024)))
MAX_AUDIO_SECONDS = float(os.getenv("META_MMS_MAX_AUDIO_SECONDS", "90"))
SAMPLE_RATE = 16000


class MmsEngine:
    def __init__(self) -> None:
        self.pipeline: Any | None = None
        self.source = MODEL_PATH or MODEL_ID
        self.error: str | None = None
        self.lock = threading.Lock()

    def load(self) -> None:
        if DEVICE != "cpu":
            raise RuntimeError("Only CPU inference is currently supported by this service.")
        logger.info("Loading MMS model from %s", self.source)
        started = time.perf_counter()
        self.pipeline = pipeline(
            "automatic-speech-recognition",
            model=self.source,
            device=-1,
        )
        logger.info("MMS model loaded in %.0f ms", (time.perf_counter() - started) * 1000)

    def status(self) -> dict[str, object]:
        return {
            "ready": self.pipeline is not None,
            "provider": "meta-mms",
            "model": MODEL_ID,
            "source": self.source,
            "language": LANGUAGE,
            "device": DEVICE,
            "error": self.error,
        }

    def transcribe(self, audio: Any, sampling_rate: int) -> str:
        if self.pipeline is None:
            raise RuntimeError(self.error or "MMS model is not ready.")
        if sampling_rate != SAMPLE_RATE:
            waveform = torch.from_numpy(audio)
            waveform = torchaudio.functional.resample(waveform, sampling_rate, SAMPLE_RATE)
            audio = waveform.numpy()
        with self.lock, torch.inference_mode():
            result = self.pipeline({"raw": audio, "sampling_rate": SAMPLE_RATE})
        text = str(result.get("text", "")).strip()
        if not text:
            raise ValueError("MMS returned empty transcription.")
        return text


engine = MmsEngine()


@asynccontextmanager
async def lifespan(_: FastAPI):
    try:
        await asyncio.to_thread(engine.load)
    except Exception as error:
        engine.error = str(error)
        logger.exception("MMS model initialization failed")
    yield


app = FastAPI(title="VoiceNav Meta MMS Service", version="1.0.0", lifespan=lifespan)


def decode_audio(data: bytes, filename: str | None, content_type: str | None) -> tuple[Any, int]:
    try:
        audio, sampling_rate = sf.read(io.BytesIO(data), dtype="float32", always_2d=False)
    except Exception as direct_error:
        ffmpeg = shutil.which("ffmpeg")
        if not ffmpeg:
            raise ValueError("Audio format could not be decoded. Install ffmpeg for browser WebM/Ogg audio.") from direct_error
        suffix = Path(filename or "audio.webm").suffix or ".webm"
        with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as source:
            source.write(data)
            source_path = source.name
        try:
            result = subprocess.run(
                [ffmpeg, "-v", "error", "-i", source_path, "-f", "wav", "-ac", "1", "-ar", str(SAMPLE_RATE), "pipe:1"],
                check=False,
                capture_output=True,
            )
            if result.returncode != 0:
                detail = result.stderr.decode(errors="replace").strip()[-300:]
                raise ValueError(f"Audio decoding failed: {detail or content_type or 'unknown format'}")
            audio, sampling_rate = sf.read(io.BytesIO(result.stdout), dtype="float32", always_2d=False)
        finally:
            Path(source_path).unlink(missing_ok=True)
    if getattr(audio, "ndim", 1) > 1:
        audio = audio.mean(axis=1)
    duration = len(audio) / sampling_rate if sampling_rate else 0
    if not sampling_rate or duration <= 0 or duration > MAX_AUDIO_SECONDS:
        raise ValueError(f"Audio duration must be greater than zero and at most {MAX_AUDIO_SECONDS:g} seconds.")
    return audio, sampling_rate


@app.get("/health")
async def health() -> dict[str, object]:
    status = engine.status()
    if not status["ready"]:
        raise HTTPException(status_code=503, detail=status)
    return status


@app.post("/transcribe")
async def transcribe(audio: UploadFile = File(...)) -> dict[str, object]:
    if engine.pipeline is None:
        raise HTTPException(status_code=503, detail="MMS model is unavailable. Start the service with a valid model path.")
    data = await audio.read(MAX_AUDIO_BYTES + 1)
    if len(data) > MAX_AUDIO_BYTES:
        raise HTTPException(status_code=413, detail="Audio file exceeds the configured maximum size.")
    if not data:
        raise HTTPException(status_code=400, detail="Audio file is empty.")
    try:
        waveform, sampling_rate = decode_audio(data, audio.filename, audio.content_type)
        started = time.perf_counter()
        text = await asyncio.wait_for(asyncio.to_thread(engine.transcribe, waveform, sampling_rate), timeout=MAX_AUDIO_SECONDS + 30)
        elapsed = round((time.perf_counter() - started) * 1000)
        logger.info("Transcribed %s in %d ms", audio.filename or "audio", elapsed)
        return {"success": True, "text": text, "provider": "meta-mms", "model": MODEL_ID, "language": LANGUAGE, "inferenceTimeMs": elapsed}
    except asyncio.TimeoutError as error:
        logger.error("MMS inference timed out")
        raise HTTPException(status_code=504, detail="MMS inference timed out.") from error
    except ValueError as error:
        logger.warning("Invalid audio: %s", error)
        raise HTTPException(status_code=400, detail=str(error)) from error
    except Exception as error:
        logger.exception("MMS inference failed")
        raise HTTPException(status_code=502, detail="MMS inference failed.") from error
