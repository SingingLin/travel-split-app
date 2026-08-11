import httpx
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app import models, schemas
from app.database import get_db

router = APIRouter(tags=["currencies"])

# Free, no-API-key-required exchange rate API. See lookup_currency_rate() below
# for the important rate-direction inversion this project needs.
EXCHANGE_RATE_API_BASE = "https://open.er-api.com/v6/latest"


@router.get("/api/trips/{trip_id}/currencies", response_model=list[schemas.CurrencyOut])
def list_currencies(trip_id: int, db: Session = Depends(get_db)):
    return (
        db.query(models.Currency)
        .filter(models.Currency.trip_id == trip_id)
        .order_by(models.Currency.is_base.desc(), models.Currency.id)
        .all()
    )


def _fetch_rates_against(base_code: str) -> dict[str, float]:
    """Call the upstream exchange-rate API for `base_code` and return every
    rate it knows about, already inverted to this project's rate_to_base
    convention.

    Direction note (important, do not flip without re-reading this):
    - This project's `rate_to_base` means "1 unit of `code` = rate_to_base
      units of the base currency" (see models.py Currency docstring and the
      IDR example in the settings UI: 1 IDR ~= 0.00184 TWD).
    - open.er-api.com/v6/latest/{BASE} returns `rates[code]` meaning
      "1 unit of BASE = rates[code] units of `code`" — the *opposite*
      direction from what we store.
    - So we must invert: rate_to_base = 1 / rates[code].
    """
    url = f"{EXCHANGE_RATE_API_BASE}/{base_code}"
    try:
        resp = httpx.get(url, timeout=8.0)
        resp.raise_for_status()
        data = resp.json()
    except httpx.TimeoutException:
        raise HTTPException(status_code=502, detail="連線匯率服務逾時，請稍後再試或手動輸入匯率")
    except httpx.HTTPError:
        raise HTTPException(status_code=502, detail="無法連線至匯率服務，請稍後再試或手動輸入匯率")
    except ValueError:
        raise HTTPException(status_code=502, detail="匯率服務回應格式異常，請稍後再試或手動輸入匯率")

    if data.get("result") != "success":
        raise HTTPException(status_code=502, detail="匯率服務回傳失敗，請稍後再試或手動輸入匯率")

    rates = data.get("rates") or {}
    if not rates:
        raise HTTPException(status_code=502, detail="匯率服務回傳資料為空，請稍後再試或手動輸入匯率")

    converted: dict[str, float] = {}
    for code, rate_base_to_target in rates.items():
        if not rate_base_to_target or rate_base_to_target <= 0:
            continue
        converted[code] = round(1.0 / rate_base_to_target, 8)
    return converted


@router.get("/api/currencies/rates", response_model=schemas.CurrencyRatesBulkLookupOut)
def lookup_currency_rates(base: str):
    """Trip-independent version of the old /api/trips/{trip_id}/currencies/
    lookup-rates: look up live exchange rates for every currency the upstream
    API knows, against an arbitrary `base` code passed as a query string.

    Doesn't require a trip_id (unlike the old endpoint), because
    CreateTripDialog needs this *before* a trip row exists — the user has
    just picked a base currency in the still-unsaved form. Shared by both
    CreateTripDialog (base = whatever the user picked in the form) and
    CurrenciesSection (base = trip.base_currency_code) so there's exactly one
    implementation of the upstream-API-call + rate-direction-inversion logic
    instead of two near-duplicates.
    """
    base_code = base.strip().upper()
    if not base_code:
        raise HTTPException(status_code=400, detail="請提供基準幣別代碼")
    rates = _fetch_rates_against(base_code)
    return schemas.CurrencyRatesBulkLookupOut(base_code=base_code, rates=rates)


@router.post("/api/trips/{trip_id}/currencies", response_model=schemas.CurrencyOut, status_code=201)
def create_currency(trip_id: int, payload: schemas.CurrencyCreate, db: Session = Depends(get_db)):
    if not db.get(models.Trip, trip_id):
        raise HTTPException(status_code=404, detail="Trip not found")
    existing = (
        db.query(models.Currency)
        .filter(models.Currency.trip_id == trip_id, models.Currency.code == payload.code.upper())
        .first()
    )
    if existing:
        raise HTTPException(status_code=400, detail="Currency code already exists for this trip")
    currency = models.Currency(
        trip_id=trip_id,
        code=payload.code.upper(),
        name=payload.name or payload.code.upper(),
        rate_to_base=payload.rate_to_base,
        is_base=False,
    )
    db.add(currency)
    db.commit()
    db.refresh(currency)
    return currency


@router.put("/api/currencies/{currency_id}", response_model=schemas.CurrencyOut)
def update_currency(currency_id: int, payload: schemas.CurrencyUpdate, db: Session = Depends(get_db)):
    currency = db.get(models.Currency, currency_id)
    if not currency:
        raise HTTPException(status_code=404, detail="Currency not found")
    if currency.is_base and payload.rate_to_base is not None and payload.rate_to_base != 1.0:
        raise HTTPException(status_code=400, detail="Base currency rate is always 1.0; change base currency instead")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(currency, field, value)
    db.commit()
    db.refresh(currency)
    return currency


@router.delete("/api/currencies/{currency_id}", status_code=204)
def delete_currency(currency_id: int, db: Session = Depends(get_db)):
    currency = db.get(models.Currency, currency_id)
    if not currency:
        raise HTTPException(status_code=404, detail="Currency not found")
    if currency.is_base:
        raise HTTPException(status_code=400, detail="Cannot delete the base currency")
    in_use = db.query(models.Expense).filter(models.Expense.currency_id == currency_id).first()
    if in_use:
        raise HTTPException(status_code=400, detail="Currency is used by existing expenses")
    db.delete(currency)
    db.commit()
    return None
