"""Bounded mail adapters. No mail leaves the machine unless explicitly enabled.

Provider hosts are deliberately fixed: a user cannot turn this into an SMTP
relay or ask the server to connect to an arbitrary internal address.
"""

from __future__ import annotations

import imaplib
import re
import smtplib
import ssl
from dataclasses import dataclass
from datetime import datetime, timezone
from email import policy
from email.header import decode_header
from email.message import EmailMessage
from email.parser import BytesParser
from email.utils import parseaddr, parsedate_to_datetime
from html.parser import HTMLParser

PROVIDERS: dict[str, dict[str, str | int]] = {
    "gmail": {"imap": "imap.gmail.com", "smtp": "smtp.gmail.com", "smtp_port": 465},
    "microsoft": {
        "imap": "outlook.office365.com",
        "smtp": "smtp.office365.com",
        "smtp_port": 587,
    },
    "yahoo": {"imap": "imap.mail.yahoo.com", "smtp": "smtp.mail.yahoo.com", "smtp_port": 465},
}

CATEGORIES = (
    "primary", "verification", "interview", "offer", "rejection", "assessment",
    "confirmation", "onboarding", "reminder",
)
MAX_MESSAGE_BYTES = 2 * 1024 * 1024
MAX_BODY_CHARS = 100_000


class MailConfigurationError(ValueError):
    pass


class MailDeliveryError(RuntimeError):
    """Contains no credentials or provider response text."""

    def __init__(self, *, delivery_unknown: bool = False):
        super().__init__("Mail delivery failed; inspect connection configuration.")
        self.delivery_unknown = delivery_unknown


class MailSyncError(RuntimeError):
    def __init__(self):
        super().__init__("Mailbox sync failed; inspect connection configuration.")


@dataclass(frozen=True)
class FetchedMessage:
    uid: str
    external_id: str
    subject: str
    sender_email: str
    sender_name: str
    recipient_email: str
    body: str
    received_at: datetime
    category: str


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def categorize_message(subject: str, body: str = "") -> str:
    """Conservative local classification; categories remain editable by users."""
    haystack = (subject + "\n" + body[:5000]).casefold()
    rules = (
        ("rejection", ("not moving forward", "not selected", "unsuccessful", "regret to inform", "other candidates", "application rejected")),
        ("offer", ("offer letter", "job offer", "offer of employment", "employment offer")),
        ("verification", ("verify your", "verification code", "confirm your email", "email verification", "one-time code")),
        ("onboarding", ("onboarding", "new hire", "welcome aboard", "first day")),
        ("reminder", ("reminder", "upcoming interview")),
        ("assessment", ("assessment", "technical test", "coding challenge", "aptitude test")),
        ("interview", ("interview", "schedule a call", "recruiter call")),
        ("confirmation", ("application received", "received your application", "thank you for applying", "application submitted")),
    )
    for category, needles in rules:
        if any(needle in haystack for needle in needles):
            return category
    return "primary"


def validate_provider(provider: str, allowed_providers: tuple[str, ...] | list[str]) -> dict[str, str | int]:
    if provider not in PROVIDERS or provider not in allowed_providers:
        raise MailConfigurationError("This mail provider is not enabled by the server.")
    return PROVIDERS[provider]


def validate_header(value: str) -> str:
    if any(char in value for char in ("\r", "\n", "\x00")):
        raise MailConfigurationError("Mail headers cannot contain control characters.")
    return value


def decode_text_header(value: str | None) -> str:
    pieces: list[str] = []
    for part, charset in decode_header(value or ""):
        if isinstance(part, bytes):
            try:
                pieces.append(part.decode(charset or "utf-8", errors="replace"))
            except LookupError:
                pieces.append(part.decode("utf-8", errors="replace"))
        else:
            pieces.append(part)
    return "".join(pieces)


