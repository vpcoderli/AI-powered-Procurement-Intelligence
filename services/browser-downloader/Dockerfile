# The official Playwright image already carries Chromium and its system libraries; the tag must
# match the playwright pin in requirements.txt or the bundled browser revision will not be found.
FROM mcr.microsoft.com/playwright/python:v1.63.0-jammy
WORKDIR /srv/browser-downloader
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 \
    BROWSER_DOWNLOADER_HOST=0.0.0.0 \
    BROWSER_DOWNLOADER_PORT=8092 \
    BROWSER_DOWNLOADER_MAX_BYTES=52428800
# Keep this pin in sync with the playwright line of requirements.txt (pytest is dev-only, so
# requirements.txt is deliberately not installed wholesale).
RUN pip install --no-cache-dir "playwright==1.63.0"
COPY downloader.py guards.py link_resolution.py renderer.py server.py ./
# `pwuser` ships with the Playwright image; Chromium must not run as root.
USER pwuser
EXPOSE 8092
HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=5 CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8092/health', timeout=8).status == 200 else 1)"
CMD ["python", "server.py"]
