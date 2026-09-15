FROM python:3.12-slim
WORKDIR /srv/extractor
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 SCRAPLING_STORAGE_DIR=/data/scrapling EXTRACTOR_PORT=8091
# Base package only: parser + lxml/orjson. No fetchers/browsers/anti-bot extras, so requirements.txt
# (which also carries pytest for local development) is deliberately not installed wholesale.
# Keep this pin in sync with the scrapling line of requirements.txt.
RUN pip install --no-cache-dir "scrapling==0.4.15"
COPY extractors.py server.py ./
RUN mkdir -p /data/scrapling
EXPOSE 8091
HEALTHCHECK --interval=15s --timeout=3s --retries=5 CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8091/health', timeout=2).status == 200 else 1)"
CMD ["python", "server.py"]
