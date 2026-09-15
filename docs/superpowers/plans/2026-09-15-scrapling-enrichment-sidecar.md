# Scrapling 详情补全 Sidecar 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给爬虫增加一个默认关闭、失败开放的"详情页补全"阶段：用独立的 Scrapling 解析 sidecar 从每条招标的详情页补齐描述、附件、分类、联系人、发布日期，并让管理员在数据源配置里控制它；SQLite 与 MySQL 双路径同等支持。

**Architecture:** `fetch-task` 在列表抓取之后、日期窗口之前调用新模块 `apsi_crawler/enrichment.py`；该模块用现有 `requests` 路径（浏览器 UA、按源节流、治理门禁之后）拉详情页，POST 给 `services/scrapling-extractor` sidecar（仅 Scrapling 解析器基础包，Python 3.12，stdlib `http.server`），只回填空字段。TS 侧两个 importer 改为"补全保护式 upsert"，管理端 PATCH 路由与 UI 让 `fetch_config.enrichment`、`cadence`、`base_url` 可编辑并写审计事件。

**Tech Stack:** Python 3.9 crawler（stdlib + requests，不新增依赖）；sidecar：Python 3.12 + `scrapling==0.4.15`（仅基础包）+ stdlib；Next.js 16 / TypeScript / Drizzle / mysql2；Vitest；pytest；Docker Compose。

**Spec:** `docs/superpowers/specs/2026-09-15-scrapling-enrichment-sidecar-design.md`

## Global Constraints

- Sidecar 依赖固定为 `scrapling==0.4.15`，**只装基础包**（不装 `fetchers`/`ai`/`shell`/`all` extra）；镜像基于 `python:3.12-slim`。
- 任何任务都不得引入 `StealthyFetcher`、`DynamicFetcher`、`curl_cffi`、`playwright`、`patchright`、`browserforge` 或任何 WAF/验证码绕过逻辑。
- `crawler/requirements.txt` 保持 `pytest==8.3.5` + `requests==2.32.3`，crawler 包不新增第三方依赖。
- `fetch_config.enrichment.enabled` 默认 `false`；未开启的源行为与现状逐字节一致。
- 补全阶段永不使 `fetch_task` 失败：所有异常计入 `failed`/`skipped`，运行仍 `success`。
- 回填只填空值：`description` 仅当为空或等于 `title`；其它字段仅当为空；`attachments` 仅当为空列表。
- 附件 `url` 只接受绝对 http(s)；`javascript:` 等链接必须经 `attachment_url_template` 解析，否则丢弃——**绝不伪造下载地址**。
- 所有服务端功能同时实现 SQLite（Drizzle）与 MySQL（手写 SQL）分支；不新增 API 路由。
- 所有用户可见文案进 `src/lib/i18n/dictionaries/{en,zh}.ts`；`t()` 不做插值，占位符由调用方 `.replace()`；`npm run i18n:check` 必须通过。
- 每个任务结束时：`cd crawler && python3 -m pytest` 与/或 `cd frontend && npx vitest run <files>` 通过后再提交；提交信息不加任何 AI 署名行。
- 数值范围：`max_details_per_run` 1–200，`min_interval_seconds` 0–60，`timeout_seconds` 5–60；`fetch_config` 序列化后 ≤ 8192 字节。

---

## File Structure

| 文件 | 职责 |
|---|---|
| `services/scrapling-extractor/extractors.py`（新） | 纯函数 `extract(html, url, fields, selectors)`：Scrapling 解析 + 启发式，返回 `fields`/`attachments`/`diagnostics` |
| `services/scrapling-extractor/server.py`（新） | stdlib `ThreadingHTTPServer`：`GET /health`、`POST /extract`，大小/超时限制，JSON 错误封套 |
| `services/scrapling-extractor/requirements.txt`、`Dockerfile`、`run-local.sh`（新） | 依赖固定、镜像、本机 venv 启动 |
| `services/scrapling-extractor/tests/test_extractors.py`、`test_server.py`、`fixtures/`（新） | pytest（scrapling 不可导入时 skip） |
| `docker-compose.yml`（改） | 新增 `scrapling-extractor` service + `scrapling-data` volume；`app` 注入 `SCRAPLING_EXTRACTOR_URL` |
| `crawler/apsi_crawler/enrichment.py`（新） | 配置解析、`ExtractorClient`、`enrich_bids()`、节流、只填空值合并、附件模板解析 |
| `crawler/tests/test_enrichment.py`（新） | 离线单测 |
| `crawler/apsi_crawler/cli.py`（改 `fetch_task`） | 接入补全阶段，写 `metadata["enrichment"]` |
| `crawler/tests/fixtures/contracts/fetch_task_v1.json`、`tests/test_contract_compatibility.py`、`tests/test_fetch_task_cli.py`（改） | 契约与 CLI 覆盖 |
| `frontend/src/server/crawler/sqlite-json-importer.ts`、`mysql-json-importer.ts`（改）+ 各自 `.test.ts` | 补全保护式 upsert |
| `frontend/src/server/admin/crawler-config.ts`（新）+ `.test.ts` | `validateCrawlerConfigInput()` 纯校验函数与类型 |
| `frontend/src/server/admin/data-sources-repository.ts`（改）+ `.test.ts` | `AdminDataSource.fetchConfig`、输入类型扩展、双分支更新、审计事件 |
| `frontend/src/app/api/admin/data-sources/[id]/route.ts`（改）+ `.test.ts` | PATCH 解析 `fetchConfig`/`cadence`/`baseUrl` |
| `frontend/src/components/admin/CrawlerConfigPanel.tsx`（新）+ `.test.ts` | 每个数据源的爬虫配置编辑面板 |
| `frontend/src/app/admin/page.tsx`（改） | 挂载面板 |
| `frontend/src/lib/i18n/dictionaries/en.ts`、`zh.ts`（改） | 文案 |
| `frontend/.env.local`、`docs/transferability/environment-variables.md`、`CLAUDE.md`、`README.md`（改） | 环境变量与文档 |

---

### Task 1: Sidecar 抽取核心 `extractors.py`

**Files:**
- Create: `services/scrapling-extractor/extractors.py`
- Create: `services/scrapling-extractor/requirements.txt`
- Create: `services/scrapling-extractor/tests/__init__.py`（空）
- Create: `services/scrapling-extractor/tests/fixtures/synthetic_detail.html`
- Test: `services/scrapling-extractor/tests/test_extractors.py`

**Interfaces:**
- Produces: `extract(html: str, url: str, fields: list[str], selectors: dict[str, str] | None = None) -> dict` 返回 `{"fields": {...7 键...}, "attachments": [...], "diagnostics": {...}}`；`SUPPORTED_FIELDS = ("description", "attachments", "category", "contact", "published_date")`；`class ExtractError(ValueError)`。

- [ ] **Step 1: 建 venv 与依赖文件**

```bash
mkdir -p services/scrapling-extractor/tests/fixtures
printf 'scrapling==0.4.15\npytest==8.3.5\n' > services/scrapling-extractor/requirements.txt
cd services/scrapling-extractor && /opt/homebrew/bin/python3.12 -m venv .venv && .venv/bin/pip install -q -r requirements.txt && .venv/bin/pip list | grep -iE 'scrapling|lxml|orjson|curl|playwright'
```
Expected: 列表只含 `scrapling 0.4.15`、`lxml`、`orjson`、`pytest`（无 curl_cffi/playwright）。在仓库根 `.gitignore` 追加一行 `services/scrapling-extractor/.venv/`。

- [ ] **Step 2: 写合成详情页 fixture**

`services/scrapling-extractor/tests/fixtures/synthetic_detail.html`：
```html
<!DOCTYPE html><html><head><title>RFQ 26-101 Bridge Deck Repair</title></head>
<body>
<nav><a href="/">Home</a><a href="/bids">Bids</a></nav>
<main>
<h1>RFQ 26-101 Bridge Deck Repair</h1>
<table class="detail">
<tr><td class="label">Bid Number</td><td>26-101</td></tr>
<tr><td class="label">Description</td><td>The Department seeks a contractor for deck repair on Bridge 41, including milling, overlay and joint replacement. Work must be complete within 90 days.</td></tr>
<tr><td class="label">Category</td><td>Construction Services</td></tr>
<tr><td class="label">NAICS</td><td>237310</td></tr>
<tr><td class="label">Posted Date</td><td>08/14/2026</td></tr>
<tr><td class="label">Contact</td><td>Jane Buyer <a href="mailto:jane.buyer@example.gov">jane.buyer@example.gov</a> <a href="tel:555-0100">555-0100</a></td></tr>
<tr><td class="label">File Attachments</td><td>
  <a href="/docs/rfq-26-101-spec.pdf">Specification.pdf</a> (1.2 MB)<br/>
  <a href="javascript:downloadFile('998877')">Drawings.zip</a>
</td></tr>
</table>
</main>
<footer>Copyright State</footer>
</body></html>
```

- [ ] **Step 3: 写失败测试**

`services/scrapling-extractor/tests/test_extractors.py`：
```python
import pathlib

import pytest

pytest.importorskip("scrapling")

from extractors import SUPPORTED_FIELDS, ExtractError, extract  # noqa: E402

FIXTURES = pathlib.Path(__file__).parent / "fixtures"
URL = "https://example.gov/bids/26-101"


def _html():
    return (FIXTURES / "synthetic_detail.html").read_text(encoding="utf-8")


def test_supported_fields_are_the_spec_list():
    assert SUPPORTED_FIELDS == ("description", "attachments", "category", "contact", "published_date")


def test_heuristics_extract_every_field_from_label_table():
    result = extract(_html(), URL, list(SUPPORTED_FIELDS))
    fields = result["fields"]
    assert fields["description"].startswith("The Department seeks a contractor")
    assert fields["full_description"] == fields["description"]
    assert fields["original_category"] == "Construction Services"
    assert fields["contact_name"] == "Jane Buyer"
    assert fields["contact_email"] == "jane.buyer@example.gov"
    assert fields["contact_phone"] == "555-0100"
    assert fields["published_date"] == "08/14/2026"
    assert result["diagnostics"]["description"] == "heuristic"


def test_attachments_resolve_absolute_urls_and_keep_javascript_links_raw():
    result = extract(_html(), URL, ["attachments"])
    attachments = result["attachments"]
    assert attachments == [
        {
            "name": "Specification.pdf",
            "url": "https://example.gov/docs/rfq-26-101-spec.pdf",
            "raw_href": "/docs/rfq-26-101-spec.pdf",
            "size_label": None,
            "mime_type": "application/pdf",
            "sort_order": 0,
        },
        {
            "name": "Drawings.zip",
            "url": None,
            "raw_href": "javascript:downloadFile('998877')",
            "size_label": None,
            "mime_type": "application/zip",
            "sort_order": 1,
        },
    ]


def test_explicit_selector_wins_over_heuristic():
    result = extract(_html(), URL, ["description"], selectors={"description": "h1"})
    assert result["fields"]["description"] == "RFQ 26-101 Bridge Deck Repair"
    assert result["diagnostics"]["description"] == "selector"


def test_xpath_selector_is_detected_by_leading_slash():
    result = extract(_html(), URL, ["category"], selectors={"category": "//tr[td='NAICS']/td[2]"})
    assert result["fields"]["original_category"] == "237310"


def test_missing_field_is_reported_not_found():
    result = extract("<html><body><p>nothing here</p></body></html>", URL, ["published_date"])
    assert result["fields"]["published_date"] is None
    assert result["diagnostics"]["published_date"] == "not_found"


def test_unknown_field_raises():
    with pytest.raises(ExtractError):
        extract(_html(), URL, ["price"])


def test_description_falls_back_to_largest_text_block_without_label():
    html = "<html><body><nav>menu</nav><div id='body'>" + ("Scope of work sentence. " * 30) + "</div><footer>foot</footer></body></html>"
    result = extract(html, URL, ["description"])
    assert result["fields"]["description"].startswith("Scope of work sentence.")
```

- [ ] **Step 4: 运行确认失败**

Run: `cd services/scrapling-extractor && .venv/bin/python -m pytest tests/test_extractors.py -v`
Expected: FAIL，`ModuleNotFoundError: No module named 'extractors'`。

- [ ] **Step 5: 实现 `extractors.py`**

```python
"""Field extraction on top of Scrapling's parser (base package only — no fetchers)."""

import mimetypes
import re
from urllib.parse import urljoin, urlparse

from scrapling.parser import Selector

SUPPORTED_FIELDS = ("description", "attachments", "category", "contact", "published_date")

_LABELS = {
    "description": ("Description", "Summary", "Scope of Work", "Scope", "Details"),
    "category": ("Category", "Commodity", "NAICS", "UNSPSC", "Classification"),
    "contact": ("Contact", "Buyer", "Procurement Officer", "Point of Contact"),
    "published_date": ("Posted Date", "Published", "Publish Date", "Issue Date", "Post Date", "Posted"),
    "attachments": ("File Attachments", "Attachments", "Documents", "Bid Documents", "Files"),
}
_DOCUMENT_EXTENSIONS = (".pdf", ".doc", ".docx", ".xls", ".xlsx", ".zip", ".csv", ".ppt", ".pptx", ".txt")
_NOISE_TAGS = ("nav", "header", "footer", "script", "style", "noscript")
_EMAIL_RE = re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+")
_PHONE_RE = re.compile(r"\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}")
_MAX_TEXT = 20_000


class ExtractError(ValueError):
    pass


def _clean(text):
    return " ".join((text or "").replace("\xa0", " ").split())[:_MAX_TEXT] or None


def _element_text(element):
    if element is None:
        return None
    return _clean(element.get_all_text(separator=" ", strip=True))


def _label_value(page, labels):
    """Text of the cell/element that follows a label cell (table rows, dt/dd, label/value divs)."""
    for label in labels:
        match = page.find_by_text(label, partial=True, first_match=True, case_sensitive=False)
        if match is None:
            continue
        own = _clean(match.text)
        if own is None or len(own) > len(label) + 40:
            continue  # the label matched inside a long paragraph, not a label cell
        following = match.next
        value = _element_text(following)
        if value:
            return value, following
        parent_next = match.parent.next if match.parent is not None else None
        value = _element_text(parent_next)
        if value:
            return value, parent_next
    return None, None


def _select(page, selector):
    if selector.startswith("/") or selector.startswith("("):
        return page.xpath(selector, identifier=selector, adaptive=True, auto_save=True)
    return page.css(selector, identifier=selector, adaptive=True, auto_save=True)


def _largest_text_block(page):
    best, best_len = None, 0
    for element in page.css("main, article, section, div, td, p"):
        if element.tag in _NOISE_TAGS:
            continue
        text = _element_text(element)
        if text and len(text) > best_len and len(element.css("div, section, table")) <= 3:
            best, best_len = text, len(text)
    return best


def _mime_for(href):
    path = urlparse(href).path if href else ""
    for extension in _DOCUMENT_EXTENSIONS:
        if path.lower().endswith(extension):
            return mimetypes.guess_type(path)[0] or "application/octet-stream"
    return None


def _attachments(page, url, selector=None):
    if selector:
        anchors = [a for a in _select(page, selector) if a.tag == "a"]
    else:
        anchors = []
        _, container = _label_value(page, _LABELS["attachments"])
        if container is not None:
            anchors = list(container.css("a[href]"))
        if not anchors:
            anchors = [a for a in page.css("a[href]") if _mime_for(a.attrib.get("href", ""))]
    results, seen = [], set()
    for anchor in anchors:
        raw_href = (anchor.attrib.get("href") or "").strip()
        name = _clean(anchor.text) or raw_href
        if not raw_href or raw_href in seen:
            continue
        seen.add(raw_href)
        absolute = urljoin(url, raw_href) if not raw_href.lower().startswith("javascript:") else None
        if absolute and urlparse(absolute).scheme not in ("http", "https"):
            absolute = None
        results.append(
            {
                "name": name,
                "url": absolute,
                "raw_href": raw_href,
                "size_label": None,
                "mime_type": _mime_for(raw_href) or _mime_for(name),
                "sort_order": len(results),
            }
        )
    return results


def _contact(page, selector=None):
    if selector:
        text = _element_text(_select(page, selector).first) if _select(page, selector) else None
        element = None
    else:
        text, element = _label_value(page, _LABELS["contact"])
    if not text:
        return None, None, None
    email = None
    phone = None
    if element is not None:
        mail = element.css("a[href^='mailto:']")
        if mail:
            email = mail[0].attrib["href"][len("mailto:"):].strip() or None
        tel = element.css("a[href^='tel:']")
        if tel:
            phone = tel[0].attrib["href"][len("tel:"):].strip() or None
    email = email or (_EMAIL_RE.search(text).group(0) if _EMAIL_RE.search(text) else None)
    phone = phone or (_PHONE_RE.search(text).group(0) if _PHONE_RE.search(text) else None)
    name = text
    for token in filter(None, (email, phone)):
        name = name.replace(token, "")
    name = _clean(name)
    return name, email, phone


def extract(html, url, fields, selectors=None):
    unknown = [field for field in fields if field not in SUPPORTED_FIELDS]
    if unknown:
        raise ExtractError(f"unsupported fields: {unknown}")
    selectors = selectors or {}
    page = Selector(html, url=url, adaptive=True)
    out = {
        "description": None, "full_description": None, "original_category": None,
        "contact_name": None, "contact_email": None, "contact_phone": None, "published_date": None,
    }
    attachments = []
    diagnostics = {}

    for field in fields:
        selector = selectors.get(field)
        if field == "attachments":
            attachments = _attachments(page, url, selector)
            diagnostics[field] = "selector" if selector else ("heuristic" if attachments else "not_found")
            continue
        if field == "contact":
            name, email, phone = _contact(page, selector)
            out["contact_name"], out["contact_email"], out["contact_phone"] = name, email, phone
            diagnostics[field] = "selector" if selector else ("heuristic" if (name or email or phone) else "not_found")
            continue

        value = None
        if selector:
            selected = _select(page, selector)
            value = _element_text(selected.first) if selected else None
            diagnostics[field] = "selector" if value else "not_found"
        else:
            value, _ = _label_value(page, _LABELS[field])
            if value is None and field == "description":
                value = _largest_text_block(page)
            diagnostics[field] = "heuristic" if value else "not_found"

        if field == "description":
            out["description"] = value
            out["full_description"] = value
        elif field == "category":
            out["original_category"] = value
        elif field == "published_date":
            out["published_date"] = value

    return {"fields": out, "attachments": attachments, "diagnostics": diagnostics}
```

