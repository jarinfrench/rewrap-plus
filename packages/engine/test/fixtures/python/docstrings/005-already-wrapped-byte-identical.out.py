def fetch(url, timeout=30, retries=3):
    """Fetch a resource from the given URL and
    return its decoded body as text.

    Args:
        url: The fully qualified URL to fetch,
             including its scheme.
        timeout: Maximum number of seconds to wait
                 before giving up.
        retries: Number of times to retry the
                 request on failure.

    Returns:
        str: The decoded response body.

    Raises:
        TimeoutError: If the request does not
                      complete within timeout.
    """
    return _do_fetch(url, timeout, retries)
