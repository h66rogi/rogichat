import os

# All tests share one app instance because Settings is lru_cached and the
# CORSMiddleware is attached at import time. Configure env before any test
# imports `meloming_media_gateway.app`.
os.environ.setdefault("S3_REGION", "ap-northeast-2")
os.environ.setdefault("S3_ACCESS_KEY_ID", "test")
os.environ.setdefault("S3_SECRET_ACCESS_KEY", "test")
os.environ.setdefault("S3_BUCKET", "test-media-cache")
os.environ.setdefault(
    "CORS_ALLOWED_ORIGINS_CSV",
    (
        "https://meloming.com,https://www.meloming.com,"
        "https://music.meloming.com,https://meloming.pri.sbalyd.com"
    ),
)
os.environ.setdefault(
    "CORS_ALLOWED_ORIGIN_REGEX",
    r"^https://meloming-front(-[a-z0-9-]+)?\.vercel\.app$",
)