- [ ] **Step 6: 运行测试直到通过**

Run: `cd services/scrapling-extractor && .venv/bin/python -m pytest tests/test_extractors.py -v`
Expected: 8 passed。若 `_label_value` 对合成表格的 `match.next` 返回的是文本节点而非 `<td>`，把 `following = match.next` 改为 `following = match.next if getattr(match.next, "tag", None) else match.parent.next`，重跑直到通过。

- [ ] **Step 7: 提交**

```bash
git add .gitignore services/scrapling-extractor/extractors.py services/scrapling-extractor/requirements.txt services/scrapling-extractor/tests
git commit -m "feat(extractor): add Scrapling-based detail field extractor with heuristics and selector overrides"
```

---

### Task 2: Sidecar HTTP 服务 `server.py`

**Files:**
- Create: `services/scrapling-extractor/server.py`
- Test: `services/scrapling-extractor/tests/test_server.py`

**Interfaces:**
- Consumes: Task 1 的 `extract()`、`ExtractError`。
- Produces: `GET /health` → `{"ok": true, "scrapling": "0.4.15"}`；`POST /extract` 请求体 `{"url","html","fields","selectors"}` → `{"fields","attachments","diagnostics"}`；错误 `{"error": {"code","message"}}`；环境变量 `EXTRACTOR_PORT`（默认 8091）、`SCRAPLING_STORAGE_DIR`（默认 `/data/scrapling`，不存在时回退当前目录）；`MAX_HTML_BYTES = 2 * 1024 * 1024`；`create_server(port) -> ThreadingHTTPServer`。

- [ ] **Step 1: 写失败测试**

```python
import json
import pathlib
import threading
import urllib.error
import urllib.request

import pytest

pytest.importorskip("scrapling")

from server import MAX_HTML_BYTES, create_server  # noqa: E402

FIXTURES = pathlib.Path(__file__).parent / "fixtures"


@pytest.fixture(scope="module")
def base_url():
    server = create_server(0)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    yield f"http://127.0.0.1:{server.server_address[1]}"
    server.shutdown()


def _post(base_url, body, raw=None):
    data = raw if raw is not None else json.dumps(body).encode()
    request = urllib.request.Request(f"{base_url}/extract", data=data, headers={"Content-Type": "application/json"}, method="POST")
    try:
        with urllib.request.urlopen(request, timeout=10) as response:
            return response.status, json.loads(response.read())
    except urllib.error.HTTPError as error:
        return error.code, json.loads(error.read())


def test_health_reports_scrapling_version(base_url):
    with urllib.request.urlopen(f"{base_url}/health", timeout=5) as response:
        body = json.loads(response.read())
    assert response.status == 200
    assert body["ok"] is True
    assert body["scrapling"] == "0.4.15"


def test_extract_returns_fields_and_attachments(base_url):
    html = (FIXTURES / "synthetic_detail.html").read_text(encoding="utf-8")
    status, body = _post(base_url, {"url": "https://example.gov/bids/26-101", "html": html, "fields": ["description", "attachments"], "selectors": None})
    assert status == 200
    assert body["fields"]["description"].startswith("The Department seeks")
    assert body["attachments"][0]["url"] == "https://example.gov/docs/rfq-26-101-spec.pdf"
    assert body["diagnostics"]["description"] == "heuristic"


def test_invalid_json_is_400(base_url):
    status, body = _post(base_url, None, raw=b"{not json")
    assert status == 400
    assert body["error"]["code"] == "INVALID_REQUEST"


def test_unknown_field_is_400(base_url):
    status, body = _post(base_url, {"url": "https://example.gov", "html": "<p>x</p>", "fields": ["price"]})
    assert status == 400
    assert body["error"]["code"] == "INVALID_REQUEST"
    assert "unsupported fields" in body["error"]["message"]


def test_oversized_html_is_413(base_url):
    status, body = _post(base_url, {"url": "https://example.gov", "html": "x" * (MAX_HTML_BYTES + 1), "fields": ["description"]})
    assert status == 413
    assert body["error"]["code"] == "INVALID_REQUEST"


def test_unknown_path_is_404(base_url):
    try:
        urllib.request.urlopen(f"{base_url}/nope", timeout=5)
        assert False, "expected 404"
    except urllib.error.HTTPError as error:
        assert error.code == 404
```

- [ ] **Step 2: 运行确认失败**

Run: `cd services/scrapling-extractor && .venv/bin/python -m pytest tests/test_server.py -v`
Expected: FAIL，`No module named 'server'`。

- [ ] **Step 3: 实现 `server.py`**

```python
"""Minimal JSON HTTP sidecar exposing extractors.extract(). stdlib only."""

import json
import os
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import scrapling

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from extractors import ExtractError, extract  # noqa: E402

MAX_HTML_BYTES = 2 * 1024 * 1024
MAX_BODY_BYTES = MAX_HTML_BYTES + 64 * 1024
DEFAULT_PORT = 8091


def _configure_storage_dir():
    storage_dir = os.environ.get("SCRAPLING_STORAGE_DIR", "/data/scrapling")
    try:
        os.makedirs(storage_dir, exist_ok=True)
        os.chdir(storage_dir)  # Scrapling's adaptive SQLite store is created relative to cwd
    except OSError:
        pass


class ExtractorHandler(BaseHTTPRequestHandler):
    server_version = "scrapling-extractor/1.0"

    def log_message(self, format, *args):  # noqa: A002 - keep stdout quiet in tests
        if os.environ.get("EXTRACTOR_LOG") == "1":
            super().log_message(format, *args)

    def _send(self, status, payload):
        body = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _error(self, status, code, message):
        self._send(status, {"error": {"code": code, "message": message}})

    def do_GET(self):
        if self.path == "/health":
            self._send(200, {"ok": True, "scrapling": scrapling.__version__})
            return
        self._error(404, "NOT_FOUND", f"no route for {self.path}")

    def do_POST(self):
        if self.path != "/extract":
            self._error(404, "NOT_FOUND", f"no route for {self.path}")
            return
        length = int(self.headers.get("Content-Length") or 0)
        if length > MAX_BODY_BYTES:
            self._error(413, "INVALID_REQUEST", f"request body exceeds {MAX_BODY_BYTES} bytes")
            return
        try:
            payload = json.loads(self.rfile.read(length))
        except ValueError:
            self._error(400, "INVALID_REQUEST", "body must be valid JSON")
            return
        if not isinstance(payload, dict):
            self._error(400, "INVALID_REQUEST", "body must be a JSON object")
            return
        html = payload.get("html")
        url = payload.get("url")
        fields = payload.get("fields")
        selectors = payload.get("selectors")
        if not isinstance(html, str) or not isinstance(url, str) or not isinstance(fields, list):
            self._error(400, "INVALID_REQUEST", "html (str), url (str) and fields (list) are required")
            return
        if len(html.encode("utf-8", errors="ignore")) > MAX_HTML_BYTES:
            self._error(413, "INVALID_REQUEST", f"html exceeds {MAX_HTML_BYTES} bytes")
            return
        if selectors is not None and not isinstance(selectors, dict):
            self._error(400, "INVALID_REQUEST", "selectors must be an object or null")
            return
        try:
            result = extract(html, url, fields, selectors)
        except ExtractError as error:
            self._error(400, "INVALID_REQUEST", str(error))
            return
        except Exception as error:  # noqa: BLE001 - never leak a traceback to the crawler
            self._error(500, "EXTRACT_FAILED", f"{type(error).__name__}: {error}")
            return
        self._send(200, result)


def create_server(port=DEFAULT_PORT):
    return ThreadingHTTPServer(("0.0.0.0", port), ExtractorHandler)


def main():
    _configure_storage_dir()
    port = int(os.environ.get("EXTRACTOR_PORT", DEFAULT_PORT))
    server = create_server(port)
    print(f"scrapling-extractor listening on :{port} (scrapling {scrapling.__version__})", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: 运行测试**

Run: `cd services/scrapling-extractor && .venv/bin/python -m pytest tests -v`
Expected: 14 passed。

- [ ] **Step 5: 提交**

```bash
git add services/scrapling-extractor/server.py services/scrapling-extractor/tests/test_server.py
git commit -m "feat(extractor): add stdlib HTTP sidecar with /health and /extract"
```

---

### Task 2b: 现场抓取三个真实详情页 fixture 并用其测试抽取器

**Files:**
- Create: `services/scrapling-extractor/tests/fixtures/live/ca_caleprocure_event.html`
- Create: `services/scrapling-extractor/tests/fixtures/live/il_bidbuy_detail.html`
- Create: `services/scrapling-extractor/tests/fixtures/live/ny_contract_reporter_detail.html`（FL 门户若为 JS 壳则以 NY 替代，见 Step 1）
- Create: `services/scrapling-extractor/tests/fixtures/live/README.md`
- Test: `services/scrapling-extractor/tests/test_live_fixtures.py`

**Interfaces:**
- Consumes: Task 1 `extract()`；crawler 的 `fetch-task`（取当前真实 bid 的 `source_url`）。
- Produces: 三个真实页面样本 + 每个源在真实页面上"启发式能拿到什么、哪些字段需要选择器"的记录（写入 README，并作为 Task 11 配置选择器的依据）。

- [ ] **Step 1: 取三条真实详情页 URL 并抓取**

```bash
cd crawler
for src in ca_caleprocure il_bidbuy ny_contract_reporter fl_mfmp; do
  case $src in
    ca_caleprocure) label="California Cal eProcure"; state=CA; base="https://caleprocure.ca.gov";;
    il_bidbuy) label="Illinois BidBuy"; state=IL; base="https://www.bidbuy.illinois.gov";;
    ny_contract_reporter) label="New York State Contract Reporter"; state=NY; base="https://www.nyscr.ny.gov";;
    fl_mfmp) label="MyFloridaMarketPlace"; state=FL; base="https://vendor.myfloridamarketplace.com";;
  esac
  printf '{"task_id":"fx_%s","source_id":"%s","label":"%s","state_code":"%s","provider_family":null,"jurisdiction_level":"state","fetch_config":{"base_url":"%s"},"limit":1,"query":null,"date_range":null}' "$src" "$src" "$label" "$state" "$base" \
    | python3 -m apsi_crawler.cli fetch-task 2>/dev/null | python3 -c "import json,sys; d=json.load(sys.stdin); print('$src', d['bids'][0]['source_url'])"
  sleep 3
done
```
对打印出的每个 URL（间隔 ≥3 s）：
```bash
UA='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
curl -sSL "<URL>" -H "User-Agent: $UA" --max-time 30 -o services/scrapling-extractor/tests/fixtures/live/<name>.html
```
判定规则：`grep -c "<title\|Description\|Attachments" <file>` 若页面正文不含该招标的标题/描述文字（只有 `<app-root>`/脚本引用等 SPA 壳），说明门户是纯 JS 渲染——把该源记入 README 的"需要浏览器渲染（二期）"并**不**为它写抽取测试；FL（Angular 门户）大概率如此，此时用 NY 作为第三个样本。每个保留的 fixture 用 Python 把 `<script>` 块删掉以缩小体积（`re.sub(r"<script.*?</script>", "", html, flags=re.S)`），保留其余标记原样。

- [ ] **Step 2: 写测试（期望值来自你刚抓到的页面）**

`tests/test_live_fixtures.py`：
```python
import json
import pathlib

import pytest

pytest.importorskip("scrapling")

from extractors import SUPPORTED_FIELDS, extract  # noqa: E402

LIVE = pathlib.Path(__file__).parent / "fixtures" / "live"
# One row per captured page. `expect` holds substrings that MUST appear in the extracted
# value (copied from the real page while capturing it); `selectors` are the per-source
# overrides needed where the heuristics alone came back not_found.
CASES = json.loads((LIVE / "expectations.json").read_text(encoding="utf-8"))


@pytest.mark.parametrize("case", CASES, ids=[case["fixture"] for case in CASES])
def test_live_page_yields_expected_fields(case):
    html = (LIVE / case["fixture"]).read_text(encoding="utf-8")
    result = extract(html, case["url"], list(SUPPORTED_FIELDS), case.get("selectors") or None)
    fields = result["fields"]
    for key, expected_substring in case["expect"].items():
        assert fields[key] is not None, f"{key} not extracted: {result['diagnostics']}"
        assert expected_substring in fields[key]
    assert len(result["attachments"]) >= case["min_attachments"]
    for attachment in result["attachments"]:
        assert attachment["url"] is None or attachment["url"].startswith("http")
```
`fixtures/live/expectations.json` 格式（每个保留的 fixture 一项；`expect` 的值从抓到的页面复制真实片段，至少含 `description`）：
```json
[
  {
    "fixture": "ca_caleprocure_event.html",
    "url": "https://caleprocure.ca.gov/event/2740/26-099",
    "expect": { "description": "<从页面复制的一段描述原文>", "original_category": "<页面上的分类值，无则删除此键>" },
    "min_attachments": 0,
    "selectors": {}
  }
]
```
先用空 `selectors` 运行；对 `not_found` 的字段，用 Scrapling shell 或 Python 交互式（`Selector(html).css(...)`）找到稳定选择器填入 `selectors`，直至测试通过。把每个源最终使用的选择器同步写进 README（Task 11 配置管理端时直接复用）。

- [ ] **Step 3: 运行**

Run: `cd services/scrapling-extractor && .venv/bin/python -m pytest tests/test_live_fixtures.py -v`
Expected: 每个保留的 fixture 一个 PASS。

- [ ] **Step 4: 写 README 并提交**

`fixtures/live/README.md` 记录：抓取日期、每个 fixture 的来源 URL、启发式命中的字段、需要的选择器、被判定为 JS 渲染的门户（列出，标注"二期：浏览器渲染"）。

```bash
git add services/scrapling-extractor/tests
git commit -m "test(extractor): live detail-page fixtures with per-source expectations and selector notes"
```

---

### Task 3: 镜像、本机启动脚本、compose 与环境变量文档

**Files:**
- Create: `services/scrapling-extractor/Dockerfile`
- Create: `services/scrapling-extractor/run-local.sh`
- Create: `services/scrapling-extractor/README.md`
- Modify: `docker-compose.yml`
- Modify: `frontend/.env.local`（追加一行）
- Modify: `docs/transferability/environment-variables.md:199`（`SAM_API_KEY` 行之后）

**Interfaces:**
- Produces: 环境变量 `SCRAPLING_EXTRACTOR_URL`（crawler 读取，Task 4）；compose 服务名 `scrapling-extractor`，端口 8091。

- [ ] **Step 1: Dockerfile**

```dockerfile
FROM python:3.12-slim
WORKDIR /srv/extractor
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 SCRAPLING_STORAGE_DIR=/data/scrapling EXTRACTOR_PORT=8091
COPY requirements.txt ./
# Base package only: parser + lxml/orjson. No fetchers/browsers/anti-bot extras.
RUN pip install --no-cache-dir "scrapling==0.4.15"
COPY extractors.py server.py ./
RUN mkdir -p /data/scrapling
EXPOSE 8091
HEALTHCHECK --interval=15s --timeout=3s --retries=5 CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8091/health', timeout=2).status == 200 else 1)"
CMD ["python", "server.py"]
```

- [ ] **Step 2: `run-local.sh`（可执行）**

```bash
#!/usr/bin/env bash
# Run the Scrapling extractor sidecar on the host without Docker (Python >= 3.10 required).
set -euo pipefail
cd "$(dirname "$0")"
PY="${PYTHON:-python3.12}"
[ -d .venv ] || "$PY" -m venv .venv
.venv/bin/pip install -q -r requirements.txt
export SCRAPLING_STORAGE_DIR="${SCRAPLING_STORAGE_DIR:-$PWD/.data}"
export EXTRACTOR_PORT="${EXTRACTOR_PORT:-8091}"
exec .venv/bin/python server.py
```
`chmod +x services/scrapling-extractor/run-local.sh`；`.gitignore` 追加 `services/scrapling-extractor/.data/`。

- [ ] **Step 3: compose**

在 `docker-compose.yml` 的 `services:` 下、`app:` 之前插入：
```yaml
  scrapling-extractor:
    build:
      context: ./services/scrapling-extractor
    image: apsi-scrapling-extractor:local
    ports:
      - "8091:8091"
    volumes:
      # Scrapling's adaptive-selector store (SQLite) survives restarts.
      - scrapling-data:/data/scrapling
    healthcheck:
      test: ["CMD", "python", "-c", "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8091/health', timeout=2).status == 200 else 1)"]
      interval: 15s
      timeout: 3s
      retries: 5
    restart: unless-stopped
