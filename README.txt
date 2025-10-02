# RSH × Stake — Wager Leaderboard

A polished, production-ready static site. No backend required.

## Quick Start
1. Open **index.html** locally to preview with the included `sample.csv` by using the Settings (⚙️) button and pasting your real Google Sheet link.
2. Make sure your Google Sheet has these headers (case-insensitive):
   - `affiliate_name` · `campaign_code` · `user_name` · `wagered` · `rank` (optional)
3. Sharing: set the sheet to **Anyone with the link (Viewer)**.
4. Paste the Google Sheet link in Settings and hit **Save**. The site auto-refreshes every 60s.

**Eligible campaigns**: supper, supper10, suppercap  
**Dates**: Sep 1, 2025 → Oct 1, 2025  
**Prize Pool**: $1000 split: 50% / 25% / 12.5% / 7.5% / 5%

## Deploy
- **Netlify**: drag the folder or connect a repo. (No build step needed.)
- **Vercel**: “Deploy” → Framework “Other”.  
- **GitHub Pages**: push and enable Pages on the main branch.

## Notes
- We aggregate multiple rows per user and sort by total wagered.
- Top 5 show prize amounts automatically.
- Search live by username/campaign. Auto-refresh interval configurable.
- `?gid=XXXX` in your site URL will force a specific tab in the Sheet.
