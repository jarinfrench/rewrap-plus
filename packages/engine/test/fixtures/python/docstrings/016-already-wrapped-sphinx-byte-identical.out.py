def fetch(url, timeout=30):
    """Fetch a resource from the given URL and
    return its decoded body as text.

    :param url: The fully qualified URL to fetch,
                including its scheme.
    :param timeout: Maximum number of seconds to
                    wait before giving up.
    :returns: The decoded response body, ready for
              the caller to parse.
    :rtype: str
    :raises TimeoutError: If the request does not
                          complete within timeout.
    """
    return _do_fetch(url, timeout)
