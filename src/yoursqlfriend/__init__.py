"""yourSQLfriend — SQLite forensic analysis with local LLMs."""

from importlib.metadata import version

__version__ = version("yoursqlfriend")
__all__ = ["__version__"]


def main():
    from yoursqlfriend.app import main as _main
    _main()