```
在 `app.environment` 追加 `SCRAPLING_EXTRACTOR_URL: http://scrapling-extractor:8091`；在 `app:` 下追加：
```yaml
    depends_on:
      scrapling-extractor:
        condition: service_healthy
```
在 `volumes:` 追加：
```yaml
  scrapling-data:
    driver: local
```

- [ ] **Step 4: 环境变量与本地配置**

`frontend/.env.local` 追加 `SCRAPLING_EXTRACTOR_URL=http://localhost:8091`。
`docs/transferability/environment-variables.md` 在 `SAM_API_KEY` 行后追加：
```
| `SCRAPLING_EXTRACTOR_URL` | `http://localhost:8091` when running `services/scrapling-extractor/run-local.sh`; `http://scrapling-extractor:8091` under docker compose. Unset = detail enrichment skipped (`reason: extractor_not_configured`). | Private network address of the extractor service; never expose publicly. |
```
`services/scrapling-extractor/README.md`：
```markdown
# scrapling-extractor

Parser-only sidecar (Scrapling 0.4.15 base package, no fetchers) that turns a bid detail page's HTML into structured fields. The crawler fetches pages itself; this service never makes outbound requests.

- Local: `./run-local.sh` (needs python3.12) → http://localhost:8091
- Docker: `docker compose up scrapling-extractor`
- API: `GET /health`, `POST /extract {url, html, fields, selectors}`
- Tests: `.venv/bin/python -m pytest tests`
```

- [ ] **Step 5: 验证镜像与 compose**

Run: `docker compose build scrapling-extractor && docker compose up -d scrapling-extractor && sleep 5 && curl -s http://localhost:8091/health`
Expected: `{"ok": true, "scrapling": "0.4.15"}`。

- [ ] **Step 6: 提交**

```bash
git add services/scrapling-extractor docker-compose.yml docs/transferability/environment-variables.md .gitignore
git commit -m "build(extractor): Dockerfile, local runner, compose service, and SCRAPLING_EXTRACTOR_URL docs"
```
（`frontend/.env.local` 不入库。）

---

### Task 4: Crawler 补全模块 `enrichment.py`

**Files:**
- Create: `crawler/apsi_crawler/enrichment.py`
- Test: `crawler/tests/test_enrichment.py`

**Interfaces:**
- Consumes: `apsi_crawler.html.public_page.fetch_html(url, session=None, timeout=30)`（浏览器 UA，非 200 抛 `HtmlPageError` 且带 `status_code`）；`apsi_crawler.storage.sqlite.now_iso()`。
- Produces:
  - `ENRICHMENT_FIELDS = ("description", "attachments", "category", "contact", "published_date")`
  - `parse_enrichment_config(fetch_config: dict | None) -> dict`（返回带默认值的规范化配置：`enabled`, `fields`, `max_details_per_run`, `min_interval_seconds`, `timeout_seconds`, `detail_selectors`, `attachment_url_template`）
  - `class ExtractorClient`：`__init__(base_url, session=None)`；`health(timeout=3.0) -> str | None`（版本或 None）；`extract(html, url, fields, selectors, timeout=10.0) -> dict`（失败抛 `ExtractorError`）
  - `enrich_bids(bids, source, fetch_config, *, extractor=None, session=None, sleep=time.sleep, now=now_iso, monotonic=time.monotonic) -> tuple[list, dict]`，stats 键：`attempted, enriched, failed, skipped, reason, extractor`
  - `resolve_attachment_url(raw_href, source_bid_id, template) -> str | None`
  - `merge_enrichment(bid, extracted, template) -> bool`（是否改动了任何字段）

- [ ] **Step 1: 写失败测试**

`crawler/tests/test_enrichment.py`：
```python
import pytest

from apsi_crawler.adapters.task import TaskSource
from apsi_crawler.enrichment import (
    ENRICHMENT_FIELDS,
    ExtractorClient,
    ExtractorError,
    enrich_bids,
    merge_enrichment,
    parse_enrichment_config,
    resolve_attachment_url,
)
from apsi_crawler.html.public_page import HtmlPageError


def _source(**fetch_config):
    return TaskSource(id="il_bidbuy", name="IL", source_label="Illinois BidBuy", jurisdiction="state", state_code="IL", fetch_config=fetch_config)


def _bid(**overrides):
    bid = {
        "id": "il_bidbuy:1", "source_bid_id": "1", "title": "Road Repair", "description": "Road Repair",
        "full_description": None, "original_category": "", "published_date": None,
        "contact_name": None, "contact_email": None, "contact_phone": None,
        "source_url": "https://portal.example.gov/bid/1", "attachments": [],
    }
    bid.update(overrides)
    return bid


class FakeExtractor:
    def __init__(self, result=None, version="0.4.15", error=None):
        self.result = result or {"fields": {}, "attachments": [], "diagnostics": {}}
        self.version = version
        self.error = error
        self.calls = []

    def health(self, timeout=3.0):
        return self.version

    def extract(self, html, url, fields, selectors, timeout=10.0):
        self.calls.append({"html": html, "url": url, "fields": fields, "selectors": selectors})
        if self.error:
            raise self.error
        return self.result


class FakeSession:
    def __init__(self, responses):
        self.responses = dict(responses)
        self.calls = []

    def get(self, url, params=None, headers=None, timeout=None):
        self.calls.append({"url": url, "headers": headers, "timeout": timeout})
        response = self.responses[url]
        if isinstance(response, Exception):
            raise response
        return response


class FakeResponse:
    def __init__(self, text="<html></html>", status_code=200, content_type="text/html"):
        self.text = text
        self.status_code = status_code
        self.headers = {"Content-Type": content_type}


ENRICHED = {
    "fields": {
        "description": "Full scope text", "full_description": "Full scope text",
        "original_category": "Construction", "contact_name": "Jane", "contact_email": "jane@example.gov",
        "contact_phone": "555-0100", "published_date": "08/14/2026",
    },
    "attachments": [
        {"name": "Spec.pdf", "url": "https://portal.example.gov/docs/spec.pdf", "raw_href": "/docs/spec.pdf", "size_label": None, "mime_type": "application/pdf", "sort_order": 0},
        {"name": "Drawings.zip", "url": None, "raw_href": "javascript:downloadFile('998877')", "size_label": None, "mime_type": "application/zip", "sort_order": 1},
    ],
    "diagnostics": {"description": "heuristic"},
}


def test_parse_config_defaults_to_disabled_with_spec_values():
    config = parse_enrichment_config({"base_url": "https://x"})
    assert config == {
        "enabled": False, "fields": list(ENRICHMENT_FIELDS), "max_details_per_run": 25,
        "min_interval_seconds": 3.0, "timeout_seconds": 20, "detail_selectors": {}, "attachment_url_template": None,
    }


def test_parse_config_reads_and_clamps_values():
    config = parse_enrichment_config({"enrichment": {"enabled": True, "fields": ["description", "bogus"], "max_details_per_run": 999, "min_interval_seconds": -1, "timeout_seconds": 1, "detail_selectors": {"description": "div.x", "bogus": "p"}, "attachment_url_template": "https://x/{id}"}})
    assert config["enabled"] is True
    assert config["fields"] == ["description"]
    assert config["max_details_per_run"] == 200
    assert config["min_interval_seconds"] == 0.0
    assert config["timeout_seconds"] == 5
    assert config["detail_selectors"] == {"description": "div.x"}
    assert config["attachment_url_template"] == "https://x/{id}"


def test_resolve_attachment_url_fills_template_from_first_digit_run():
    template = "https://www.bidbuy.illinois.gov/bso/external/bidDetail.sdo?downloadFileNbr={id}&docId={source_bid_id}&mode=download"
    assert resolve_attachment_url("javascript:downloadFile('998877')", "26-350", template) == (
        "https://www.bidbuy.illinois.gov/bso/external/bidDetail.sdo?downloadFileNbr=998877&docId=26-350&mode=download"
    )
    assert resolve_attachment_url("javascript:void(0)", "26-350", template) is None
    assert resolve_attachment_url("javascript:downloadFile('1')", "26-350", None) is None
    assert resolve_attachment_url("javascript:downloadFile('1')", "26-350", "ftp://bad/{id}") is None


def test_merge_only_fills_empty_values_and_keeps_existing_richer_data():
    bid = _bid(description="Road Repair", original_category="Existing", published_date="01/01/2026")
    changed = merge_enrichment(bid, ENRICHED, None)
    assert changed is True
    assert bid["description"] == "Full scope text"          # was equal to title → filled
    assert bid["full_description"] == "Full scope text"
    assert bid["original_category"] == "Existing"           # non-empty → kept
    assert bid["published_date"] == "01/01/2026"            # non-empty → kept
    assert bid["contact_email"] == "jane@example.gov"
    assert [a["url"] for a in bid["attachments"]] == ["https://portal.example.gov/docs/spec.pdf"]  # javascript link dropped without template
    assert bid["attachments"][0] == {"name": "Spec.pdf", "url": "https://portal.example.gov/docs/spec.pdf", "size_label": None, "mime_type": "application/pdf", "sort_order": 0}
    assert bid["raw_payload"]["enrichment"] == {"fields": {"description": "heuristic"}}


def test_merge_resolves_javascript_attachment_through_template():
    bid = _bid()
    merge_enrichment(bid, ENRICHED, "https://x/download?f={id}&d={source_bid_id}")
    assert [a["url"] for a in bid["attachments"]] == ["https://portal.example.gov/docs/spec.pdf", "https://x/download?f=998877&d=1"]
    assert bid["attachments"][1]["sort_order"] == 1


def test_merge_does_not_replace_existing_attachments():
    bid = _bid(attachments=[{"name": "Old.pdf", "url": "https://x/old.pdf", "size_label": None, "mime_type": None, "sort_order": 0}])
    merge_enrichment(bid, ENRICHED, None)
    assert [a["name"] for a in bid["attachments"]] == ["Old.pdf"]


def test_disabled_config_skips_everything():
    bids = [_bid()]
    out, stats = enrich_bids(bids, _source(), {"base_url": "https://x"}, extractor=FakeExtractor())
    assert out == bids
    assert stats == {"attempted": 0, "enriched": 0, "failed": 0, "skipped": 1, "reason": "disabled", "extractor": None}


def test_missing_extractor_configuration_skips(monkeypatch):
    monkeypatch.delenv("SCRAPLING_EXTRACTOR_URL", raising=False)
    _, stats = enrich_bids([_bid()], _source(enrichment={"enabled": True}), {"enrichment": {"enabled": True}})
    assert stats["reason"] == "extractor_not_configured"
    assert stats["skipped"] == 1


def test_unhealthy_extractor_skips_whole_stage():
    extractor = FakeExtractor(version=None)
    _, stats = enrich_bids([_bid()], _source(), {"enrichment": {"enabled": True}}, extractor=extractor)
    assert stats["reason"] == "extractor_unavailable"
    assert extractor.calls == []


def test_enriches_records_respecting_cap_and_throttle():
    extractor = FakeExtractor(result=ENRICHED)
    session = FakeSession({"https://portal.example.gov/bid/1": FakeResponse("<html>1</html>"), "https://portal.example.gov/bid/2": FakeResponse("<html>2</html>")})
    sleeps = []
    clock = iter([100.0, 100.0, 100.5, 100.5, 104.0, 104.0])
    bids = [_bid(), _bid(id="il_bidbuy:2", source_bid_id="2", source_url="https://portal.example.gov/bid/2"), _bid(id="il_bidbuy:3", source_bid_id="3", source_url="https://portal.example.gov/bid/3")]
    out, stats = enrich_bids(
        bids, _source(), {"enrichment": {"enabled": True, "max_details_per_run": 2, "min_interval_seconds": 3, "timeout_seconds": 7}},
        extractor=extractor, session=session, sleep=sleeps.append, now=lambda: "2026-09-15T00:00:00+00:00", monotonic=lambda: next(clock),
    )
    assert stats["attempted"] == 2 and stats["enriched"] == 2 and stats["skipped"] == 1 and stats["failed"] == 0
    assert stats["extractor"] == "0.4.15"
    assert out[0]["description"] == "Full scope text" and out[1]["description"] == "Full scope text"
    assert out[2]["description"] == "Road Repair"
    assert out[0]["detail_fetched_at"] == "2026-09-15T00:00:00+00:00"
    assert session.calls[0]["timeout"] == 7 and "Mozilla/5.0" in session.calls[0]["headers"]["User-Agent"]
    assert extractor.calls[0]["fields"] == list(ENRICHMENT_FIELDS) and extractor.calls[0]["url"] == "https://portal.example.gov/bid/1"
    assert sleeps == [2.5]  # second request came 0.5s after the first → wait the remaining 2.5s


def test_detail_fetch_failure_counts_failed_and_continues():
    extractor = FakeExtractor(result=ENRICHED)
    session = FakeSession({"https://portal.example.gov/bid/1": HtmlPageError("HTML request failed with status 403: nope"), "https://portal.example.gov/bid/2": FakeResponse("<html>2</html>")})
    bids = [_bid(), _bid(id="il_bidbuy:2", source_bid_id="2", source_url="https://portal.example.gov/bid/2")]
    out, stats = enrich_bids(bids, _source(), {"enrichment": {"enabled": True, "min_interval_seconds": 0}}, extractor=extractor, session=session, sleep=lambda s: None)
    assert stats["failed"] == 1 and stats["enriched"] == 1
    assert out[0]["description"] == "Road Repair" and out[1]["description"] == "Full scope text"


def test_extractor_error_counts_failed_never_raises():
    extractor = FakeExtractor(error=ExtractorError("boom"))
    session = FakeSession({"https://portal.example.gov/bid/1": FakeResponse()})
    _, stats = enrich_bids([_bid()], _source(), {"enrichment": {"enabled": True, "min_interval_seconds": 0}}, extractor=extractor, session=session, sleep=lambda s: None)
    assert stats == {"attempted": 1, "enriched": 0, "failed": 1, "skipped": 0, "reason": None, "extractor": "0.4.15"}


def test_records_without_detail_url_are_skipped():
    extractor = FakeExtractor(result=ENRICHED)
    _, stats = enrich_bids([_bid(source_url=""), _bid(source_url="https://portal.example.gov/list")], _source(base_url="https://portal.example.gov/list"), {"base_url": "https://portal.example.gov/list", "enrichment": {"enabled": True}}, extractor=extractor, session=FakeSession({}), sleep=lambda s: None)
    assert stats["skipped"] == 2 and stats["attempted"] == 0


def test_records_already_complete_for_requested_fields_are_skipped():
    extractor = FakeExtractor(result=ENRICHED)
    complete = _bid(description="Real scope text", original_category="Construction", attachments=[{"name": "A.pdf", "url": "https://x/a.pdf", "size_label": None, "mime_type": None, "sort_order": 0}])
    _, stats = enrich_bids([complete], _source(), {"enrichment": {"enabled": True, "fields": ["description", "attachments", "category"]}}, extractor=extractor, session=FakeSession({}), sleep=lambda s: None)
    assert stats == {"attempted": 0, "enriched": 0, "failed": 0, "skipped": 1, "reason": None, "extractor": "0.4.15"}
    assert extractor.calls == []


def test_extractor_client_posts_json_and_maps_errors():
    class PostSession:
        def __init__(self, status=200, payload=None):
            self.status = status
            self.payload = payload or {"fields": {}, "attachments": [], "diagnostics": {}}
            self.calls = []

        def post(self, url, json=None, timeout=None):
            self.calls.append({"url": url, "json": json, "timeout": timeout})
            return FakeJsonResponse(self.status, self.payload)

        def get(self, url, timeout=None):
            return FakeJsonResponse(200, {"ok": True, "scrapling": "0.4.15"})

    class FakeJsonResponse:
        def __init__(self, status_code, payload):
            self.status_code = status_code
            self._payload = payload

        def json(self):
            return self._payload

    session = PostSession()
    client = ExtractorClient("http://localhost:8091/", session=session)
    assert client.health() == "0.4.15"
    client.extract("<p/>", "https://x/1", ["description"], {"description": "p"})
    assert session.calls[0]["url"] == "http://localhost:8091/extract"
    assert session.calls[0]["json"] == {"html": "<p/>", "url": "https://x/1", "fields": ["description"], "selectors": {"description": "p"}}
    with pytest.raises(ExtractorError):
        ExtractorClient("http://localhost:8091", session=PostSession(status=500, payload={"error": {"code": "EXTRACT_FAILED", "message": "x"}})).extract("<p/>", "https://x/1", ["description"], None)
```

