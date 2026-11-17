# Booking log in Google Sheets (n8n)

`booking-log.workflow.json` is an n8n workflow that keeps a Google Sheet with one row per booking.

Every 15 minutes it reads the bookings from Firebase and adds a row for each new one. It also updates a booking's row when its status changes: deposit paid, approved, declined, cancelled or expired.

```
Every 15 minutes → Read recent bookings → List guests → Read guest profiles → Build sheet rows → Save to Google Sheet
   (schedule)        (Firestore query)       (code)        (Firestore get)       (code)          (append or update)
```

- **Reads only.** The workflow never changes anything in Firebase, and its Google account can only read the database.
- **Can't be faked.** n8n reads the real database itself; the website doesn't send anything to n8n.
- **What it reads:** bookings whose check-out is no more than 30 days ago, plus those guests' profiles. Older bookings no longer change, so their rows stay as they are.

## Columns

`booking-log-headers.csv` holds the header row:

Booking ID, Booked at, Room, Check-in, Check-out, Nights, Guests, Status, Total (RM), Deposit (RM), Balance (RM), Payment method, Payment ref, Paid at, Guest name, Phone, Email, Decided at, Decline reason, Refund due, Cancelled at, Last change

Times are in Malaysia time. **Status** matches what the website shows, including *Expired* for an unpaid booking past its 24-hour hold.

## Setup (about 15 minutes)

### 1. A read-only Google service account

1. Open https://console.cloud.google.com and pick the project **redzai-guesthouse** at the top.
2. Go to **IAM & Admin → Service Accounts → Create service account**.
   - Name: `n8n-booking-log`
   - Role: **Cloud Datastore Viewer**. This gives read-only access to Firestore.
   - Click **Done**.
3. Open the new service account and go to **Keys → Add key → Create new key → JSON**. A `.json` file downloads.
   Keep it private: it can read every booking and guest. Never put it in GitHub, email or chat.
4. Go to **APIs & Services → Library**, search for **Google Sheets API** and click **Enable**.

### 2. The Google Sheet

1. Create a new Google Sheet, for example *Redzai bookings*.
2. Go to **File → Import → Upload** and choose `booking-log-headers.csv`, then select **Replace current sheet**. Row 1 now holds the headers.
3. Click **Share** and add the service account's email address (`n8n-booking-log@redzai-guesthouse.iam.gserviceaccount.com`, also shown in the `.json` file as `client_email`) as an **Editor**.

### 3. n8n

1. In n8n, go to **Workflows → Import from File** and pick `booking-log.workflow.json`.
2. Open **Read recent bookings** and, under **Credential**, choose **Create new credential → Google Service Account API**:
   - **Service Account Email:** `client_email` from the `.json` file
   - **Private Key:** `private_key` from the `.json` file, from `-----BEGIN PRIVATE KEY-----` to `-----END PRIVATE KEY-----`
   - Save.
3. Select the same credential in **Read guest profiles** and **Save to Google Sheet**.
4. In **Save to Google Sheet**:
   - Paste the sheet's URL into **Document**.
   - Choose the tab in **Sheet**.
   - Leave **Column to match on** as **Booking ID**.
5. Click **Execute workflow**. Your bookings should appear in the sheet.
6. Turn the workflow **Active** (or **Publish** it) so it runs every 15 minutes.

## Notes

- **Prices:** the **Build sheet rows** node has its own copy of the room prices, cleaning fee and deposit. If you change them in `js/store.js`, change them here too.
- **Firebase free plan:** each run reads one document per booking in the 30-day window, plus one per guest. With 50 active bookings, that's about 7,000 of the 50,000 free reads a day.
- **Your own columns:** you can add columns to the right of *Last change*, such as notes. The workflow leaves them alone.
- **Don't rename** the existing headers, especially **Booking ID**. The workflow uses them to find each row.
