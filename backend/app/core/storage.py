from pathlib import Path
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

    def put(self, key: str, data: bytes, content_type: str) -> None:
        path = self._path(key)
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("xb") as stream:
            stream.write(data)

    def get(self, key: str) -> bytes:
        path = self._path(key)
        if not path.is_file():
            fail(404, "document_missing", "Document content is unavailable")
        return path.read_bytes()

    def delete(self, key: str) -> None:
        path = self._path(key)
        path.unlink(missing_ok=True)
