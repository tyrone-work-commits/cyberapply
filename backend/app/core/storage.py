from pathlib import Path
from urllib.parse import quote

import httpx

from app.core.config import get_settings
from app.core.errors import fail


class Storage:
    def __init__(self):
        self.settings = get_settings()

    def _path(self, key: str) -> Path:
        root = self.settings.storage_dir.resolve()
        path = (root / key).resolve()
        if not key or path == root or not path.is_relative_to(root) or "\\" in key:
            fail(400, "invalid_storage_key", "Invalid document key")
        return path

    def _request(self, method: str, key: str, data=None, content_type="application/octet-stream"):
        if not self.settings.supabase_url or not self.settings.supabase_service_key:
            fail(503, "storage_unconfigured", "Supabase Storage is not configured")
        path = quote(self.settings.supabase_storage_bucket, safe="") + "/" + quote(key, safe="/")
        try:
            response = httpx.request(
                method, self.settings.supabase_url.rstrip("/") + "/storage/v1/object/" + path,
                content=data, headers={"Authorization": "Bearer " + self.settings.supabase_service_key,
                                      "apikey": self.settings.supabase_service_key, "Content-Type": content_type},
                timeout=20, follow_redirects=False,
            )
            if method == "DELETE" and response.status_code == 404:
                return b""
            response.raise_for_status()
            return response.content
        except httpx.HTTPError:
            fail(503, "storage_unavailable", "Document storage is unavailable")

    def put(self, key: str, data: bytes, content_type: str) -> None:
        path = self._path(key)
        if self.settings.storage_backend == "supabase":
            self._request("POST", key, data, content_type)
        else:
            path.parent.mkdir(parents=True, exist_ok=True)
            with path.open("xb") as stream:
                stream.write(data)

    def get(self, key: str) -> bytes:
        path = self._path(key)
        if self.settings.storage_backend == "supabase":
            return self._request("GET", key)
        if not path.is_file():
            fail(404, "document_missing", "Document content is unavailable")
        return path.read_bytes()

    def delete(self, key: str) -> None:
        path = self._path(key)
        if self.settings.storage_backend == "supabase":
            self._request("DELETE", key)
        else:
            path.unlink(missing_ok=True)
