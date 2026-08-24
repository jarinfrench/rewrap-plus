# Module level comment that is long enough to need wrapping at this width.
import os


def outer():
    # A comment inside the outer function, also long enough to require
    # wrapping down here at this deeper indentation level.
    if os.name == "posix":
        # And a comment nested one level deeper still, which should wrap
        # correctly at its own indentation without merging with anything above.
        return True
    return False
