def notify(user):
    """Send a notification message to the given
    user right away.

    Parameters
    ----------
    user : str
        The recipient to notify about the pending
        event.
    """
    return _send(user)
