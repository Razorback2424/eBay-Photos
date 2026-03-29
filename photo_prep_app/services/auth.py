from functools import wraps
import hashlib
import json
import os
import secrets
import urllib.parse
import urllib.request

from flask import redirect, request, session, url_for

DEFAULT_SUPPORT_EMAIL = "support@cardworks.app"
DEFAULT_APP_DISPLAY_NAME = "CardWorks"


def auth_state():
    user = session.get("auth_user")
    if not isinstance(user, dict):
        return {"is_authenticated": False, "user": None, "mode": auth_mode()}
    return {"is_authenticated": True, "user": user, "mode": auth_mode()}


def auth_mode():
    return (os.environ.get("AUTH_MODE") or "gumroad").strip().lower()


def launch_mode_enabled():
    raw = os.environ.get("LAUNCH_MODE")
    if raw is None:
        return True
    return str(raw).strip().lower() in {"1", "true", "yes", "on"}


def support_email():
    return (os.environ.get("SUPPORT_EMAIL") or DEFAULT_SUPPORT_EMAIL).strip()


def support_email_configured():
    email = support_email()
    return bool(email and "@" in email and email != DEFAULT_SUPPORT_EMAIL)


def app_display_name():
    return (os.environ.get("APP_DISPLAY_NAME") or DEFAULT_APP_DISPLAY_NAME).strip()


def legal_entity_name():
    return (os.environ.get("LEGAL_ENTITY_NAME") or app_display_name()).strip()


def legal_contact_address():
    return (os.environ.get("LEGAL_CONTACT_ADDRESS") or "").strip()


def gumroad_product_url():
    explicit = (os.environ.get("GUMROAD_PRODUCT_URL") or "").strip()
    if explicit:
        return explicit
    permalink = (os.environ.get("GUMROAD_PRODUCT_PERMALINK") or "").strip()
    if permalink:
        return f"https://gumroad.com/l/{permalink}"
    return ""


def plausible_domain():
    return (os.environ.get("PLAUSIBLE_DOMAIN") or "").strip()


def plausible_script_src():
    return (os.environ.get("PLAUSIBLE_SCRIPT_SRC") or "https://plausible.io/js/script.js").strip()


def auth0_config():
    return {
        "domain": (os.environ.get("AUTH0_DOMAIN") or "").strip(),
        "client_id": (os.environ.get("AUTH0_CLIENT_ID") or "").strip(),
        "client_secret": (os.environ.get("AUTH0_CLIENT_SECRET") or "").strip(),
        "callback_url": (os.environ.get("AUTH0_CALLBACK_URL") or "").strip(),
        "audience": (os.environ.get("AUTH0_AUDIENCE") or "").strip(),
        "logout_return_to": (os.environ.get("AUTH0_LOGOUT_RETURN_TO") or "").strip(),
    }


def auth0_ready():
    cfg = auth0_config()
    return bool(cfg["domain"] and cfg["client_id"] and cfg["client_secret"] and cfg["callback_url"])


def sign_in_demo(email):
    email = (email or "").strip().lower()
    if not email:
        email = "seller@example.com"
    # Give each demo email its own account ID so local testing reflects real multi-user isolation.
    if email == "seller@example.com":
        demo_account_id = "local-demo-user"
    else:
        demo_account_id = "demo-" + hashlib.sha256(email.encode("utf-8")).hexdigest()[:16]
    session["auth_user"] = {
        "id": demo_account_id,
        "email": email,
        "name": email.split("@")[0] if "@" in email else email,
        "provider": "demo",
    }
    return session["auth_user"]


def sign_in_gumroad(email, *, name=""):
    email = (email or "").strip().lower()
    if not email:
        email = "buyer@example.com"
    session["auth_user"] = {
        "id": "gumroad-" + hashlib.sha256(email.encode("utf-8")).hexdigest()[:16],
        "email": email,
        "name": (name or (email.split("@")[0] if "@" in email else email)).strip(),
        "provider": "gumroad",
    }
    return session["auth_user"]


def sign_in_user(user):
    session["auth_user"] = user
    return user


def begin_auth0_login(next_url):
    cfg = auth0_config()
    state = secrets.token_urlsafe(24)
    session["auth0_state"] = state
    session["auth_next"] = next_url
    query = {
        "response_type": "code",
        "client_id": cfg["client_id"],
        "redirect_uri": cfg["callback_url"],
        "scope": "openid profile email",
        "state": state,
    }
    if cfg["audience"]:
        query["audience"] = cfg["audience"]
    return "https://" + cfg["domain"].strip("/") + "/authorize?" + urllib.parse.urlencode(query)


def exchange_auth0_code(code):
    cfg = auth0_config()
    data = urllib.parse.urlencode(
        {
            "grant_type": "authorization_code",
            "client_id": cfg["client_id"],
            "client_secret": cfg["client_secret"],
            "code": code,
            "redirect_uri": cfg["callback_url"],
        }
    ).encode("utf-8")
    req = urllib.request.Request(
        "https://" + cfg["domain"].strip("/") + "/oauth/token",
        data=data,
        method="POST",
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    with urllib.request.urlopen(req, timeout=20) as resp:
        return json.loads(resp.read().decode("utf-8"))


def fetch_auth0_userinfo(access_token):
    req = urllib.request.Request(
        "https://" + auth0_config()["domain"].strip("/") + "/userinfo",
        method="GET",
        headers={"Authorization": f"Bearer {access_token}"},
    )
    with urllib.request.urlopen(req, timeout=20) as resp:
        return json.loads(resp.read().decode("utf-8"))


def auth0_logout_url(fallback_return_to):
    cfg = auth0_config()
    return_to = cfg["logout_return_to"] or fallback_return_to
    query = {"client_id": cfg["client_id"], "returnTo": return_to}
    return "https://" + cfg["domain"].strip("/") + "/v2/logout?" + urllib.parse.urlencode(query)


def sign_out():
    session.pop("auth0_state", None)
    session.pop("auth_next", None)
    session.pop("auth_user", None)


def require_login(view_fn):
    @wraps(view_fn)
    def wrapped(*args, **kwargs):
        if not auth_state()["is_authenticated"]:
            next_url = request.path
            if request.query_string:
                next_url = f"{next_url}?{request.query_string.decode('utf-8', errors='ignore')}"
            return redirect(url_for("login", next=next_url))
        return view_fn(*args, **kwargs)

    return wrapped
