"""Image-to-video providers.

Two backends are supported and selected by the `provider` key in the YAML:

  * Replicate  -> https://replicate.com/wan-video/wan-2.2-i2v-fast
                  https://replicate.com/wan-video/wan-2.2-i2v-a14b
  * fal.ai     -> https://fal.ai/models/fal-ai/minimax/hailuo-02/...
                  https://fal.ai/models/fal-ai/wan/v2.2-a14b/image-to-video/turbo
                  https://fal.ai/models/fal-ai/kling-video/...

Each provider exposes a single `generate(image_path, prompt, ...)` -> mp4 path.
"""
from __future__ import annotations

import logging
import os
import time
from pathlib import Path
from typing import Callable

import requests

LOG = logging.getLogger("photo2livephoto.i2v")


# -----------------------------------------------------------------------
# Model registry: alias -> (provider, endpoint, default_kwargs_builder)
# -----------------------------------------------------------------------
def _wan22_fast_kwargs(prompt: str, duration: int, resolution: str) -> dict:
    return {
        "image": None,  # filled by caller
        "prompt": prompt,
        "num_frames": 81 if duration <= 5 else 121,
        "resolution": "480p" if resolution == "480p" else "720p",
    }


def _wan22_full_kwargs(prompt: str, duration: int, resolution: str) -> dict:
    return {
        "image": None,
        "prompt": prompt,
        "resolution": "720p" if resolution != "480p" else "480p",
        "num_frames": 81 if duration <= 5 else 121,
    }


# Replicate model slugs (versionless; Replicate resolves to latest)
REPLICATE_MODELS: dict[str, tuple[str, Callable[[str, int, str], dict]]] = {
    "wan-2.2-fast": ("wan-video/wan-2.2-i2v-fast", _wan22_fast_kwargs),
    "wan-2.2":      ("wan-video/wan-2.2-i2v-a14b", _wan22_full_kwargs),
}

# fal.ai endpoints
FAL_MODELS: dict[str, str] = {
    "wan-2.2-turbo": "fal-ai/wan/v2.2-a14b/image-to-video/turbo",
    "wan-2.2":       "fal-ai/wan/v2.2-a14b/image-to-video",
    "hailuo-02":     "fal-ai/minimax/hailuo-02/standard/image-to-video",
    "kling-2.1":     "fal-ai/kling-video/v2.1/standard/image-to-video",
    "kling-2.5":     "fal-ai/kling-video/v2.5-turbo/standard/image-to-video",
}


# =======================================================================
# Replicate backend
# =======================================================================
def _replicate_generate(
    image_path: Path,
    prompt: str,
    *,
    model_alias: str,
    duration: int,
    resolution: str,
    out_dir: Path,
) -> Path:
    import replicate

    if model_alias not in REPLICATE_MODELS:
        raise ValueError(
            f"Replicate provider does not support model '{model_alias}'. "
            f"Available: {list(REPLICATE_MODELS)}"
        )
    model_slug, kwargs_builder = REPLICATE_MODELS[model_alias]
    kwargs = kwargs_builder(prompt, duration, resolution)

    LOG.info("[replicate] %s | %s", model_slug, image_path.name)
    with image_path.open("rb") as fh:
        kwargs["image"] = fh
        # Replicate returns a list of FileOutput (or single).
        output = replicate.run(model_slug, input=kwargs)

    # Normalize to a URL we can download.
    video_url = _extract_url(output)
    LOG.info("[replicate] generated -> %s", video_url)
    return _download(video_url, out_dir, stem=image_path.stem)


# =======================================================================
# fal.ai backend
# =======================================================================
def _fal_generate(
    image_path: Path,
    prompt: str,
    *,
    model_alias: str,
    duration: int,
    resolution: str,
    out_dir: Path,
) -> Path:
    import fal_client

    if model_alias not in FAL_MODELS:
        raise ValueError(
            f"fal.ai provider does not support model '{model_alias}'. "
            f"Available: {list(FAL_MODELS)}"
        )
    endpoint = FAL_MODELS[model_alias]

    # Upload local image to fal storage and get a hosted URL
    LOG.info("[fal] uploading %s", image_path.name)
    image_url = fal_client.upload_file(str(image_path))

    payload: dict = {"image_url": image_url, "prompt": prompt}
    # Hailuo expects "duration"; Wan expects "num_frames"; Kling expects "duration"
    if "wan" in endpoint:
        payload["num_frames"] = 81 if duration <= 5 else 121
        payload["resolution"] = "720p" if resolution != "480p" else "480p"
    elif "hailuo" in endpoint:
        payload["duration"] = max(6, duration)  # Hailuo allows 6 or 10
        payload["resolution"] = "768P" if resolution != "1080p" else "1080P"
    elif "kling" in endpoint:
        payload["duration"] = "5" if duration <= 5 else "10"

    LOG.info("[fal] %s | %s", endpoint, image_path.name)
    handler = fal_client.submit(endpoint, arguments=payload)
    result = handler.get()
    video_url = _extract_url(result)
    LOG.info("[fal] generated -> %s", video_url)
    return _download(video_url, out_dir, stem=image_path.stem)


# =======================================================================
# Helpers
# =======================================================================
def _extract_url(output) -> str:
    """Replicate / fal both nest the URL slightly differently."""
    if hasattr(output, "url"):  # Replicate FileOutput
        return output.url
    if isinstance(output, list) and output:
        first = output[0]
        return first.url if hasattr(first, "url") else str(first)
    if isinstance(output, dict):
        # fal.ai shape: {"video": {"url": "..."}}
        if "video" in output and isinstance(output["video"], dict):
            return output["video"]["url"]
        if "url" in output:
            return output["url"]
        if "output" in output:
            return _extract_url(output["output"])
    if isinstance(output, str):
        return output
    raise RuntimeError(f"Cannot extract video URL from response: {output!r}")


def _download(url: str, out_dir: Path, *, stem: str) -> Path:
    out_dir.mkdir(parents=True, exist_ok=True)
    target = out_dir / f"{stem}.mp4"
    LOG.info("downloading %s -> %s", url, target)
    with requests.get(url, stream=True, timeout=180) as r:
        r.raise_for_status()
        with target.open("wb") as fh:
            for chunk in r.iter_content(chunk_size=64 * 1024):
                fh.write(chunk)
    return target


# =======================================================================
# Public dispatcher
# =======================================================================
def generate_video(
    image_path: Path,
    *,
    provider: str,
    model: str,
    prompt: str,
    duration: int,
    resolution: str,
    out_dir: Path,
    retries: int = 2,
) -> Path:
    last_err: Exception | None = None
    for attempt in range(retries + 1):
        try:
            if provider == "replicate":
                return _replicate_generate(
                    image_path,
                    prompt,
                    model_alias=model,
                    duration=duration,
                    resolution=resolution,
                    out_dir=out_dir,
                )
            elif provider == "fal":
                return _fal_generate(
                    image_path,
                    prompt,
                    model_alias=model,
                    duration=duration,
                    resolution=resolution,
                    out_dir=out_dir,
                )
            else:
                raise ValueError(
                    f"Unknown provider '{provider}'. Use 'replicate' or 'fal'."
                )
        except Exception as exc:  # noqa: BLE001
            last_err = exc
            LOG.warning(
                "attempt %d/%d failed for %s: %s",
                attempt + 1,
                retries + 1,
                image_path.name,
                exc,
            )
            time.sleep(2 + attempt * 3)
    assert last_err is not None
    raise last_err