- [ ] **Step 2: 运行确认失败**

Run: `cd crawler && python3 -m pytest tests/test_enrichment.py -v`
Expected: FAIL，`ModuleNotFoundError: No module named 'apsi_crawler.enrichment'`。

- [ ] **Step 3: 实现 `apsi_crawler/enrichment.py`**

```python
"""Optional detail-page enrichment stage for fetch-task.

Fetches each normalized bid's source_url with the crawler's own requests path (browser UA,
per-source throttle) and asks the Scrapling extractor sidecar to pull description,
attachments, category, contact and published date out of the HTML. Fills EMPTY values only,
never raises into fetch_task (fail-open), and reports transparent stats.
"""

import os
import re
import time
from urllib.parse import urlparse

import requests

from apsi_crawler.html.public_page import HtmlPageError, fetch_html
from apsi_crawler.storage.sqlite import now_iso

ENRICHMENT_FIELDS = ("description", "attachments", "category", "contact", "published_date")
_DEFAULTS = {
    "enabled": False,
    "max_details_per_run": 25,
    "min_interval_seconds": 3.0,
    "timeout_seconds": 20,
}
_HEALTH_TIMEOUT = 3.0
_EXTRACT_TIMEOUT = 10.0
_MAX_HTML_BYTES = 2 * 1024 * 1024
_DIGITS = re.compile(r"\d+")


class ExtractorError(Exception):
    pass


def _clamp(value, low, high, default, cast):
    try:
        number = cast(value)
    except (TypeError, ValueError):
        return default
    return max(low, min(high, number))


def parse_enrichment_config(fetch_config):
    raw = (fetch_config or {}).get("enrichment")
    raw = raw if isinstance(raw, dict) else {}
    fields = raw.get("fields")
    if not isinstance(fields, list):
        fields = list(ENRICHMENT_FIELDS)
    fields = [field for field in fields if field in ENRICHMENT_FIELDS]
    selectors = raw.get("detail_selectors")
    selectors = selectors if isinstance(selectors, dict) else {}
    selectors = {
        key: value for key, value in selectors.items()
        if key in ENRICHMENT_FIELDS and isinstance(value, str) and value.strip()
    }
    template = raw.get("attachment_url_template")
    template = template if isinstance(template, str) and template.strip() else None
    return {
        "enabled": raw.get("enabled") is True,
        "fields": fields,
        "max_details_per_run": _clamp(raw.get("max_details_per_run"), 1, 200, _DEFAULTS["max_details_per_run"], int),
        "min_interval_seconds": _clamp(raw.get("min_interval_seconds"), 0.0, 60.0, _DEFAULTS["min_interval_seconds"], float),
        "timeout_seconds": _clamp(raw.get("timeout_seconds"), 5, 60, _DEFAULTS["timeout_seconds"], int),
        "detail_selectors": selectors,
        "attachment_url_template": template,
    }


class ExtractorClient:
    def __init__(self, base_url, session=None):
        self.base_url = base_url.rstrip("/")
        self.session = session or requests.Session()

    def health(self, timeout=_HEALTH_TIMEOUT):
        try:
            response = self.session.get(f"{self.base_url}/health", timeout=timeout)
            if response.status_code != 200:
                return None
            payload = response.json()
        except (requests.RequestException, ValueError):
            return None
        return payload.get("scrapling") if isinstance(payload, dict) and payload.get("ok") else None

    def extract(self, html, url, fields, selectors, timeout=_EXTRACT_TIMEOUT):
        try:
            response = self.session.post(
                f"{self.base_url}/extract",
                json={"html": html, "url": url, "fields": list(fields), "selectors": selectors or None},
                timeout=timeout,
            )
        except requests.RequestException as error:
            raise ExtractorError(f"extractor request failed: {error}") from error
        try:
            payload = response.json()
        except ValueError as error:
            raise ExtractorError("extractor returned non-JSON") from error
        if response.status_code != 200:
            message = payload.get("error", {}).get("message") if isinstance(payload, dict) else None
            raise ExtractorError(f"extractor returned {response.status_code}: {message}")
        if not isinstance(payload, dict) or not isinstance(payload.get("fields"), dict):
            raise ExtractorError("extractor payload missing fields")
        return payload


def resolve_attachment_url(raw_href, source_bid_id, template):
    if not template or not isinstance(template, str):
        return None
    if urlparse(template).scheme not in ("http", "https"):
        return None
    match = _DIGITS.search(raw_href or "")
    if not match:
        return None
    return template.replace("{id}", match.group(0)).replace("{source_bid_id}", str(source_bid_id or ""))


def _empty(value):
    return value is None or (isinstance(value, str) and not value.strip())


def merge_enrichment(bid, extracted, template):
    fields = extracted.get("fields") or {}
    changed = False

    description = fields.get("description")
    if not _empty(description) and (_empty(bid.get("description")) or bid.get("description") == bid.get("title")):
        bid["description"] = description
        changed = True
    for key in ("full_description", "original_category", "contact_name", "contact_email", "contact_phone", "published_date"):
        value = fields.get(key)
        if not _empty(value) and _empty(bid.get(key)):
            bid[key] = value
            changed = True

    if not bid.get("attachments"):
        resolved = []
        for attachment in extracted.get("attachments") or []:
            url = attachment.get("url") or resolve_attachment_url(attachment.get("raw_href"), bid.get("source_bid_id"), template)
            if not url or urlparse(url).scheme not in ("http", "https"):
                continue
            resolved.append(
                {
                    "name": attachment.get("name") or url,
                    "url": url,
                    "size_label": attachment.get("size_label"),
                    "mime_type": attachment.get("mime_type"),
                    "sort_order": len(resolved),
                }
            )
        if resolved:
            bid["attachments"] = resolved
            changed = True

    raw_payload = bid.get("raw_payload")
    if not isinstance(raw_payload, dict):
        raw_payload = {}
    raw_payload["enrichment"] = {"fields": extracted.get("diagnostics") or {}}
    bid["raw_payload"] = raw_payload
    return changed


def _already_complete(bid, fields):
    """True when every requested field group already holds a real value (nothing to fill)."""
    checks = {
        "description": lambda: not _empty(bid.get("description")) and bid.get("description") != bid.get("title"),
        "attachments": lambda: bool(bid.get("attachments")),
        "category": lambda: not _empty(bid.get("original_category")),
        "contact": lambda: any(not _empty(bid.get(key)) for key in ("contact_name", "contact_email", "contact_phone")),
        "published_date": lambda: not _empty(bid.get("published_date")),
    }
    return all(checks[field]() for field in fields if field in checks)


def _needs_enrichment(bid, source, config):
    url = bid.get("source_url") or ""
    if urlparse(url).scheme not in ("http", "https"):
        return False
    if url.rstrip("/") == (source.base_url or "").rstrip("/"):
        return False
    if _already_complete(bid, config["fields"]):
        return False
    return True


def enrich_bids(bids, source, fetch_config, *, extractor=None, session=None, sleep=time.sleep, now=now_iso, monotonic=time.monotonic):
    config = parse_enrichment_config(fetch_config)
    stats = {"attempted": 0, "enriched": 0, "failed": 0, "skipped": 0, "reason": None, "extractor": None}

    if not config["enabled"]:
        stats["skipped"] = len(bids)
        stats["reason"] = "disabled"
        return bids, stats

    if extractor is None:
        base_url = os.environ.get("SCRAPLING_EXTRACTOR_URL", "").strip()
        if not base_url:
            stats["skipped"] = len(bids)
            stats["reason"] = "extractor_not_configured"
            return bids, stats
        extractor = ExtractorClient(base_url)

    version = extractor.health()
    if not version:
        stats["skipped"] = len(bids)
        stats["reason"] = "extractor_unavailable"
        return bids, stats
    stats["extractor"] = version

    client = session or requests.Session()
    close_client = session is None
    last_request_at = None
    try:
        for bid in bids:
            if stats["attempted"] >= config["max_details_per_run"] or not _needs_enrichment(bid, source, config):
                stats["skipped"] += 1
                continue

            if last_request_at is not None:
                remaining = config["min_interval_seconds"] - (monotonic() - last_request_at)
                if remaining > 0:
                    sleep(remaining)
            stats["attempted"] += 1
            last_request_at = monotonic()
            try:
                html = fetch_html(bid["source_url"], session=client, timeout=config["timeout_seconds"])
                if len(html.encode("utf-8", errors="ignore")) > _MAX_HTML_BYTES:
                    raise ExtractorError("detail page exceeds 2 MB")
                extracted = extractor.extract(html, bid["source_url"], config["fields"], config["detail_selectors"])
                merge_enrichment(bid, extracted, config["attachment_url_template"])
                bid["detail_fetched_at"] = now()
                stats["enriched"] += 1
            except (HtmlPageError, ExtractorError, requests.RequestException, ValueError, KeyError, TypeError):
                stats["failed"] += 1
            except Exception:  # noqa: BLE001 - fail-open by contract
                stats["failed"] += 1
    finally:
        if close_client:
            client.close()

    return bids, stats
```

- [ ] **Step 4: 运行测试**

Run: `cd crawler && python3 -m pytest tests/test_enrichment.py -v`
Expected: 15 passed。若 `test_enriches_records_respecting_cap_and_throttle` 的 `sleeps` 断言不等于 `[2.5]`，检查 `monotonic()` 的调用次数与 `clock` 序列一致（每条记录调用两次：节流判断与 `last_request_at`），调整 `clock` 序列而非实现。

- [ ] **Step 5: 全量 crawler 测试并提交**

Run: `cd crawler && python3 -m pytest -q`
Expected: 全部通过（现有 239 + 新增 15）。

```bash
git add crawler/apsi_crawler/enrichment.py crawler/tests/test_enrichment.py
git commit -m "feat(crawler): add fail-open detail enrichment stage backed by the Scrapling extractor"
```

---

### Task 5: 接入 `fetch_task` 与契约更新

**Files:**
- Modify: `crawler/apsi_crawler/cli.py`（`fetch_task`，`_require_non_empty_bids` 与 `apply_date_window` 之间）
- Modify: `crawler/tests/fixtures/contracts/fetch_task_v1.json`
- Modify: `crawler/tests/test_contract_compatibility.py`
- Test: `crawler/tests/test_fetch_task_cli.py`

**Interfaces:**
- Consumes: Task 4 `enrich_bids(bids, source, fetch_config)`。
- Produces: `metadata["enrichment"]` 恒存在于成功载荷（禁用时为 `{"attempted":0,...,"reason":"disabled"}`）；TS 侧 `CrawlerJsonRunPayload.metadata.enrichment` 可选。

- [ ] **Step 1: 写失败测试**

在 `crawler/tests/test_fetch_task_cli.py` 末尾追加：
```python
def test_fetch_task_reports_disabled_enrichment_by_default(monkeypatch, capsys):
    monkeypatch.setitem(registry.DEDICATED_ADAPTERS, "plain_source", lambda source, **kwargs: [{"id": "plain_source:1", "title": "T", "source": "Plain"}])
    exit_code, result = _run({"task_id": "tsk_e1", "source_id": "plain_source", "label": "Plain", "state_code": "CA", "fetch_config": {}}, monkeypatch, capsys)
    assert exit_code == 0
    assert result["metadata"]["enrichment"] == {"attempted": 0, "enriched": 0, "failed": 0, "skipped": 1, "reason": "disabled", "extractor": None}


def test_fetch_task_runs_enrichment_when_enabled(monkeypatch, capsys):
    from apsi_crawler import enrichment

    monkeypatch.setitem(registry.DEDICATED_ADAPTERS, "rich_source", lambda source, **kwargs: [{"id": "rich_source:1", "title": "T", "description": "T", "source": "Rich", "source_url": "https://portal.example.gov/bid/1", "attachments": []}])
    monkeypatch.setattr(enrichment, "fetch_html", lambda url, session=None, timeout=30: "<html>detail</html>")

    class Extractor:
        def health(self, timeout=3.0):
            return "0.4.15"

        def extract(self, html, url, fields, selectors, timeout=10.0):
            return {"fields": {"description": "Long description"}, "attachments": [], "diagnostics": {"description": "heuristic"}}

    monkeypatch.setattr(enrichment, "ExtractorClient", lambda base_url, session=None: Extractor())
    monkeypatch.setenv("SCRAPLING_EXTRACTOR_URL", "http://extractor.test")

    exit_code, result = _run({"task_id": "tsk_e2", "source_id": "rich_source", "label": "Rich", "state_code": "CA", "fetch_config": {"enrichment": {"enabled": True, "min_interval_seconds": 0}}}, monkeypatch, capsys)
    assert exit_code == 0
    assert result["bids"][0]["description"] == "Long description"
    assert result["metadata"]["enrichment"]["enriched"] == 1


def test_enrichment_failure_never_fails_the_run(monkeypatch, capsys):
    from apsi_crawler import enrichment

    monkeypatch.setitem(registry.DEDICATED_ADAPTERS, "fragile_source", lambda source, **kwargs: [{"id": "fragile_source:1", "title": "T", "source": "Fragile", "source_url": "https://portal.example.gov/bid/1"}])
    monkeypatch.setenv("SCRAPLING_EXTRACTOR_URL", "http://extractor.test")

    class Broken:
        def health(self, timeout=3.0):
            raise RuntimeError("health exploded")

    monkeypatch.setattr(enrichment, "ExtractorClient", lambda base_url, session=None: Broken())
    exit_code, result = _run({"task_id": "tsk_e3", "source_id": "fragile_source", "label": "Fragile", "state_code": "CA", "fetch_config": {"enrichment": {"enabled": True}}}, monkeypatch, capsys)
    assert exit_code == 0
    assert result["status"] == "success"
    assert result["metadata"]["enrichment"]["reason"] == "enrichment_crashed"
```

- [ ] **Step 2: 运行确认失败**

Run: `cd crawler && python3 -m pytest tests/test_fetch_task_cli.py -v -k enrichment`
Expected: 3 FAIL（`KeyError: 'enrichment'`）。

- [ ] **Step 3: 修改 `cli.py`**

导入区追加 `from apsi_crawler.enrichment import enrich_bids`。在 `fetch_task` 中把
```python
        _require_non_empty_bids(bids, source.id)
        bids, date_filter_stats = apply_date_window(bids, date_range)
```
改为
```python
        _require_non_empty_bids(bids, source.id)
        # Optional detail-page enrichment (fetch_config.enrichment.enabled). Runs after the
        # liveness check and before the date window so filtered-out rows are never fetched
        # twice... but is ALWAYS fail-open: any crash here is recorded, never raised.
        try:
            bids, enrichment_stats = enrich_bids(bids, source, payload.get("fetch_config"))
        except Exception as error:  # noqa: BLE001 - enrichment must never fail the run
            enrichment_stats = {
                "attempted": 0, "enriched": 0, "failed": 0, "skipped": len(bids),
                "reason": "enrichment_crashed", "extractor": None, "error": f"{type(error).__name__}: {error}",
            }
        metadata["enrichment"] = enrichment_stats
        bids, date_filter_stats = apply_date_window(bids, date_range)
```

- [ ] **Step 4: 契约 fixture 与守卫测试**

`tests/fixtures/contracts/fetch_task_v1.json` 的 `fetch_config` 改为：
```json
  "fetch_config": {
    "base_url": "https://caleprocure.ca.gov",
    "enrichment": {
      "enabled": false,
      "fields": ["description", "attachments", "category", "contact", "published_date"],
      "max_details_per_run": 25,
      "min_interval_seconds": 3,
      "timeout_seconds": 20,
      "detail_selectors": {},
      "attachment_url_template": null
    }
  },
```
在 `tests/test_contract_compatibility.py` 追加：
```python
def test_contract_enrichment_block_parses_to_disabled_defaults():
    from apsi_crawler.enrichment import parse_enrichment_config

    payload = json.loads(CONTRACT_PATH.read_text())
    config = parse_enrichment_config(payload["fetch_config"])
    assert config["enabled"] is False
    assert config["fields"] == ["description", "attachments", "category", "contact", "published_date"]
    assert config["max_details_per_run"] == 25
```
（文件顶部已有 `import json`；若没有则补上。）

