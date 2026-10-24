# CourseMaster Backend

CourseMaster is a REST API for an e-learning platform. It uses Node.js, Express 5, MongoDB/Mongoose, JWT authentication, bcrypt password hashing, and Zod request validation.

## Requirements

- Node.js 20 or later
- npm
- MongoDB running locally, or a MongoDB connection string

## Run locally

1. Install dependencies:

   ```sh
   npm ci
   ```

2. Copy `.env.example` to `.env` and set at least:

   ```env
   NODE_ENV=development
   PORT=5000
   MONGODB_URI=mongodb://127.0.0.1:27017/coursemaster_test
   JWT_SECRET=<a-long-random-secret>
   ```

   Generate a local JWT secret with:

   ```sh
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```

   Never commit `.env`, production secrets, or real account credentials.

3. Start the API:

   ```sh
   npm run dev
   ```

   The API is available at `http://localhost:5000`. A simple health check is `GET /`.

## Load disposable sample data

The seed script **deletes all users, courses, enrollments, quiz submissions, and assignment submissions** in the selected database before loading fixtures. It is only permitted when `NODE_ENV` is not `production`, `SEED_ALLOW_RESET=true`, and the database name ends in `_test` or `_demo`.

For a local database named `coursemaster_test`, add these settings to `.env` before running the seed:

```env
SEED_ALLOW_RESET=true
SEED_ADMIN_EMAIL=admin@example.test
SEED_ADMIN_PASSWORD=<a-unique-password-at-least-12-characters>
SEED_STUDENT_EMAIL=student@coursemaster.com
SEED_STUDENT_PASSWORD=<a-different-unique-password-at-least-12-characters>
```

Then run:

```sh
npm run seed
```

Use the credentials you set in `.env` to sign in. The seed script does not print passwords. Do not use a production database, real user data, or these sample accounts on a public deployment. Keep `SEED_ALLOW_RESET=false` after seeding.

## Test

Run the automated regression tests:

```sh
npm test
```

The test suite covers password verification, admin registration-key checks, JWT and banned-user handling, enrollment ownership and creation, public quiz-answer filtering, quiz scoring, and seed safety.

## Authentication and roles

- Register with `POST /api/auth/register`. New accounts are students by default.
- Admin registration is disabled unless `ADMIN_REGISTRATION_KEY` is set. To create an admin through registration, provide the matching `adminKey`; a caller-supplied `role` is never trusted.
- Sign in with `POST /api/auth/login`; include the returned JWT on requests to protected endpoints.
- Protected requests verify the token and current user record. Banned or deleted users are rejected, and role changes take effect for existing tokens.

Example:

```sh
curl -X POST http://localhost:5000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"name":"Test Student","email":"student@example.com","password":"replace-this-password"}'
```

```sh
curl -X POST http://localhost:5000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"student@example.com","password":"replace-this-password"}'
```

## API reference

All request and response bodies use JSON unless otherwise noted. Protected routes require a bearer token. Admin routes require a current admin account.

### Authentication

| Method | Path | Access | Purpose |
|---|---|---|---|
| `POST` | `/api/auth/register` | Public | Create a student; optionally create an admin with the configured `adminKey`. |
| `POST` | `/api/auth/login` | Public | Verify credentials and return a JWT. |
| `GET` | `/api/auth/me` | Signed in | Return the current user's profile. |

Registration body:

```json
{
  "name": "Test Student",
  "email": "student@example.com",
  "password": "replace-this-password"
}
```

For configured admin registration, add `"adminKey": "<ADMIN_REGISTRATION_KEY>"`. Passwords must be at least six characters; use a much stronger password outside local testing.

### Courses

| Method | Path | Access | Purpose |
|---|---|---|---|
| `GET` | `/api/courses` | Public | List courses. Supports `page`, `limit`, `search`, `sort=price_asc\|price_desc`, `category`, and comma-separated `tags`. |
| `GET` | `/api/courses/:id` | Public | Get one course. |
| `POST` | `/api/admin/courses` | Admin | Create a course. |
| `PATCH` | `/api/admin/courses/:id` | Admin | Update a course. |
| `DELETE` | `/api/admin/courses/:id` | Admin | Delete a course. |

