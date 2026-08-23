def outer():
    """Outer function docstring."""

    def inner():
        """Inner function docstring."""
        return "not a docstring"

    return inner()
