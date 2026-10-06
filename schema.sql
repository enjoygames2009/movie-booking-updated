-- BOOK MY MOVIE database for MySQL Workbench
-- Open this file in Workbench (File > Open SQL Script) and click the lightning bolt.
-- Safe to run more than once: it will not add duplicate movies or shows.

CREATE DATABASE IF NOT EXISTS movie_booking;
USE movie_booking;

CREATE TABLE IF NOT EXISTS movies (
    movie_id    INT AUTO_INCREMENT PRIMARY KEY,
    movie_name  VARCHAR(150) NOT NULL,
    language    VARCHAR(50)  NOT NULL,
    genre       VARCHAR(50)  NOT NULL,
    duration    INT NOT NULL CHECK (duration > 0),
    UNIQUE KEY uq_movie_name (movie_name)
);

CREATE TABLE IF NOT EXISTS shows (
    show_id      INT AUTO_INCREMENT PRIMARY KEY,
    movie_id     INT NOT NULL,
    show_date    DATE NOT NULL,
    show_time    TIME NOT NULL,
    total_seats  INT NOT NULL DEFAULT 50,
    FOREIGN KEY (movie_id) REFERENCES movies(movie_id) ON DELETE CASCADE,
    UNIQUE KEY uq_show (movie_id, show_date, show_time)
);

CREATE TABLE IF NOT EXISTS customers (
    customer_id  INT AUTO_INCREMENT PRIMARY KEY,
    name         VARCHAR(100) NOT NULL,
    phone        VARCHAR(20)  NOT NULL,
    email        VARCHAR(120) NOT NULL
);

CREATE TABLE IF NOT EXISTS bookings (
    booking_id    INT AUTO_INCREMENT PRIMARY KEY,
    customer_id   INT NOT NULL,
    show_id       INT NOT NULL,
    seat_number   VARCHAR(5) NOT NULL,
    amount        DECIMAL(8,2) NOT NULL DEFAULT 150.00,
    booking_date  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (customer_id) REFERENCES customers(customer_id),
    FOREIGN KEY (show_id) REFERENCES shows(show_id) ON DELETE CASCADE,
    UNIQUE KEY uq_show_seat (show_id, seat_number)   -- a seat can't be booked twice
);

-- Movies
INSERT IGNORE INTO movies (movie_name, language, genre, duration) VALUES
    ('Lucifer',                      'Malayalam', 'Political Thriller', 174),
    ('L2: Empuraan',                 'Malayalam', 'Action Thriller',    179),
    ('Aadujeevitham: The Goat Life', 'Malayalam', 'Survival Drama',     173),
    ('The Greatest of All Time',     'Tamil',     'Action Sci-Fi',      183),
    ('Avengers: Endgame',            'English',   'Superhero',          181),
    ('Avengers: Doomsday',           'English',   'Superhero',          150);

-- Shows (days from today, time)
INSERT IGNORE INTO shows (movie_id, show_date, show_time, total_seats)
SELECT m.movie_id, DATE_ADD(CURDATE(), INTERVAL v.d DAY), v.t, 50
FROM (
    SELECT 'Lucifer' AS n, 0 AS d, '18:30:00' AS t
    UNION ALL SELECT 'Lucifer', 1, '21:00:00'
    UNION ALL SELECT 'L2: Empuraan', 0, '16:00:00'
    UNION ALL SELECT 'L2: Empuraan', 1, '20:00:00'
    UNION ALL SELECT 'Aadujeevitham: The Goat Life', 1, '19:00:00'
    UNION ALL SELECT 'The Greatest of All Time', 2, '20:15:00'
    UNION ALL SELECT 'Avengers: Endgame', 1, '17:30:00'
    UNION ALL SELECT 'Avengers: Doomsday', 2, '19:45:00'
) v
JOIN movies m ON m.movie_name = v.n;

SELECT * FROM movies;
SELECT * FROM shows;