class _PlainHTML(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []
        self.hidden_depth = 0

    def handle_starttag(self, tag, attrs):
        if tag in ("script", "style"):
            self.hidden_depth += 1
        elif tag in ("br", "p", "div", "li") and not self.hidden_depth:
            self.parts.append("\n")

    def handle_endtag(self, tag):
        if tag in ("script", "style") and self.hidden_depth:
            self.hidden_depth -= 1

    def handle_data(self, data):
        if not self.hidden_depth:
            self.parts.append(data)


def parse_message(raw: bytes, uid: str) -> FetchedMessage:
    if len(raw) > MAX_MESSAGE_BYTES:
        raise ValueError("Message exceeds import limit.")
    message = BytesParser(policy=policy.default).parsebytes(raw)
    sender_name, sender_email = parseaddr(decode_text_header(message.get("From")))
    _, recipient_email = parseaddr(decode_text_header(message.get("To")))
    subject = decode_text_header(message.get("Subject")).replace("\x00", "")[:500]
    body_part = message.get_body(preferencelist=("plain", "html"))
    if body_part is None:
        body = ""
    else:
        try:
            body = body_part.get_content()
        except (LookupError, UnicodeDecodeError):
            body = (body_part.get_payload(decode=True) or b"").decode("utf-8", errors="replace")
        if not isinstance(body, str):
            body = ""
        if body_part.get_content_type() == "text/html":
            parser = _PlainHTML()
            parser.feed(body)
            body = "".join(parser.parts)
    body = body.replace("\x00", "")[:MAX_BODY_CHARS]
    try:
        received_at = parsedate_to_datetime(str(message.get("Date", "")))
        if received_at.tzinfo is None:
            received_at = received_at.replace(tzinfo=timezone.utc)
        received_at = received_at.astimezone(timezone.utc)
    except (ValueError, TypeError, OverflowError):
        received_at = utcnow()
    return FetchedMessage(
        uid=uid,
        external_id=str(message.get("Message-ID", ""))[:1000],
        subject=subject,
        sender_email=sender_email[:320],
        sender_name=sender_name[:300],
        recipient_email=recipient_email[:320],
        body=body,
        received_at=received_at,
        category=categorize_message(subject, body),
    )


def send_message(
    *, provider: str, allowed_providers: tuple[str, ...] | list[str],
    username: str, password: str, recipient: str, subject: str, body: str,
    message_id: str, enabled: bool, timeout: int = 15,
    attachments: list[tuple[str, bytes, str]] | None = None,
) -> str:
    """Return sent only after provider acknowledgement; demo is handled upstream."""
    endpoints = validate_provider(provider, allowed_providers)
    if not enabled:
        raise MailConfigurationError("Outbound email is disabled on this server.")
    message = EmailMessage()
    message["From"] = validate_header(username)
    message["To"] = validate_header(recipient)
    message["Subject"] = validate_header(subject)
    message["Message-ID"] = validate_header(message_id)
    message["Date"] = utcnow().strftime("%a, %d %b %Y %H:%M:%S +0000")
    message.set_content(body)
    for filename, payload, content_type in attachments or []:
        maintype, _, subtype = content_type.partition("/")
        if not maintype or not subtype:
            maintype, subtype = "application", "octet-stream"
        message.add_attachment(payload, maintype=maintype, subtype=subtype, filename=filename)
    delivery_started = False
    try:
        context = ssl.create_default_context()
        if endpoints["smtp_port"] == 465:
            client = smtplib.SMTP_SSL(str(endpoints["smtp"]), 465, timeout=timeout, context=context)
        else:
            client = smtplib.SMTP(str(endpoints["smtp"]), 587, timeout=timeout)
        with client:
            if endpoints["smtp_port"] == 587:
                client.ehlo()
                client.starttls(context=context)
                client.ehlo()
            client.login(username, password)
            delivery_started = True
            refused = client.send_message(message, from_addr=username, to_addrs=[recipient])
            if refused:
                raise MailDeliveryError()
    except MailDeliveryError:
        raise
    except (smtplib.SMTPAuthenticationError, smtplib.SMTPRecipientsRefused, smtplib.SMTPSenderRefused):
        raise MailDeliveryError(delivery_unknown=False) from None
    except (OSError, smtplib.SMTPException):
        # A dropped connection after DATA may follow a successful delivery.
        raise MailDeliveryError(delivery_unknown=delivery_started) from None
    return "sent"


def sync_inbox(
    *, provider: str, allowed_providers: tuple[str, ...] | list[str],
    username: str, password: str, enabled: bool, after_uid: int = 0,
    limit: int = 50, uidvalidity: str | None = None, timeout: int = 15,
) -> tuple[list[FetchedMessage], dict]:
    endpoints = validate_provider(provider, allowed_providers)
    if not enabled:
        raise MailConfigurationError("Mailbox synchronization is disabled on this server.")
    if not 1 <= limit <= 100 or after_uid < 0:
        raise MailConfigurationError("Invalid sync range.")
    client = None
    fetched: list[FetchedMessage] = []
    last_uid = after_uid
    try:
        client = imaplib.IMAP4_SSL(str(endpoints["imap"]), 993, ssl_context=ssl.create_default_context(), timeout=timeout)
        client.login(username, password)
        status, _ = client.select("INBOX", readonly=True)
        if status != "OK":
            raise MailSyncError()
        _, validity_data = client.response("UIDVALIDITY")
        server_uidvalidity = (validity_data[0] if validity_data else b"0") or b"0"
        server_uidvalidity = server_uidvalidity.decode("ascii", errors="replace")
        if server_uidvalidity != uidvalidity:
            after_uid = 0
            last_uid = 0
        status, data = client.uid("search", None, f"UID {after_uid + 1}:*")
        if status != "OK":
            raise MailSyncError()
        # UID ranges can include the last existing message when start > max UID.
        uids = sorted(int(uid) for uid in (data[0] or b"").split() if int(uid) > after_uid)[:limit]
        for uid in uids:
            status, size_chunks = client.uid("fetch", str(uid), "(RFC822.SIZE)")
            if status != "OK":
                raise MailSyncError()
            size_info = b" ".join(part if isinstance(part, bytes) else part[0] for part in size_chunks if isinstance(part, (bytes, tuple)))
            size_match = re.search(rb"RFC822\.SIZE\s+(\d+)", size_info, re.IGNORECASE)
            if size_match is None:
                raise MailSyncError()
            if int(size_match.group(1)) > MAX_MESSAGE_BYTES:
                last_uid = uid
                continue
            status, chunks = client.uid("fetch", str(uid), "(BODY.PEEK[])")
            if status != "OK":
                raise MailSyncError()
            raw = next((part[1] for part in chunks if isinstance(part, tuple) and isinstance(part[1], bytes)), None)
            if raw is not None and len(raw) <= MAX_MESSAGE_BYTES:
                fetched.append(parse_message(raw, str(uid)))
            last_uid = uid
    except MailSyncError:
        raise
    except (OSError, imaplib.IMAP4.error, ValueError, TypeError):
        raise MailSyncError() from None
    finally:
        if client is not None:
            try:
                client.logout()
            except (OSError, imaplib.IMAP4.error):
                pass
    return fetched, {"last_uid": last_uid, "uidvalidity": server_uidvalidity}
