def process(items):
    result = []
    for item in items:
        # Skip anything that has already been processed in a previous run so
        # that we never do the same expensive work more than once per item.
        if item.processed:
            continue
        result.append(item)
    return result