- [ ] **Step 5: 运行全量测试**

Run: `cd crawler && python3 -m pytest -q`
Expected: 全部通过（含 3 个新 CLI 测试与 1 个契约测试）。

- [ ] **Step 6: 提交**

```bash
git add crawler/apsi_crawler/cli.py crawler/tests/test_fetch_task_cli.py crawler/tests/fixtures/contracts/fetch_task_v1.json crawler/tests/test_contract_compatibility.py
git commit -m "feat(crawler): wire fail-open enrichment into fetch-task and extend the task contract"
```

---

### Task 6: SQLite importer 补全保护式 upsert

**Files:**
- Modify: `frontend/src/server/crawler/sqlite-json-importer.ts`（`replaceAttachments`、`upsertBid`）
- Test: `frontend/src/server/crawler/sqlite-json-importer.test.ts`

**Interfaces:**
- Produces: 导出 `enrichmentPreservingUpdateSet(updateValues, row)`（返回传给 `onConflictDoUpdate({ set })` 的对象）——Task 7 的 MySQL 实现遵循同一规则但用 SQL 表达。

- [ ] **Step 1: 写失败测试**

在 `sqlite-json-importer.test.ts` 的 `describe` 内追加（复用文件顶部已有的 `NOW`、`testDb`、`importCrawlerJsonRunIntoSqlite`、`bids`、`bidAttachments` 导入；若 `bidAttachments`/`eq` 未导入则从 `@/server/db/schema`、`drizzle-orm` 导入）：
```typescript
  function payloadWith(bid: Record<string, unknown>) {
    return {
      source: "il_bidbuy", runId: `run_${Math.random().toString(16).slice(2)}`, status: "success" as const,
      startedAt: NOW, finishedAt: NOW, durationMs: 5, metadata: {}, bids: [bid], errorCode: null, errorMessage: null, errorStack: null,
    };
  }

  const baseBid = {
    id: "il_bidbuy:1", source: "Illinois BidBuy", source_bid_id: "1", dedupe_key: "il_bidbuy:1", title: "Road Repair",
    issuer_name: "IDOT", issuer_type: "state", state_code: "IL", source_url: "https://portal.example.gov/bid/1",
  };

  it("keeps an enriched description when a later run only carries the title again", () => {
    importCrawlerJsonRunIntoSqlite(testDb.db, payloadWith({ ...baseBid, description: "Full scope of work", full_description: "Full scope of work", original_category: "Construction", published_date: "08/14/2026", contact_email: "jane@example.gov", detail_fetched_at: NOW }));
    importCrawlerJsonRunIntoSqlite(testDb.db, payloadWith({ ...baseBid, description: "Road Repair", full_description: null, original_category: "", published_date: null, contact_email: null, detail_fetched_at: null }));

    const row = testDb.db.select().from(bids).where(eq(bids.id, "il_bidbuy:1")).get();
    expect(row?.description).toBe("Full scope of work");
    expect(row?.fullDescription).toBe("Full scope of work");
    expect(row?.originalCategory).toBe("Construction");
    expect(row?.publishedDate).toBe("08/14/2026");
    expect(row?.contactEmail).toBe("jane@example.gov");
    expect(row?.detailFetchedAt).toBe(NOW);
  });

  it("still overwrites enriched fields with newer non-empty values", () => {
    importCrawlerJsonRunIntoSqlite(testDb.db, payloadWith({ ...baseBid, description: "Old scope", original_category: "Old" }));
    importCrawlerJsonRunIntoSqlite(testDb.db, payloadWith({ ...baseBid, description: "New scope", original_category: "New" }));

    const row = testDb.db.select().from(bids).where(eq(bids.id, "il_bidbuy:1")).get();
    expect(row?.description).toBe("New scope");
    expect(row?.originalCategory).toBe("New");
  });

  it("keeps existing attachments when a later run carries an empty attachment list", () => {
    importCrawlerJsonRunIntoSqlite(testDb.db, payloadWith({ ...baseBid, attachments: [{ name: "Spec.pdf", url: "https://portal.example.gov/spec.pdf", sort_order: 0 }] }));
    importCrawlerJsonRunIntoSqlite(testDb.db, payloadWith({ ...baseBid, attachments: [] }));
    expect(testDb.db.select().from(bidAttachments).where(eq(bidAttachments.bidId, "il_bidbuy:1")).all()).toHaveLength(1);

    importCrawlerJsonRunIntoSqlite(testDb.db, payloadWith({ ...baseBid, attachments: [{ name: "A.pdf", url: "https://x/a.pdf", sort_order: 0 }, { name: "B.pdf", url: "https://x/b.pdf", sort_order: 1 }] }));
    expect(testDb.db.select().from(bidAttachments).where(eq(bidAttachments.bidId, "il_bidbuy:1")).all().map((a) => a.name)).toEqual(["A.pdf", "B.pdf"]);
  });
```

- [ ] **Step 2: 运行确认失败**

Run: `cd frontend && npx vitest run src/server/crawler/sqlite-json-importer.test.ts`
Expected: 3 个新测试 FAIL（描述被覆盖为 "Road Repair"；附件被清空）。

- [ ] **Step 3: 实现**

在 `sqlite-json-importer.ts` 顶部 `import { eq } from "drizzle-orm"` 改为 `import { eq, sql } from "drizzle-orm"`。新增导出：
```typescript
/**
 * Enrichment-preserving update set: a list-page-only run must not clobber detail-page data
 * written by an earlier enriched run. `description` is only replaced when the incoming value
 * is a real description (non-empty and different from the incoming title); the other
 * enrichable columns only when the incoming value is non-empty. Everything else keeps the
 * plain overwrite semantics.
 */
export function enrichmentPreservingUpdateSet(updateValues: ReturnType<typeof bidUpdateValues>, row: JsonRecord) {
  const incomingDescription = stringValue(row.description, "");
  const incomingTitle = stringValue(row.title, "Untitled opportunity");
  const realDescription = incomingDescription.trim() !== "" && incomingDescription !== incomingTitle;
  const keepIfEmpty = <K extends keyof typeof updateValues>(key: K, column: string) =>
    updateValues[key] === null || updateValues[key] === ""
      ? sql.raw(column)
      : updateValues[key];

  return {
    ...updateValues,
    description: realDescription ? updateValues.description : sql.raw("description"),
    fullDescription: keepIfEmpty("fullDescription", "full_description"),
    originalCategory: keepIfEmpty("originalCategory", "original_category"),
    contactName: keepIfEmpty("contactName", "contact_name"),
    contactEmail: keepIfEmpty("contactEmail", "contact_email"),
    contactPhone: keepIfEmpty("contactPhone", "contact_phone"),
    publishedDate: keepIfEmpty("publishedDate", "published_date"),
    detailFetchedAt: keepIfEmpty("detailFetchedAt", "detail_fetched_at"),
  };
}
```
`upsertBid` 中 `.onConflictDoUpdate({ target: bids.id, set: updateValues })` 改为 `.onConflictDoUpdate({ target: bids.id, set: enrichmentPreservingUpdateSet(updateValues, row) })`。
`replaceAttachments` 开头加：
```typescript
  const incoming = attachmentRowsForBid(row, bidId, fallbackTimestamp);
  // An empty incoming list means "this run learned nothing about attachments" (list-page-only
  // crawl), not "the portal removed them" — keep whatever an enriched run already stored.
  if (incoming.length === 0) return;
  db.delete(bidAttachments).where(eq(bidAttachments.bidId, bidId)).run();
  for (const attachmentRow of incoming) {
    db.insert(bidAttachments).values(attachmentRow).run();
  }
```
（替换原函数体；更新函数上方注释的最后一句为"empty payload lists are ignored, see below"。）注意 Drizzle 的 `sql.raw("description")` 在 `ON CONFLICT DO UPDATE SET description = description` 语境下引用的是**现有行**的列值——正是所需语义。

- [ ] **Step 4: 运行测试**

Run: `cd frontend && npx vitest run src/server/crawler/sqlite-json-importer.test.ts src/server/crawler/configured-runner.test.ts src/app/api/crawler/state/run/route.test.ts`
Expected: 全部通过。SQLite 的 `ON CONFLICT DO UPDATE SET col = <expr>` 中，裸列名 `description` 指**现有行**的值，`excluded.description` 才是传入值——`sql.raw("description")` 正是"保留现值"。若 Drizzle 生成的 SQL 让 SQLite 报 "ambiguous column"/"no such column"，改为显式限定 `sql\`"bids"."description"\``（其余列同理）后重跑。

- [ ] **Step 5: 提交**

```bash
git add frontend/src/server/crawler/sqlite-json-importer.ts frontend/src/server/crawler/sqlite-json-importer.test.ts
git commit -m "fix(importer): enrichment-preserving upsert for the SQLite JSON importer"
```

---

### Task 7: MySQL importer 补全保护式 upsert

**Files:**
- Modify: `frontend/src/server/crawler/mysql-json-importer.ts`（`upsertBid`、`replaceAttachments`）
- Test: `frontend/src/server/crawler/mysql-json-importer.test.ts`

**Interfaces:**
- Produces: 导出 `bidUpdateAssignment(column: string): string`，返回 `ON DUPLICATE KEY UPDATE` 片段。

- [ ] **Step 1: 写失败测试**

在 `mysql-json-importer.test.ts` 顶部导入 `bidUpdateAssignment`，追加：
```typescript
  it("builds enrichment-preserving ON DUPLICATE KEY UPDATE assignments", () => {
    expect(bidUpdateAssignment("description")).toBe(
      "description = IF(VALUES(description) <> '' AND VALUES(description) <> VALUES(title), VALUES(description), description)",
    );
    for (const column of ["full_description", "original_category", "contact_name", "contact_email", "contact_phone", "published_date", "detail_fetched_at"]) {
      expect(bidUpdateAssignment(column)).toBe(`${column} = COALESCE(NULLIF(VALUES(${column}), ''), ${column})`);
    }
    expect(bidUpdateAssignment("title")).toBe("title = VALUES(title)");
    expect(bidUpdateAssignment("deadline_date")).toBe("deadline_date = VALUES(deadline_date)");
  });

  it("uses the preserving assignments in the bids upsert SQL", async () => {
    const mysql = createFakeMysql();
    const executed: string[] = [];
    const recording = { ...mysql, execute: async (sql: string, values: unknown[] = []) => { executed.push(sql); return mysql.execute(sql, values); } };
    await importCrawlerJsonRunIntoMysql(recording as typeof mysql, {
      source: "il_bidbuy", runId: "run_p", status: "success", startedAt: NOW, finishedAt: NOW, durationMs: 1, metadata: {},
      bids: [{ id: "il_bidbuy:1", source: "Illinois BidBuy", source_bid_id: "1", dedupe_key: "il_bidbuy:1", title: "T", description: "T", state_code: "IL", source_url: "https://x/1" }],
      errorCode: null, errorMessage: null, errorStack: null,
    });
    const upsert = executed.find((sql) => sql.includes("INSERT INTO bids"));
    expect(upsert).toContain("description = IF(VALUES(description) <> '' AND VALUES(description) <> VALUES(title), VALUES(description), description)");
    expect(upsert).toContain("original_category = COALESCE(NULLIF(VALUES(original_category), ''), original_category)");
  });

  it("does not delete existing attachments when the payload carries an empty list", async () => {
    const mysql = createFakeMysql();
    const executed: string[] = [];
    const recording = { ...mysql, execute: async (sql: string, values: unknown[] = []) => { executed.push(sql); return mysql.execute(sql, values); } };
    await importCrawlerJsonRunIntoMysql(recording as typeof mysql, {
      source: "il_bidbuy", runId: "run_a", status: "success", startedAt: NOW, finishedAt: NOW, durationMs: 1, metadata: {},
      bids: [{ id: "il_bidbuy:1", source: "Illinois BidBuy", source_bid_id: "1", dedupe_key: "il_bidbuy:1", title: "T", state_code: "IL", source_url: "https://x/1", attachments: [] }],
      errorCode: null, errorMessage: null, errorStack: null,
    });
    expect(executed.some((sql) => sql.includes("DELETE FROM bid_attachments"))).toBe(false);
  });
```

- [ ] **Step 2: 运行确认失败**

Run: `cd frontend && npx vitest run src/server/crawler/mysql-json-importer.test.ts`
Expected: 3 FAIL（`bidUpdateAssignment` 未导出；DELETE 被执行）。

- [ ] **Step 3: 实现**

在 `mysql-json-importer.ts` 的 `bidUpdateColumns` 定义后追加：
```typescript
const preserveWhenEmptyColumns = new Set([
  "full_description", "original_category", "contact_name", "contact_email", "contact_phone", "published_date", "detail_fetched_at",
]);

/**
 * ON DUPLICATE KEY UPDATE assignment for one column. Detail-page enrichment (see
 * crawler/apsi_crawler/enrichment.py) writes richer values than a list-page crawl; a later
 * list-page-only run must not clobber them. MySQL twin of sqlite-json-importer.ts's
 * enrichmentPreservingUpdateSet.
 */
export function bidUpdateAssignment(column: string) {
  if (column === "description") {
    return "description = IF(VALUES(description) <> '' AND VALUES(description) <> VALUES(title), VALUES(description), description)";
  }
  if (preserveWhenEmptyColumns.has(column)) {
    return `${column} = COALESCE(NULLIF(VALUES(${column}), ''), ${column})`;
  }
  return `${column} = VALUES(${column})`;
}
```
`upsertBid` 的 SQL 中 `${bidUpdateColumns.map((column) => \`${column} = VALUES(${column})\`).join(", ")}` 改为 `${bidUpdateColumns.map(bidUpdateAssignment).join(", ")}`。
`replaceAttachments` 循环体改为：
```typescript
    const incoming = attachmentRowsForBid(row, mysqlBidId, fallbackTimestamp);
    // Empty list = this run learned nothing about attachments (list-page-only crawl); keep
    // what an enriched run already stored. Non-empty lists still fully replace the set.
    if (incoming.length === 0) continue;
    await mysqlExecute(mysql, "DELETE FROM bid_attachments WHERE bid_id = ?", [mysqlBidId]);
    for (const attachment of incoming) {
      await mysqlExecute(
        mysql,
        `
          INSERT INTO bid_attachments (${attachmentColumns.join(", ")})
          VALUES (${attachmentColumns.map(() => "?").join(", ")})
        `,
        attachmentColumns.map((column) => attachment[column]),
      );
    }
```

- [ ] **Step 4: 运行测试**

Run: `cd frontend && npx vitest run src/server/crawler/mysql-json-importer.test.ts src/server/crawler/mysql-importer.test.ts src/server/crawler/configured-runner.test.ts`
Expected: 全部通过。

- [ ] **Step 5: 真实 MySQL 冒烟**

Run: `cd frontend && set -a && source .env.local && set +a && npm run db:mysql:smoke`
Expected: `MySQL smoke passed`（importer 改动不影响 schema）。

- [ ] **Step 6: 提交**

```bash
git add frontend/src/server/crawler/mysql-json-importer.ts frontend/src/server/crawler/mysql-json-importer.test.ts
git commit -m "fix(importer): enrichment-preserving upsert for the MySQL JSON importer"
```

---

### Task 8: 爬虫配置校验与仓库层双实现

**Files:**
- Create: `frontend/src/server/admin/crawler-config.ts`
- Test: `frontend/src/server/admin/crawler-config.test.ts`
- Modify: `frontend/src/server/admin/data-sources-repository.ts`（`AdminDataSource`、`DataSourceRow` 选择列、`toAdminSource`、`UpdateAdminDataSourceInput`、两个 update 函数）
- Test: `frontend/src/server/admin/data-sources-repository.test.ts`

**Interfaces:**
- Produces:
  - `crawler-config.ts`：`CADENCES = ["hourly","daily","weekly","manual"] as const`；`type Cadence`；`ENRICHMENT_FIELDS = ["description","attachments","category","contact","published_date"] as const`；`interface EnrichmentConfig { enabled: boolean; fields: EnrichmentField[]; maxDetailsPerRun: number; minIntervalSeconds: number; timeoutSeconds: number; detailSelectors: Partial<Record<EnrichmentField,string>>; attachmentUrlTemplate: string | null }`；`DEFAULT_ENRICHMENT_CONFIG`；`parseEnrichmentConfig(fetchConfig: Record<string,unknown>): EnrichmentConfig`；`validateCrawlerConfigInput(input: { fetchConfig?: unknown; cadence?: unknown; baseUrl?: unknown }): { ok: true; value: { fetchConfig?: Record<string,unknown>; cadence?: Cadence; baseUrl?: string | null } } | { ok: false; message: string }`；`serializeEnrichmentConfig(config: EnrichmentConfig): Record<string, unknown>`（转成 snake_case 的 `enrichment` 块）。
  - `AdminDataSource.fetchConfig: Record<string, unknown>`；`UpdateAdminDataSourceInput` 增加 `fetchConfig?: Record<string, unknown>; cadence?: Cadence; baseUrl?: string | null`；审计事件名 `data_source.crawler_config_updated`。

