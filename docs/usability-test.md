# Usability test with new staff

Pass mark: at least 9 of 10 people who have never used the app finish a dine-in order without help, each in under
2 minutes, after a 10-minute demo.

## Setup
- The counter PC runs the backend with the normal menu and at least 8 tables; one test phone (360 px class Android
  phone) and, if used, one tablet, both logged in to the restaurant Wi-Fi.
- Each person gets their own Cashier login with a known PIN.
- One observer with a stopwatch and this sheet. The observer does not answer questions during the task.

## Demo (10 minutes, same for everyone)
1. Log in with the staff tile and PIN.
2. Home → Dine-in / Tables → tap an Available table → add food → Send to Kitchen.
3. Show the green "Sent to kitchen" bar and the table turning red.

## Task (timed)
"Table 4 wants 1 Dal Makhani, 2 Tandoori Roti and 1 Sweet Lassi. Send it to the kitchen."
Start the clock at Home; stop it when the green "Sent to kitchen" bar shows.

## Record per person

| # | Finished unaided (Y/N) | Time (s) | Taps | Where they hesitated or asked |
|---|---|---|---|---|
| 1 | | | | |
| 2 | | | | |
| 3 | | | | |
| 4 | | | | |
| 5 | | | | |
| 6 | | | | |
| 7 | | | | |
| 8 | | | | |
| 9 | | | | |
| 10 | | | | |

Result: ___ / 10 unaided (pass at 9 or more). Note every hesitation point; fix it and re-test if the result is below 9.

The automated browser test (`npm run e2e`) already fails if this order takes more than 8 taps or 30 seconds.
