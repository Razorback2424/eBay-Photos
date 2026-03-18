import json
import os
import urllib.parse
import urllib.request


VERIFY_URL = "https://api.gumroad.com/v2/licenses/verify"


def config():
    return {
        "product_permalink": (os.environ.get("GUMROAD_PRODUCT_PERMALINK") or "").strip(),
        "product_id": (os.environ.get("GUMROAD_PRODUCT_ID") or "").strip(),
        "product_url": (os.environ.get("GUMROAD_PRODUCT_URL") or "").strip(),
        "test_license_keys": {
            item.strip()
            for item in (os.environ.get("GUMROAD_TEST_LICENSE_KEYS") or "").split(",")
            if item.strip()
        },
    }


def ready():
    cfg = config()
    return bool(cfg["product_permalink"] or cfg["product_id"] or cfg["test_license_keys"])


def product_url():
    return config()["product_url"]


def verify_license(email, license_key):
    email = (email or "").strip().lower()
    license_key = (license_key or "").strip()
    cfg = config()

    if not email:
        return False, "Enter the purchase email from your Gumroad receipt."
    if not license_key:
        return False, "Enter the Gumroad license key from your receipt."

    if license_key in cfg["test_license_keys"]:
        return True, {
            "email": email,
            "name": email.split("@")[0] if "@" in email else email,
            "license_key": license_key,
        }

    if not ready():
        return False, "Gumroad access is not configured yet."

    form = {
        "license_key": license_key,
        "increment_uses_count": "false",
    }
    if cfg["product_permalink"]:
        form["product_permalink"] = cfg["product_permalink"]
    elif cfg["product_id"]:
        form["product_id"] = cfg["product_id"]

    data = urllib.parse.urlencode(form).encode("utf-8")
    req = urllib.request.Request(
        VERIFY_URL,
        data=data,
        method="POST",
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
    except Exception:
        return False, "We could not verify that license key right now. Try again in a moment."

    if not payload.get("success"):
        return False, "That license key was not accepted. Check the receipt and try again."

    purchase = payload.get("purchase") or {}
    purchase_email = (purchase.get("email") or email).strip().lower()
    if purchase_email and email and purchase_email != email:
        return False, f"Use the purchase email from Gumroad: {purchase_email}"

    return True, {
        "email": purchase_email or email,
        "name": (purchase.get("full_name") or purchase.get("name") or email.split("@")[0]).strip(),
        "license_key": license_key,
    }