- [ ] **Step 1: 写校验函数失败测试**

`crawler-config.test.ts`：
```typescript
import { describe, expect, it } from "vitest";
import { DEFAULT_ENRICHMENT_CONFIG, parseEnrichmentConfig, serializeEnrichmentConfig, validateCrawlerConfigInput } from "./crawler-config";

describe("parseEnrichmentConfig", () => {
  it("returns disabled defaults for a fetch_config without an enrichment block", () => {
    expect(parseEnrichmentConfig({ base_url: "https://x" })).toEqual(DEFAULT_ENRICHMENT_CONFIG);
    expect(DEFAULT_ENRICHMENT_CONFIG).toEqual({
      enabled: false, fields: ["description", "attachments", "category", "contact", "published_date"],
      maxDetailsPerRun: 25, minIntervalSeconds: 3, timeoutSeconds: 20, detailSelectors: {}, attachmentUrlTemplate: null,
    });
  });

  it("reads snake_case values and drops unknown fields/selectors", () => {
    expect(parseEnrichmentConfig({ enrichment: { enabled: true, fields: ["description", "bogus"], max_details_per_run: 10, min_interval_seconds: 1, timeout_seconds: 30, detail_selectors: { description: "div.x", bogus: "p" }, attachment_url_template: "https://x/{id}" } })).toEqual({
      enabled: true, fields: ["description"], maxDetailsPerRun: 10, minIntervalSeconds: 1, timeoutSeconds: 30, detailSelectors: { description: "div.x" }, attachmentUrlTemplate: "https://x/{id}",
    });
  });

  it("round-trips through serializeEnrichmentConfig", () => {
    const config = { ...DEFAULT_ENRICHMENT_CONFIG, enabled: true, detailSelectors: { attachments: "a.doc" } };
    expect(parseEnrichmentConfig({ enrichment: serializeEnrichmentConfig(config) })).toEqual(config);
  });
});

describe("validateCrawlerConfigInput", () => {
  it("accepts a valid fetchConfig, cadence and baseUrl", () => {
    const result = validateCrawlerConfigInput({
      fetchConfig: { base_url: "https://x", enrichment: { enabled: true, fields: ["description"], max_details_per_run: 5, min_interval_seconds: 2, timeout_seconds: 10, detail_selectors: {}, attachment_url_template: null } },
      cadence: "weekly", baseUrl: "https://portal.example.gov/bids",
    });
    expect(result).toEqual({ ok: true, value: { fetchConfig: { base_url: "https://x", enrichment: { enabled: true, fields: ["description"], max_details_per_run: 5, min_interval_seconds: 2, timeout_seconds: 10, detail_selectors: {}, attachment_url_template: null } }, cadence: "weekly", baseUrl: "https://portal.example.gov/bids" } });
  });

  it("rejects out-of-range numbers, unknown fields, bad cadence, non-http base URL and oversized JSON", () => {
    expect(validateCrawlerConfigInput({ fetchConfig: { enrichment: { max_details_per_run: 500 } } })).toEqual({ ok: false, message: "enrichment.max_details_per_run must be between 1 and 200." });
    expect(validateCrawlerConfigInput({ fetchConfig: { enrichment: { min_interval_seconds: 61 } } })).toEqual({ ok: false, message: "enrichment.min_interval_seconds must be between 0 and 60." });
    expect(validateCrawlerConfigInput({ fetchConfig: { enrichment: { timeout_seconds: 2 } } })).toEqual({ ok: false, message: "enrichment.timeout_seconds must be between 5 and 60." });
    expect(validateCrawlerConfigInput({ fetchConfig: { enrichment: { fields: ["price"] } } })).toEqual({ ok: false, message: "enrichment.fields contains an unsupported field: price." });
    expect(validateCrawlerConfigInput({ fetchConfig: { enrichment: { detail_selectors: { description: "" } } } })).toEqual({ ok: false, message: "enrichment.detail_selectors.description must be a non-empty string." });
    expect(validateCrawlerConfigInput({ fetchConfig: { enrichment: { attachment_url_template: "ftp://x/{id}" } } })).toEqual({ ok: false, message: "enrichment.attachment_url_template must be an absolute http(s) URL." });
    expect(validateCrawlerConfigInput({ cadence: "yearly" })).toEqual({ ok: false, message: "cadence must be one of hourly, daily, weekly, manual." });
    expect(validateCrawlerConfigInput({ baseUrl: "javascript:alert(1)" })).toEqual({ ok: false, message: "baseUrl must be an absolute http(s) URL or null." });
    expect(validateCrawlerConfigInput({ fetchConfig: { note: "x".repeat(9000) } })).toEqual({ ok: false, message: "fetchConfig must serialize to at most 8192 bytes." });
    expect(validateCrawlerConfigInput({ fetchConfig: [] })).toEqual({ ok: false, message: "fetchConfig must be a JSON object." });
  });

  it("returns an empty value when nothing crawler-related is present", () => {
    expect(validateCrawlerConfigInput({})).toEqual({ ok: true, value: {} });
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd frontend && npx vitest run src/server/admin/crawler-config.test.ts`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现 `crawler-config.ts`**

```typescript
export const CADENCES = ["hourly", "daily", "weekly", "manual"] as const;
export type Cadence = (typeof CADENCES)[number];

export const ENRICHMENT_FIELDS = ["description", "attachments", "category", "contact", "published_date"] as const;
export type EnrichmentField = (typeof ENRICHMENT_FIELDS)[number];

export interface EnrichmentConfig {
  enabled: boolean;
  fields: EnrichmentField[];
  maxDetailsPerRun: number;
  minIntervalSeconds: number;
  timeoutSeconds: number;
  detailSelectors: Partial<Record<EnrichmentField, string>>;
  attachmentUrlTemplate: string | null;
}

export const DEFAULT_ENRICHMENT_CONFIG: EnrichmentConfig = {
  enabled: false,
  fields: [...ENRICHMENT_FIELDS],
  maxDetailsPerRun: 25,
  minIntervalSeconds: 3,
  timeoutSeconds: 20,
  detailSelectors: {},
  attachmentUrlTemplate: null,
};

const MAX_FETCH_CONFIG_BYTES = 8192;
const RANGES = {
  max_details_per_run: [1, 200],
  min_interval_seconds: [0, 60],
  timeout_seconds: [5, 60],
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isHttpUrl(value: string) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function isEnrichmentField(value: unknown): value is EnrichmentField {
  return typeof value === "string" && (ENRICHMENT_FIELDS as readonly string[]).includes(value);
}

/** Lenient reader (mirrors crawler/apsi_crawler/enrichment.py parse_enrichment_config). */
export function parseEnrichmentConfig(fetchConfig: Record<string, unknown>): EnrichmentConfig {
  const raw = isRecord(fetchConfig.enrichment) ? fetchConfig.enrichment : {};
  const fields = Array.isArray(raw.fields) ? raw.fields.filter(isEnrichmentField) : [...ENRICHMENT_FIELDS];
  const selectors: Partial<Record<EnrichmentField, string>> = {};
  if (isRecord(raw.detail_selectors)) {
    for (const [key, value] of Object.entries(raw.detail_selectors)) {
      if (isEnrichmentField(key) && typeof value === "string" && value.trim()) selectors[key] = value;
    }
  }
  const clamp = (value: unknown, [low, high]: readonly [number, number], fallback: number) =>
    typeof value === "number" && Number.isFinite(value) ? Math.min(high, Math.max(low, value)) : fallback;
  return {
    enabled: raw.enabled === true,
    fields,
    maxDetailsPerRun: clamp(raw.max_details_per_run, RANGES.max_details_per_run, DEFAULT_ENRICHMENT_CONFIG.maxDetailsPerRun),
    minIntervalSeconds: clamp(raw.min_interval_seconds, RANGES.min_interval_seconds, DEFAULT_ENRICHMENT_CONFIG.minIntervalSeconds),
    timeoutSeconds: clamp(raw.timeout_seconds, RANGES.timeout_seconds, DEFAULT_ENRICHMENT_CONFIG.timeoutSeconds),
    detailSelectors: selectors,
    attachmentUrlTemplate: typeof raw.attachment_url_template === "string" && raw.attachment_url_template.trim() ? raw.attachment_url_template : null,
  };
}

export function serializeEnrichmentConfig(config: EnrichmentConfig): Record<string, unknown> {
  return {
    enabled: config.enabled,
    fields: config.fields,
    max_details_per_run: config.maxDetailsPerRun,
    min_interval_seconds: config.minIntervalSeconds,
    timeout_seconds: config.timeoutSeconds,
    detail_selectors: config.detailSelectors,
    attachment_url_template: config.attachmentUrlTemplate,
  };
}

export type CrawlerConfigValidation =
  | { ok: true; value: { fetchConfig?: Record<string, unknown>; cadence?: Cadence; baseUrl?: string | null } }
  | { ok: false; message: string };

/** Strict validator for admin PATCH input (rejects instead of clamping). */
export function validateCrawlerConfigInput(input: { fetchConfig?: unknown; cadence?: unknown; baseUrl?: unknown }): CrawlerConfigValidation {
  const value: { fetchConfig?: Record<string, unknown>; cadence?: Cadence; baseUrl?: string | null } = {};

  if (input.fetchConfig !== undefined) {
    if (!isRecord(input.fetchConfig)) return { ok: false, message: "fetchConfig must be a JSON object." };
    if (JSON.stringify(input.fetchConfig).length > MAX_FETCH_CONFIG_BYTES) {
      return { ok: false, message: `fetchConfig must serialize to at most ${MAX_FETCH_CONFIG_BYTES} bytes.` };
    }
    if (input.fetchConfig.enrichment !== undefined) {
      const enrichment = input.fetchConfig.enrichment;
      if (!isRecord(enrichment)) return { ok: false, message: "enrichment must be a JSON object." };
      for (const [key, [low, high]] of Object.entries(RANGES)) {
        const number = enrichment[key];
        if (number !== undefined && (typeof number !== "number" || !Number.isFinite(number) || number < low || number > high)) {
          return { ok: false, message: `enrichment.${key} must be between ${low} and ${high}.` };
        }
      }
      if (enrichment.fields !== undefined) {
        if (!Array.isArray(enrichment.fields)) return { ok: false, message: "enrichment.fields must be an array." };
        const bad = enrichment.fields.find((field) => !isEnrichmentField(field));
        if (bad !== undefined) return { ok: false, message: `enrichment.fields contains an unsupported field: ${String(bad)}.` };
      }
      if (enrichment.detail_selectors !== undefined) {
        if (!isRecord(enrichment.detail_selectors)) return { ok: false, message: "enrichment.detail_selectors must be a JSON object." };
        for (const [key, selector] of Object.entries(enrichment.detail_selectors)) {
          if (!isEnrichmentField(key)) return { ok: false, message: `enrichment.detail_selectors has an unsupported field: ${key}.` };
          if (typeof selector !== "string" || !selector.trim()) return { ok: false, message: `enrichment.detail_selectors.${key} must be a non-empty string.` };
        }
      }
      const template = enrichment.attachment_url_template;
      if (template !== undefined && template !== null && (typeof template !== "string" || !isHttpUrl(template))) {
        return { ok: false, message: "enrichment.attachment_url_template must be an absolute http(s) URL." };
      }
      if (enrichment.enabled !== undefined && typeof enrichment.enabled !== "boolean") {
        return { ok: false, message: "enrichment.enabled must be a boolean." };
      }
    }
    value.fetchConfig = input.fetchConfig;
  }

  if (input.cadence !== undefined) {
    if (typeof input.cadence !== "string" || !(CADENCES as readonly string[]).includes(input.cadence)) {
      return { ok: false, message: `cadence must be one of ${CADENCES.join(", ")}.` };
    }
    value.cadence = input.cadence as Cadence;
  }

  if (input.baseUrl !== undefined) {
    if (input.baseUrl !== null && (typeof input.baseUrl !== "string" || !isHttpUrl(input.baseUrl))) {
      return { ok: false, message: "baseUrl must be an absolute http(s) URL or null." };
    }
    value.baseUrl = input.baseUrl as string | null;
  }

  return { ok: true, value };
}
```

- [ ] **Step 4: 运行校验测试**

Run: `cd frontend && npx vitest run src/server/admin/crawler-config.test.ts`
Expected: 6 passed。

- [ ] **Step 5: 写仓库层失败测试**

在 `data-sources-repository.test.ts` 追加。文件顶部确保有这些导入（缺哪个补哪个）：`import { updateAdminDataSource, updateAdminDataSourceFromMysql } from "./data-sources-repository";`、`import { dataSources, eventLog } from "@/server/db/schema";`（`eventLog` 是 `schema.ts` 里 `event_log` 表的导出名；若实际导出名不同，以 `grep -n "event_log" src/server/db/schema.ts` 为准）、`import { eq } from "drizzle-orm";`：
```typescript
  it("exposes fetchConfig on admin sources and updates crawler config with an audit event (SQLite)", async () => {
    testDb.db.insert(dataSources).values({ id: "il_bidbuy", label: "Illinois BidBuy", issuerType: "state", stateCode: "IL", baseUrl: "https://old.example.gov", isEnabled: 1, cadence: "daily", fetchConfig: JSON.stringify({ base_url: "https://old.example.gov" }), createdAt: NOW, updatedAt: NOW }).run();

    const updated = await updateAdminDataSource(testDb.db, "il_bidbuy", {
      fetchConfig: { base_url: "https://old.example.gov", enrichment: { enabled: true, fields: ["description"] } },
      cadence: "weekly",
      baseUrl: "https://new.example.gov",
    }, { actorUserId: "admin_1" });

    expect(updated.cadence).toBe("weekly");
    expect(updated.baseUrl).toBe("https://new.example.gov");
    expect(updated.fetchConfig).toEqual({ base_url: "https://new.example.gov", enrichment: { enabled: true, fields: ["description"] } });

    const events = testDb.db.select().from(eventLog).all().filter((event) => event.eventName === "data_source.crawler_config_updated");
    expect(events).toHaveLength(1);
    expect(events[0].actorId).toBe("admin_1");
    expect(events[0].targetId).toBe("il_bidbuy");
  });

  it("updates crawler config through the MySQL twin with the same SQL shape", async () => {
    const executed: Array<{ sql: string; values: unknown[] }> = [];
    const row = { id: "il_bidbuy", label: "Illinois BidBuy", issuerType: "state", stateCode: "IL", baseUrl: "https://old.example.gov", isEnabled: 1, cadence: "daily", fetchConfig: JSON.stringify({ base_url: "https://old.example.gov" }), jurisdictionLevel: "state", jurisdictionName: null, approvedForIngestion: 1, approvalStatus: "approved", legalReviewStatus: "approved_public", consecutiveFailures: 0, lastSuccessAt: null, lastFailureAt: null, createdAt: NOW, updatedAt: NOW };
    const mysql = {
      query: async (sql: string) => (sql.includes("FROM data_sources") ? [[row]] : [[]]),
      execute: async (sql: string, values: unknown[] = []) => { executed.push({ sql, values }); return [{}]; },
    };

    await updateAdminDataSourceFromMysql(mysql as never, "il_bidbuy", { fetchConfig: { enrichment: { enabled: true } }, cadence: "hourly", baseUrl: null }, { actorUserId: "admin_1" });

    const update = executed.find((call) => call.sql.startsWith("UPDATE data_sources SET"));
    expect(update?.sql).toContain("fetch_config = ?");
    expect(update?.sql).toContain("cadence = ?");
    expect(update?.sql).toContain("base_url = ?");
    expect(update?.values).toContain(JSON.stringify({ enrichment: { enabled: true } }));
    expect(update?.values).toContain("hourly");
    expect(executed.some((call) => call.sql.includes("INSERT INTO event_log") && call.values.includes("data_source.crawler_config_updated"))).toBe(true);
  });
```

- [ ] **Step 6: 运行确认失败**

Run: `cd frontend && npx vitest run src/server/admin/data-sources-repository.test.ts`
Expected: 2 FAIL（`fetchConfig` 未暴露/未更新）。

- [ ] **Step 7: 实现仓库层**

