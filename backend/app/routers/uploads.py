"""Expense receipt image upload.

Single endpoint: accepts one image file, validates type/size, stores it under
backend/uploads/ with a random filename (avoids collisions/overwrites and
avoids trusting the client's original filename), and returns a relative URL
that's mounted as static files in main.py (`app.mount("/uploads", ...)`) so
the frontend can use it directly as an <img src> — see
ExpenseFormDialog.tsx's upload flow and models.Expense.image_url.
"""
import os
import uuid

from fastapi import APIRouter, File, HTTPException, UploadFile

from app.database import BASE_DIR

router = APIRouter(prefix="/api/uploads", tags=["uploads"])

UPLOAD_DIR = os.path.join(BASE_DIR, "uploads")

ALLOWED_CONTENT_TYPES = {"image/jpeg", "image/png", "image/webp"}
ALLOWED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp"}
MAX_UPLOAD_BYTES = 5 * 1024 * 1024  # 5MB


@router.post("/expense-image")
async def upload_expense_image(file: UploadFile = File(...)):
    ext = os.path.splitext(file.filename or "")[1].lower()
    if file.content_type not in ALLOWED_CONTENT_TYPES or ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(status_code=400, detail="僅支援 JPG / PNG / WEBP 圖片格式")

    contents = await file.read()
    if len(contents) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=400, detail="檔案大小不可超過 5MB")
    if len(contents) == 0:
        raise HTTPException(status_code=400, detail="檔案是空的")

    os.makedirs(UPLOAD_DIR, exist_ok=True)
    filename = f"{uuid.uuid4().hex}{ext}"
    dest_path = os.path.join(UPLOAD_DIR, filename)
    with open(dest_path, "wb") as f:
        f.write(contents)

    return {"url": f"/uploads/{filename}"}
