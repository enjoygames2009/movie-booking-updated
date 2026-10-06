"""BOOK MY MOVIE - Flask backend using the MySQL database from schema.sql
Run:  pip install -r requirements.txt
      set DB_PASSWORD=your_mysql_password   (Windows)   /  export DB_PASSWORD=...  (Mac/Linux)
      python app.py     then open http://127.0.0.1:5000
"""
import os
import re
from datetime import date, datetime, time, timedelta
from decimal import Decimal

import mysql.connector
from flask import Flask, abort, jsonify, request, send_from_directory

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
PUBLIC_FILES = {"style.css", "script.js"}  # only these are served to the browser

app = Flask(__name__, static_folder=None)

DB_CONFIG = dict(
    host=os.getenv("DB_HOST", "localhost"),
    user=os.getenv("DB_USER", "root"),
    password=os.getenv("DB_PASSWORD", "root"),
    database=os.getenv("DB_NAME", "movie_booking"),
)
ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD", "admin123")
TICKET_PRICE = 150.00
TOTAL_SEATS = 50


def connect():
    return mysql.connector.connect(**DB_CONFIG)


def clean(v):
    """Make MySQL values JSON friendly."""
    if isinstance(v, timedelta):
        s = int(v.total_seconds())
        return f"{s // 3600:02d}:{(s % 3600) // 60:02d}:{s % 60:02d}"
    if isinstance(v, (datetime, date, time)):
        return v.isoformat()
    if isinstance(v, Decimal):
        return float(v)
    return v


def fetch(sql, params=(), one=False):
    con = connect()
    try:
        cur = con.cursor(dictionary=True)
        cur.execute(sql, params)
        rows = [{k: clean(v) for k, v in r.items()} for r in cur.fetchall()]
        return (rows[0] if rows else None) if one else rows
    finally:
        con.close()


def error(msg, code=400):
    return jsonify(error=msg), code


def admin_only(fn):
    def wrapper(*a, **kw):
        if request.headers.get("X-Admin-Password") != ADMIN_PASSWORD:
            return error("Incorrect admin password.", 401)
        return fn(*a, **kw)
    wrapper.__name__ = fn.__name__
    return wrapper


@app.route("/")
def home():
    return send_from_directory(BASE_DIR, "index.html")


@app.route("/<name>")
def public_file(name):
    if name not in PUBLIC_FILES:  # keeps app.py and schema.sql private
        abort(404)
    return send_from_directory(BASE_DIR, name)


@app.errorhandler(mysql.connector.Error)
def database_problem(e):
    return error(f"Database problem: {e}. Is MySQL running, is DB_PASSWORD correct, and did you run schema.sql?", 500)


@app.get("/api/movies")
def movies():
    return jsonify(fetch("SELECT movie_id, movie_name, language, genre, duration FROM movies ORDER BY movie_id"))


@app.get("/api/shows")
def shows():
    return jsonify(fetch("""
        SELECT s.show_id, s.movie_id, m.movie_name, s.show_date, s.show_time, s.total_seats,
               (SELECT COUNT(*) FROM bookings b WHERE b.show_id = s.show_id) AS booked
        FROM shows s JOIN movies m ON s.movie_id = m.movie_id
        ORDER BY s.show_date, s.show_time"""))


@app.get("/api/shows/<int:show_id>/seats")
def seats(show_id):
    rows = fetch("SELECT seat_number FROM bookings WHERE show_id = %s", (show_id,))
    return jsonify(booked=[r["seat_number"] for r in rows], total=TOTAL_SEATS)


