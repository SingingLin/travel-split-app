"""Split-amount math shared by the expense router.

The one hard rule: the sum of shares must always equal the expense total,
to the cent. Naive `total / n` division loses cents to rounding (e.g.
100 / 3 = 33.33 * 3 = 99.99), so equal_split distributes the leftover cents
one-by-one to the first participants (largest-remainder method) instead of
just rounding each share independently.
"""

CENT = 0.01
EPSILON = 0.005  # tolerance when comparing money floats after rounding to cents


def to_cents(amount: float) -> int:
    return round(amount * 100)


def from_cents(cents: int) -> float:
    return cents / 100


def equal_split(total: float, member_ids: list[int]) -> dict[int, float]:
    """Split `total` equally across member_ids, returning member_id -> amount.

    Guarantees sum(result.values()) == round(total, 2) exactly (in cents).
    Extra cents (from the remainder of total_cents / n) go to the first
    members in `member_ids` order, so the split is deterministic.
    """
    if not member_ids:
        return {}
    n = len(member_ids)
    total_cents = to_cents(total)
    base_cents, remainder = divmod(total_cents, n)
    result: dict[int, float] = {}
    for i, member_id in enumerate(member_ids):
        cents = base_cents + (1 if i < remainder else 0)
        result[member_id] = from_cents(cents)
    return result


def shares_sum_matches_total(shares: dict[int, float], total: float) -> bool:
    """True if the manually-edited shares still add up to the expense total."""
    return abs(sum(shares.values()) - total) <= EPSILON


def rebalance_remainder(shares: dict[int, float], total: float) -> dict[int, float]:
    """Nudge the last share so the sum matches `total` exactly (fixes float drift)."""
    if not shares:
        return shares
    total_cents = to_cents(total)
    cents = {mid: to_cents(amt) for mid, amt in shares.items()}
    diff = total_cents - sum(cents.values())
    if diff != 0:
        last_key = list(cents.keys())[-1]
        cents[last_key] += diff
    return {mid: from_cents(c) for mid, c in cents.items()}


def weighted_split(amount: float, member_shares: dict[int, int]) -> dict[int, float]:
    """Split `amount` proportionally to each member's integer "share count"
    (e.g. someone who eats more can be given 2 shares vs everyone else's 1),
    returning member_id -> amount. Used by the '依份數分攤' split mode.

    Same hard guarantee as equal_split: sum(result.values()) == round(amount, 2)
    exactly (in cents). Each member's ideal cents allocation
    (total_cents * their_shares / total_shares) is floored, then the leftover
    cents (lost to flooring) are handed out one-by-one to the members with the
    largest fractional remainder first (largest-remainder method) — ties are
    broken by `member_shares` insertion order, so the split is deterministic.

    Every value in `member_shares` must be a positive integer; 0 or negative
    share counts are rejected (a member who isn't participating should simply
    be omitted from `member_shares`, not included with a 0/negative weight).
    """
    if not member_shares:
        return {}
    for member_id, shares in member_shares.items():
        if shares <= 0:
            raise ValueError(f"share count for member {member_id} must be a positive integer, got {shares}")

    member_ids = list(member_shares.keys())
    total_shares = sum(member_shares.values())
    total_cents = to_cents(amount)

    ideal_cents = {mid: total_cents * member_shares[mid] / total_shares for mid in member_ids}
    base_cents = {mid: int(ideal_cents[mid]) for mid in member_ids}  # floor (ideal_cents is always >= 0)
    remainder = total_cents - sum(base_cents.values())

    # Largest fractional remainder first; Python's sort is stable so ties keep
    # `member_shares`' original insertion order (mirrors equal_split's
    # "first members in list order" tie-break rule).
    order = sorted(member_ids, key=lambda mid: ideal_cents[mid] - base_cents[mid], reverse=True)
    for i in range(remainder):
        base_cents[order[i]] += 1

    return {mid: from_cents(base_cents[mid]) for mid in member_ids}
