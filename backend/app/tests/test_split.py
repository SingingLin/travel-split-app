from app.services.split import equal_split, rebalance_remainder, shares_sum_matches_total


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