在 `data-sources-repository.ts`：
1. 导入 `import { writeAuditEvent, writeAuditEventFromMysql } from "@/server/events/event-log";` 与 `import type { Cadence } from "./crawler-config";`。
2. `AdminDataSource` 在 `cadence: string;` 后加 `fetchConfig: Record<string, unknown>;`。
3. 新增解析助手（文件内，`toAdminSource` 之前）：
```typescript
function parseFetchConfigJson(raw: unknown): Record<string, unknown> {
  if (typeof raw !== "string" || raw.trim() === "") return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
```
4. `toAdminSource` 返回对象在 `cadence: row.cadence,` 后加 `fetchConfig: parseFetchConfigJson(row.fetchConfig),`。
5. `dataSourceSelectSql` 的列列表在 `cadence,` 后加 `fetch_config AS fetchConfig,`。
6. `UpdateAdminDataSourceInput` 末尾加：
```typescript
  fetchConfig?: Record<string, unknown>;
  cadence?: Cadence;
  baseUrl?: string | null;
```
7. 新增：
```typescript
function hasCrawlerConfigUpdate(input: UpdateAdminDataSourceInput) {
  return input.fetchConfig !== undefined || input.cadence !== undefined || input.baseUrl !== undefined;
}

/** base_url lives both in the column and inside fetch_config.base_url; keep them in sync. */
function nextFetchConfig(existingRaw: unknown, input: UpdateAdminDataSourceInput) {
  const next = { ...(input.fetchConfig ?? parseFetchConfigJson(existingRaw)) };
  if (input.baseUrl !== undefined) {
    if (input.baseUrl === null) delete next.base_url;
    else next.base_url = input.baseUrl;
  }
  return next;
}
```
8. `updateAdminDataSource`（SQLite）的 `.set({...})` 中追加：
```typescript
      ...(hasCrawlerConfigUpdate(input) ? { fetchConfig: JSON.stringify(nextFetchConfig(existing.fetchConfig, input)) } : {}),
      ...(input.cadence !== undefined ? { cadence: input.cadence } : {}),
      ...(input.baseUrl !== undefined ? { baseUrl: input.baseUrl } : {}),
```
   在 `if (hasGovernanceUpdate(input)) {...}` 块之后追加：
```typescript
  if (hasCrawlerConfigUpdate(input)) {
    writeAuditEvent(db, {
      eventName: "data_source.crawler_config_updated",
      actorType: options.actorUserId ? "user" : "system",
      actorId: options.actorUserId ?? null,
      targetType: "data_source",
      targetId: id,
      outcome: "success",
      beforeAfter: {
        before: { fetchConfig: parseFetchConfigJson(existing.fetchConfig), cadence: existing.cadence, baseUrl: existing.baseUrl },
        after: { fetchConfig: parseFetchConfigJson(updated.fetchConfig), cadence: updated.cadence, baseUrl: updated.baseUrl },
      },
      occurredAt: updatedAt,
    });
  }
```
9. `updateAdminDataSourceFromMysql` 在 `fields.push("updated_at = ?")` 之前追加：
```typescript
  if (hasCrawlerConfigUpdate(input)) {
    fields.push("fetch_config = ?");
    values.push(JSON.stringify(nextFetchConfig(existing.fetchConfig, input)));
  }
  if (input.cadence !== undefined) {
    fields.push("cadence = ?");
    values.push(input.cadence);
  }
  if (input.baseUrl !== undefined) {
    fields.push("base_url = ?");
    values.push(input.baseUrl);
  }
```
   在 MySQL 的 `if (hasGovernanceUpdate(input)) {...}` 块之后追加与 SQLite 相同内容的 `await writeAuditEventFromMysql(mysql, {...})`（`existing`/`updated` 为 `DataSourceRow`，字段同名）。
   若 `writeAuditEvent` 的 `WriteEventInput.actorType` 枚举不含 `"user"`，改用 `event-log.ts` 中 `EventActorType` 的实际值（查看该类型定义并替换）。

- [ ] **Step 8: 运行测试**

Run: `cd frontend && npx vitest run src/server/admin/data-sources-repository.test.ts src/server/admin/crawler-config.test.ts src/app/api/admin/data-sources`
Expected: 全部通过。

- [ ] **Step 9: 提交**

```bash
git add frontend/src/server/admin/crawler-config.ts frontend/src/server/admin/crawler-config.test.ts frontend/src/server/admin/data-sources-repository.ts frontend/src/server/admin/data-sources-repository.test.ts
git commit -m "feat(admin): crawler config validation and fetch_config/cadence/base_url updates on both dialects"
```

---

### Task 9: PATCH 路由解析爬虫配置

**Files:**
- Modify: `frontend/src/app/api/admin/data-sources/[id]/route.ts`（`parsePatchBody`、`PATCH`）
- Test: `frontend/src/app/api/admin/data-sources/[id]/route.test.ts`

**Interfaces:**
- Consumes: Task 8 `validateCrawlerConfigInput`。
- Produces: 400 `{ error: { code: "INVALID_CRAWLER_CONFIG", message } }`；成功响应 `source.fetchConfig`。

- [ ] **Step 1: 写失败测试**

追加到 `describe("PATCH /api/admin/data-sources/[id]")`：
```typescript
  it("updates crawler config (fetchConfig, cadence, baseUrl) for operators", async () => {
    const PATCH = createAdminDataSourcePatch(testDb.db);
    const response = await PATCH(
      new Request("http://localhost/api/admin/data-sources/sam_gov", {
        method: "PATCH",
        body: JSON.stringify({ fetchConfig: { enrichment: { enabled: true, fields: ["description", "attachments"] } }, cadence: "weekly", baseUrl: "https://sam.gov/opportunities" }),
      }),
      { params: Promise.resolve({ id: "sam_gov" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.source.cadence).toBe("weekly");
    expect(body.source.baseUrl).toBe("https://sam.gov/opportunities");
    expect(body.source.fetchConfig).toEqual({ enrichment: { enabled: true, fields: ["description", "attachments"] }, base_url: "https://sam.gov/opportunities" });
    // crawler config is an operator action, not a governance change: no admin re-check
    expect(adminAuth.requireAdminAccess).toHaveBeenCalledTimes(1);
  });

  it("rejects invalid crawler config with INVALID_CRAWLER_CONFIG", async () => {
    const PATCH = createAdminDataSourcePatch(testDb.db);
    const response = await PATCH(
      new Request("http://localhost/api/admin/data-sources/sam_gov", {
        method: "PATCH",
        body: JSON.stringify({ fetchConfig: { enrichment: { max_details_per_run: 999 } } }),
      }),
      { params: Promise.resolve({ id: "sam_gov" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("INVALID_CRAWLER_CONFIG");
    expect(body.error.message).toBe("enrichment.max_details_per_run must be between 1 and 200.");
  });
```

- [ ] **Step 2: 运行确认失败**

Run: `cd frontend && npx vitest run "src/app/api/admin/data-sources/[id]/route.test.ts"`
Expected: 2 FAIL。

- [ ] **Step 3: 实现**

在 `route.ts` 导入 `import { validateCrawlerConfigInput } from "@/server/admin/crawler-config";`。新增错误类：
```typescript
class InvalidCrawlerConfigError extends Error {}
```
`parsePatchBody` 在 `return Object.keys(input).length > 0 ? input : null;` 之前追加：
```typescript
  if (Object.hasOwn(body, "fetchConfig") || Object.hasOwn(body, "cadence") || Object.hasOwn(body, "baseUrl")) {
    const validation = validateCrawlerConfigInput({ fetchConfig: body.fetchConfig, cadence: body.cadence, baseUrl: body.baseUrl });
    if (!validation.ok) throw new InvalidCrawlerConfigError(validation.message);
    Object.assign(input, validation.value);
  }
```
`PATCH` 中把
```typescript
      const input = await parsePatchBody(request);
```
改为
```typescript
      let input: UpdateAdminDataSourceInput | null;
      try {
        input = await parsePatchBody(request);
      } catch (error) {
        if (error instanceof InvalidCrawlerConfigError) {
          return errorResponse("INVALID_CRAWLER_CONFIG", error.message, 400);
        }
        throw error;
      }
```
`includesGovernanceUpdate` 保持不变（爬虫配置不触发 admin 二次校验）。

- [ ] **Step 4: 运行测试与结构覆盖**

Run: `cd frontend && npx vitest run "src/app/api/admin/data-sources/[id]/route.test.ts" src/server/auth/role-route-coverage.test.ts src/server/db/mysql-route-coverage.test.ts src/server/auth/feature-gate-coverage.test.ts`
Expected: 全部通过（未新增路由）。

- [ ] **Step 5: 提交**

```bash
git add "frontend/src/app/api/admin/data-sources/[id]/route.ts" "frontend/src/app/api/admin/data-sources/[id]/route.test.ts"
git commit -m "feat(admin): accept crawler config in the data source PATCH route"
```

---

### Task 10: 管理端"爬虫配置"面板

**Files:**
- Create: `frontend/src/components/admin/CrawlerConfigPanel.tsx`
- Test: `frontend/src/components/admin/CrawlerConfigPanel.test.ts`
- Modify: `frontend/src/app/admin/page.tsx`（导入 + 数据源表操作列）
- Modify: `frontend/src/lib/api/admin.ts`（`UpdateAdminDataSourceInput` 已通过类型再导出自动包含新字段；无需改动，验证即可）
- Modify: `frontend/src/lib/i18n/dictionaries/en.ts`、`zh.ts`

**Interfaces:**
- Consumes: `updateAdminDataSource(id, input)`（`@/lib/api/admin`）、`parseEnrichmentConfig`/`serializeEnrichmentConfig`/`ENRICHMENT_FIELDS`/`CADENCES`（`@/server/admin/crawler-config` 为纯 TS，无服务端依赖，可被客户端导入）。
- Produces: `CrawlerConfigPanel({ source, onSaved, disabled })`；导出纯函数 `buildCrawlerConfigPatch(source, form) -> UpdateAdminDataSourceInput` 与 `formFromSource(source) -> CrawlerConfigForm`。

- [ ] **Step 1: 写失败测试**

`CrawlerConfigPanel.test.ts`：
```typescript
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { AdminDataSource } from "@/lib/api/admin";
import { buildCrawlerConfigPatch, formFromSource } from "./CrawlerConfigPanel";

const source = {
  id: "il_bidbuy", label: "Illinois BidBuy", cadence: "daily", baseUrl: "https://www.bidbuy.illinois.gov",
  fetchConfig: { base_url: "https://www.bidbuy.illinois.gov", enrichment: { enabled: true, fields: ["description", "attachments"], max_details_per_run: 10, min_interval_seconds: 2, timeout_seconds: 15, detail_selectors: { description: "div.x" }, attachment_url_template: "https://x/{id}" } },
} as unknown as AdminDataSource;

describe("formFromSource", () => {
  it("hydrates the form from fetch_config.enrichment, cadence and baseUrl", () => {
    expect(formFromSource(source)).toEqual({
      cadence: "daily", baseUrl: "https://www.bidbuy.illinois.gov", enabled: true, fields: ["description", "attachments"],
      maxDetailsPerRun: 10, minIntervalSeconds: 2, timeoutSeconds: 15, detailSelectors: { description: "div.x" }, attachmentUrlTemplate: "https://x/{id}",
    });
  });
});

describe("buildCrawlerConfigPatch", () => {
  it("serializes the form back into a PATCH body preserving unrelated fetch_config keys", () => {
    const patch = buildCrawlerConfigPatch({ ...source, fetchConfig: { ...source.fetchConfig, custom_flag: true } } as AdminDataSource, { ...formFromSource(source), enabled: false, cadence: "weekly", baseUrl: "https://new.example.gov" });
    expect(patch).toEqual({
      cadence: "weekly",
      baseUrl: "https://new.example.gov",
      fetchConfig: {
        base_url: "https://www.bidbuy.illinois.gov", custom_flag: true,
        enrichment: { enabled: false, fields: ["description", "attachments"], max_details_per_run: 10, min_interval_seconds: 2, timeout_seconds: 15, detail_selectors: { description: "div.x" }, attachment_url_template: "https://x/{id}" },
      },
    });
  });

  it("drops blank selectors and a blank template", () => {
    const patch = buildCrawlerConfigPatch(source, { ...formFromSource(source), detailSelectors: { description: "  " }, attachmentUrlTemplate: "" });
    const enrichment = (patch.fetchConfig as { enrichment: Record<string, unknown> }).enrichment;
    expect(enrichment.detail_selectors).toEqual({});
    expect(enrichment.attachment_url_template).toBeNull();
  });
});

describe("CrawlerConfigPanel wiring", () => {
  const component = readFileSync(new URL("CrawlerConfigPanel.tsx", import.meta.url), "utf8");
  const page = readFileSync(new URL("../../app/admin/page.tsx", import.meta.url), "utf8");

  it("saves through updateAdminDataSource and reports via i18n", () => {
    expect(component).toContain("updateAdminDataSource(source.id, buildCrawlerConfigPatch(source, form))");
    expect(component).toContain('t("admin.crawlerConfigSaved")');
    expect(component).toContain('t("admin.crawlerConfigSaveFailed")');
    expect(component).toContain('t(`admin.crawlerConfigField_${field}`)');
  });

  it("is mounted per data source row in the admin page", () => {
    expect(page).toContain("CrawlerConfigPanel");
    expect(page).toContain("onSaved={replaceSource}");
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd frontend && npx vitest run src/components/admin/CrawlerConfigPanel.test.ts`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: i18n 文案**

`en.ts` 的 admin 区块（`batchRunWindowKept` 之后）追加：
```typescript
    crawlerConfigTitle: "Crawler config",
    crawlerConfigOpen: "Crawler config",
    crawlerConfigClose: "Close",
    crawlerConfigDescription: "Detail-page enrichment fills description, attachments, category, contact, and posted date from each bid's detail page. Fetching stays on the crawler's own polite HTTP path; the Scrapling extractor only parses.",
    crawlerConfigCadence: "Cadence",
    crawlerConfigCadence_hourly: "Hourly",
    crawlerConfigCadence_daily: "Daily",
    crawlerConfigCadence_weekly: "Weekly",
    crawlerConfigCadence_manual: "Manual only",
    crawlerConfigBaseUrl: "Base URL",
    crawlerConfigEnrichmentEnabled: "Enable detail enrichment",
    crawlerConfigFields: "Fields to fill",
    crawlerConfigField_description: "Description",
    crawlerConfigField_attachments: "Attachments",
    crawlerConfigField_category: "Category / NAICS",
    crawlerConfigField_contact: "Contact",
    crawlerConfigField_published_date: "Posted date",
    crawlerConfigMaxDetails: "Max detail pages per run",
    crawlerConfigMinInterval: "Min seconds between detail requests",
    crawlerConfigTimeout: "Detail request timeout (s)",
    crawlerConfigSelectors: "Selector overrides (CSS or XPath, optional)",
    crawlerConfigAttachmentTemplate: "Attachment URL template (optional, {id} / {source_bid_id})",
    crawlerConfigSave: "Save crawler config",
    crawlerConfigSaving: "Saving...",
    crawlerConfigSaved: "Crawler config saved for {source}.",
    crawlerConfigSaveFailed: "Unable to save crawler config: {message}",
```
`zh.ts` 同位置追加：
```typescript
    crawlerConfigTitle: "爬虫配置",
    crawlerConfigOpen: "爬虫配置",
    crawlerConfigClose: "收起",
    crawlerConfigDescription: "详情补全会从每条招标的详情页补齐描述、附件、分类、联系人和发布日期。抓取仍走爬虫自身的礼貌 HTTP 路径，Scrapling 抽取器只负责解析。",
    crawlerConfigCadence: "抓取频率",
    crawlerConfigCadence_hourly: "每小时",
    crawlerConfigCadence_daily: "每天",
    crawlerConfigCadence_weekly: "每周",
    crawlerConfigCadence_manual: "仅手动",
    crawlerConfigBaseUrl: "基础 URL",
    crawlerConfigEnrichmentEnabled: "启用详情补全",
    crawlerConfigFields: "补全字段",
    crawlerConfigField_description: "描述",
    crawlerConfigField_attachments: "附件",
    crawlerConfigField_category: "分类 / NAICS",
    crawlerConfigField_contact: "联系人",
    crawlerConfigField_published_date: "发布日期",
    crawlerConfigMaxDetails: "每次运行最多补全详情页数",
    crawlerConfigMinInterval: "详情请求最小间隔（秒）",
    crawlerConfigTimeout: "详情请求超时（秒）",
    crawlerConfigSelectors: "选择器覆盖（CSS 或 XPath，可选）",
    crawlerConfigAttachmentTemplate: "附件 URL 模板（可选，支持 {id} / {source_bid_id}）",
    crawlerConfigSave: "保存爬虫配置",
    crawlerConfigSaving: "保存中...",
    crawlerConfigSaved: "已保存 {source} 的爬虫配置。",
    crawlerConfigSaveFailed: "保存爬虫配置失败：{message}",
```

- [ ] **Step 4: 实现组件**

