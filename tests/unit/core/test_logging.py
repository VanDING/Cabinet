import logging

from cabinet.core.observability import setup_logging


def test_setup_logging_sets_level():
    setup_logging(level="DEBUG")
    root = logging.getLogger()
    assert root.level == logging.DEBUG


def test_setup_logging_default_info():
    setup_logging()
    root = logging.getLogger()
    assert root.level == logging.INFO


def test_setup_logging_configures_handler():
    setup_logging()
    root = logging.getLogger()
    assert len(root.handlers) > 0
