"""Test-harness compatibility for GenLayer Direct Mode on Windows.

The pinned direct-mode loader replaces fd 0 with a temporary file and then
unlinks that still-open handle. Windows rejects that unlink (the contract
runtime itself is unaffected), so leave the short-lived temp file for the OS
to reclaim instead of turning every direct test into a harness failure.
"""

import os


if os.name == "nt":
    _unlink = os.unlink

    def _safe_unlink(path, *args, **kwargs):
        try:
            return _unlink(path, *args, **kwargs)
        except PermissionError:
            if str(path).lower().startswith(str(os.environ.get("TEMP", "")).lower()):
                return None
            raise

    os.unlink = _safe_unlink
