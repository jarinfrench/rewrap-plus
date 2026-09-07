"""Rewrap+ demo module -- run a wrap command on any region below (Alt+Q at the cursor, or Format Document) to see comments, Google/NumPy/Sphinx docstrings, and string literals all reflow to the configured column limit. Set rewrapPlus.columnLimit to 88 before recording so the overflow is obvious against the ruler."""


# ---------------------------------------------------------------------------
# 1. Regular comments
# ---------------------------------------------------------------------------


def process_order(order_items):
    # This is an ordinary Python line comment, written as a single very long line on purpose, so that running Rewrap+'s wrap command on it clearly demonstrates comment reflow.
    total = 0.0
    for price in order_items:
        total += price  # A trailing comment on a real line of code, also written long enough on purpose to overflow the configured column limit and need wrapping.
    return total


# A block of two contiguous same-indent comment lines, each written here as one long line, which Rewrap+ groups together as a single logical paragraph when reflowing rather than wrapping every physical source line independently, so word and sentence boundaries stay intact.
# This second line belongs to the same contiguous comment block as the line above it, and Rewrap+'s wrap command merges both overlong lines into one coherent reflowed paragraph instead of treating them as two separate single-line comments.
def audit_log_entry():
    pass


# ---------------------------------------------------------------------------
# 2. Docstrings -- Google, NumPy, and Sphinx/reST styles
# ---------------------------------------------------------------------------


def calculate_shipping_cost(weight_kg, destination_country, expedited=False):
    """Calculate the shipping cost for a package based on its weight, destination country, and whether expedited delivery was requested by the customer at checkout time.

    Args:
        weight_kg: The package weight in kilograms, used with the destination country's own per-kilogram shipping rate table to compute a base cost before any surcharge is applied.
        destination_country: The ISO 3166-1 alpha-2 country code the package ships to, which determines which regional shipping rate table this function looks its pricing up from.
        expedited: Whether the customer requested expedited delivery, which adds a flat surcharge on top of the computed base shipping cost regardless of weight or destination country.

    Returns:
        float: The total shipping cost in US dollars, already rounded to two decimal places and including any expedited-delivery surcharge that applies to this particular shipment.

    Raises:
        ValueError: Raised when destination_country is not a recognized ISO 3166-1 alpha-2 country code present in the shipping rate table this function looks its pricing up from.
    """


def merge_customer_records(primary_record, duplicate_records, prefer_primary=True):
    """Merge one or more duplicate customer records into a single primary record, resolving field-level conflicts between them according to the prefer_primary flag.

    Parameters
    ----------
    primary_record : dict
        The customer record treated as authoritative whenever a field-level conflict arises between it and one of the duplicate records being merged into it.
    duplicate_records : list of dict
        A list of customer records identified as duplicates of the primary record, each of which may contribute fields the primary record itself is entirely missing.
    prefer_primary : bool, optional
        Whether conflicting field values should be resolved in favor of the primary record instead of the most recently updated duplicate record, defaults to True.

    Returns
    -------
    dict
        A single merged customer record combining every field found across the primary record and all of its duplicates, with conflicts resolved per prefer_primary.
    """


def resolve_discount_code(code, cart_total, customer_loyalty_tier):
    """Resolve a discount code into a dollar amount to subtract from the customer's cart, taking their loyalty tier into account for tier-exclusive discount codes.

    :param code: The discount code string entered by the customer at checkout, matched case-insensitively against every currently active promotional campaign.
    :param cart_total: The customer's pre-discount cart total in US dollars, needed because several discount codes are defined as a percentage rather than a flat amount.
    :param customer_loyalty_tier: The customer's current loyalty program tier, required because some discount codes are restricted to customers above a minimum tier.
    :returns: The dollar amount to subtract from the cart total, or zero if the supplied code does not match any currently active campaign the customer is eligible for.
    :rtype: float
    """


# ---------------------------------------------------------------------------
# 3. String literals
# ---------------------------------------------------------------------------


WELCOME_MESSAGE = "Thank you for creating an account with us today -- we're excited to have you as part of our growing community of customers and look forward to serving you soon."

ACCOUNT_LOCKED_MESSAGE = "Your account has been temporarily locked after several failed sign-in attempts; please wait fifteen minutes before trying to sign in again, or reset your password."
