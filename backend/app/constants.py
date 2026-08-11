"""Shared default-data constants.

Extracted from routers/trips.py (used at trip-creation time) so the
"reset to defaults" endpoints in routers/categories.py and
routers/payment_methods.py can reuse the exact same lists instead of a
second, easily-drifting copy.
"""

DEFAULT_CATEGORIES = ["吃喝", "移動", "購物", "票券", "住宿", "機票", "娛樂"]
DEFAULT_PAYMENT_METHODS = ["現金", "信用卡"]
