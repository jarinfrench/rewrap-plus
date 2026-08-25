"""A module docstring that is deliberately long
enough to need wrapping across lines."""

RETRIES = 3
"""Number of times to retry a failed network
request before giving up entirely."""


class Client:
    """A small HTTP client wrapper used throughout
    this package for requests."""

    def __init__(self):
        """Initialize the client with default
        settings and an empty session cache."""
        self.session = None
