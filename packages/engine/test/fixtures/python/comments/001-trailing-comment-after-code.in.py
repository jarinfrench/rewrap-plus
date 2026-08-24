def compute_total(prices):
    total = 0
    for price in prices:
        total += price  # accumulate the running total across every item in the list
    return total
