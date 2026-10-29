# webpage-testing

A simple homestay booking website (Airbnb-style), built with plain HTML, CSS and JavaScript.
No build step or server code is needed.

## Features

| Page | File | What it does |
| --- | --- | --- |
| Room availability | `index.html` | Browse rooms, filter by location and guests, and check which rooms are free for your dates |
| Room details | `room.html` | Two-month availability calendar (booked nights are crossed out), price summary, and reservation |
| Login | `login.html` | Log in or sign up for a member account |
| Members | `members.html` | Members-only page: profile, booking stats, and upcoming, past and cancelled bookings, with cancellation |

Demo account: **demo@homestay.my** / **demo123**

## Running locally

```bash
python3 -m http.server 8000
```

Then open http://localhost:8000.

## How it works

- All data (users, bookings, session) is stored in the browser's `localStorage` (`js/store.js`).
  To reset the demo, clear site data in your browser.
- A room is available for a stay if no confirmed booking overlaps the nights from check-in to check-out.
  A guest's check-out day can be the next guest's check-in day.
- Room listings are defined in the `ROOMS` array in `js/store.js`.

> **Note:** this is a front-end demo. Login runs entirely in the browser, so it is not secure.
> A real site needs a backend (for example Node/Express, Laravel or Firebase) for accounts and bookings.
