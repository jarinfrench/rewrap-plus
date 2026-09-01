def notify(user):
    """Send a notification message to the given user right away.

    Args:
        user: The recipient to notify about the pending event.
    """
    return _send(user)
