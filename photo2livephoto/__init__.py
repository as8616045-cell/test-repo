"""photo2livephoto: batch convert still photos into iPhone Live Photos.

Pipeline per image:
  1. Upload photo to a hosted image-to-video model
     (Wan 2.2 / Hailuo 02 / Kling via Replicate or fal.ai).
  2. Download the generated MP4.
  3. Trim to ~3 seconds.
  4. Pair (cover_jpeg, mov) and write Apple ContentIdentifier metadata
     so Apple Photos recognizes them as a single Live Photo.

The result is a folder of `<name>.jpeg` + `<name>.mov` pairs that you
AirDrop / iCloud Photos to the iPhone, where they import as Live Photos.
"""

__version__ = "0.1.0"
