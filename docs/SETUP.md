# Security Scheduler — Setup Guide

## Prerequisites

- Node.js 18+ / Bun
- A Supabase project
- A Google Cloud project with Sheets API enabled

## 1. Clone and Install

```bash
bun install
cp .env.local.example .env.local
```

## 2. Supabase Setup

### Create Project
1. Go to [supabase.com](https://supabase.com) and create a new project
2. Copy your project URL and anon key to `.env.local`
3. Copy your service role key to `.env.local`

### Run Migration
1. Open the SQL Editor in your Supabase dashboard
2. Paste the contents of `supabase/migrations/001_initial_schema.sql`
3. Run the query

### Configure Google SSO
1. In Supabase dashboard → Authentication → Providers → Google
2. Enable Google provider
3. Add your Google OAuth client ID and secret
4. Set the redirect URL to `http://localhost:3000/auth/callback` (development)
5. In Google Cloud Console, add the Supabase redirect URL to your OAuth consent screen

## 3. Google Sheets API Setup

### Create Service Account
1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Enable the Google Sheets API
3. Create a service account (IAM → Service Accounts → Create)
4. Create a JSON key for the service account
5. Copy `client_email` and `private_key` to `.env.local`

### Share the Sheet
1. Open your master Google Sheet
2. Share it with the service account email (read-only)
3. Copy the spreadsheet ID from the URL and add to `.env.local`
   - URL format: `https://docs.google.com/spreadsheets/d/{SPREADSHEET_ID}/edit`

## 4. Run Development Server

```bash
bun dev
```

Open [http://localhost:3000](http://localhost:3000).

## 5. First User Setup

1. Log in with Google — you'll be created as an `epo` by default
2. To promote yourself to management, run in Supabase SQL Editor:
   ```sql
   update profiles set role = 'management' where email = 'your-email@gmail.com';
   ```
