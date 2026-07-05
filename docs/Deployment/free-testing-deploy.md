# Free Testing Deployment for CodifyX

This guide sets up CodifyX with free hosting for the frontend and free Render services for the backend APIs.

## What is configured

- `firebase.json` → Static frontend hosting for:
  - `apps/client-web`
  - `apps/worker-web`
  - `apps/admin-web`
- `render.yaml` → Render free plan services for:
  - `codifyx-public-api`
  - `codifyx-admin-api`

## Frontend deployment (Firebase Hosting)

1. Install Firebase CLI if needed:
   - `npm install -g firebase-tools`
2. Log in:
   - `firebase login`
3. Initialize and connect to your Firebase project(s).
   - The repo already contains `firebase.json` and `.firebaserc` with 3 hosting targets.
4. Deploy the three frontend sites:
   - `firebase deploy --only hosting:codifyx-solutions,hosting:codifyx-solutions-worker,hosting:codifyx-solutions-admin`

> Note: The Firebase hosting sites listed in `firebase.json` are sample names. Replace them with your actual project site IDs if needed.

## Backend deployment (Render Free Plan)

1. Push this repo to GitHub.
2. Create a Render account and connect your GitHub repository.
3. Render will auto-detect `render.yaml` and create two services:
   - `codifyx-public-api`
   - `codifyx-admin-api`
4. During service creation, set environment variables:
   - `NODE_ENV=production`
   - `JWT_SECRET` = a random secret string
   - `CORS_ALLOWED_ORIGINS` = comma-separated frontend origins, e.g.
     - `https://codifyx-solutions.web.app,https://codifyx-solutions.firebaseapp.com`
     - `https://codifyx-solutions-admin.web.app,https://codifyx-solutions-admin.firebaseapp.com`
   - Leave `DATABASE_URL` blank to use local SQLite for testing.

## Important deployment notes

- The app currently expects the frontend and backend on the same origin unless `API_BASE` is configured in frontend JS.
- For Firebase-hosted frontends calling Render APIs, update the frontend `API_BASE` configuration before deploy:
  - `apps/client-web/js/common.js`
  - `apps/worker-web/js/common.js`
  - `apps/admin-web/js/common.js`

Example:
```js
const API_BASE = 'https://<your-public-api>.onrender.com';
```
For the admin frontend, use the admin API endpoint if needed.

## Using SQLite on Render

- Render free services can run SQLite in the container filesystem, but the data is ephemeral.
- Perfect for testing and demo environments, but not production.

## Summary

Files added or updated:
- `render.yaml` — Render free plan service definitions
- `apps/public-api/server.js` — Render-compatible `PORT` fallback
- `apps/admin-api/server.js` — Render-compatible `PORT` fallback
- `package.json` — dependency cleanup for root package

CI: GitHub Actions

You can automate validation and deploy triggers using GitHub Actions. A sample workflow is added at `.github/workflows/render-deploy.yml`.

Required repository secrets for automatic deploys:
- `RENDER_API_KEY` — your Render API key (create in Render dashboard -> Account -> API keys)
- `RENDER_PUBLIC_SERVICE_ID` — Render service ID for `codifyx-public-api` (created via Render dashboard)
- `RENDER_ADMIN_SERVICE_ID` — Render service ID for `codifyx-admin-api`

Behavior of the workflow:
- Validates `render.yaml` using the Render CLI (`render blueprints validate`).
- If the two service ID secrets are present, triggers `render deploys create <SERVICE_ID>` for each service.

Notes:
- If you haven't connected this repository in the Render dashboard yet, visit Render, connect your GitHub repo, and let Render auto-detect `render.yaml` to create the services. After services exist, copy their service IDs into GitHub secrets to enable full CI deploys.
- You can also install the Render CLI locally and run `render login` to manage services interactively.

Use this setup to deploy CodifyX in a free testing environment before moving to production.
