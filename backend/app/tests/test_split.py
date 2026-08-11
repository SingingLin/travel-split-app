import pytest

from app.services.split import equal_split, rebalance_remainder, shares_sum_matches_total, weighted_split


def test_equal_split_divides_evenly():
    result = equal_split(900.0, [1, 2, 3])
    assert result == {1: 300.0, 2: 300.0, 3: 300.0}
    assert sum(result.values()) == 900.0


def test_equal_split_distributes_remainder_cents():
    # 1000 / 3 = 333.333... -> cents: 33333 total split base 11111*3=33333 remainder 0
    result = equal_split(1000.0, [1, 2, 3])
    assert round(sum(result.values()), 2) == 1000.0
    # values differ by at most 1 cent
    assert max(result.values()) - min(result.values()) <= 0.01


def test_equal_split_remainder_goes_to_first_members():
    # 10.00 split across 3 -> 3.33 + 3.33 + 3.34 (cents: 1000 -> 333,333,334)
    result = equal_split(10.0, [1, 2, 3])
    assert result[1] == 3.34  # first member absorbs the extra cent (remainder=1)
    assert result[2] == 3.33
    assert result[3] == 3.33
    assert round(sum(result.values()), 2) == 10.0


def test_equal_split_many_participants_sum_exact():
    for n in range(1, 12):
        for total in [1.0, 3.33, 100.0, 999.99, 0.03]:
            result = equal_split(total, list(range(n)))
            assert abs(sum(result.values()) - round(total, 2)) < 1e-9


def test_shares_sum_matches_total():
    assert shares_sum_matches_total({1: 5.0, 2: 5.0}, 10.0)
    assert not shares_sum_matches_total({1: 5.0, 2: 4.0}, 10.0)


def test_rebalance_remainder_fixes_drift():
    shares = {1: 3.33, 2: 3.33, 3: 3.33}  # sums to 9.99, total is 10.0
    fixed = rebalance_remainder(shares, 10.0)
    assert round(sum(fixed.values()), 2) == 10.0
    assert fixed[3] == 3.34  # last key absorbs the 1-cent diff


def test_weighted_split_proportional():
    # A has 2 shares, B has 1 share -> 300 splits 200/100
    result = weighted_split(300.0, {1: 2, 2: 1})
    assert result == {1: 200.0, 2: 100.0}
    assert sum(result.values()) == 300.0


def test_weighted_split_equal_shares_matches_equal_split():
    # All members with the same share count should behave exactly like
    # equal_split (same remainder-distribution order too).
    weighted = weighted_split(10.0, {1: 1, 2: 1, 3: 1})
    equal = equal_split(10.0, [1, 2, 3])
    assert weighted == equal


def test_weighted_split_remainder_goes_to_largest_fraction_first():
    # total_cents=10000, total_shares=3 -> ideal cents each 3333.33...
    # floor each -> 3333*3=9999, remainder=1 cent, all three tied on
    # fractional remainder (.33) -> tie-break is insertion order, so member 1
    # (first key in the dict) absorbs the extra cent, same rule as equal_split.
    result = weighted_split(100.0, {1: 1, 2: 1, 3: 1})
    assert result[1] == 33.34
    assert result[2] == 33.33
    assert result[3] == 33.33
    assert round(sum(result.values()), 2) == 100.0


def test_weighted_split_many_cases_sum_exact():
    cases = [
        (999.99, {1: 3, 2: 2, 3: 1}),
        (0.03, {1: 1, 2: 2}),
        (12345.67, {1: 5, 2: 3, 3: 2, 4: 1}),
        (1.0, {1: 7}),
        (100.0, {1: 10, 2: 3, 3: 3, 4: 3, 5: 1}),
    ]
    for total, shares in cases:
        result = weighted_split(total, shares)
        assert abs(sum(result.values()) - round(total, 2)) < 1e-9


def test_weighted_split_empty_returns_empty():
    assert weighted_split(100.0, {}) == {}


def test_weighted_split_rejects_zero_or_negative_shares():
    with pytest.raises(ValueError):
        weighted_split(100.0, {1: 0, 2: 1})
    with pytest.raises(ValueError):
        weighted_split(100.0, {1: -2, 2: 1})