`CrawlerConfigPanel.tsx`：
```tsx
"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { updateAdminDataSource, type AdminDataSource, type UpdateAdminDataSourceInput } from "@/lib/api/admin";
import { useLanguage } from "@/lib/i18n/LanguageContext";
import {
  CADENCES,
  ENRICHMENT_FIELDS,
  parseEnrichmentConfig,
  serializeEnrichmentConfig,
  type Cadence,
  type EnrichmentField,
} from "@/server/admin/crawler-config";

export interface CrawlerConfigForm {
  cadence: Cadence;
  baseUrl: string;
  enabled: boolean;
  fields: EnrichmentField[];
  maxDetailsPerRun: number;
  minIntervalSeconds: number;
  timeoutSeconds: number;
  detailSelectors: Partial<Record<EnrichmentField, string>>;
  attachmentUrlTemplate: string;
}

export function formFromSource(source: AdminDataSource): CrawlerConfigForm {
  const enrichment = parseEnrichmentConfig(source.fetchConfig ?? {});
  return {
    cadence: (CADENCES as readonly string[]).includes(source.cadence) ? (source.cadence as Cadence) : "daily",
    baseUrl: source.baseUrl ?? "",
    enabled: enrichment.enabled,
    fields: enrichment.fields,
    maxDetailsPerRun: enrichment.maxDetailsPerRun,
    minIntervalSeconds: enrichment.minIntervalSeconds,
    timeoutSeconds: enrichment.timeoutSeconds,
    detailSelectors: enrichment.detailSelectors,
    attachmentUrlTemplate: enrichment.attachmentUrlTemplate ?? "",
  };
}

export function buildCrawlerConfigPatch(source: AdminDataSource, form: CrawlerConfigForm): UpdateAdminDataSourceInput {
  const selectors: Partial<Record<EnrichmentField, string>> = {};
  for (const [field, selector] of Object.entries(form.detailSelectors) as Array<[EnrichmentField, string | undefined]>) {
    if (selector && selector.trim()) selectors[field] = selector.trim();
  }
  const template = form.attachmentUrlTemplate.trim();
  return {
    cadence: form.cadence,
    baseUrl: form.baseUrl.trim() === "" ? null : form.baseUrl.trim(),
    fetchConfig: {
      ...(source.fetchConfig ?? {}),
      enrichment: serializeEnrichmentConfig({
        enabled: form.enabled,
        fields: form.fields,
        maxDetailsPerRun: form.maxDetailsPerRun,
        minIntervalSeconds: form.minIntervalSeconds,
        timeoutSeconds: form.timeoutSeconds,
        detailSelectors: selectors,
        attachmentUrlTemplate: template === "" ? null : template,
      }),
    },
  };
}

interface CrawlerConfigPanelProps {
  source: AdminDataSource;
  disabled?: boolean;
  onSaved: (source: AdminDataSource) => void;
  onMessage?: (message: string) => void;
}

const inputClass = "h-8 w-full rounded-lg border border-slate-200 bg-white px-2 text-xs text-slate-700 outline-none";

export function CrawlerConfigPanel({ source, disabled = false, onSaved, onMessage }: CrawlerConfigPanelProps) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<CrawlerConfigForm>(() => formFromSource(source));
  const [saving, setSaving] = useState(false);

  const update = <K extends keyof CrawlerConfigForm>(key: K, value: CrawlerConfigForm[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  const toggleField = (field: EnrichmentField) =>
    setForm((current) => ({
      ...current,
      fields: current.fields.includes(field) ? current.fields.filter((item) => item !== field) : [...current.fields, field],
    }));

  const save = () => {
    setSaving(true);
    updateAdminDataSource(source.id, buildCrawlerConfigPatch(source, form))
      .then(({ source: updated }) => {
        onSaved(updated);
        setForm(formFromSource(updated));
        onMessage?.(t("admin.crawlerConfigSaved").replace("{source}", source.label));
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        onMessage?.(t("admin.crawlerConfigSaveFailed").replace("{message}", message));
      })
      .finally(() => setSaving(false));
  };

  if (!open) {
    return (
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)} disabled={disabled} className="h-7 rounded-lg border-slate-200 px-2 text-xs">
        {t("admin.crawlerConfigOpen")}
      </Button>
    );
  }

  return (
    <div className="mt-2 grid gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs" data-testid={`crawler-config-${source.id}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="font-semibold text-slate-800">{t("admin.crawlerConfigTitle")}</span>
        <button type="button" onClick={() => setOpen(false)} className="text-slate-500 hover:underline">{t("admin.crawlerConfigClose")}</button>
      </div>
      <p className="text-slate-500">{t("admin.crawlerConfigDescription")}</p>

      <label className="grid gap-1">
        <span className="font-medium text-slate-600">{t("admin.crawlerConfigCadence")}</span>
        <select value={form.cadence} onChange={(event) => update("cadence", event.target.value as Cadence)} className={inputClass}>
          {CADENCES.map((cadence) => (
            <option key={cadence} value={cadence}>{t(`admin.crawlerConfigCadence_${cadence}`)}</option>
          ))}
        </select>
      </label>
      <label className="grid gap-1">
        <span className="font-medium text-slate-600">{t("admin.crawlerConfigBaseUrl")}</span>
        <input type="url" value={form.baseUrl} onChange={(event) => update("baseUrl", event.target.value)} className={inputClass} />
      </label>

      <label className="flex items-center gap-2 font-medium text-slate-700">
        <input type="checkbox" checked={form.enabled} onChange={(event) => update("enabled", event.target.checked)} />
        {t("admin.crawlerConfigEnrichmentEnabled")}
      </label>

      <div className="grid gap-1">
        <span className="font-medium text-slate-600">{t("admin.crawlerConfigFields")}</span>
        <div className="flex flex-wrap gap-3">
          {ENRICHMENT_FIELDS.map((field) => (
            <label key={field} className="flex items-center gap-1">
              <input type="checkbox" checked={form.fields.includes(field)} onChange={() => toggleField(field)} />
              {t(`admin.crawlerConfigField_${field}`)}
            </label>
          ))}
        </div>
      </div>

      <div className="grid gap-2 md:grid-cols-3">
        <label className="grid gap-1">
          <span className="font-medium text-slate-600">{t("admin.crawlerConfigMaxDetails")}</span>
          <input type="number" min={1} max={200} value={form.maxDetailsPerRun} onChange={(event) => update("maxDetailsPerRun", Number(event.target.value))} className={inputClass} />
        </label>
        <label className="grid gap-1">
          <span className="font-medium text-slate-600">{t("admin.crawlerConfigMinInterval")}</span>
          <input type="number" min={0} max={60} step={0.5} value={form.minIntervalSeconds} onChange={(event) => update("minIntervalSeconds", Number(event.target.value))} className={inputClass} />
        </label>
        <label className="grid gap-1">
          <span className="font-medium text-slate-600">{t("admin.crawlerConfigTimeout")}</span>
          <input type="number" min={5} max={60} value={form.timeoutSeconds} onChange={(event) => update("timeoutSeconds", Number(event.target.value))} className={inputClass} />
        </label>
      </div>

      <div className="grid gap-1">
        <span className="font-medium text-slate-600">{t("admin.crawlerConfigSelectors")}</span>
        {ENRICHMENT_FIELDS.map((field) => (
          <label key={field} className="grid grid-cols-[8rem_1fr] items-center gap-2">
            <span className="text-slate-500">{t(`admin.crawlerConfigField_${field}`)}</span>
            <input
              type="text"
              value={form.detailSelectors[field] ?? ""}
              onChange={(event) => update("detailSelectors", { ...form.detailSelectors, [field]: event.target.value })}
              className={inputClass}
            />
          </label>
        ))}
      </div>

      <label className="grid gap-1">
        <span className="font-medium text-slate-600">{t("admin.crawlerConfigAttachmentTemplate")}</span>
        <input type="text" value={form.attachmentUrlTemplate} onChange={(event) => update("attachmentUrlTemplate", event.target.value)} className={inputClass} />
      </label>

      <div className="flex justify-end">
        <Button type="button" size="sm" onClick={save} disabled={disabled || saving} className="h-8 rounded-lg px-3">
          {saving ? t("admin.crawlerConfigSaving") : t("admin.crawlerConfigSave")}
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: 挂载到管理页**

`page.tsx`：在 `import { JurisdictionBatchRunPanel } ...` 之后加 `import { CrawlerConfigPanel } from "@/components/admin/CrawlerConfigPanel";`。在数据源表的 `canRunOperations` 操作单元格里（`runSourceNow` 按钮所在 `<TableCell className="text-right">` 内，按钮/`-` 之后）追加：
```tsx
                      <div className="mt-2 flex justify-end">
                        <CrawlerConfigPanel
                          source={source}
                          disabled={isRunning || runningSourceId !== null}
                          onSaved={replaceSource}
                          onMessage={setRunMessage}
                        />
                      </div>
```

- [ ] **Step 6: 运行测试与门禁**

Run: `cd frontend && npx vitest run src/components/admin/CrawlerConfigPanel.test.ts src/app/admin/page.test.ts src/lib/api/admin.test.ts && npm run i18n:check && npm run lint && npm run build`
Expected: 测试通过；`i18n:check` 无新 finding；lint 与 build 通过。若 `@/server/admin/crawler-config` 被客户端导入触发 Next 的 server-only 边界错误，把该文件移到 `src/lib/crawler-config.ts` 并更新 Task 8/9 的导入路径（文件本身无服务端依赖）。

- [ ] **Step 7: 浏览器验证**

`npm run dev` 后登录管理员，打开 `/admin` 数据源表，对 Illinois BidBuy 点击"爬虫配置"→ 勾选启用、字段全选、保存；刷新页面确认面板回填了保存的值；MySQL 查询 `SELECT fetch_config, cadence FROM data_sources WHERE id='il_bidbuy'` 应看到 `enrichment.enabled: true`。

- [ ] **Step 8: 提交**

```bash
git add frontend/src/components/admin/CrawlerConfigPanel.tsx frontend/src/components/admin/CrawlerConfigPanel.test.ts frontend/src/app/admin/page.tsx frontend/src/lib/i18n/dictionaries/en.ts frontend/src/lib/i18n/dictionaries/zh.ts
git commit -m "feat(admin): per-source crawler config panel for enrichment, cadence, and base URL"
```

---

### Task 11: 真实 MySQL 端到端验证、基线对比与文档

**Files:**
- Modify: `CLAUDE.md`（Crawler architecture 小节末尾）
- Modify: `README.md`（主要功能列表）
- Create: `docs/operations/detail-enrichment.md`

**Interfaces:**
- Consumes: 全部前序任务。

- [ ] **Step 1: 起 sidecar 与 MySQL，记录基线**

```bash
docker compose up -d scrapling-extractor && curl -s http://localhost:8091/health
docker exec winbids-mysql mysql -u winbids -pwinbids_dev_password winbids -e "SELECT COUNT(*) total, SUM(description IS NULL OR description='' OR description=title) desc_missing, SUM(original_category IS NULL OR original_category='') no_category, SUM(published_date IS NULL OR published_date='') no_published FROM bids WHERE source IN ('California Cal eProcure','Illinois BidBuy','MyFloridaMarketPlace','New York State Contract Reporter','Texas ESBD'); SELECT COUNT(DISTINCT bid_id) FROM bid_attachments;"
```
把两组数字记入 `docs/operations/detail-enrichment.md` 的"基线"表。

- [ ] **Step 2: 开启五源补全并运行**

在 `/admin` 对 CA / IL / FL / NY / TX 五源打开"爬虫配置"→ 启用补全、字段全选、IL 填附件模板 `https://www.bidbuy.illinois.gov/bso/external/bidDetail.sdo?downloadFileNbr={id}&docId={source_bid_id}&currentPage=1&mode=download&parentUrl=close` → 保存。在"按辖区批量运行"面板勾选这五个源运行（服务端已由 `.env.local` 的 `SCRAPLING_EXTRACTOR_URL` 指向 sidecar）。

- [ ] **Step 3: 验证补全统计与数据**

```bash
docker exec winbids-mysql mysql -u winbids -pwinbids_dev_password winbids -e "SELECT source, status, fetched_count, JSON_EXTRACT(metadata, '$.enrichment') enrichment FROM crawler_logs ORDER BY started_at DESC LIMIT 5;"
```
Expected: 五行 `success`，`enrichment.enriched > 0`，`reason` 为 null。再跑 Step 1 的统计 SQL 得到"补全后"数字；`desc_missing` 与 `no_category` 应明显下降、有附件的招标数上升。抽查 10 条：
```bash
docker exec winbids-mysql mysql -u winbids -pwinbids_dev_password winbids -e "SELECT id, LEFT(description,80) d, original_category, contact_email, detail_fetched_at FROM bids WHERE detail_fetched_at IS NOT NULL ORDER BY detail_fetched_at DESC LIMIT 10;"
```
逐条打开 `source_url` 对照门户页面，描述/分类/联系人必须与页面一致；不一致的字段记入文档"已知偏差"并在对应源的 `detail_selectors` 填入精确选择器后重跑。

- [ ] **Step 4: 保护式 upsert 真实验证**

对 IL 关闭补全（保存）后再运行一次 IL；重跑 Step 3 的抽查 SQL：`description`、`original_category`、附件数必须保持补全后的值。

- [ ] **Step 5: 全量门禁**

```bash
cd frontend && set -a && source .env.local && set +a && npm run db:mysql:smoke && npm run risk:check && npx vitest run && npm run lint && npm run build && npm run i18n:check
cd ../crawler && python3 -m pytest -q
cd ../services/scrapling-extractor && .venv/bin/python -m pytest -q
```
Expected: 全部通过。

- [ ] **Step 6: 文档**

`docs/operations/detail-enrichment.md`：
```markdown
# 详情补全（Scrapling extractor）运维

## 组件
- `services/scrapling-extractor`：解析 sidecar（Python 3.12，scrapling 0.4.15 基础包，无抓取/反检测组件）。
- `crawler/apsi_crawler/enrichment.py`：fetch-task 内的可选补全阶段，默认关闭、失败开放。
- 管理端 → 数据源 → 爬虫配置：按源开关、字段、上限、间隔、超时、选择器、附件 URL 模板。

## 启动
- 本机：`services/scrapling-extractor/run-local.sh`；`frontend/.env.local` 设 `SCRAPLING_EXTRACTOR_URL=http://localhost:8091`。
- compose：`docker compose up -d scrapling-extractor`（app 自动注入 URL）。

## 观测
- `crawler_logs.metadata.enrichment`：`{attempted, enriched, failed, skipped, reason, extractor}`；`reason` 取值 `disabled | extractor_not_configured | extractor_unavailable | enrichment_crashed | null`。
- `bids.detail_fetched_at`、`bids.raw_payload.enrichment.fields`（每字段 selector/heuristic/not_found）。

## 基线与结果（2026-09-15，五源 CA/IL/FL/NY/TX）
（两列均为实测值：左列来自 Task 11 Step 1 的 SQL，右列来自 Step 3 同一 SQL 的复跑；实施者直接写入数字。）
| 指标 | 补全前 | 补全后 |
|---|---|---|
| description 缺失或等于标题 | Step 1 实测 | Step 3 实测 |
| original_category 缺失 | Step 1 实测 | Step 3 实测 |
| published_date 缺失 | Step 1 实测 | Step 3 实测 |
| 有附件的招标数 | Step 1 实测 | Step 3 实测 |

## 已知偏差
（Step 3 抽查中不一致的字段与处理方式）

## 边界
- 详情页 403/WAF 202 只计 `failed`，不重试、不绕过。
- 补全只填空值；关闭补全后的运行不会覆盖已补全数据（importer 保护式 upsert）。
```
`CLAUDE.md` 的 "Crawler architecture" 小节末尾追加一段：
```markdown
**Detail enrichment (optional):** `fetch-task` runs `apsi_crawler/enrichment.py` after the liveness check when a source's `fetch_config.enrichment.enabled` is true: it fetches each bid's `source_url` on the crawler's own requests path and POSTs the HTML to the `services/scrapling-extractor` sidecar (`SCRAPLING_EXTRACTOR_URL`; Scrapling 0.4.15 parser only — no fetchers, no anti-bot tooling, never bypasses WAF challenges). It only fills empty fields, never fails the run (`metadata.enrichment` reports stats), and both JSON importers use enrichment-preserving upserts so a later list-page-only run cannot clobber enriched values. Admins edit `fetch_config`/`cadence`/`base_url` per source in `/admin` (PATCH `/api/admin/data-sources/[id]`).
```
`README.md` 主要功能列表增加一条：
```markdown
- **详情补全（Scrapling sidecar）**：按源可开关的详情页补全，补齐描述、附件、分类、联系人、发布日期；仅解析、不绕过任何反爬机制；管理端可配置字段、上限、间隔与选择器。
```

- [ ] **Step 7: 提交**

```bash
git add CLAUDE.md README.md docs/operations/detail-enrichment.md
git commit -m "docs: detail enrichment operations guide, architecture notes, and MySQL verification baseline"
```
