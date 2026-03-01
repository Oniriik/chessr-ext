"""
Chessr.io authentication via Supabase REST API.

Handles login, session persistence, and plan fetching.
"""

import json
import logging
from pathlib import Path

import requests

logger = logging.getLogger("maia-auth")

SUPABASE_URL = "https://ratngdlkcvyfdmidtenx.supabase.co"
SUPABASE_ANON_KEY = (
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9."
    "eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJhdG5nZGxrY3Z5ZmRtaWR0ZW54Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjkwODE0OTMsImV4cCI6MjA4NDY1NzQ5M30."
    "ZYXOVkGgIrdymoRFOs5MHP_03UPOt6Mu00ijYL12Bv4"
)

SESSION_DIR = Path.home() / ".chessr-maia"
SESSION_FILE = SESSION_DIR / "session.json"


def _headers(access_token: str | None = None) -> dict:
    h = {
        "apikey": SUPABASE_ANON_KEY,
        "Content-Type": "application/json",
    }
    if access_token:
        h["Authorization"] = f"Bearer {access_token}"
    return h


def login(email: str, password: str) -> dict:
    """Sign in with email/password.

    Returns:
        dict with keys: email, user_id, access_token, refresh_token, plan
    Raises:
        Exception on failure with user-facing message.
    """
    resp = requests.post(
        f"{SUPABASE_URL}/auth/v1/token?grant_type=password",
        headers=_headers(),
        json={"email": email, "password": password},
        timeout=10,
    )

    if resp.status_code != 200:
        data = resp.json()
        msg = data.get("error_description") or data.get("msg") or data.get("error", "Login failed")
        raise Exception(msg)

    data = resp.json()
    user = data.get("user", {})
    user_id = user.get("id", "")
    access_token = data.get("access_token", "")
    refresh_token = data.get("refresh_token", "")

    # Fetch plan
    plan = fetch_plan(user_id, access_token)

    session = {
        "email": email,
        "user_id": user_id,
        "access_token": access_token,
        "refresh_token": refresh_token,
        "plan": plan,
    }

    save_session(session)
    logger.info(f"Logged in as {email} (plan: {plan})")
    return session


def fetch_plan(user_id: str, access_token: str) -> str:
    """Fetch the user's plan from user_settings table."""
    try:
        resp = requests.get(
            f"{SUPABASE_URL}/rest/v1/user_settings"
            f"?user_id=eq.{user_id}&select=plan,plan_expiry",
            headers=_headers(access_token),
            timeout=10,
        )
        if resp.status_code == 200:
            rows = resp.json()
            if rows and len(rows) > 0:
                return rows[0].get("plan", "free")
    except Exception as e:
        logger.debug(f"Failed to fetch plan: {e}")
    return "free"


def refresh_session(session: dict) -> dict | None:
    """Try to refresh an expired access token."""
    try:
        resp = requests.post(
            f"{SUPABASE_URL}/auth/v1/token?grant_type=refresh_token",
            headers=_headers(),
            json={"refresh_token": session.get("refresh_token", "")},
            timeout=10,
        )
        if resp.status_code == 200:
            data = resp.json()
            user = data.get("user", {})
            new_session = {
                "email": session.get("email", user.get("email", "")),
                "user_id": user.get("id", session.get("user_id", "")),
                "access_token": data.get("access_token", ""),
                "refresh_token": data.get("refresh_token", ""),
                "plan": fetch_plan(
                    user.get("id", session.get("user_id", "")),
                    data.get("access_token", ""),
                ),
            }
            save_session(new_session)
            logger.info("Session refreshed")
            return new_session
    except Exception as e:
        logger.debug(f"Session refresh failed: {e}")
    return None


def load_session() -> dict | None:
    """Load saved session from disk. Returns None if not found or invalid."""
    try:
        if not SESSION_FILE.exists():
            return None
        data = json.loads(SESSION_FILE.read_text())
        if not data.get("access_token") or not data.get("email"):
            return None

        # Verify the token is still valid by fetching plan
        plan = fetch_plan(data["user_id"], data["access_token"])
        if plan:
            data["plan"] = plan
            save_session(data)
            logger.info(f"Session restored for {data['email']} (plan: {plan})")
            return data

        # Token might be expired, try refresh
        refreshed = refresh_session(data)
        if refreshed:
            return refreshed

        # Couldn't restore — clear stale session
        logout()
        return None
    except Exception as e:
        logger.debug(f"Failed to load session: {e}")
        return None


def save_session(session: dict):
    """Save session to disk."""
    try:
        SESSION_DIR.mkdir(parents=True, exist_ok=True)
        SESSION_FILE.write_text(json.dumps(session))
    except Exception as e:
        logger.debug(f"Failed to save session: {e}")


def login_with_token(access_token: str, refresh_token: str) -> dict:
    """Log in using tokens from the Chrome extension.

    Verifies the access_token with Supabase, fetches user info and plan.

    Returns:
        dict with keys: email, user_id, access_token, refresh_token, plan
    Raises:
        Exception on failure.
    """
    # Get user info from Supabase using the access token
    resp = requests.get(
        f"{SUPABASE_URL}/auth/v1/user",
        headers=_headers(access_token),
        timeout=10,
    )

    if resp.status_code != 200:
        raise Exception("Invalid or expired token")

    user = resp.json()
    email = user.get("email", "")
    user_id = user.get("id", "")

    if not email or not user_id:
        raise Exception("Could not retrieve user info")

    plan = fetch_plan(user_id, access_token)

    session = {
        "email": email,
        "user_id": user_id,
        "access_token": access_token,
        "refresh_token": refresh_token,
        "plan": plan,
    }

    save_session(session)
    logger.info(f"Token login as {email} (plan: {plan})")
    return session


def logout():
    """Delete saved session."""
    try:
        if SESSION_FILE.exists():
            SESSION_FILE.unlink()
        logger.info("Logged out")
    except Exception as e:
        logger.debug(f"Failed to delete session: {e}")
