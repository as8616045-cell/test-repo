"""CLI entry point.

Examples:
    # 1. One-time setup
    cp .env.example .env       # paste your Replicate or fal.ai token
    cp config.example.yaml config.yaml

    # 2. Drop photos in ./inbox, then run:
    python -m photo2livephoto.cli

    # 3. Or specify directly:
    python -m photo2livephoto.cli \\
        --input  ./my_photos \\
        --output ./my_live_photos \\
        --model  wan-2.2-fast \\
        --prompt "the man calmly continues eating his bowl of noodles"
"""
from __future__ import annotations

import argparse
import logging
import os
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import yaml
from dotenv import load_dotenv
from tqdm import tqdm

from . import i2v, livephoto

LOG = logging.getLogger("photo2livephoto")

PHOTO_EXTS = {".jpg", ".jpeg", ".png", ".heic", ".heif", ".webp"}


# ---------------------------------------------------------------------
# Config loading
# ---------------------------------------------------------------------
def load_config(path: Path | None) -> dict:
    cfg: dict = {
        "input_dir": "./inbox",
        "output_dir": "./out",
        "work_dir": "./.cache",
        "provider": "replicate",
        "model": "wan-2.2-fast",
        "duration_seconds": 5,
        "resolution": "720p",
        "default_prompt": (
            "Continue the natural motion implied by the scene. "
            "People should perform realistic, contextually appropriate "
            "actions (eating, walking, smiling, blinking, gestures). "
            "Keep camera mostly static. No teleporting, no morphing."
        ),
        "live_photo_length": 3.0,
        "keep_raw_video": True,
        "max_workers": 3,
        "retry": 2,
    }
    if path and path.exists():
        with path.open("r", encoding="utf-8") as fh:
            user = yaml.safe_load(fh) or {}
        cfg.update(user)
    return cfg


# ---------------------------------------------------------------------
# Per-image worker
# ---------------------------------------------------------------------
def process_one(image_path: Path, cfg: dict) -> tuple[Path, Path]:
    work_dir = Path(cfg["work_dir"])
    out_dir = Path(cfg["output_dir"])

    raw_video = i2v.generate_video(
        image_path,
        provider=cfg["provider"],
        model=cfg["model"],
        prompt=_prompt_for(image_path, cfg),
        duration=int(cfg["duration_seconds"]),
        resolution=cfg["resolution"],
        out_dir=work_dir,
        retries=int(cfg["retry"]),
    )

    jpeg, mov = livephoto.build_live_photo(
        cover_image=image_path,
        raw_video=raw_video,
        out_dir=out_dir,
        length_seconds=float(cfg["live_photo_length"]),
        keep_raw=bool(cfg["keep_raw_video"]),
    )
    return jpeg, mov


def _prompt_for(image_path: Path, cfg: dict) -> str:
    """Allow per-image prompts via a sidecar `<name>.txt` file."""
    sidecar = image_path.with_suffix(".txt")
    if sidecar.exists():
        text = sidecar.read_text(encoding="utf-8").strip()
        if text:
            return text
    return cfg["default_prompt"]


# ---------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------
def main(argv: list[str] | None = None) -> int:
    load_dotenv()  # pulls REPLICATE_API_TOKEN / FAL_KEY from .env

    parser = argparse.ArgumentParser(
        description="Batch convert photos -> Apple Live Photos via cloud I2V."
    )
    parser.add_argument(
        "--config",
        type=Path,
        default=Path("config.yaml"),
        help="Path to YAML config (defaults to ./config.yaml)",
    )
    parser.add_argument("--input", type=Path)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--provider", choices=["replicate", "fal"])
    parser.add_argument("--model")
    parser.add_argument("--prompt", help="Override default prompt for all images")
    parser.add_argument("-v", "--verbose", action="store_true")
    args = parser.parse_args(argv)

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s | %(message)s",
        datefmt="%H:%M:%S",
    )

    cfg = load_config(args.config)
    if args.input:
        cfg["input_dir"] = str(args.input)
    if args.output:
        cfg["output_dir"] = str(args.output)
    if args.provider:
        cfg["provider"] = args.provider
    if args.model:
        cfg["model"] = args.model
    if args.prompt:
        cfg["default_prompt"] = args.prompt

    # Sanity checks for required env vars
    if cfg["provider"] == "replicate" and not os.getenv("REPLICATE_API_TOKEN"):
        LOG.error("REPLICATE_API_TOKEN is not set. Edit .env first.")
        return 2
    if cfg["provider"] == "fal" and not os.getenv("FAL_KEY"):
        LOG.error("FAL_KEY is not set. Edit .env first.")
        return 2

    input_dir = Path(cfg["input_dir"])
    if not input_dir.exists():
        LOG.error("input_dir does not exist: %s", input_dir)
        return 2

    photos = sorted(
        p for p in input_dir.iterdir()
        if p.is_file() and p.suffix.lower() in PHOTO_EXTS
    )
    if not photos:
        LOG.warning("No photos in %s. Drop some .jpg/.heic files in there.", input_dir)
        return 0

    LOG.info(
        "Processing %d photos | provider=%s | model=%s | parallel=%d",
        len(photos),
        cfg["provider"],
        cfg["model"],
        cfg["max_workers"],
    )

    failures: list[tuple[Path, Exception]] = []
    successes: list[Path] = []

    with ThreadPoolExecutor(max_workers=int(cfg["max_workers"])) as pool:
        futures = {pool.submit(process_one, p, cfg): p for p in photos}
        for fut in tqdm(as_completed(futures), total=len(futures), desc="live photos"):
            photo = futures[fut]
            try:
                jpeg, _mov = fut.result()
                successes.append(jpeg)
            except Exception as exc:  # noqa: BLE001
                LOG.exception("FAILED: %s", photo.name)
                failures.append((photo, exc))

    LOG.info("Done. ok=%d  failed=%d", len(successes), len(failures))
    if failures:
        LOG.warning("Failures:")
        for p, exc in failures:
            LOG.warning("  %s -> %s", p.name, exc)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