Public course responses omit quiz `correctIndex` values. Correct answers are used only by the server when grading quiz submissions.

### Enrollments

| Method | Path | Access | Purpose |
|---|---|---|---|
| `POST` | `/api/enrollments/:courseId` | Signed in | Enroll the current user; optional body: `{"batchId":"<batch-id>"}`. |
| `GET` | `/api/enrollments/my` | Signed in | List the current user's enrollments. |
| `PATCH` | `/api/enrollments/:enrollId/complete-lesson` | Signed in | Mark a lesson complete; body: `{"lessonId":"<lesson-id>"}`. Only the enrollment owner can update progress. |

### Assignments

| Method | Path | Access | Purpose |
|---|---|---|---|
| `POST` | `/api/assignments/submit` | Signed in | Submit `{ "courseId", "lessonId", "answerType": "text"\|"link", "answer" }` for an enrolled course. |
| `GET` | `/api/assignments/my` | Signed in | List the current user's submissions; optional `courseId` query. |
| `GET` | `/api/assignments/stats?courseId=:id` | Signed in | Get submission and grading statistics for the current user. |
| `GET` | `/api/admin/assignments` | Admin | List submissions; optional `courseId` query. |
| `PATCH` | `/api/admin/assignments/:id/review` | Admin | Review a submission with `reviewNotes`, `grade`, and/or `status`. |

### Quizzes

| Method | Path | Access | Purpose |
|---|---|---|---|
| `POST` | `/api/quizzes/submit` | Signed in | Submit `{ "courseId", "lessonId", "answers": [0, 2] }` for an enrolled course. |
| `GET` | `/api/quizzes/my` | Signed in | List the current user's quiz submissions; optional `courseId` query. |
| `GET` | `/api/quizzes/stats?courseId=:id` | Signed in | Get the latest score per lesson and course average. |

### Administration and users

| Method | Path | Access | Purpose |
|---|---|---|---|
| `GET` | `/api/admin/enrollments` | Admin | List enrollments; optional `courseId` and `batchId` filters. |
| `GET` | `/api/admin/analytics` | Admin | Get enrollment and platform statistics. |
| `GET` | `/api/users` | Admin | List users without password hashes. |
| `PATCH` | `/api/users/:id/role` | Admin | Change a user's role (`student` or `admin`). |
| `PATCH` | `/api/users/:id/ban` | Admin | Toggle a user's banned state. |
| `DELETE` | `/api/users/:id` | Admin | Delete a user. |

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `MONGODB_URI` (or `MONGO_URI`) | Yes | MongoDB connection string. |
| `JWT_SECRET` | Yes | Long, random secret used to sign and verify tokens. |
| `PORT` | No | HTTP port; defaults to `5000`. |
| `NODE_ENV` | No | Use `development` locally and `production` for production. |
| `ADMIN_REGISTRATION_KEY` | No | Enables admin signup only when a matching `adminKey` is supplied. |
| `EMAIL_SERVICE`, `EMAIL_USER`, `EMAIL_PASSWORD` | No | Optional Nodemailer welcome-email settings. |
| `FRONTEND_URL` | No | Frontend URL included in welcome emails. |
| `SEED_ALLOW_RESET` | Seed only | Must be `true` to confirm database reset; never enable in production. |
| `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD`, `SEED_STUDENT_PASSWORD` | Seed only | Required seed-account settings; passwords must be at least 12 characters. |
| `SEED_STUDENT_EMAIL` | No | Seed student email; defaults to `student@coursemaster.com`. |

## Deployment notes

Set `MONGODB_URI` and a strong `JWT_SECRET` in the deployment platform's secret/environment settings. Configure optional email settings as needed. Never configure the seed reset flag or run the seed command against production data. The project includes a Vercel serverless entry point in `api/index.js`.

## Project layout

```text
api/                 Vercel serverless entry point
src/config/          Database connection
src/controllers/     HTTP controllers
src/middlewares/     Authentication, validation, and errors
src/models/          Mongoose models
src/routes/          Express route definitions
src/services/        Application logic
src/validators/      Zod request schemas
test/                Automated regression tests
```
