from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.database import Base, engine
from app.routers import categories, currencies, expenses, members, payment_methods, settlement, trips

# Local single-file SQLite DB: create tables on startup if they don't exist yet.
# This is a local desktop-style tool, so a lightweight "create if missing" is
# sufficient — no Alembic migration chain.
Base.metadata.create_all(bind=engine)

app = FastAPI(title="TravelSplit API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(trips.router)
app.include_router(members.router)
app.include_router(currencies.router)
app.include_router(categories.router)
app.include_router(payment_methods.router)
app.include_router(expenses.router)
app.include_router(settlement.router)


@app.get("/api/health")
def health():
    return {"status": "ok"}