@app.post("/api/book")
def book():
    d = request.get_json(silent=True) or {}
    name, phone, email = (d.get("name") or "").strip(), (d.get("phone") or "").strip(), (d.get("email") or "").strip()
    seat_list = d.get("seats") or []
    if not name or not re.fullmatch(r"[0-9+\-\s]{7,15}", phone):
        return error("Enter your name and a valid phone number.")
    if not re.fullmatch(r"\S+@\S+\.\S+", email):
        return error("Enter a valid email address.")
    if not seat_list or len(set(seat_list)) != len(seat_list):
        return error("Select at least one seat.")
    for s in seat_list:
        if not re.fullmatch(r"S\d{1,2}", str(s)) or not 1 <= int(s[1:]) <= TOTAL_SEATS:
            return error(f"Invalid seat {s}. Seats are S1 to S{TOTAL_SEATS}.")
    con = connect()
    try:
        cur = con.cursor()
        cur.execute("SELECT show_id FROM shows WHERE show_id = %s", (d.get("show_id"),))
        if cur.fetchone() is None:
            return error("Show does not exist.", 404)
        cur.execute("INSERT INTO customers (name, phone, email) VALUES (%s, %s, %s)", (name, phone, email))
        customer_id = cur.lastrowid
        made = []
        for s in seat_list:
            cur.execute(
                "INSERT INTO bookings (customer_id, show_id, seat_number, amount) VALUES (%s, %s, %s, %s)",
                (customer_id, d["show_id"], s, TICKET_PRICE))
            made.append({"booking_id": cur.lastrowid, "seat_number": s})
        con.commit()
        return jsonify(bookings=made, amount=TICKET_PRICE * len(made), name=name)
    except mysql.connector.IntegrityError:
        con.rollback()
        return error("One of those seats was just booked. Pick another seat.", 409)
    except mysql.connector.Error as e:
        con.rollback()
        return error(f"Booking failed: {e}", 500)
    finally:
        con.close()


BOOKING_SQL = """
    SELECT b.booking_id, c.name, c.phone, m.movie_name, s.show_date, s.show_time,
           b.seat_number, b.amount, b.booking_date
    FROM bookings b
    JOIN customers c ON b.customer_id = c.customer_id
    JOIN shows s ON b.show_id = s.show_id
    JOIN movies m ON s.movie_id = m.movie_id"""


@app.get("/api/booking/<int:booking_id>")
def get_booking(booking_id):
    row = fetch(BOOKING_SQL + " WHERE b.booking_id = %s", (booking_id,), one=True)
    return jsonify(row) if row else error("Booking not found.", 404)


@app.delete("/api/booking/<int:booking_id>")
def cancel_booking(booking_id):
    con = connect()
    try:
        cur = con.cursor()
        cur.execute("DELETE FROM bookings WHERE booking_id = %s", (booking_id,))
        con.commit()
        return jsonify(ok=True) if cur.rowcount else error("Booking not found.", 404)
    finally:
        con.close()


@app.get("/api/admin/bookings")
@admin_only
def all_bookings():
    return jsonify(fetch(BOOKING_SQL + " ORDER BY b.booking_id"))


@app.post("/api/admin/movies")
@admin_only
def add_movie():
    d = request.get_json(silent=True) or {}
    try:
        duration = int(d.get("duration"))
    except (TypeError, ValueError):
        return error("Invalid duration.")
    if not (d.get("movie_name") or "").strip() or not (d.get("language") or "").strip() or not (d.get("genre") or "").strip() or duration < 1:
        return error("Fill in every movie field.")
    con = connect()
    try:
        cur = con.cursor()
        cur.execute("INSERT INTO movies (movie_name, language, genre, duration) VALUES (%s, %s, %s, %s)",
                    (d["movie_name"].strip(), d["language"].strip(), d["genre"].strip(), duration))
        con.commit()
        return jsonify(ok=True)
    finally:
        con.close()


@app.post("/api/admin/shows")
@admin_only
def add_show():
    d = request.get_json(silent=True) or {}
    con = connect()
    try:
        cur = con.cursor()
        cur.execute("INSERT INTO shows (movie_id, show_date, show_time, total_seats) VALUES (%s, %s, %s, %s)",
                    (d.get("movie_id"), d.get("show_date"), d.get("show_time"), TOTAL_SEATS))
        con.commit()
        return jsonify(ok=True)
    except mysql.connector.Error as e:
        con.rollback()
        return error(f"Could not add show: {e}")
    finally:
        con.close()


if __name__ == "__main__":
    app.run(debug=True)
