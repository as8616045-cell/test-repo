"""Pack (cover_image + short video) into a real Apple Live Photo pair.

Apple Live Photos are technically two separate files (.HEIC/.JPG + .MOV)
linked by a shared `ContentIdentifier` UUID written into both files'
metadata. iOS Photos discovers the link on import.

We rely on `makelive` (https://github.com/RhetTbull/makelive), which is
maintained by the author of `osxphotos` and is the de-facto standard.

Pipeline:
  1. Trim the generated mp4 to ~3 seconds (native Live Photo length).
  2. Re-encode to H.264 / AAC inside a .mov container.
  3. Convert HEIC cover to JPEG if needed.
  4. Call `makelive.make_live_photo(jpeg_path, mov_path)` so the pair
     gets a matching ContentIdentifier UUID.

The output `<name>.jpeg` + `<name>.mov` can be AirDropped to iPhone or
imported through Apple Photos on macOS.
"""
from __future__ import annotations

import logging
import shutil
import subprocess
from pathlib import Path

from PIL import Image

LOG = logging.getLogger("photo2livephoto.livephoto")


# -----------------------------------------------------------------------
# Cover image normalization
# -----------------------------------------------------------------------
def normalize_cover(src: Path, dst_jpeg: Path) -> Path:
    """Convert any input photo (heic/png/webp/jpg) to a baseline JPEG."""
    dst_jpeg.parent.mkdir(parents=True, exist_ok=True)
    if src.suffix.lower() in {".heic", ".heif"}:
        # Pillow may need pillow-heif; if missing we fall back to ffmpeg.
        try:
            import pillow_heif  # type: ignore

            pillow_heif.register_heif_opener()
        except ImportError:
            LOG.info("pillow-heif missing, using ffmpeg for HEIC -> JPEG")
            _ffmpeg(["-y", "-i", str(src), str(dst_jpeg)])
            return dst_jpeg

    img = Image.open(src).convert("RGB")
    img.save(dst_jpeg, format="JPEG", quality=92)
    return dst_jpeg


# -----------------------------------------------------------------------
# Trim + remux video
# -----------------------------------------------------------------------
def prepare_mov(raw_mp4: Path, dst_mov: Path, length_seconds: float = 3.0) -> Path:
    """Trim mp4 to length_seconds and remux into a Live-Photo-style .mov.

    Apple Live Photos use H.264 + AAC inside a QuickTime (.mov) container.
    We force that even if the source was already mov/H.264.
    """
    dst_mov.parent.mkdir(parents=True, exist_ok=True)
    _ffmpeg(
        [
            "-y",
            "-i", str(raw_mp4),
            "-t", f"{length_seconds:.2f}",
            "-c:v", "libx264",
            "-pix_fmt", "yuv420p",
            "-profile:v", "high",
            "-level", "4.0",
            "-movflags", "+faststart",
            "-c:a", "aac",
            "-b:a", "128k",
            str(dst_mov),
        ]
    )
    return dst_mov


# -----------------------------------------------------------------------
# Final pairing via makelive
# -----------------------------------------------------------------------
def pair_live_photo(jpeg: Path, mov: Path) -> tuple[Path, Path]:
    """Write matching ContentIdentifier UUIDs into both files."""
    try:
        import makelive
    except ImportError as e:
        raise RuntimeError(
            "Package 'makelive' is required for Live Photo pairing. "
            "Install with: pip install makelive"
        ) from e

    LOG.info("pairing Live Photo: %s + %s", jpeg.name, mov.name)
    # makelive.make_live_photo returns the shared ContentIdentifier
    asset_id = makelive.make_live_photo(str(jpeg), str(mov))
    LOG.info("ContentIdentifier = %s", asset_id)
    return jpeg, mov


# -----------------------------------------------------------------------
# Top-level orchestration: cover + raw mp4 -> live photo pair
# -----------------------------------------------------------------------
def build_live_photo(
    cover_image: Path,
    raw_video: Path,
    out_dir: Path,
    *,
    length_seconds: float = 3.0,
    keep_raw: bool = True,
) -> tuple[Path, Path]:
    out_dir.mkdir(parents=True, exist_ok=True)
    stem = cover_image.stem

    jpeg = out_dir / f"{stem}.jpeg"
    mov = out_dir / f"{stem}.mov"

    normalize_cover(cover_image, jpeg)
    prepare_mov(raw_video, mov, length_seconds=length_seconds)
    pair_live_photo(jpeg, mov)

    if keep_raw:
        backup = out_dir / f"{stem}.raw.mp4"
        shutil.copy2(raw_video, backup)

    return jpeg, mov


# -----------------------------------------------------------------------
# Internal: locate ffmpeg
# -----------------------------------------------------------------------
def _ffmpeg(args: list[str]) -> None:
    binary = shutil.which("ffmpeg")
    if not binary:
        raise RuntimeError(
            "ffmpeg not found in PATH. Install it first:\n"
            "  macOS:   brew install ffmpeg\n"
            "  Ubuntu:  sudo apt install ffmpeg\n"
            "  Windows: winget install Gyan.FFmpeg"
        )
    cmd = [binary, *args]
    LOG.debug("ffmpeg: %s", " ".join(cmd))
    res = subprocess.run(cmd, capture_output=True, text=True)
    if res.returncode != 0:
        raise RuntimeError(f"ffmpeg failed:\n{res.stderr}")
