def fetch(url, timeout=30):
    """Fetch a resource from the given URL and
    return its decoded body as text.

    Parameters
    ----------
    url : str
        The fully qualified URL to fetch,
        including its scheme.
    timeout : int, optional
        Maximum number of seconds to wait before
        giving up on the request.

    Returns
    -------
    str
        The decoded response body, ready for the
        caller to parse further.
    """
    return _do_fetch(url, timeout)
